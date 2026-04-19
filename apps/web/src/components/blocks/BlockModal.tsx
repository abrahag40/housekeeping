/**
 * BlockModal — Formulario para crear solicitudes de bloqueo.
 *
 * Decisiones de UX (principios NNGroup + Apple HIG):
 * 1. XOR visual: "Habitación completa" vs "Cama específica" con radio buttons
 *    → previene la confusión de tener ambas a la vez.
 * 2. Semántica con descripción inline: el recepcionista no sabe qué es OOO/OOS,
 *    pero sí entiende "problema menor" vs "inhabilitada".
 * 3. Motivos filtrados por semántica: dropdown dinámico evita combos inválidos.
 * 4. Motivos críticos fuerzan OOO automáticamente (PEST_CONTROL, etc.).
 * 5. Fecha de fin opcional: UI explica que "indefinido" requiere liberación manual.
 * 6. Notas housekeeping vs notas internas: separación visual clara.
 */
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BlockSemantic,
  BlockReason,
  HousekeepingRole,
  type CreateBlockDto,
  type RoomDto,
  type BedDto,
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

// Motivos que fuerzan semántica OOO
const FORCE_OOO = new Set([
  BlockReason.PEST_CONTROL,
  BlockReason.WATER_DAMAGE,
  BlockReason.ELECTRICAL,
  BlockReason.STRUCTURAL,
])

// Motivos que fuerzan OOI
const FORCE_OOI = new Set([BlockReason.RENOVATION])

interface BlockModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (dto: CreateBlockDto) => Promise<void>
  prefillRoomId?: string
  prefillBedId?: string
}

