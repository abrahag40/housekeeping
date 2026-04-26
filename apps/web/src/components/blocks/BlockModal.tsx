/**
 * BlockModal v2 — Formulario para crear bloqueos de habitación.
 *
 * Layout: 2 columnas (Qué bloquear | Cuándo y detalles).
 * Baymard Institute (2022): 2 columnas cuando los campos pertenecen a grupos
 * conceptuales distintos y el ancho lo permite.
 *
 * Decisiones de UX (Sprint 8G):
 * - CTA dinámico: "Crear bloqueo" vs "Solicitar aprobación" (NNGroup H#4 — consistencia)
 * - Motivo visualmente subordinado al tipo — indented con border-l bajo el semantic grid
 * - "Más frecuente" badge en OOS (Cialdini: anchoring del default más seguro)
 * - WCAG 2.2 AA: ring-2 + ✓ en la card seleccionada
 * - Quick-pickers de duración: Hoy / +1 d / +3 d / +7 d
 * - Notas colapsables — no saturan el viewport por defecto
 * - Atajos: Cmd/Ctrl+Enter = submit, Escape = cerrar
 */
import { useState, useEffect, useRef } from 'react'
import { Lock, ChevronDown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import {
  BlockSemantic,
  BlockReason,
  HousekeepingRole,
  type CreateBlockDto,
  type RoomDto,
  type UnitDto,
} from '@zenix/shared'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
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

// Motivos que fuerzan un semantic específico (problema grave operacional)
const FORCE_OOO = new Set([
  BlockReason.PEST_CONTROL,
  BlockReason.WATER_DAMAGE,
  BlockReason.ELECTRICAL,
  BlockReason.STRUCTURAL,
])
const FORCE_OOI = new Set([BlockReason.RENOVATION])

// Descripción breve por semantic — lenguaje del operador, no del sistema
const SEMANTIC_DESCRIPTIONS: Record<BlockSemantic, string> = {
  [BlockSemantic.OUT_OF_SERVICE]:   'Problema menor. Venta posible en emergencia.',
  [BlockSemantic.OUT_OF_ORDER]:     'Inhabilitada. Sale del inventario. Requiere aprobación.',
  [BlockSemantic.OUT_OF_INVENTORY]: 'Largo plazo (renovación). Fuera del inventario operativo.',
  [BlockSemantic.HOUSE_USE]:        'Uso interno: fotografía, capacitación, personal.',
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
  const user       = useAuthStore((s) => s.user)
  const isSupervisor = user?.role === HousekeepingRole.SUPERVISOR

  const formRef = useRef<HTMLFormElement>(null)

  const [scope, setScope]                   = useState<'room' | 'unit'>('unit')
  const [roomId, setRoomId]                 = useState(prefillRoomId ?? '')
  const [unitId, setUnitId]                 = useState(prefillUnitId ?? '')
  const [semantic, setSemantic]             = useState<BlockSemantic>(BlockSemantic.OUT_OF_SERVICE)
  const [reason, setReason]                 = useState<BlockReason>(BlockReason.MAINTENANCE)
  const [notes, setNotes]                   = useState('')
  const [internalNotes, setInternalNotes]   = useState('')
  const [showNotes, setShowNotes]           = useState(false)
  const [startDate, setStartDate]           = useState(isoToday())
  const [endDate, setEndDate]               = useState('')
  const [isSubmitting, setIsSubmitting]     = useState(false)
  const [error, setError]                   = useState('')
  const [showEndDateWarning, setShowEndDateWarning] = useState(false)

  // Cargar rooms de la propiedad
  const { data: rooms = [] } = useQuery<RoomDto[]>({
    queryKey: ['rooms-for-block'],
    queryFn: () => api.get<RoomDto[]>('/rooms'),
    enabled: isOpen,
    staleTime: 60_000,
  })

  const selectedRoom   = rooms.find((r) => r.id === roomId)
  const unitsForRoom: UnitDto[] = (selectedRoom as any)?.units ?? []

  // ── Handlers: reason ↔ semantic sin useEffect circular ───────────────────

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

  // Auto-expand notes when reason = OTHER (mandatory note)
  useEffect(() => {
    if (reason === BlockReason.OTHER) setShowNotes(true)
  }, [reason])

  // Reset al abrir el modal
  useEffect(() => {
    if (!isOpen) return
    const start = prefillStartDate ?? isoToday()
    setScope(prefillUnitId ? 'unit' : 'room')
    setRoomId(prefillRoomId ?? '')
    setUnitId(prefillUnitId ?? '')
    setSemantic(BlockSemantic.OUT_OF_SERVICE)
    setReason(BlockReason.MAINTENANCE)
    setNotes('')
    setInternalNotes('')
    setShowNotes(false)
    setStartDate(start)
    setEndDate(prefillEndDate ?? addDaysToIso(start, 1))
    setError('')
    setShowEndDateWarning(false)
  }, [isOpen, prefillRoomId, prefillUnitId, prefillStartDate, prefillEndDate])

  // Atajos de teclado: Escape → cerrar; Cmd/Ctrl+Enter → submit
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        formRef.current?.requestSubmit()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (scope === 'room' && !roomId)  { setError('Selecciona una habitación'); return }
    if (scope === 'unit' && !unitId)  { setError('Selecciona una unidad'); return }
    if (reason === BlockReason.OTHER && !notes.trim()) {
      setError('Agrega una nota cuando el motivo es "Otro"')
      setShowNotes(true)
      return
    }
    if (endDate && endDate <= startDate) {
      setError('La fecha de fin debe ser posterior al inicio')
      return
    }

    // Advertencia suave por falta de fecha fin (primer intento)
    if (!endDate && !showEndDateWarning) {
      setShowEndDateWarning(true)
      return
    }

    const dto: CreateBlockDto = {
      ...(scope === 'room' ? { roomId } : { unitId }),
      semantic,
      reason,
      notes: notes.trim() || undefined,
      internalNotes: internalNotes.trim() || undefined,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-gray-600" />
            Nuevo bloqueo
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col min-h-0">

          {/* ── 2-column body ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 overflow-y-auto">

            {/* Left — Qué bloquear */}
            <div className="px-6 py-5 space-y-4 border-r border-gray-100">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Qué bloquear
              </p>

              {/* Scope */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  ¿Qué deseas bloquear?
                </label>
                <div className="flex gap-4">
                  <label
                    className="flex items-center gap-2 cursor-pointer"
                    title="Una cama o espacio específico dentro de la habitación (ej: Cama 3 del Dorm 2)"
                  >
                    <input
                      type="radio" name="scope" value="unit"
                      checked={scope === 'unit'}
                      onChange={() => { setScope('unit'); setUnitId('') }}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Unidad específica</span>
                  </label>
                  <label
                    className="flex items-center gap-2 cursor-pointer"
                    title="Todas las camas/unidades de la habitación quedan bloqueadas"
                  >
                    <input
                      type="radio" name="scope" value="room"
                      checked={scope === 'room'}
                      onChange={() => { setScope('room'); setUnitId(''); setRoomId('') }}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Habitación completa</span>
                  </label>
                </div>
              </div>

              {/* Habitación */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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

              {/* Unidad (conditional) */}
              {scope === 'unit' && roomId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
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

              {/* ── Tipo de bloqueo + Motivo (subordinado) ─────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700">
                    Tipo de bloqueo
                  </label>
                  {isForcedSemantic && (
                    <span className="text-[10px] font-medium text-amber-600">
                      determinado por el motivo
                    </span>
                  )}
                </div>

                {/* 2×2 semantic cards */}
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.values(BlockSemantic).map((s) => {
                    if (s === BlockSemantic.OUT_OF_INVENTORY && !isSupervisor) return null
                    const isSelected = semantic === s
                    return (
                      <label
                        key={s}
                        className={[
                          'flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors',
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500 ring-offset-1'
                            : 'border-gray-200 hover:border-gray-300',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="semantic"
                          value={s}
                          checked={isSelected}
                          onChange={() => handleSemanticChange(s)}
                          className="mt-0.5 text-indigo-600 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            <p className="text-xs font-semibold text-gray-900 leading-tight">
                              {SEMANTIC_LABELS[s]}
                            </p>
                            {s === BlockSemantic.OUT_OF_SERVICE && (
                              <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1 py-0.5 rounded font-semibold leading-none shrink-0">
                                Frecuente
                              </span>
                            )}
                            {isSelected && (
                              <span className="ml-auto text-indigo-600 text-[11px] font-bold leading-none shrink-0">
                                ✓
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                            {SEMANTIC_DESCRIPTIONS[s]}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>

                {/* Motivo — visualmente subordinado al semantic */}
                <div className="mt-3 pl-3 border-l-2 border-gray-200">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Especifica el motivo
                  </label>
                  <select
                    value={reason}
                    onChange={(e) => handleReasonChange(e.target.value as BlockReason)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-gray-50"
                    required
                  >
                    {validReasons.map((r) => (
                      <option key={r} value={r}>{REASON_LABELS[r]}</option>
                    ))}
                  </select>
                  {isForcedSemantic && (
                    <p className="text-[11px] text-amber-600 mt-1">
                      ⚠ Clasifica la habitación como &ldquo;{SEMANTIC_LABELS[semantic]}&rdquo; automáticamente
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right — Cuándo y detalles */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Cuándo y detalles
              </p>

              {/* Fechas */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha inicio
                    </label>
                    <input
                      type="date"
                      value={startDate}
                      min={isoToday()}
                      onChange={(e) => {
                        setStartDate(e.target.value)
                        // mantener la duración relativa si hay endDate
                        if (endDate) setEndDate(addDaysToIso(e.target.value, 1))
                        setShowEndDateWarning(false)
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Fecha fin{' '}
                      <span className="text-gray-400 font-normal">(opcional)</span>
                    </label>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate}
                      onChange={(e) => { setEndDate(e.target.value); setShowEndDateWarning(false) }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>
                </div>

                {/* Quick-pickers de duración */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-gray-400 shrink-0">Duración:</span>
                  {[
                    { label: 'Hoy', days: 0 },
                    { label: '+1 d', days: 1 },
                    { label: '+3 d', days: 3 },
                    { label: '+7 d', days: 7 },
                  ].map(({ label, days }) => {
                    const target = addDaysToIso(startDate, days)
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
                  {endDate && (
                    <button
                      type="button"
                      onClick={() => { setEndDate(''); setShowEndDateWarning(false) }}
                      className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-gray-100 text-gray-400 hover:text-red-500 hover:bg-red-50 border-transparent transition-colors"
                      title="Quitar fecha de fin (bloqueo indefinido)"
                    >
                      ✕
                    </button>
                  )}
                </div>
                {!endDate && (
                  <p className="text-[10px] text-gray-400">
                    Sin fecha = liberación manual
                  </p>
                )}
              </div>

              {/* Notas — colapsables */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowNotes((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <ChevronDown
                    className={[
                      'w-3.5 h-3.5 transition-transform duration-150',
                      showNotes ? '' : '-rotate-90',
                    ].join(' ')}
                  />
                  Agregar instrucciones
                  <span className="text-gray-400 text-xs font-normal">(opcional)</span>
                  {reason === BlockReason.OTHER && (
                    <span className="text-red-500 text-xs">*</span>
                  )}
                </button>

                {showNotes && (
                  <div className="mt-2 space-y-3">
                    {/* Notas housekeeping */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Para housekeeping
                        {reason === BlockReason.OTHER && (
                          <span className="text-red-500 ml-1">*</span>
                        )}
                      </label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        rows={2}
                        placeholder={
                          reason === BlockReason.OTHER
                            ? 'Obligatorio cuando el motivo es Otro'
                            : 'Instrucciones para la camarera (visible en la app)'
                        }
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                      />
                    </div>

                    {/* Notas internas — solo supervisores */}
                    {isSupervisor && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          Notas internas{' '}
                          <span className="text-gray-400 font-normal">(solo supervisores)</span>
                        </label>
                        <textarea
                          value={internalNotes}
                          onChange={(e) => setInternalNotes(e.target.value)}
                          rows={2}
                          placeholder="Contexto para supervisores (no visible para housekeeping)"
                          className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Footer (full width) ─────────────────────────────────────────── */}
          <div className="px-6 pb-5 pt-4 border-t border-gray-100 space-y-3 shrink-0">
            {needsApproval && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                ℹ Este tipo de bloqueo requiere aprobación del supervisor antes de activarse.
              </div>
            )}
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
                  disabled={isSubmitting}
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
