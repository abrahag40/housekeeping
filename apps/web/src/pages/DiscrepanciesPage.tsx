/*
 * DiscrepanciesPage.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DESIGN DOCUMENT — Bed-Swapping Problem in Hostel Housekeeping
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## The Problem
 * In shared dormitories, guests frequently move to a different bed from their
 * assigned one without notifying reception. This creates a data inconsistency:
 *
 *   System view:  Bed A = "checkout" (needs cleaning)  |  Bed B = "occupied"
 *   Physical:     Bed A = still occupied               |  Bed B = empty
 *
 * When housekeeping arrives to clean Bed A and finds a sleeping guest, the
 * result is operational friction, potential conflict, and lost trust.
 *
 * ## How Competitors Handle This
 *
 * Research findings (Mews, Beds24, Little Hotelier, Sirvoy):
 *
 * 1. **Mews**: Offers "Space Move" in the timeline view — a receptionist can
 *    drag reservations across room/bed slots. Housekeeping assignments update
 *    automatically. No mobile "guest moved" report from housekeepers.
 *
 * 3. **Little Hotelier**: Simple grid; no bed-level swap flow. Staff must
 *    handle discrepancies via manual notes or phone.
 *
 * 4. **Beds24**: Supports bed-level bookings with a "Move Booking" action.
 *    Housekeepers can flag beds via a basic notes field. No structured alert.
 *
 * 5. **Hostelworld / HostelManager**: These are OTAs/channel managers, not
 *    operational PMS. They surface inventory but delegate discrepancy handling
 *    entirely to the property's PMS.
 *
 * 6. **Sirvoy**: Minimal housekeeping module; discrepancies are handled via
 *    free-text notes to reception. No structured flow.
 *
 * **Common pattern across all tools**: Reception-driven room-move is universal.
 * Housekeeper-initiated "I found a guest in this bed" reports are absent or
 * handled via informal channels (WhatsApp, phone). This is a gap.
 *
 * ## Our Solution Design
 *
 * ### Mobile (Housekeeping App) — Trigger
 * On the task detail screen, housekeepers see a "¿Problema con esta cama?"
 * button. Tapping it opens a bottom sheet with four quick-select options:
 *   • "Cama ocupada (huésped no hizo checkout)" → BED_STATUS_MISMATCH
 *   • "Huésped extendió su estancia" → GUEST_EXTENSION
 *   • "Cama ocupada sin reserva" → UNEXPECTED_OCCUPANCY
 *   • "Otro problema" → OTHER
 * The housekeeper optionally adds a short note and submits. This calls
 * POST /discrepancies. An SSE event (discrepancy:reported) fires immediately.
 *
 * ### Web Dashboard (Reception) — Alert
 * A persistent amber banner appears at the top of RoomsPage when there are
 * OPEN discrepancies. It shows count + a link to /discrepancies.
 * Reception staff also sees a badge on the Sidebar "Discrepancias" link.
 * Clicking "Reconocer" acknowledges the discrepancy (PATCH .../acknowledge),
 * stopping the banner from re-appearing while reception investigates.
 *
 * ### Resolution Flow
 * 1. Housekeeper reports → status = OPEN (SSE fires)
 * 2. Reception sees banner → reviews beds in /rooms or /discrepancies
 * 3. Reception calls or checks physically, then does one of:
 *    a. Room-move in PMS (Mews/Zenix) → re-syncs bed state
 *    b. Manual checkout + re-assign → corrects the system
 * 4. Reception clicks "Resolver" on /discrepancies, optionally adding a
 *    resolution note → status = RESOLVED
 * 5. Housekeeper can now safely clean or skip the bed.
 *
 * ### Why This Works Better Than Competitors
 * - Structured report type (not free-text) enables analytics on swap frequency
 * - Real-time SSE alert to reception means zero lag
 * - Acknowledge step prevents alert spam while investigating
 * - Audit trail (createdAt, resolvedAt, reportedBy, resolvedBy) for ops review
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { formatDistanceToNow, format } from 'date-fns'
import { es } from 'date-fns/locale'
import { api } from '../api/client'
import { useSSE } from '../hooks/useSSE'
import type { UnitDiscrepancyDto, SseEvent } from '@zenix/shared'
import { DiscrepancyStatus, DiscrepancyType } from '@zenix/shared'

// ─── Config ───────────────────────────────────────────────────────────────────

const TYPE_CFG: Record<DiscrepancyType, { label: string; color: string; bg: string; border: string }> = {
  [DiscrepancyType.BED_STATUS_MISMATCH]: {
    label: 'Estado incorrecto',
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
  },
  [DiscrepancyType.GUEST_EXTENSION]: {
    label: 'Huésped extendió',
    color: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  [DiscrepancyType.UNEXPECTED_OCCUPANCY]: {
    label: 'Ocupación inesperada',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
  },
  [DiscrepancyType.OTHER]: {
    label: 'Otro',
    color: 'text-gray-700',
    bg: 'bg-gray-50',
    border: 'border-gray-200',
  },
}

const STATUS_CFG: Record<DiscrepancyStatus, { label: string; dot: string }> = {
  [DiscrepancyStatus.OPEN]:         { label: 'Abierta',      dot: 'bg-red-500' },
  [DiscrepancyStatus.ACKNOWLEDGED]: { label: 'Reconocida',   dot: 'bg-amber-500' },
  [DiscrepancyStatus.RESOLVED]:     { label: 'Resuelta',     dot: 'bg-green-500' },
}

type FilterStatus = 'ALL' | DiscrepancyStatus

// ─── Page ─────────────────────────────────────────────────────────────────────

export function DiscrepanciesPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<FilterStatus>('ALL')
  const [resolveTarget, setResolveTarget] = useState<UnitDiscrepancyDto | null>(null)

  const { data: discrepancies = [], isLoading } = useQuery<UnitDiscrepancyDto[]>({
    queryKey: ['discrepancies'],
    queryFn: () => api.get('/discrepancies'),
  })

  // Live updates via SSE
  const handleSSE = useCallback(
    (event: SseEvent) => {
      if (event.type === 'discrepancy:reported') {
        qc.invalidateQueries({ queryKey: ['discrepancies'] })
        toast('Nueva discrepancia reportada', { icon: '⚠️' })
      }
    },
    [qc],
  )
  useSSE(handleSSE)

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/discrepancies/${id}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discrepancies'] })
      toast.success('Discrepancia reconocida')
    },
    onError: () => toast.error('Error al reconocer'),
  })

  const filtered = filter === 'ALL'
    ? discrepancies
    : discrepancies.filter((d) => d.status === filter)

  const openCount = discrepancies.filter((d) => d.status === DiscrepancyStatus.OPEN).length
  const ackCount  = discrepancies.filter((d) => d.status === DiscrepancyStatus.ACKNOWLEDGED).length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        Cargando discrepancias...
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Discrepancias de Camas</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Incidencias reportadas por housekeeping · tiempo real
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            {openCount > 0 && (
              <span className="flex items-center gap-1.5 border rounded-full px-3 py-1 bg-red-50 text-red-700 border-red-200">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {openCount} abiert{openCount === 1 ? 'a' : 'as'}
              </span>
            )}
            {ackCount > 0 && (
              <span className="flex items-center gap-1.5 border rounded-full px-3 py-1 bg-amber-50 text-amber-700 border-amber-200">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                {ackCount} en revisión
              </span>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {(['ALL', DiscrepancyStatus.OPEN, DiscrepancyStatus.ACKNOWLEDGED, DiscrepancyStatus.RESOLVED] as FilterStatus[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === s
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {s === 'ALL' ? 'Todas' : STATUS_CFG[s].label}
                {s !== 'ALL' && (
                  <span className="ml-1.5 text-gray-400">
                    ({discrepancies.filter((d) => d.status === s).length})
                  </span>
                )}
              </button>
            ),
          )}
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-sm font-medium text-gray-700">
              {filter === 'ALL' ? 'Sin discrepancias registradas' : 'Sin resultados para este filtro'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Housekeeping reportará incidencias desde la app móvil
            </p>
          </div>
        )}

        {/* List */}
        <div className="space-y-3">
          {filtered.map((d) => (
            <DiscrepancyCard
              key={d.id}
              discrepancy={d}
              onAcknowledge={() => acknowledgeMutation.mutate(d.id)}
              onResolve={() => setResolveTarget(d)}
              isAcknowledging={acknowledgeMutation.isPending && acknowledgeMutation.variables === d.id}
            />
          ))}
        </div>
      </div>

      {resolveTarget && (
        <ResolveModal
          discrepancy={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onResolved={() => {
            setResolveTarget(null)
            qc.invalidateQueries({ queryKey: ['discrepancies'] })
          }}
        />
      )}
    </>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function DiscrepancyCard({
  discrepancy: d,
  onAcknowledge,
  onResolve,
  isAcknowledging,
}: {
  discrepancy: UnitDiscrepancyDto
  onAcknowledge: () => void
  onResolve: () => void
  isAcknowledging: boolean
}) {
  const typeCfg   = TYPE_CFG[d.type]
  const statusCfg = STATUS_CFG[d.status]
  const isOpen    = d.status === DiscrepancyStatus.OPEN
  const isAck     = d.status === DiscrepancyStatus.ACKNOWLEDGED
  const isResolved = d.status === DiscrepancyStatus.RESOLVED

  const bedLabel   = d.unit?.label   ?? d.unitId
  const roomNumber = d.unit?.room?.number ?? '—'

  return (
    <div className={`bg-white border rounded-xl overflow-hidden ${isOpen ? 'border-red-300 shadow-sm' : 'border-gray-200'}`}>
      {/* Top stripe for open items */}
      {isOpen && <div className="h-1 bg-red-400" />}

      <div className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          {/* Left: location + type */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 text-sm">
                Hab. {roomNumber} · {bedLabel}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full border font-medium ${typeCfg.color} ${typeCfg.bg} ${typeCfg.border}`}
              >
                {typeCfg.label}
              </span>
              <span className="flex items-center gap-1 text-xs text-gray-400">
                <span className={`w-1.5 h-1.5 rounded-full ${statusCfg.dot}`} />
                {statusCfg.label}
              </span>
            </div>

            {/* Description */}
            {d.description && (
              <p className="text-sm text-gray-600 mt-1.5 leading-snug">"{d.description}"</p>
            )}

            {/* Meta */}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-xs text-gray-400">
              {d.reportedBy && <span>Reportado por {d.reportedBy.name}</span>}
              <span title={format(new Date(d.createdAt), "d MMM yyyy 'a las' HH:mm", { locale: es })}>
                {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true, locale: es })}
              </span>
              {isResolved && d.resolvedAt && (
                <span className="text-green-600">
                  Resuelto {formatDistanceToNow(new Date(d.resolvedAt), { addSuffix: true, locale: es })}
                </span>
              )}
            </div>

            {/* Resolution note */}
            {isResolved && d.resolution && (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 mt-2">
                Resolución: {d.resolution}
              </p>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex gap-2 shrink-0">
            {isOpen && (
              <button
                onClick={onAcknowledge}
                disabled={isAcknowledging}
                className="px-3 py-1.5 text-xs font-medium border border-amber-300 text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors disabled:opacity-50"
              >
                {isAcknowledging ? '...' : 'Reconocer'}
              </button>
            )}
            {(isOpen || isAck) && (
              <button
                onClick={onResolve}
                className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Resolver
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Resolve modal ─────────────────────────────────────────────────────────────

function ResolveModal({
  discrepancy,
  onClose,
  onResolved,
}: {
  discrepancy: UnitDiscrepancyDto
  onClose: () => void
  onResolved: () => void
}) {
  const [resolution, setResolution] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/discrepancies/${discrepancy.id}/resolve`, { resolution: resolution || undefined }),
    onSuccess: () => {
      toast.success('Discrepancia resuelta')
      onResolved()
    },
    onError: () => toast.error('Error al resolver'),
  })

  const bedLabel   = discrepancy.unit?.label   ?? discrepancy.unitId
  const roomNumber = discrepancy.unit?.room?.number ?? '—'
  const typeCfg    = TYPE_CFG[discrepancy.type]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 bg-indigo-50">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900 text-sm">
                Resolver Discrepancia
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Hab. {roomNumber} · {bedLabel} ·{' '}
                <span className={`font-medium ${typeCfg.color}`}>{typeCfg.label}</span>
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {discrepancy.description && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-600">
              <p className="text-xs font-medium text-gray-400 mb-1">Reporte original</p>
              "{discrepancy.description}"
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Nota de resolución (opcional)
            </label>
            <textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
              placeholder="Ej: Se hizo room-move en el PMS, huésped confirmó cama correcta..."
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-300 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? 'Resolviendo...' : 'Marcar como Resuelta'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
