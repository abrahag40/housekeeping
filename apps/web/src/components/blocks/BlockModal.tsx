/**
 * BlockModal v3 — Formulario para crear bloqueos de habitación.
 *
 * Layout: 2 columnas balanceadas (Alcance | Tipo + Fechas).
 * - Columna izquierda: Alcance del bloqueo (scope, habitación, unidad, tipo semántico)
 * - Columna derecha:   Motivo + Fechas + Instrucciones
 *
 * Cambios v3 (Sprint 8G — ronda 2):
 * - Motivo movido a columna derecha para equilibrar alturas
 * - Segmented control pill en lugar de radios para el alcance
 * - Cards semánticas sin <input type="radio"> — ARIA puro (role="radiogroup")
 * - Badge "Más usado" absolute-positioned (uniform card height 84px)
 * - Tipografía: escala de 4 tamaños (11px / 12px / 14px / 18px)
 * - × fantasma 24×24 para limpiar fecha fin
 * - hover:bg-gray-50 en cards no seleccionadas
 * - Descripciones de card: text-gray-500 (no text-gray-400)
 */
import { useState, useEffect, useRef } from 'react'
import { Lock, AlertTriangle } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  BlockSemantic,
  BlockReason,
  HousekeepingRole,
  PropertyType,
  type CreateBlockDto,
  type RoomDto,
  type UnitDto,
} from '@zenix/shared'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { usePropertySettings } from '../../hooks/usePropertySettings'
import { SEMANTIC_LABELS, REASON_LABELS } from '../../pages/BlocksPage'

// ─── Motivos válidos por semántica ────────────────────────────────────────────

const REASONS_BY_SEMANTIC: Record<BlockSemantic, BlockReason[]> = {
  [BlockSemantic.OUT_OF_SERVICE]: [
    BlockReason.MAINTENANCE,
    BlockReason.DEEP_CLEANING,
    BlockReason.INSPECTION,
    BlockReason.PHOTOGRAPHY,
    BlockReason.VIP_SETUP,
    BlockReason.OTHER,
  ],
  [BlockSemantic.OUT_OF_ORDER]: [
    BlockReason.PEST_CONTROL,
    BlockReason.WATER_DAMAGE,
    BlockReason.ELECTRICAL,
    BlockReason.PLUMBING,
    BlockReason.STRUCTURAL,
    BlockReason.OTHER,
  ],
  [BlockSemantic.OUT_OF_INVENTORY]: [
    BlockReason.RENOVATION,
    BlockReason.OTHER,
  ],
  [BlockSemantic.HOUSE_USE]: [
    BlockReason.OWNER_STAY,
    BlockReason.STAFF_USE,
    BlockReason.OTHER,
  ],
}

// Motivos que fuerzan un semantic específico
const FORCE_OOO = new Set([
  BlockReason.PEST_CONTROL,
  BlockReason.WATER_DAMAGE,
  BlockReason.ELECTRICAL,
  BlockReason.STRUCTURAL,
])
const FORCE_OOI = new Set([BlockReason.RENOVATION])

// Descripción breve por semantic — lenguaje del operador
const SEMANTIC_DESCRIPTIONS: Record<BlockSemantic, string> = {
  [BlockSemantic.OUT_OF_SERVICE]:   'Problema menor. Venta posible en emergencia.',
  [BlockSemantic.OUT_OF_ORDER]:     'Inhabilitada. Sale del inventario. Requiere aprobación.',
  [BlockSemantic.OUT_OF_INVENTORY]: 'Largo plazo (renovación). Fuera del inventario operativo.',
  [BlockSemantic.HOUSE_USE]:        'Uso interno: fotografía, capacitación, personal.',
}

// ─── Tipo de respuesta del check de disponibilidad ────────────────────────────

interface AvailabilityConflict {
  source: 'LOCAL_STAY' | 'LOCAL_SEGMENT'
  label: string
  from: string
  to: string
}

interface AvailabilityCheckResult {
  available: boolean
  conflicts: AvailabilityConflict[]
}

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function isoToday() {
  return new Date().toISOString().split('T')[0]
}

