import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

// ── Channex.io Channel Manager Gateway ───────────────────────────────────────
//
// Centraliza todo el I/O contra api.channex.io. Ningún módulo externo habla
// con Channex directamente — siempre a través de este gateway.
//
// Auth: header `user-api-key` en cada request (Channex API docs).
// Base URL: CHANNEX_BASE_URL (default: https://app.channex.io/api/v1)
// Política de fallos (CLAUDE.md §31): pushInventory es best-effort.
//   - Si Channex falla, la operación local ya está commiteada → log, NO revertir.
//   - pullAvailability en lecturas normales: fail-soft (retorna fromChannex:false).
//
// Endpoints implementados:
//   GET  /v1/room_types/:id/availabilities?date_from&date_to  (pull allotment)
//   POST /v1/availability                                      (push inventory delta)
//   POST /v1/restrictions                                      (stop-sell, MLOS) — stub
//
// Webhooks inbound (booking_new, booking_modify, booking_cancel):
//   Consumidos en /api/webhooks/channex (ver Sprint 8).

// ── Tipos ─────────────────────────────────────────────────────────────────────

export interface ChannexAvailabilitySlot {
  date: string            // YYYY-MM-DD (día local de la propiedad)
  roomTypeId: string      // Channex room_type_id
  available: number       // allotment total en todos los canales
  stopSell: boolean
}

export interface ChannexInventoryUpdate {
  channexPropertyId?: string  // Property ID en Channex (de PropertySettings.channexPropertyId)
  roomTypeId: string          // Room type ID en Channex (de Room.channexRoomTypeId)
  dateFrom: string            // YYYY-MM-DD (inclusive)
  dateTo: string              // YYYY-MM-DD (inclusive)
  delta: number               // +1 = liberar una unidad, -1 = ocupar una unidad
  reason: 'RESERVATION' | 'CANCELLATION' | 'ROOM_MOVE' | 'SPLIT' | 'BLOCK' | 'RELEASE'
  traceId: string             // ID interno para correlacionar con audit trail
}

export interface ChannexPullResult {
  fromChannex: boolean
  slots: ChannexAvailabilitySlot[]
}

// ── Gateway ──────────────────────────────────────────────────────────────────

@Injectable()
export class ChannexGateway {
  private readonly logger = new Logger(ChannexGateway.name)

  constructor(private readonly config: ConfigService) {}

  private get apiKey(): string | undefined {
    return this.config.get<string>('CHANNEX_API_KEY')
  }

  private get baseUrl(): string {
    return (
      this.config.get<string>('CHANNEX_BASE_URL') ??
      'https://app.channex.io/api/v1'
    )
  }

  /** True si las credenciales están configuradas. Sin ellas, todas las llamadas son no-op. */
  get enabled(): boolean {
    return !!this.apiKey
  }

  // ─── Pull availability ──────────────────────────────────────────────────────
  //
  // Channex endpoint: GET /room_types/:id/availabilities?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
  // Respuesta: { data: [{ attributes: { availability: [{date, availability, stop_sell}] } }] }
  //
  // Fail-soft en lecturas — los consumidores vuelven a datos locales si Channex no responde.
  async pullAvailability(params: {
    roomTypeId: string
    dateFrom: Date
    dateTo: Date
  }): Promise<ChannexPullResult> {
    if (!this.enabled) {
      return { fromChannex: false, slots: [] }
    }

    const from = toDateString(params.dateFrom)
    const to   = toDateString(params.dateTo)
    const url  = `${this.baseUrl}/room_types/${params.roomTypeId}/availabilities?date_from=${from}&date_to=${to}`

    try {
      const res = await fetch(url, {
        headers: {
          'user-api-key': this.apiKey!,
          'Content-Type': 'application/json',
        },
      })

      if (!res.ok) {
        const text = await res.text()
        this.logger.warn(`[Channex] pullAvailability HTTP ${res.status}: ${text}`)
        return { fromChannex: false, slots: [] }
      }

      const json = await res.json() as {
        data?: { attributes?: { availability?: Array<{ date: string; availability: number; stop_sell: boolean }> } }[]
      }

      const raw = json.data?.[0]?.attributes?.availability ?? []
      const slots: ChannexAvailabilitySlot[] = raw.map((item) => ({
        date:       item.date,
        roomTypeId: params.roomTypeId,
        available:  item.availability,
        stopSell:   item.stop_sell,
      }))

      return { fromChannex: true, slots }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.warn(`[Channex] pullAvailability failed: ${msg} — using local data`)
      return { fromChannex: false, slots: [] }
    }
  }