export function BlockModal({
  isOpen,
  onClose,
  onSubmit,
  prefillRoomId,
  prefillBedId,
}: BlockModalProps) {
  const user = useAuthStore((s) => s.user)
  const isSupervisor = user?.role === HousekeepingRole.SUPERVISOR

  const [scope, setScope] = useState<'room' | 'bed'>('bed')
  const [roomId, setRoomId] = useState(prefillRoomId ?? '')
  const [bedId, setBedId] = useState(prefillBedId ?? '')
  const [semantic, setSemantic] = useState<BlockSemantic>(BlockSemantic.OUT_OF_SERVICE)
  const [reason, setReason] = useState<BlockReason>(BlockReason.MAINTENANCE)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [startDate, setStartDate] = useState(today())
  const [endDate, setEndDate] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Cargar rooms de la propiedad
  const { data: rooms = [] } = useQuery<RoomDto[]>({
    queryKey: ['rooms-for-block'],
    queryFn: () => api.get<RoomDto[]>('/rooms'),
    enabled: isOpen,
    staleTime: 60_000,
  })

  // Camas del room seleccionado
  const selectedRoom = rooms.find((r) => r.id === roomId)
  const bedsForRoom: BedDto[] = (selectedRoom as any)?.beds ?? []

  // Si cambia el motivo, ajustar semántica automáticamente
  useEffect(() => {
    if (FORCE_OOO.has(reason)) setSemantic(BlockSemantic.OUT_OF_ORDER)
    else if (FORCE_OOI.has(reason)) setSemantic(BlockSemantic.OUT_OF_INVENTORY)
  }, [reason])

  // Si cambia la semántica, resetear el motivo al primero válido
  useEffect(() => {
    const validReasons = REASONS_BY_SEMANTIC[semantic]
    if (!validReasons.includes(reason)) setReason(validReasons[0])
  }, [semantic])

  // Reset al abrir
  useEffect(() => {
    if (isOpen) {
      setScope(prefillBedId ? 'bed' : 'room')
      setRoomId(prefillRoomId ?? '')
      setBedId(prefillBedId ?? '')
      setSemantic(BlockSemantic.OUT_OF_SERVICE)
      setReason(BlockReason.MAINTENANCE)
      setNotes('')
      setInternalNotes('')
      setStartDate(today())
      setEndDate('')
      setError('')
    }
  }, [isOpen, prefillRoomId, prefillBedId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (scope === 'room' && !roomId) { setError('Selecciona una habitación'); return }
    if (scope === 'bed' && !bedId) { setError('Selecciona una cama'); return }
    if (reason === BlockReason.OTHER && !notes.trim()) {
      setError('Agrega una nota cuando el motivo es "Otro"')
      return
    }
    if (endDate && endDate <= startDate) {
      setError('La fecha de fin debe ser posterior al inicio')
      return
    }

    const dto: CreateBlockDto = {
      ...(scope === 'room' ? { roomId } : { bedId }),
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

  const validReasons = REASONS_BY_SEMANTIC[semantic]
  const semanticForcedByReason = FORCE_OOO.has(reason) || FORCE_OOI.has(reason)

  // Descripciones de semántica para usuarios no técnicos
  const SEMANTIC_DESCRIPTIONS: Record<BlockSemantic, string> = {
    [BlockSemantic.OUT_OF_SERVICE]:   'Problema menor. No afecta métricas de revenue. Se puede vender en emergencia.',
    [BlockSemantic.OUT_OF_ORDER]:     'Cama inhabilitada. Se remueve del inventario. Requiere aprobación del supervisor.',
    [BlockSemantic.OUT_OF_INVENTORY]: 'Largo plazo (renovación). Excluida del inventario operativo.',
    [BlockSemantic.HOUSE_USE]:        'Uso interno: fotografía, capacitación, personal.',
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Panel */}
        <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">🔒 Nuevo bloqueo</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Scope selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                ¿Qué deseas bloquear?
              </label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value="bed"
                    checked={scope === 'bed'}
                    onChange={() => { setScope('bed'); setBedId('') }}
                    className="text-indigo-600"
                  />
                  <span className="text-sm text-gray-700">Cama específica</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="scope"
                    value="room"
                    checked={scope === 'room'}
                    onChange={() => { setScope('room'); setBedId(''); setRoomId('') }}
                    className="text-indigo-600"
                  />
                  <span className="text-sm text-gray-700">Habitación completa</span>
                </label>
              </div>
            </div>

            {/* Room selector (siempre visible para scope bed también) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Habitación
              </label>
              <select
                value={roomId}
                onChange={(e) => { setRoomId(e.target.value); setBedId('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                required={scope === 'room' || scope === 'bed'}
              >
                <option value="">— Selecciona habitación —</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    Hab. {r.number} {r.floor ? `· Piso ${r.floor}` : ''} · {r.category === 'SHARED' ? 'Dormitorio' : 'Privada'}
                  </option>
                ))}
              </select>
            </div>

            {/* Bed selector (solo si scope = bed y hay room seleccionada) */}
            {scope === 'bed' && roomId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cama
                </label>
                {bedsForRoom.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">
                    Esta habitación no tiene camas registradas
                  </p>
                ) : (
                  <select
                    value={bedId}
                    onChange={(e) => setBedId(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    required
                  >
                    <option value="">— Selecciona cama —</option>
                    {bedsForRoom.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label} · {b.status}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Tipo (semántica) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tipo de bloqueo
                {semanticForcedByReason && (
                  <span className="ml-2 text-xs text-amber-600 font-normal">
                    (forzado por el motivo seleccionado)
                  </span>
                )}
              </label>
              <div className="space-y-2">
                {Object.values(BlockSemantic).map((s) => {
                  // OOI solo visible para supervisores
                  if (s === BlockSemantic.OUT_OF_INVENTORY && !isSupervisor) return null
                  return (
                    <label
                      key={s}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        semantic === s
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200 hover:border-gray-300'
                      } ${semanticForcedByReason ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <input
                        type="radio"
                        name="semantic"
                        value={s}
                        checked={semantic === s}
                        onChange={() => setSemantic(s)}
                        disabled={semanticForcedByReason}
                        className="mt-0.5 text-indigo-600"
                      />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{SEMANTIC_LABELS[s]}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{SEMANTIC_DESCRIPTIONS[s]}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            {/* Motivo */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Motivo</label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as BlockReason)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                required
              >
                {validReasons.map((r) => (
                  <option key={r} value={r}>{REASON_LABELS[r]}</option>
                ))}
              </select>
              {FORCE_OOO.has(reason) && (
                <p className="text-xs text-red-600 mt-1">
                  ⚠ Este motivo requiere bloqueo OUT_OF_ORDER automáticamente
                </p>
              )}
            </div>

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
                  Fecha fin <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                {!endDate && (
                  <p className="text-xs text-gray-400 mt-0.5">Sin fecha = liberación manual</p>
                )}
              </div>
            </div>

            {/* Notas housekeeping */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notas para housekeeping
                {reason === BlockReason.OTHER && <span className="text-red-500 ml-1">*</span>}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={reason === BlockReason.OTHER ? 'Obligatorio cuando el motivo es Otro' : 'Instrucciones para la camarera (opcional)'}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
              />
            </div>

            {/* Notas internas — solo supervisores */}
            {isSupervisor && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notas internas <span className="text-gray-400 text-xs font-normal">(solo supervisores)</span>
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

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Info de aprobación */}
            {(semantic === BlockSemantic.OUT_OF_ORDER || semantic === BlockSemantic.OUT_OF_INVENTORY) && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
                ℹ Este tipo de bloqueo requiere aprobación del supervisor antes de activarse.
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-1">
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
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split('T')[0]
}