function addDaysToIso(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BlockModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (dto: CreateBlockDto) => Promise<void>
  prefillRoomId?: string
  prefillUnitId?: string
  prefillStartDate?: string
  prefillEndDate?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BlockModal({
  isOpen,
  onClose,
  onSubmit,
  prefillRoomId,
  prefillUnitId,
  prefillStartDate,
  prefillEndDate,
}: BlockModalProps) {
  const user         = useAuthStore((s) => s.user)
  const isSupervisor = user?.role === HousekeepingRole.SUPERVISOR
  const { propertyType } = usePropertySettings()
  const isHotel = propertyType === PropertyType.HOTEL

  const formRef = useRef<HTMLFormElement>(null)

  const [scope, setScope]                   = useState<'unit' | 'room'>('unit')
  const [roomId, setRoomId]                 = useState(prefillRoomId ?? '')
  const [unitId, setUnitId]                 = useState(prefillUnitId ?? '')
  const [semantic, setSemantic]             = useState<BlockSemantic>(BlockSemantic.OUT_OF_SERVICE)
  const [reason, setReason]                 = useState<BlockReason>(BlockReason.MAINTENANCE)
  const [notes, setNotes]                   = useState('')
  const [startDate, setStartDate]           = useState(isoToday())
  const [endDate, setEndDate]               = useState('')
  const [isSubmitting, setIsSubmitting]     = useState(false)
  const [error, setError]                   = useState('')
  const [showEndDateWarning, setShowEndDateWarning] = useState(false)

  const { data: rooms = [] } = useQuery<RoomDto[]>({
    queryKey: ['rooms-for-block'],
    queryFn: () => api.get<RoomDto[]>('/rooms'),
    enabled: isOpen,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const selectedRoom              = rooms.find((r) => r.id === roomId)
  const unitsForRoom: UnitDto[]   = (selectedRoom as any)?.units ?? []

  // ── Pre-flight: verificar disponibilidad cuando hay habitación + fechas ────
  // Se dispara cada vez que cambia roomId, startDate o endDate.
  // Usamos el roomId directo (scope=room) o el roomId de la unidad seleccionada.
  const effectiveRoomId = scope === 'room' ? roomId : selectedRoom?.id ?? ''
  const availEnabled = isOpen && !!effectiveRoomId && !!startDate

  const { data: availData, isFetching: availLoading } = useQuery<AvailabilityCheckResult>({
    queryKey: ['block-availability', effectiveRoomId, startDate, endDate],
    queryFn: () => {
      const params = new URLSearchParams({ roomId: effectiveRoomId, startDate })
      if (endDate) params.set('endDate', endDate)
      return api.get<AvailabilityCheckResult>(`/blocks/check-availability?${params}`)
    },
    enabled: availEnabled,
    staleTime: 0,
    retry: false,
  })

  const hasConflict = availData !== undefined && !availData.available

  // ── reason ↔ semantic — sin useEffect circular ────────────────────────────

  const handleReasonChange = (newReason: BlockReason) => {
    setReason(newReason)
    if (FORCE_OOO.has(newReason))      setSemantic(BlockSemantic.OUT_OF_ORDER)
    else if (FORCE_OOI.has(newReason)) setSemantic(BlockSemantic.OUT_OF_INVENTORY)
  }

  const handleSemanticChange = (newSemantic: BlockSemantic) => {
    setSemantic(newSemantic)
    if (!REASONS_BY_SEMANTIC[newSemantic].includes(reason)) {
      setReason(REASONS_BY_SEMANTIC[newSemantic][0])
    }
  }

  // Reset al abrir — isHotel excluded from deps to avoid re-resetting while open
  useEffect(() => {
    if (!isOpen) return
    const start = prefillStartDate ?? isoToday()
    setScope(isHotel ? 'room' : (prefillUnitId ? 'unit' : 'room'))
    setRoomId(prefillRoomId ?? '')
    setUnitId(prefillUnitId ?? '')
    setSemantic(BlockSemantic.OUT_OF_SERVICE)
    setReason(BlockReason.MAINTENANCE)
    setNotes('')
    setStartDate(start)
    setEndDate(prefillEndDate ?? addDaysToIso(start, 1))
    setError('')
    setShowEndDateWarning(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, prefillRoomId, prefillUnitId, prefillStartDate, prefillEndDate])

  // When hotel mode resolves after open, force scope to 'room' without resetting the form
  useEffect(() => {
    if (isOpen && isHotel) setScope('room')
  }, [isHotel, isOpen])

  // Atajos: Escape → cerrar, Cmd/Ctrl+Enter → submit
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') formRef.current?.requestSubmit()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (scope === 'room' && !roomId) { setError('Selecciona una habitación'); return }
    if (scope === 'unit' && !unitId) { setError('Selecciona una unidad'); return }
    if (reason === BlockReason.OTHER && !notes.trim()) {
      setError('Agrega una nota cuando el motivo es "Otro"')
      return
    }
    if (endDate && endDate <= startDate) {
      setError('La fecha de fin debe ser posterior al inicio')
      return
    }

    // Advertencia suave — primer intento sin fecha fin
    if (!endDate && !showEndDateWarning) {
      setShowEndDateWarning(true)
      return
    }

    const dto: CreateBlockDto = {
      ...(scope === 'room' ? { roomId } : { unitId }),
      semantic,
      reason,
      notes: notes.trim() || undefined,
      startDate,
      endDate: endDate || undefined,
    }

    setIsSubmitting(true)
    setShowEndDateWarning(false)
    try {
      await onSubmit(dto)
    } catch (err: any) {
      setError(err?.message ?? 'Error al crear el bloqueo')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const validReasons     = REASONS_BY_SEMANTIC[semantic]
  const isForcedSemantic = FORCE_OOO.has(reason) || FORCE_OOI.has(reason)
  const needsApproval    =
    semantic === BlockSemantic.OUT_OF_ORDER ||
    semantic === BlockSemantic.OUT_OF_INVENTORY

  const ctaLabel = isSubmitting
    ? 'Procesando…'
    : needsApproval
      ? 'Solicitar aprobación'
      : 'Crear bloqueo'

  // ── Quick-pickers config ───────────────────────────────────────────────────
  const QUICK_PICKS = [
    { label: 'Hoy',  days: 0 },
    { label: '+1 d', days: 1 },
    { label: '+3 d', days: 3 },
    { label: '+7 d', days: 7 },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-[832px] bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-[18px] font-semibold text-gray-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-gray-500" />
            Nuevo bloqueo
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-base leading-none"
          >
            ✕
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col min-h-0">

          {/* ── 2-column body ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 overflow-y-auto">

            {/* ─ Left — Alcance del bloqueo ─────────────────────────────── */}
            <div className="px-6 py-5 space-y-4 border-r border-gray-100">

              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Alcance del bloqueo
              </p>

              {/* Toggle — Habitación completa (solo hostales con habitaciones compartidas) */}
              {!isHotel && (
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={scope === 'room'}
                    onClick={() => { setScope(scope === 'room' ? 'unit' : 'room'); setUnitId('') }}
                    className={[
                      'relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
                      scope === 'room' ? 'bg-indigo-600' : 'bg-gray-200',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-150',
                        scope === 'room' ? 'translate-x-[18px]' : 'translate-x-0.5',
                      ].join(' ')}
                    />
                  </button>
                  <span className="text-sm font-medium text-gray-700">Habitación completa</span>
                </label>
              )}

              {/* Habitación */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Habitación
                </label>
                <select
                  value={roomId}
                  onChange={(e) => { setRoomId(e.target.value); setUnitId('') }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required={scope === 'room' || scope === 'unit'}
                >
                  <option value="">— Selecciona habitación —</option>
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Hab. {r.number}{r.floor ? ` · Piso ${r.floor}` : ''} · {r.category === 'SHARED' ? 'Dormitorio' : 'Privada'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Unidad (conditional — oculta en hoteles donde toda hab. es privada) */}
              {!isHotel && scope === 'unit' && roomId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Unidad
                  </label>
                  {unitsForRoom.length === 0 ? (
                    <p className="text-sm text-gray-400 italic">
                      Esta habitación no tiene unidades registradas
                    </p>
                  ) : (
                    <select
                      value={unitId}
                      onChange={(e) => setUnitId(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      required
                    >
                      <option value="">— Selecciona unidad —</option>
                      {unitsForRoom.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label} · {u.status}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {/* Tipo de bloqueo — semantic cards */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tipo de bloqueo
                </label>

                <div
                  role="radiogroup"
                  aria-label="Tipo de bloqueo"
                  className="grid grid-cols-2 gap-1.5"
                >
                  {(() => {
                    const visible = Object.values(BlockSemantic).filter(
                      (s) => !(s === BlockSemantic.OUT_OF_INVENTORY && !isSupervisor)
                    )
                    const isOdd = visible.length % 2 !== 0
                    return visible.map((s, idx) => {
                      const isSelected = semantic === s
                      const isMostUsed = s === BlockSemantic.OUT_OF_SERVICE
                      const isLast = idx === visible.length - 1
                      return (
                        <div
                          key={s}
                          role="radio"
                          aria-checked={isSelected}
                          tabIndex={0}
                          onClick={() => handleSemanticChange(s)}
                          onKeyDown={(e) => {
                            if (e.key === ' ' || e.key === 'Enter') {
                              e.preventDefault()
                              handleSemanticChange(s)
                            }
                          }}
                          className={[
                            'relative p-2 rounded-lg border cursor-pointer transition-colors',
                            'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
                            isOdd && isLast ? 'col-span-2' : '',
                            isSelected
                              ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500 ring-offset-1'
                              : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300',
                          ].join(' ')}
                          style={{ minHeight: '84px' }}
                        >
                          <p className={`text-xs font-semibold text-gray-900 leading-tight${isMostUsed ? ' pr-12' : ''}`}>
                            {SEMANTIC_LABELS[s]}
                          </p>
                          <p className="text-[11px] text-gray-500 mt-1 leading-[1.45] text-left">
                            {SEMANTIC_DESCRIPTIONS[s]}
                          </p>
                        </div>
                      )
                    })
                  })()}
                </div>
              </div>
            </div>

            {/* ─ Right — Motivo + Fechas + Instrucciones ────────────────── */}
            <div className="px-6 py-5 space-y-4">

              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Tipo y detalles
              </p>

              {/* Motivo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Motivo
                </label>
                <select
                  value={reason}
                  onChange={(e) => handleReasonChange(e.target.value as BlockReason)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required
                >
                  {validReasons.map((r) => (
                    <option key={r} value={r}>{REASON_LABELS[r]}</option>
                  ))}
                </select>
              </div>

              {/* Fechas */}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Fecha inicio
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      min={isoToday()}
                      max={endDate || undefined}
                      onChange={(e) => {
                        setStartDate(e.target.value)
                        if (endDate) setEndDate(addDaysToIso(e.target.value, 1))
                        setShowEndDateWarning(false)
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Fecha fin{' '}
                      <span className="text-gray-400 font-normal">(opcional)</span>
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type="date"
                        value={endDate}
                        min={startDate}
                        onChange={(e) => { setEndDate(e.target.value); setShowEndDateWarning(false) }}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                      {endDate && (
                        <button
                          type="button"
                          onClick={() => { setEndDate(''); setShowEndDateWarning(false) }}
                          title="Limpiar fecha fin"
                          className="absolute right-1.5 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-400 transition-colors text-[13px] leading-none"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Quick-pickers */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-gray-400 shrink-0">Duración:</span>
                  {QUICK_PICKS.map(({ label, days }) => {
                    const target   = addDaysToIso(startDate, days)
                    const isActive = endDate === target
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => { setEndDate(target); setShowEndDateWarning(false) }}
                        className={[
                          'px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors border',
                          isActive
                            ? 'bg-indigo-100 text-indigo-700 border-indigo-300'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border-transparent',
                        ].join(' ')}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>

                {/* Conflicto de disponibilidad */}
                {availLoading && effectiveRoomId && (
                  <p className="text-[11px] text-gray-400 animate-pulse">
                    Verificando disponibilidad…
                  </p>
                )}
                {!availLoading && hasConflict && availData && (
                  <div className="flex gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                    <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-red-700">
                        Habitación no disponible en estas fechas
                      </p>
                      {availData.conflicts.map((c, i) => (
                        <p key={i} className="text-[11px] text-red-600">
                          {c.label} · {c.from} → {c.to}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Instrucciones */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Instrucciones
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder={
                    reason === BlockReason.OTHER
                      ? 'Obligatorio cuando el motivo es Otro — visible para todo el equipo'
                      : 'Visible para todo el equipo (Opcional)'
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                />
              </div>
            </div>
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div className="px-6 pb-5 pt-4 border-t border-gray-100 space-y-3 shrink-0">
            {/* Siempre ocupa el mismo espacio — evita saltos de altura al cambiar tipo */}
            <div className={[
              'bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700',
              needsApproval ? '' : 'invisible',
            ].join(' ')}>
              ℹ Este tipo de bloqueo requiere aprobación del supervisor antes de activarse.
            </div>
            {showEndDateWarning && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-xs text-orange-700">
                ⚠ Sin fecha de fin — el bloqueo se extenderá indefinidamente hasta liberarlo
                manualmente. Confirma haciendo clic en &ldquo;{ctaLabel}&rdquo; de nuevo.
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700 font-medium">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-300 hidden sm:block">
                ⌘ Enter para confirmar · Esc para cerrar
              </span>
              <div className="flex gap-3 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || hasConflict || availLoading}
                  title={hasConflict ? 'Hay huéspedes en ese período — selecciona otras fechas' : undefined}
                  className={[
                    'px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                    needsApproval
                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                      : 'bg-indigo-600 text-white hover:bg-indigo-700',
                  ].join(' ')}
                >
                  {ctaLabel}
                </button>
              </div>
            </div>
          </div>

        </form>
      </div>
    </div>
  )
}
