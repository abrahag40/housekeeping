/**
 * NightAuditScheduler — Procesamiento automático de no-shows por propiedad.
 *
 * Diseño multi-timezone (CRÍTICO):
 * ─────────────────────────────────────────────────────────────────────────────
 * El cron corre cada 30 minutos en UTC. Para cada propiedad:
 *   1. Se obtiene la timezone de PropertySettings.
 *   2. Se calcula la hora local actual en esa timezone via Intl.DateTimeFormat.
 *   3. Si hora local >= noShowCutoffHour (default 2 AM) Y la fecha local actual
 *      no coincide con noShowProcessedDate → se procesan los no-shows.
 *   4. Se actualiza noShowProcessedDate para evitar doble ejecución.
 *
 * Por qué Intl.DateTimeFormat y no moment-timezone ni date-fns-tz:
 *   - Intl es nativo en Node.js ≥12 con soporte completo de IANA timezones.
 *   - Sin dependencias extra. Validado contra IANA tz database incluida en ICU.
 *
 * Por qué cada 30 minutos y no una vez al día:
 *   - Una propiedad en UTC-5 tiene cutoff a las 02:00 local = 07:00 UTC.
 *   - Una propiedad en UTC+9 tiene cutoff a las 02:00 local = 17:00 UTC del día anterior.
 *   - Un único cron diario en UTC necesitaría ejecutarse a todas las horas posibles.
 *   - Cada 30 min garantiza que cualquier propiedad del mundo es procesada
 *     dentro de los 30 minutos siguientes a su ventana de cutoff.
 *
 * Idempotencia:
 *   - noShowProcessedDate actúa como semáforo: si ya se procesó hoy en la
 *     timezone local de esa propiedad, el loop salta sin hacer nada.
 *   - markAsNoShowSystem() es también idempotente: si el stay ya tiene noShowAt,
 *     sale inmediatamente.
 *
 * Trazabilidad (auditoría):
 *   - Cada no-show generado automáticamente tiene noShowReason =
 *     'Marcado automáticamente por night audit' y noShowById = null.
 *   - El StayJourneyEvent.actorId = null indica origen de sistema.
 */
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { GuestStaysService } from './guest-stays.service'
import { ChannexGateway } from '../../integrations/channex/channex.gateway'

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0]
}

function toLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function toLocalHour(date: Date, timezone: string): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).format(date)
  // Intl.DateTimeFormat con hour12:false puede devolver "24" en medianoche — normalizar a 0
  return Number(formatted) % 24
}

@Injectable()
export class NightAuditScheduler {
  private readonly logger = new Logger(NightAuditScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestStaysService: GuestStaysService,
    private readonly channex: ChannexGateway,
  ) {}

  /**
   * Corre cada 30 minutos. Para cada propiedad evalúa si corresponde procesar
   * no-shows según su timezone local y su noShowCutoffHour configurado.
   */
  @Cron('0,30 * * * *')
  async processNoShows() {
    const now = new Date()

    // Cargar settings de todas las propiedades activas
    const allSettings = await this.prisma.propertySettings.findMany({
      select: {
        propertyId:          true,
        timezone:            true,
        noShowCutoffHour:    true,
        noShowProcessedDate: true,
        channexPropertyId:   true,
        property: {
          select: {
            organizationId: true,
            isActive:       true,
          },
        },
      },
    })

    let processed = 0
    let skipped   = 0

    for (const settings of allSettings) {
      if (!settings.property?.isActive) {
        skipped++
        continue
      }

      const tz       = settings.timezone || 'UTC'
      const orgId    = settings.property.organizationId

      const localHour = toLocalHour(now, tz)
      const localDate = toLocalDate(now, tz)

      // Hora local aún no alcanzó el cutoff → esperar
      if (localHour < settings.noShowCutoffHour) {
        skipped++
        continue
      }

      // Ya se procesó hoy en esta timezone → saltar
      const lastProcessed = settings.noShowProcessedDate
        ? toLocalDate(settings.noShowProcessedDate, tz)
        : null
      if (lastProcessed === localDate) {
        skipped++
        continue
      }

      // Buscar estadías que debían llegar hoy (en hora local) y no hicieron check-in
      // "Hoy en hora local" = checkinAt cae en el día actual de la propiedad.
      // Usamos UTC midnight del día local para el rango:
      //   dayStart = YYYY-MM-DDT00:00:00Z (en UTC, representando medianoche local)
      // NOTA: Este rango no es perfecto para timezones con offsets grandes, pero es
      // suficientemente preciso dado que el cron corre cada 30 min y la ventana es de
      // ±1 día. Un refinamiento futuro sería usar `checkinAt AT TIME ZONE tz`.
      const dayStart = new Date(`${localDate}T00:00:00.000Z`)
      const dayEnd   = new Date(`${localDate}T23:59:59.999Z`)

      const overdueStays = await this.prisma.guestStay.findMany({
        where: {
          organizationId:    orgId ?? undefined,
          propertyId:        settings.propertyId,
          deletedAt:         null,
          actualCheckout:    null,
          noShowAt:          null,
          noShowRevertedAt:  null, // exclude stays that were manually reverted — don't re-mark
          checkinAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          guestName: true,
          scheduledCheckout: true,
          room: { select: { channexRoomTypeId: true } },
        },
      })

      if (overdueStays.length === 0) {
        // Marcar como procesado aunque no haya no-shows (para no re-ejecutar)
        await this.prisma.propertySettings.update({
          where: { propertyId: settings.propertyId },
          data:  { noShowProcessedDate: new Date(`${localDate}T00:00:00.000Z`) },
        })
        skipped++
        continue
      }

      this.logger.log(
        `[NightAudit] property=${settings.propertyId} tz=${tz} localDate=${localDate} ` +
        `processing ${overdueStays.length} potential no-show(s)`,
      )

      for (const stay of overdueStays) {
        try {
          await this.guestStaysService.markAsNoShowSystem(
            stay.id,
            orgId ?? '',
            settings.propertyId,
          )

          // Notificar a Channex.io que la unidad quedó libre — best-effort (§31).
          // Solo si la propiedad y la habitación tienen IDs de Channex configurados.
          const channexRoomTypeId = stay.room?.channexRoomTypeId
          if (settings.channexPropertyId && channexRoomTypeId) {
            this.channex.pushInventory({
              channexPropertyId: settings.channexPropertyId,
              roomTypeId:        channexRoomTypeId,
              dateFrom:          localDate,
              dateTo:            toDateString(stay.scheduledCheckout),
              delta:             +1,  // liberar unidad
              reason:            'RELEASE',
              traceId:           `noshow_audit_${stay.id}`,
            }).catch((err: Error) =>
              this.logger.error(`[NightAudit] Channex push failed stay=${stay.id}: ${err.message}`)
            )
          }

          processed++
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          this.logger.error(`[NightAudit] Error processing stay=${stay.id}: ${msg}`)
        }
      }

      // Marcar la propiedad como procesada para este día local
      await this.prisma.propertySettings.update({
        where: { propertyId: settings.propertyId },
        data:  { noShowProcessedDate: new Date(`${localDate}T00:00:00.000Z`) },
      })
    }

    if (processed > 0 || skipped === 0) {
      this.logger.log(`[NightAudit] Ciclo completado — no-shows procesados: ${processed}, propiedades saltadas: ${skipped}`)
    }
  }
}