  // ─── Push inventory delta ───────────────────────────────────────────────────
  //
  // Channex endpoint: POST /availability
  // Body: { values: [{ property_id, room_type_id, date, availability }] }
  //
  // Nota: Channex acepta valores ABSOLUTOS, no deltas. Este método envía
  // availability=1 para RELEASE y availability=0 para RESERVATION/BLOCK.
  // Esto es correcto para propiedades con 1 unidad por room_type (boutique hotels).
  // Para propiedades con múltiples unidades, se necesitará pull-then-push (Sprint 8+).
  //
  // IMPORTANTE — Best-effort (CLAUDE.md §31):
  //   La operación local ya fue commiteada antes de llamar aquí.
  //   Si Channex falla, logueamos pero NO lanzamos excepción.
  async pushInventory(update: ChannexInventoryUpdate): Promise<void> {
    if (!this.enabled) return
    // Skip silently if the property has no Channex ID configured (§31 fail-soft)
    if (!update.channexPropertyId) return

    // Generar lista de fechas en el rango (dateFrom inclusive, dateTo inclusive)
    const dates = generateDateRange(update.dateFrom, update.dateTo)
    if (dates.length === 0) return

    // Channex usa valores absolutos: RELEASE (+1 delta) → 1 disponible; todo lo demás → 0
    const absoluteValue = update.delta > 0 ? 1 : 0

    const values = dates.map((date) => ({
      property_id:  update.channexPropertyId,
      room_type_id: update.roomTypeId,
      date,
      availability: absoluteValue,
    }))

    try {
      const res = await fetch(`${this.baseUrl}/availability`, {
        method: 'POST',
        headers: {
          'user-api-key':  this.apiKey!,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ values }),
      })

      if (!res.ok) {
        const text = await res.text()
        // Log pero NO throw — la operación local ya está commiteada
        this.logger.error(
          `[Channex] pushInventory failed HTTP ${res.status} ` +
          `reason=${update.reason} trace=${update.traceId}: ${text}`,
        )
        return
      }

      this.logger.log(
        `[Channex] pushInventory OK reason=${update.reason} ` +
        `dates=${dates.length} delta=${update.delta} trace=${update.traceId}`,
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // Best-effort: loguear y continuar (CLAUDE.md §31)
      this.logger.error(
        `[Channex] pushInventory network error reason=${update.reason} trace=${update.traceId}: ${msg}`,
      )
    }
  }

  // ─── Push stop-sell ─────────────────────────────────────────────────────────
  //
  // Channex endpoint: POST /restrictions
  // Usada cuando la propiedad bloquea venta (renovación, mantenimiento).
  async pushStopSell(params: {
    channexPropertyId: string
    roomTypeId: string
    dateFrom: Date
    dateTo: Date
    stopSell: boolean
    traceId: string
  }): Promise<void> {
    if (!this.enabled) return

    const dates = generateDateRange(toDateString(params.dateFrom), toDateString(params.dateTo))
    if (dates.length === 0) return

    const values = dates.map((date) => ({
      property_id:  params.channexPropertyId,
      room_type_id: params.roomTypeId,
      date,
      stop_sell:    params.stopSell,
    }))

    try {
      const res = await fetch(`${this.baseUrl}/restrictions`, {
        method: 'POST',
        headers: {
          'user-api-key': this.apiKey!,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values }),
      })

      if (!res.ok) {
        const text = await res.text()
        this.logger.error(
          `[Channex] pushStopSell failed HTTP ${res.status} trace=${params.traceId}: ${text}`,
        )
        return
      }

      this.logger.log(`[Channex] pushStopSell OK stopSell=${params.stopSell} trace=${params.traceId}`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`[Channex] pushStopSell network error trace=${params.traceId}: ${msg}`)
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0]
}

/** Genera todas las fechas entre from y to (ambas inclusive), formato YYYY-MM-DD. */
function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = []
  const current = new Date(`${from}T00:00:00Z`)
  const end     = new Date(`${to}T00:00:00Z`)
  while (current <= end) {
    dates.push(toDateString(current))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}
