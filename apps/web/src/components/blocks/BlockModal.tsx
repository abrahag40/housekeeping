/**
 * BlockModal — Formulario para crear solicitudes de bloqueo.
 *
 * Layout: 2 columnas (Qué bloquear | Cuándo y detalles).
 * Justificación: Baymard Institute (2022) — 2 columnas correctas cuando los
 * campos tienen dos grupos conceptuales distintos y el ancho lo permite.
 * NNGroup H#1: toda la información crítica cabe sin scroll en viewports ≥ 700px.
 *
 * Bug fix (circular lock):
 * - Antes: `semanticForcedByReason` añadía `pointer-events-none` a los radios
 *   de semántica → el usuario no podía escapar del semantic forzado.
 * - Ahora: el forced-semantic es INFORMATIVO (badge + mensaje), no bloqueante.
 *   `handleSemanticChange` sigue reseteando el motivo si el nuevo semantic
 *   no lo incluye — el usuario siempre tiene una ruta de salida.
 * - Eliminados los dos `useEffect` de sincronización reason ↔ semantic;
 *   reemplazados por handlers directos sin dependencias circulares.
 */
import { useState, useEffect } from 'react'
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

// Motivos que fuerzan un semantic específico (problema grave, no negociable)
const FORCE_OOO = new Set([
  BlockReason.PEST_CONTROL,
  BlockReason.WATER_DAMAGE,
  BlockReason.ELECTRICAL,
  BlockReason.STRUCTURAL,
])
const FORCE_OOI = new Set([BlockReason.RENOVATION])

