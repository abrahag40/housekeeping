// TODO(sprint8-pricing): cuando Sprint 8 esté activo, mostrar también ratePlanId y
// commissionRate de la habitación destino para OTAs. Ver CLAUDE.md §Sprint 8.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  startOfDay, format, addDays, addMonths, differenceInDays, parseISO,
  startOfMonth, startOfWeek, endOfMonth, endOfWeek, eachDayOfInterval,
  isBefore, isAfter, isSameDay, isSameMonth,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowRightLeft, Check, X, Calendar, TrendingUp, TrendingDown,
  Split, Plus, Trash2, AlertTriangle, Search, ChevronDown, ChevronUp, Sparkles,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { Popover } from 'radix-ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { GuestStayBlock, FlatRow, RoomTypeGroup } from '../../types/timeline.types'

// ── Minimal custom date picker ────────────────────────────────────────────────
// Replaces <input type="date"> to: (a) match the "Desde" display format
// (d MMM yyyy, Spanish), and (b) avoid the browser's native highlight box on
// today's date, which confuses users when today is disabled by the min constraint.
type DatePickerInputProps = {
  value: Date
  onChange: (d: Date) => void
  min?: Date
  max?: Date
}
function DatePickerInput({ value, onChange, min, max }: DatePickerInputProps) {
  const [open, setOpen] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(value))

  const gridDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 })
    const end   = endOfWeek(endOfMonth(viewMonth),     { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [viewMonth])

  function pick(day: Date) {
    const d = startOfDay(day)
    if (min && isBefore(d, startOfDay(min))) return
    if (max && isAfter(d, startOfDay(max))) return
    onChange(d)
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="text-xs font-semibold px-2 py-1.5 rounded border border-slate-200 text-slate-700 w-full text-left flex items-center gap-1.5 hover:border-emerald-400 focus:outline-none focus:border-emerald-400 transition-colors"
        >
          <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
          {format(value, 'd MMM yyyy', { locale: es })}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="z-[9999] bg-white rounded-xl shadow-xl border border-slate-100 p-3 w-[232px]"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={(e: Event) => e.preventDefault()}
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewMonth(m => addMonths(m, -1))}
              className="p-1 rounded hover:bg-slate-100 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5 text-slate-500" />
            </button>
            <span className="text-[11px] font-semibold text-slate-700 capitalize">
              {format(viewMonth, 'MMMM yyyy', { locale: es })}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth(m => addMonths(m, 1))}
              className="p-1 rounded hover:bg-slate-100 transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
            </button>
          </div>

          {/* Weekday headers */}
          <div className="grid grid-cols-7 mb-1">
            {['Lu','Ma','Mi','Ju','Vi','Sá','Do'].map(d => (
              <span key={d} className="text-center text-[9px] font-semibold text-slate-400 py-0.5">{d}</span>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {gridDays.map((day) => {
              const isSelected  = isSameDay(day, value)
              const isThisMonth = isSameMonth(day, viewMonth)
              const disabled    =
                (!!min && isBefore(startOfDay(day), startOfDay(min))) ||
                (!!max && isAfter(startOfDay(day), startOfDay(max)))
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(day)}
                  className={cn(
                    'h-7 w-full rounded text-[11px] font-medium transition-colors',
                    isSelected
                      ? 'bg-emerald-500 text-white'
                      : disabled
                        ? 'text-slate-300 cursor-default'
                        : isThisMonth
                          ? 'text-slate-700 hover:bg-emerald-50 hover:text-emerald-700'
                          : 'text-slate-300 hover:bg-slate-50',
                  )}
                >
                  {format(day, 'd')}
                </button>
              )
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

interface MoveRoomDialogProps {
  stay: GuestStayBlock
  groups: (RoomTypeGroup & { collapsed: boolean })[]
  flatRows: FlatRow[]
  stays: GuestStayBlock[]
  /** True when the guest is IN_HOUSE — enables effective-date picker and locks first split part */
  isInHouse?: boolean
  isPending: boolean
  onClose: () => void
  onConfirm: (newRoomId: string, effectiveDate?: Date) => void
  /** Called when the user confirms a multi-room split (≥2 parts) */
  onSplit: (parts: Array<{ roomId: string; checkIn: Date; checkOut: Date }>) => void
  /** Pre-selects the second split part's room (used when opening via drag to a target room) */
  initialNewRoomId?: string
  /** Opens the dialog directly in split mode (used when the guest is IN_HOUSE and drag was attempted) */
  initialSplitMode?: boolean
}

type SplitPart = { roomId: string | null; checkIn: Date; checkOut: Date }
type RoomInfo = {
  id: string
  number: string
  floor: number | null
  status: string
  roomTypeId: string
  groupName: string
  groupCode: string
  baseRate: number
  currency: string
}

export function MoveRoomDialog({
  stay,
  groups,
  stays,
  isInHouse = false,
  isPending,
  onClose,
  onConfirm,
  onSplit,
  initialNewRoomId,
  initialSplitMode = false,
}: MoveRoomDialogProps) {
  // today: estable durante la vida del dialog. Sin useMemo se creaba un Date
  // nuevo cada render, invalidando `validation` useMemo aun sin cambios.
  const today = useMemo(() => startOfDay(new Date()), [])
  // For split mode, the range must cover the entire journey — not just this
  // segment/block. When the stay is part of a journey, compute the combined
  // range from all of the journey's segments (min checkIn, max checkOut).
  const { checkIn, checkOut } = useMemo(() => {
    if (stay.journeyId) {
      const segs = stays.filter(s => s.journeyId === stay.journeyId && !s.actualCheckout)
      if (segs.length > 0) {
        const minIn  = segs.reduce((m, s) => (new Date(s.checkIn)  < m ? new Date(s.checkIn)  : m), new Date(segs[0].checkIn))
        const maxOut = segs.reduce((m, s) => (new Date(s.checkOut) > m ? new Date(s.checkOut) : m), new Date(segs[0].checkOut))
        return { checkIn: startOfDay(minIn), checkOut: startOfDay(maxOut) }
      }
    }
    return { checkIn: startOfDay(new Date(stay.checkIn)), checkOut: startOfDay(new Date(stay.checkOut)) }
  }, [stay.journeyId, stay.checkIn, stay.checkOut, stays])
  const totalNights = Math.max(1, differenceInDays(checkOut, checkIn))

  const roomsFlat: RoomInfo[] = useMemo(
    () =>
      groups.flatMap(g =>
        g.rooms.map(r => ({
          ...r,
          groupName: g.name,
          groupCode: g.code,
          baseRate: g.baseRate,
          currency: g.currency,
        }))
      ),
    [groups],
  )

  // Metadata del cuarto actual — usado por las heurísticas del picker
  const currentRoom = useMemo(
    () => roomsFlat.find(r => r.id === stay.roomId) ?? null,
    [roomsFlat, stay.roomId],
  )

  const currentRate = stay.ratePerNight

  // ── Simple move state (flujo actual) ────────────────────────────────────────
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const maxEffectiveDate = format(addDays(checkOut, -1), 'yyyy-MM-dd')
  const [effectiveDateStr, setEffectiveDateStr] = useState(format(today, 'yyyy-MM-dd'))

  // ── Split state (modo N-parts) ──────────────────────────────────────────────
  const [splitMode, setSplitMode] = useState(initialSplitMode)
  const [splitParts, setSplitParts] = useState<SplitPart[]>(() => {
    // Semilla: 2 partes dividiendo el rango por la mitad.
    // Para IN_HOUSE, el corte inicial debe ser ≥ mañana (primer tramo debe incluir hoy).
    const mid = totalNights >= 2
      ? addDays(checkIn, Math.max(1, Math.floor(totalNights / 2)))
      : addDays(checkIn, 1)
    const adjustedMid = isInHouse && mid <= today ? addDays(today, 1) : mid
    return [
      { roomId: stay.roomId, checkIn, checkOut: adjustedMid },
      // Pre-fill the new room when opening via drag-and-drop to a specific target room
      { roomId: initialNewRoomId ?? null, checkIn: adjustedMid, checkOut },
    ]
  })

  // ── Performance: índice pre-calculado de stays por roomId ───────────────────
  // Antes: isRoomOccupied era O(S) y se llamaba O(R × N_parts) por render →
  // 60k+ allocations de Date por keystroke con 5 parts × 20 rooms × 200 stays.
  // Ahora: O(k) donde k = stays en ese roomId específico (típicamente 1-3).
  // Los timestamps se pre-calculan una vez y se comparan numéricamente.
  type StayIndexEntry = {
    id: string
    journeyId: string | undefined
    guestName: string
    checkInMs: number
    checkOutMs: number
  }
  const staysByRoom = useMemo(() => {
    const m = new Map<string, StayIndexEntry[]>()
    for (const s of stays) {
      if (s.actualCheckout) continue
      const entry: StayIndexEntry = {
        id: s.id,
        journeyId: s.journeyId,
        guestName: s.guestName,
        checkInMs:  startOfDay(new Date(s.checkIn)).getTime(),
        checkOutMs: startOfDay(new Date(s.checkOut)).getTime(),
      }
      const arr = m.get(s.roomId)
      if (arr) arr.push(entry)
      else m.set(s.roomId, [entry])
    }
    return m
  }, [stays])

  const isRoomOccupied = useCallback(
    (roomId: string, from: Date, to: Date, excludeStayId?: string): string | null => {
      const list = staysByRoom.get(roomId)
      if (!list || list.length === 0) return null
      const fromMs = from.getTime()
      const toMs   = to.getTime()
      const excludeId = excludeStayId ?? stay.id
      for (const s of list) {
        if (s.id === excludeId) continue
        // Exclude all segments of the same journey — they're being rearranged together.
        if (stay.journeyId && s.journeyId === stay.journeyId) continue
        if (s.checkOutMs > fromMs && s.checkInMs < toMs) return s.guestName
      }
      return null
    },
    [staysByRoom, stay.id, stay.journeyId],
  )

  // ── Split-mode helpers ──────────────────────────────────────────────────────

  function setPart(i: number, patch: Partial<SplitPart>) {
    setSplitParts(prev => {
      const next = prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p))
      // Cuando cambia checkOut de parte[i], propaga a checkIn de parte[i+1]
      if (patch.checkOut && i < next.length - 1) {
        next[i + 1] = { ...next[i + 1], checkIn: patch.checkOut }
      }
      return next
    })
  }

  function addPart() {
    setSplitParts(prev => {
      const last = prev[prev.length - 1]
      const range = differenceInDays(last.checkOut, last.checkIn)
      if (range < 2) return prev // no hay noches suficientes para dividir
      const mid = addDays(last.checkIn, Math.max(1, Math.floor(range / 2)))
      return [
        ...prev.slice(0, -1),
        { ...last, checkOut: mid },
        { roomId: null, checkIn: mid, checkOut: last.checkOut },
      ]
    })
  }

  function removePart(i: number) {
    setSplitParts(prev => {
      if (prev.length <= 2) return prev
      const next = [...prev]
      const removed = next.splice(i, 1)[0]
      // Extiende el siguiente (o el anterior si era el último) para cubrir el rango eliminado
      if (i < next.length) {
        next[i] = { ...next[i], checkIn: removed.checkIn }
      } else if (next.length > 0) {
        next[next.length - 1] = { ...next[next.length - 1], checkOut: removed.checkOut }
      }
      return next
    })
  }

  // ── Validaciones en tiempo real ─────────────────────────────────────────────

  const validation = useMemo(() => {
    const issues: string[] = []

    // Continuidad temporal
    if (splitParts[0].checkIn.getTime() !== checkIn.getTime()) {
      issues.push('La primera parte debe empezar en el check-in de la reserva')
    }
    if (splitParts[splitParts.length - 1].checkOut.getTime() !== checkOut.getTime()) {
      issues.push('La última parte debe terminar en el check-out de la reserva')
    }
    for (let i = 0; i < splitParts.length; i++) {
      const p = splitParts[i]
      if (differenceInDays(p.checkOut, p.checkIn) < 1) {
        issues.push(`Parte ${i + 1}: necesita al menos 1 noche`)
      }
      if (i > 0 && p.checkIn.getTime() !== splitParts[i - 1].checkOut.getTime()) {
        issues.push(`Gap u overlap entre parte ${i} y parte ${i + 1}`)
      }
    }

    // IN_HOUSE: primera parte debe ser la habitación actual y cubrir al menos hasta hoy
    if (isInHouse) {
      if (splitParts[0].roomId !== stay.roomId) {
        issues.push('La primera parte debe mantener la habitación actual mientras el huésped esté adentro')
      }
      if (splitParts[0].checkOut <= today) {
        issues.push('La primera parte debe incluir al menos hasta hoy')
      }
    }

    // Rooms asignados y disponibilidad
    for (let i = 0; i < splitParts.length; i++) {
      const p = splitParts[i]
      if (!p.roomId) {
        issues.push(`Parte ${i + 1}: selecciona una habitación`)
        continue
      }
      const conflictName = isRoomOccupied(p.roomId, p.checkIn, p.checkOut)
      if (conflictName) {
        issues.push(`Parte ${i + 1}: habitación ocupada por ${conflictName}`)
      }
    }

    // Caso H — evitar partes consecutivas en la misma habitación (split sin división real)
    const warnings: string[] = []
    for (let i = 1; i < splitParts.length; i++) {
      const a = splitParts[i - 1].roomId
      const b = splitParts[i].roomId
      if (a && b && a === b) {
        warnings.push(`Parte ${i} y ${i + 1} usan la misma habitación — únelas o asigna habitaciones distintas`)
      }
    }

    return { ok: issues.length === 0 && warnings.length === 0, issues, warnings }
    // Deps: isRoomOccupied encapsula staysByRoom + stay.id/journeyId; usar la
    // callback estable evita depender del array `stays` directamente.
  }, [splitParts, checkIn, checkOut, isInHouse, stay.roomId, isRoomOccupied, today])

  function handleConfirm() {
    if (splitMode) {
      if (!validation.ok) return
      const validParts = splitParts.filter(
        (p): p is { roomId: string; checkIn: Date; checkOut: Date } => !!p.roomId,
      )
      onSplit(validParts)
    } else {
      if (!selectedRoomId) return
      const effectiveDate = isInHouse ? parseISO(effectiveDateStr) : undefined
      onConfirm(selectedRoomId, effectiveDate)
    }
  }

  const canAddMore = splitParts[splitParts.length - 1]
    && differenceInDays(splitParts[splitParts.length - 1].checkOut, splitParts[splitParts.length - 1].checkIn) >= 2

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh', animation: 'var(--animate-spring-in)' }}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
              {splitMode
                ? <Split className="h-4 w-4 text-slate-600" />
                : <ArrowRightLeft className="h-4 w-4 text-slate-600" />}
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">
                {splitMode ? 'Dividir reserva' : 'Cambiar habitación'}
              </p>
              <p className="text-[11px] text-slate-400">
                {stay.guestName} · {format(checkIn, 'd MMM', { locale: es })} – {format(checkOut, 'd MMM', { locale: es })} · {totalNights} {totalNights === 1 ? 'noche' : 'noches'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {/* Toggle split mode — solo si hay al menos 2 noches divisibles.
            Caso F: en IN_HOUSE con sólo 1 noche futura, dividir dejaría la parte 2
            con 0 noches. Gate por noches futuras en ese caso. */}
        {(isInHouse
          ? differenceInDays(checkOut, today) >= 2
          : totalNights >= 2
        ) && (
          <div className="px-5 pt-3 pb-2 shrink-0">
            <label className="flex items-center gap-2.5 cursor-pointer group">
              <div
                className={cn(
                  'relative w-9 h-5 rounded-full transition-colors',
                  splitMode ? 'bg-emerald-500' : 'bg-slate-300',
                )}
                onClick={(e) => {
                  e.preventDefault()
                  setSplitMode(v => !v)
                }}
              >
                <div
                  className={cn(
                    'absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform',
                    splitMode ? 'translate-x-[18px]' : 'translate-x-0.5',
                  )}
                />
              </div>
              <span className="text-sm text-slate-700 select-none">
                Dividir en varias habitaciones
              </span>
            </label>
          </div>
        )}

        {/* ── Modo SIMPLE: lista de habitaciones (flujo actual) ──────────────── */}
        {!splitMode && (
          <>
            {/* Effective date picker — solo IN_HOUSE */}
            {isInHouse && (
              <div className="px-5 pt-2 pb-1 shrink-0">
                <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[11px] font-medium text-slate-500 mb-1">Fecha efectiva del cambio</p>
                    <input
                      type="date"
                      value={effectiveDateStr}
                      min={format(today, 'yyyy-MM-dd')}
                      max={maxEffectiveDate}
                      onChange={e => setEffectiveDateStr(e.target.value)}
                      className="text-sm font-semibold text-slate-800 bg-transparent border-none outline-none w-full"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 min-h-0 flex flex-col px-4 pb-2">
              <RoomPicker
                rooms={roomsFlat}
                currentRoom={currentRoom}
                selectedRoomId={selectedRoomId}
                onSelect={setSelectedRoomId}
                getConflict={(roomId) => isRoomOccupied(roomId, checkIn, checkOut)}
                currentRate={currentRate}
                showSuggested
              />
            </div>
          </>
        )}

        {/* ── Modo SPLIT: editor N-parts ─────────────────────────────────────── */}
        {splitMode && (
          <div
            className="flex-1 overflow-y-auto p-4 space-y-3"
            style={{ overscrollBehavior: 'contain' }}
          >
            {splitParts.map((part, i) => {
              const partNights = Math.max(0, differenceInDays(part.checkOut, part.checkIn))
              const isFirst = i === 0
              const isLast = i === splitParts.length - 1
              const roomLocked = isInHouse && isFirst // primera parte fija al cuarto actual cuando IN_HOUSE
              const checkInLocked = isFirst // primer checkIn siempre = journey.checkIn
              const checkOutLocked = isLast // último checkOut siempre = journey.checkOut

              // Fecha mínima para el checkOut de esta parte:
              //   - debe ser > checkIn
              //   - en IN_HOUSE la primera parte debe terminar ≥ mañana
              const minCheckOut = isInHouse && isFirst
                ? format(addDays(today, 1), 'yyyy-MM-dd')
                : format(addDays(part.checkIn, 1), 'yyyy-MM-dd')
              const maxCheckOut = isLast
                ? format(checkOut, 'yyyy-MM-dd')
                : format(addDays(splitParts[i + 1].checkOut, -1), 'yyyy-MM-dd')

              return (
                <div
                  key={i}
                  className="border border-slate-200 rounded-xl p-3 space-y-2.5 bg-white"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                      Parte {i + 1}
                      <span className="ml-1.5 text-slate-400 font-normal">
                        · {partNights} {partNights === 1 ? 'noche' : 'noches'}
                      </span>
                    </p>
                    {splitParts.length > 2 && (
                      <button
                        onClick={() => removePart(i)}
                        className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                        title="Eliminar esta parte"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Fechas */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-400 mb-0.5">Desde</p>
                      <div className={cn(
                        'text-xs font-semibold px-2 py-1.5 rounded border',
                        checkInLocked ? 'bg-slate-50 border-slate-100 text-slate-500' : 'bg-slate-50 border-slate-100 text-slate-700',
                      )}>
                        {format(part.checkIn, 'd MMM yyyy', { locale: es })}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-400 mb-0.5">Hasta</p>
                      {checkOutLocked ? (
                        <div className="text-xs font-semibold px-2 py-1.5 rounded border bg-slate-50 border-slate-100 text-slate-500">
                          {format(part.checkOut, 'd MMM yyyy', { locale: es })}
                        </div>
                      ) : (
                        <DatePickerInput
                          value={part.checkOut}
                          onChange={(d) => setPart(i, { checkOut: d })}
                          min={parseISO(minCheckOut)}
                          max={parseISO(maxCheckOut)}
                        />
                      )}
                    </div>
                  </div>

                  {/* Room picker — expandable inline (mismo componente que modo simple) */}
                  <SplitPartRoomField
                    rooms={roomsFlat}
                    currentRoom={currentRoom}
                    selectedRoomId={part.roomId}
                    onSelect={(roomId) => setPart(i, { roomId })}
                    getConflict={(roomId) => isRoomOccupied(roomId, part.checkIn, part.checkOut)}
                    currentRate={currentRate}
                    locked={roomLocked}
                  />
                </div>
              )
            })}

            {/* Agregar parte */}
            {canAddMore && (
              <button
                onClick={addPart}
                className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-slate-300 rounded-xl text-sm font-medium text-slate-500 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50/40 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Agregar habitación
              </button>
            )}

            {/* Validaciones inline */}
            {validation.ok ? (
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 px-3 py-2 rounded-lg">
                <Check className="h-3.5 w-3.5" />
                División válida · cubre {totalNights} {totalNights === 1 ? 'noche' : 'noches'}
              </div>
            ) : (
              <div className="flex items-start gap-2 text-xs font-medium text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  {[...validation.issues, ...validation.warnings].slice(0, 3).map((issue, idx) => (
                    <p key={idx}>· {issue}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex gap-2.5 shrink-0">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            className="flex-1 bg-slate-800 hover:bg-slate-700 text-white"
            disabled={
              isPending ||
              (splitMode ? !validation.ok : !selectedRoomId)
            }
            onClick={handleConfirm}
          >
            {isPending
              ? (splitMode ? 'Dividiendo…' : 'Moviendo…')
              : splitMode
              ? `Dividir en ${splitParts.length} habitaciones`
              : 'Confirmar cambio'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// RoomPicker — selector de habitación escalable (virtualizado + search + filters)
// ═════════════════════════════════════════════════════════════════════════════
// Motivación: ver CLAUDE.md + plan `perfecto-en-caso-de-tingly-feather`.
// - Hotel Tulum (22 rooms): comportamiento indistinguible del legacy.
// - Hotel Riu (200-600 rooms): de scroll ciego → búsqueda/filtro en 1-2 keystrokes.
// - DOM cap: ~15 filas visibles vía @tanstack/react-virtual (reduce ~90% nodes).
// Sugeridas (L1) + search (L2) + chips (L3) + virtualizer (L4) + headers inline (L5).

const ROW_H      = 64  // altura fila room
const HEADER_H   = 30  // altura header de grupo

type PickerItem =
  | { kind: 'header'; key: string; groupCode: string; label: string; count: number }
  | { kind: 'room';   key: string; room: RoomInfo }

interface RoomPickerProps {
  rooms: RoomInfo[]
  currentRoom: RoomInfo | null
  selectedRoomId: string | null
  onSelect: (roomId: string) => void
  /** Retorna el nombre del huésped en conflicto, o null si disponible */
  getConflict: (roomId: string) => string | null
  currentRate: number
  /** Mostrar la sección "Sugeridas" arriba (default true en simple, false en split) */
  showSuggested?: boolean
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function RoomPicker({
  rooms,
  currentRoom,
  selectedRoomId,
  onSelect,
  getConflict,
  currentRate,
  showSuggested = true,
}: RoomPickerProps) {
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [onlyAvailable, setOnlyAvailable] = useState(true)
  const [onlySameType, setOnlySameType] = useState(false)
  const [onlySameFloor, setOnlySameFloor] = useState(false)

  // Debounce ligero para desacoplar cada keystroke del filter+render
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 80)
    return () => clearTimeout(t)
  }, [search])

  // Pre-calcula ocupación una sola vez por lista. Evita llamar getConflict
  // dentro del virtualizer render loop.
  const conflictByRoom = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const r of rooms) m.set(r.id, getConflict(r.id))
    return m
  }, [rooms, getConflict])

  // Heurística de sugeridas: mismo tipo + tarifa ±10% + disponible, orden por mismo piso.
  const suggested = useMemo<RoomInfo[]>(() => {
    if (!showSuggested || !currentRoom) return []
    const out: Array<{ r: RoomInfo; score: number }> = []
    for (const r of rooms) {
      if (r.id === currentRoom.id) continue
      if (conflictByRoom.get(r.id)) continue
      if (r.roomTypeId !== currentRoom.roomTypeId) continue
      const rateClose = currentRate === 0 || Math.abs(r.baseRate - currentRate) / currentRate <= 0.1
      if (!rateClose) continue
      let score = 0
      if (r.floor === currentRoom.floor) score += 10
      if (r.baseRate === currentRoom.baseRate) score += 5
      out.push({ r, score })
    }
    out.sort((a, b) => b.score - a.score)
    return out.slice(0, 3).map((x) => x.r)
  }, [showSuggested, currentRoom, rooms, conflictByRoom, currentRate])

  // Filtros en cadena. Si hay "sugeridas" visibles (sin búsqueda activa) se
  // excluyen de la lista principal para no duplicar información.
  const suggestedIdSet = useMemo(
    () => new Set(suggested.map((r) => r.id)),
    [suggested],
  )
  const hideSuggestedFromList = showSuggested && !searchDebounced && suggested.length > 0

  const filtered = useMemo<RoomInfo[]>(() => {
    const q = normalize(searchDebounced.trim())
    const currentTypeId = currentRoom?.roomTypeId
    const currentFloor  = currentRoom?.floor
    const result: RoomInfo[] = []
    for (const r of rooms) {
      if (r.id === currentRoom?.id) continue   // cuarto actual no es opción
      if (hideSuggestedFromList && suggestedIdSet.has(r.id)) continue
      if (onlyAvailable && conflictByRoom.get(r.id)) continue
      if (onlySameType && currentTypeId && r.roomTypeId !== currentTypeId) continue
      if (onlySameFloor && r.floor != null && currentFloor != null && r.floor !== currentFloor) continue
      if (q) {
        const hay = normalize(`${r.number} ${r.groupName} piso ${r.floor ?? ''}`)
        if (!hay.includes(q)) continue
      }
      result.push(r)
    }
    return result
  }, [rooms, searchDebounced, onlyAvailable, onlySameType, onlySameFloor, currentRoom, conflictByRoom, hideSuggestedFromList, suggestedIdSet])

  // Build items con headers intercalados (un header por cada groupCode).
  // Mantiene el orden de `rooms` → hereda el orden de `groups` del prop.
  const items = useMemo<PickerItem[]>(() => {
    const out: PickerItem[] = []
    let lastCode: string | null = null
    let lastHeaderIdx = -1
    for (const r of filtered) {
      if (r.groupCode !== lastCode) {
        lastHeaderIdx = out.length
        out.push({
          kind: 'header',
          key: `h-${r.groupCode}`,
          groupCode: r.groupCode,
          label: r.groupName,
          count: 0,
        })
        lastCode = r.groupCode
      }
      out.push({ kind: 'room', key: r.id, room: r })
      if (lastHeaderIdx >= 0) {
        ;(out[lastHeaderIdx] as Extract<PickerItem, { kind: 'header' }>).count++
      }
    }
    return out
  }, [filtered])

  // Virtualizer — render ~15 filas visibles + overscan en vez del listado completo
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i]?.kind === 'header' ? HEADER_H : ROW_H),
    overscan: 6,
    getItemKey: (i) => items[i]?.key ?? i,
  })

  const totalCount = rooms.length
  const visibleCount = filtered.length

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Search + counters */}
      <div className="shrink-0 space-y-2 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="search"
            placeholder={`Buscar entre ${totalCount} habitaciones…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 transition-all"
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip active={onlyAvailable} onToggle={() => setOnlyAvailable(v => !v)}>
            Disponibles
          </FilterChip>
          {currentRoom && (
            <FilterChip active={onlySameType} onToggle={() => setOnlySameType(v => !v)}>
              Mismo tipo
            </FilterChip>
          )}
          {currentRoom?.floor != null && (
            <FilterChip active={onlySameFloor} onToggle={() => setOnlySameFloor(v => !v)}>
              Piso {currentRoom.floor}
            </FilterChip>
          )}
          <span className="ml-auto text-[11px] text-slate-400 font-medium">
            {visibleCount} {visibleCount === 1 ? 'resultado' : 'resultados'}
          </span>
        </div>
      </div>

      {/* Sugeridas — fuera del virtualizer (max 3). Solo cuando no hay búsqueda activa. */}
      {showSuggested && !searchDebounced && suggested.length > 0 && (
        <div className="shrink-0 pb-2">
          <div className="flex items-center gap-1.5 mb-1.5 text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
            <Sparkles className="h-3 w-3" />
            Sugeridas
          </div>
          <div className="space-y-1">
            {suggested.map((r) => (
              <RoomRow
                key={`sug-${r.id}`}
                room={r}
                isSelected={selectedRoomId === r.id}
                isCurrent={false}
                conflict={null}
                currentRate={currentRate}
                highlighted
                onClick={() => onSelect(r.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Lista virtualizada */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        style={{ overscrollBehavior: 'contain', willChange: 'scroll-position' }}
      >
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-slate-400">
            <Search className="h-5 w-5 mb-2 text-slate-300" />
            <p>Sin resultados.</p>
            <p>Prueba quitar filtros o ajustar la búsqueda.</p>
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const item = items[vi.index]
              if (!item) return null
              if (item.kind === 'header') {
                return (
                  <div
                    key={vi.key}
                    className="absolute left-0 right-0 flex items-end px-1 pb-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                    style={{ transform: `translateY(${vi.start}px)`, height: HEADER_H }}
                  >
                    {item.label}
                    <span className="ml-1.5 font-normal text-slate-300 normal-case tracking-normal">· {item.count}</span>
                  </div>
                )
              }
              const conflict = conflictByRoom.get(item.room.id) ?? null
              return (
                <div
                  key={vi.key}
                  className="absolute left-0 right-0 px-0.5"
                  style={{ transform: `translateY(${vi.start}px)`, height: ROW_H }}
                >
                  <RoomRow
                    room={item.room}
                    isSelected={selectedRoomId === item.room.id}
                    isCurrent={false}
                    conflict={conflict}
                    currentRate={currentRate}
                    onClick={() => !conflict && onSelect(item.room.id)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── RoomRow — fila única, estética consistente con el listado legacy ──────────

interface RoomRowProps {
  room: RoomInfo
  isSelected: boolean
  isCurrent: boolean
  conflict: string | null
  currentRate: number
  highlighted?: boolean   // true para sugeridas (ring emerald más fuerte)
  onClick: () => void
}

function RoomRow({ room, isSelected, isCurrent, conflict, currentRate, highlighted, onClick }: RoomRowProps) {
  const isDisabled = isCurrent || !!conflict
  const rateDiff = room.baseRate - currentRate
  const hasRateDelta = !isCurrent && rateDiff !== 0
  return (
    <button
      disabled={isDisabled}
      onClick={onClick}
      className={cn(
        'w-full h-[56px] flex items-center gap-3 px-3 rounded-xl text-left transition-all border',
        isSelected
          ? 'border-emerald-400 bg-emerald-50'
          : highlighted
          ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
          : isDisabled
          ? 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-50'
          : 'border-slate-100 hover:border-slate-300 hover:bg-slate-50 cursor-pointer',
      )}
    >
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0',
          isSelected
            ? 'bg-emerald-600 text-white'
            : isCurrent
            ? 'bg-slate-200 text-slate-500'
            : highlighted
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-slate-100 text-slate-700',
        )}
      >
        {room.number}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-semibold truncate', isSelected ? 'text-emerald-800' : 'text-slate-700')}>
          Hab. {room.number}
          {room.floor != null && (
            <span className="ml-1.5 text-[10px] font-normal text-slate-400">· piso {room.floor}</span>
          )}
        </p>
        <p className="text-[11px] text-slate-400 truncate">
          {room.groupName}
          {conflict && <span className="text-amber-600"> · Ocupada por {conflict}</span>}
        </p>
      </div>
      {!isCurrent && !conflict && (
        <div className="shrink-0 text-right">
          <p className={cn('text-xs font-mono font-semibold', isSelected ? 'text-emerald-700' : 'text-slate-600')}>
            {room.currency} {room.baseRate.toLocaleString()}/n
          </p>
          {hasRateDelta && (
            <p
              className={cn(
                'text-[10px] font-semibold flex items-center justify-end gap-0.5 mt-0.5',
                rateDiff > 0 ? 'text-orange-500' : 'text-emerald-600',
              )}
            >
              {rateDiff > 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
              {rateDiff > 0 ? '+' : '−'}{room.currency} {Math.abs(rateDiff).toLocaleString()}/n
            </p>
          )}
        </div>
      )}
      {isSelected && (
        <div className="w-5 h-5 bg-emerald-600 rounded-full flex items-center justify-center shrink-0 ml-1">
          <Check className="h-3 w-3 text-white" />
        </div>
      )}
    </button>
  )
}

// ── FilterChip — toggle pill reutilizado en los filtros del RoomPicker ────────

function FilterChip({
  active,
  onToggle,
  children,
}: {
  active: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors',
        active
          ? 'bg-emerald-600 text-white border-emerald-600'
          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300',
      )}
    >
      {children}
    </button>
  )
}

// ── SplitPartRoomField — trigger colapsible que embebe un RoomPicker ──────────
// Reemplaza al <select> nativo por parte del split. Colapsado por defecto para
// mantener el modal compacto; al click se expande al picker completo.

interface SplitPartRoomFieldProps {
  rooms: RoomInfo[]
  currentRoom: RoomInfo | null
  selectedRoomId: string | null
  onSelect: (roomId: string) => void
  getConflict: (roomId: string) => string | null
  currentRate: number
  locked?: boolean
}

function SplitPartRoomField({
  rooms,
  currentRoom,
  selectedRoomId,
  onSelect,
  getConflict,
  currentRate,
  locked,
}: SplitPartRoomFieldProps) {
  const [open, setOpen] = useState(false)
  const selected = useMemo(
    () => (selectedRoomId ? rooms.find((r) => r.id === selectedRoomId) ?? null : null),
    [rooms, selectedRoomId],
  )

  // Al seleccionar, colapsar automáticamente.
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id)
      setOpen(false)
    },
    [onSelect],
  )

  return (
    <div>
      <p className="text-[10px] text-slate-400 mb-0.5">Habitación</p>
      <button
        type="button"
        disabled={locked}
        onClick={() => !locked && setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 text-sm font-semibold px-2.5 py-1.5 rounded border outline-none transition-colors',
          locked
            ? 'bg-slate-50 border-slate-100 text-slate-500 cursor-not-allowed'
            : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300',
        )}
      >
        <span className="flex-1 text-left truncate">
          {selected
            ? <>Hab. {selected.number} <span className="text-slate-400 font-normal">· {selected.groupName}</span></>
            : <span className="text-slate-400 font-normal">Selecciona habitación…</span>}
        </span>
        {!locked && (open ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />)}
      </button>

      {open && !locked && (
        <div
          className="mt-2 border border-slate-200 rounded-lg bg-white overflow-hidden"
          style={{ height: 320 }}
        >
          <div className="p-2 h-full">
            <RoomPicker
              rooms={rooms}
              currentRoom={currentRoom}
              selectedRoomId={selectedRoomId}
              onSelect={handleSelect}
              getConflict={getConflict}
              currentRate={currentRate}
              showSuggested={false}
            />
          </div>
        </div>
      )}
    </div>
  )
}