// Descripción operativa de cada semantic — lenguaje del usuario, no del sistema
const SEMANTIC_DESCRIPTIONS: Record<BlockSemantic, string> = {
  [BlockSemantic.OUT_OF_SERVICE]:   'Problema menor, no afecta revenue. Venta posible en emergencia.',
  [BlockSemantic.OUT_OF_ORDER]:     'Inhabilitada. Sale del inventario. Requiere aprobación.',
  [BlockSemantic.OUT_OF_INVENTORY]: 'Largo plazo (renovación). Excluida del inventario operativo.',
  [BlockSemantic.HOUSE_USE]:        'Uso interno: fotografía, capacitación, personal.',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0]
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
  const user = useAuthStore((s) => s.user)
  const isSupervisor = user?.role === HousekeepingRole.SUPERVISOR

  const [scope, setScope]                   = useState<'room' | 'unit'>('unit')
  const [roomId, setRoomId]                 = useState(prefillRoomId ?? '')
  const [unitId, setUnitId]                 = useState(prefillUnitId ?? '')
  const [semantic, setSemantic]             = useState<BlockSemantic>(BlockSemantic.OUT_OF_SERVICE)
  const [reason, setReason]                 = useState<BlockReason>(BlockReason.MAINTENANCE)
  const [notes, setNotes]                   = useState('')
  const [internalNotes, setInternalNotes]   = useState('')
  const [startDate, setStartDate]           = useState(today())
  const [endDate, setEndDate]               = useState('')
  const [isSubmitting, setIsSubmitting]     = useState(false)
  const [error, setError]                   = useState('')

  // Cargar rooms de la propiedad
  const { data: rooms = [] } = useQuery<RoomDto[]>({
    queryKey: ['rooms-for-block'],
    queryFn: () => api.get<RoomDto[]>('/rooms'),
    enabled: isOpen,
    staleTime: 60_000,
  })

  const selectedRoom = rooms.find((r) => r.id === roomId)
  const unitsForRoom: UnitDto[] = (selectedRoom as any)?.units ?? []

  // ── Handlers: reason ↔ semantic sincronizados sin useEffect circular ────────

  const handleReasonChange = (newReason: BlockReason) => {
    setReason(newReason)
    // Forced reasons sobreescriben el semantic — son no negociables por operaciones
    if (FORCE_OOO.has(newReason))      setSemantic(BlockSemantic.OUT_OF_ORDER)
    else if (FORCE_OOI.has(newReason)) setSemantic(BlockSemantic.OUT_OF_INVENTORY)
  }

  const handleSemanticChange = (newSemantic: BlockSemantic) => {
    setSemantic(newSemantic)
    // Si el motivo actual no es válido para el nuevo semantic, resetear al primero válido
    if (!REASONS_BY_SEMANTIC[newSemantic].includes(reason)) {
      setReason(REASONS_BY_SEMANTIC[newSemantic][0])
    }
  }

  // Reset completo al abrir el modal
  useEffect(() => {
    if (!isOpen) return
    setScope(prefillUnitId ? 'unit' : 'room')
    setRoomId(prefillRoomId ?? '')
    setUnitId(prefillUnitId ?? '')
    setSemantic(BlockSemantic.OUT_OF_SERVICE)
    setReason(BlockReason.MAINTENANCE)
    setNotes('')
    setInternalNotes('')
    setStartDate(prefillStartDate ?? today())
    setEndDate(prefillEndDate ?? '')
    setError('')
  }, [isOpen, prefillRoomId, prefillUnitId, prefillStartDate, prefillEndDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (scope === 'room' && !roomId)  { setError('Selecciona una habitación'); return }
    if (scope === 'unit' && !unitId)  { setError('Selecciona una unidad'); return }
    if (reason === BlockReason.OTHER && !notes.trim()) {
      setError('Agrega una nota cuando el motivo es "Otro"')
      return
    }
    if (endDate && endDate <= startDate) {
      setError('La fecha de fin debe ser posterior al inicio')
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
    try {
      await onSubmit(dto)
    } catch (e: any) {
      setError(e?.message ?? 'Error al crear el bloqueo')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const validReasons    = REASONS_BY_SEMANTIC[semantic]
  const isForcedSemantic = FORCE_OOO.has(reason) || FORCE_OOI.has(reason)
  const needsApproval   =
    semantic === BlockSemantic.OUT_OF_ORDER ||
    semantic === BlockSemantic.OUT_OF_INVENTORY

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-white rounded-2xl shadow-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-lg font-bold text-gray-900">🔒 Nuevo bloqueo</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col min-h-0">

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
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio" name="scope" value="unit"
                      checked={scope === 'unit'}
                      onChange={() => { setScope('unit'); setUnitId('') }}
                      className="text-indigo-600"
                    />
                    <span className="text-sm text-gray-700">Unidad específica</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
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

              {/* Tipo de bloqueo (semantic) — 2×2 grid de cards compactas */}
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
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.values(BlockSemantic).map((s) => {
                    if (s === BlockSemantic.OUT_OF_INVENTORY && !isSupervisor) return null
                    return (
                      <label
                        key={s}
                        className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                          semantic === s
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="semantic"
                          value={s}
                          checked={semantic === s}
                          onChange={() => handleSemanticChange(s)}
                          className="mt-0.5 text-indigo-600 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-900 leading-tight">
                            {SEMANTIC_LABELS[s]}
                          </p>
                          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">
                            {SEMANTIC_DESCRIPTIONS[s]}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Motivo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
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
                {isForcedSemantic && (
                  <p className="text-xs text-amber-600 mt-1">
                    ⚠ Este motivo clasifica la habitación como &ldquo;{SEMANTIC_LABELS[semantic]}&rdquo; automáticamente
                  </p>
                )}
              </div>
            </div>

            {/* Right — Cuándo y detalles */}
            <div className="px-6 py-5 space-y-4">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                Cuándo y detalles
              </p>

              {/* Fechas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Fecha inicio
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    min={today()}
                    onChange={(e) => setStartDate(e.target.value)}
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
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  {!endDate && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Sin fecha = liberación manual
                    </p>
                  )}
                </div>
              </div>

              {/* Notas housekeeping */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notas para housekeeping
                  {reason === BlockReason.OTHER && (
                    <span className="text-red-500 ml-1">*</span>
                  )}
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder={
                    reason === BlockReason.OTHER
                      ? 'Obligatorio cuando el motivo es Otro'
                      : 'Instrucciones para la camarera (opcional)'
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                />
              </div>

              {/* Notas internas — solo supervisores */}
              {isSupervisor && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notas internas{' '}
                    <span className="text-gray-400 text-xs font-normal">
                      (solo supervisores)
                    </span>
                  </label>
                  <textarea
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    rows={3}
                    placeholder="Contexto para supervisores (no visible para housekeeping)"
                    className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── Footer (full width) ─────────────────────────────────────────── */}
          <div className="px-6 pb-5 pt-4 border-t border-gray-100 space-y-3 shrink-0">
            {needsApproval && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                ℹ Este tipo de bloqueo requiere aprobación del supervisor antes de activarse.
              </div>
            )}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="flex gap-3 justify-end">
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
                className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Creando…' : 'Crear solicitud'}
              </button>
            </div>
          </div>

        </form>
      </div>
    </div>
  )
}
