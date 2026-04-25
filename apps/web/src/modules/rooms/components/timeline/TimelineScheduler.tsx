import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { subDays, addDays, differenceInDays, differenceInCalendarDays, startOfDay } from 'date-fns'
import { useTimelineStore } from '../../stores/timeline.store'
import { TIMELINE } from '../../utils/timeline.constants'
import { getStayStatus } from '../../utils/timeline.utils'
import { useDragDrop } from '../../hooks/useDragDrop'
import { useGuestStays, useCreateGuestStay, useCheckout, useMoveRoom, useSplitMidStay, useSplitReservation, useMarkNoShow, useRevertNoShow, useRoomReadinessTasks, useExtendStay, useExtendSameRoom, useExtendNewRoom, useMoveExtensionRoom, useConfirmCheckin } from '../../hooks/useGuestStays'
import { guestStaysApi } from '../../api/guest-stays.api'
import { useStayJourneys } from '../../hooks/useStayJourneys'
import { useRoomSSE } from '../../hooks/useRoomSSE'
import { useSoftLockSSE } from '@/hooks/useSoftLock'
import { usePropertySettings } from '@/hooks/usePropertySettings'
import { useDateVirtualizer } from '../../hooks/useDateVirtualizer'
import { TimelineTopBar } from './TimelineTopBar'
import { TimelineSubBar } from './TimelineSubBar'
import { DateHeader } from './DateHeader'
import { RoomColumn } from './RoomColumn'
import { TimelineGrid } from './TimelineGrid'
import { BookingsLayer } from './BookingsLayer'
import { TodayColumnHighlight } from './TodayColumnHighlight'
import { OccupancyFooter } from './OccupancyFooter'
import { DragGhost } from './DragGhost'
import { BookingDetailSheet } from '../dialogs/BookingDetailSheet'
import { CheckInDialog } from '../dialogs/CheckInDialog'
import type { NewStayData } from '../dialogs/CheckInDialog'
import { CheckOutDialog } from '../dialogs/CheckOutDialog'
import { ExtendConfirmDialog } from '../dialogs/ExtendConfirmDialog'
import { MoveRoomDialog } from '../dialogs/MoveRoomDialog'
import { MoveExtensionConfirmDialog } from '../dialogs/MoveExtensionConfirmDialog'
import { MoveReservationConfirmDialog } from '../dialogs/MoveReservationConfirmDialog'
import { NoShowConfirmModal } from './NoShowConfirmModal'
import { ConfirmCheckinDialog } from '../dialogs/ConfirmCheckinDialog'
import type {
  FlatRow,
  DropResult,
  ExtendState,
} from '../../types/timeline.types'
import { useRoomGroups } from '../../hooks/useRoomGroups'
import { useAuthStore } from '@/store/auth'
import { usePropertyStore } from '@/store/property'

// ─── Component ──────────────────────────────────────────────

export function TimelineScheduler() {
  const { dayWidth, sheetOpen, sheetStayId, openSheet, closeSheet } = useTimelineStore()

  // Active property comes from the property switcher; falls back to the
  // JWT's home property on first load, before the persisted store or the
  // /properties fetch have had a chance to populate.
  const activeId = usePropertyStore((s) => s.activePropertyId)
  const jwtPropertyId = useAuthStore((s) => s.user?.propertyId) ?? ''
  const currentUserId = useAuthStore((s) => s.user?.id) ?? ''
  const PROPERTY_ID = activeId ?? jwtPropertyId

  const { data: apiGroups = [], isLoading: groupsLoading } = useRoomGroups(PROPERTY_ID)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  // ─── Date Virtualizer (infinite horizontal scroll) ─────────
  const {
    virtualColumns,
    totalWidth,
    scrollToDate,
    indexToDate,
    POOL_START,
  } = useDateVirtualizer(PROPERTY_ID, scrollContainerRef, dayWidth)

  // ─── Stable data window — un solo rango grande, queryKey estable ──
  // Solo se expande cuando el viewport está a <14 días del borde.
  const [dataWindow, setDataWindow] = useState(() => {
    const now = new Date()
    return { from: subDays(now, 90), to: addDays(now, 90) }
  })

  const firstVirtIdx = virtualColumns[0]?.index ?? 0
  const lastVirtIdx = virtualColumns[virtualColumns.length - 1]?.index ?? 0
  const expandBucket = Math.floor(firstVirtIdx / 14)

  useEffect(() => {
    if (!virtualColumns.length) return
    const firstDate = indexToDate(firstVirtIdx)
    const lastDate = indexToDate(lastVirtIdx)

    setDataWindow((prev) => {
      let next = prev
      if (differenceInDays(prev.from, firstDate) > -14) {
        next = { ...next, from: subDays(firstDate, 60) }
      }
      if (differenceInDays(lastDate, prev.to) > -14) {
        next = { ...next, to: addDays(lastDate, 60) }
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandBucket])

  // Derive days array from virtual columns (for components that need it)
  const days = useMemo(
    () => virtualColumns.map((vc) => vc.date),
    [virtualColumns],
  )

  // Collapsible groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const groups = useMemo(
    () =>
      apiGroups.map((g) => ({
        ...g,
        collapsed: collapsedGroups.has(g.id),
      })),
    [apiGroups, collapsedGroups],
  )

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  // Flatten groups into rows (group headers + visible room rows)
  const flatRows: FlatRow[] = useMemo(() => {
    const rows: FlatRow[] = []
    groups.forEach((group) => {
      rows.push({ type: 'group', id: group.id, group })
      if (!group.collapsed) {
        group.rooms.forEach((room) => {
          rows.push({ type: 'room', id: room.id, groupId: group.id, room })
        })
      }
    })
    return rows
  }, [groups])

  // Total rooms for occupancy calculation
  const totalRooms = useMemo(
    () => groups.reduce((sum, g) => sum + (g.collapsed ? 0 : g.rooms.length), 0),
    [groups],
  )

  // Handle scroll sync
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (el) {
      setScrollTop(el.scrollTop)
      setScrollLeft(el.scrollLeft)
    }
  }, [])

  // ─── Navigation (wired to virtualizer, not store) ──────────
  const handleNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      if (!virtualColumns.length) return
      const visibleCount = virtualColumns.length
      const step = Math.floor(visibleCount / 2)
      const midDate = virtualColumns[Math.floor(visibleCount / 2)]?.date
      if (!midDate) return
      const target =
        direction === 'next' ? addDays(midDate, step) : subDays(midDate, step)
      scrollToDate(target)
    },
    [virtualColumns, scrollToDate],
  )

  const handleGoToToday = useCallback(() => {
    scrollToDate(subDays(new Date(), 2))
  }, [scrollToDate])

  // ─── Lock/Unlock ───────────────────────────────────────────
  const [lockedStays, setLockedStays] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('lockedStays') ?? '[]') as string[]),
  )

  const toggleLock = useCallback((stayId: string) => {
    setLockedStays(prev => {
      const next = new Set(prev)
      if (next.has(stayId)) next.delete(stayId)
      else next.add(stayId)
      localStorage.setItem('lockedStays', JSON.stringify([...next]))
      return next
    })
  }, [])

  // ─── Guest stays from API ──────────────────────────────────
  const { data: stays = [], isLoading } = useGuestStays(
    PROPERTY_ID,
    dataWindow.from,
    dataWindow.to,
  )
  const createStay      = useCreateGuestStay(PROPERTY_ID)
  const checkoutMut     = useCheckout(PROPERTY_ID)
  const moveRoomMut     = useMoveRoom(PROPERTY_ID)
  const splitMidStayMut = useSplitMidStay(PROPERTY_ID)
  const splitReservationMut = useSplitReservation(PROPERTY_ID)
  const extendStayMut        = useExtendStay(PROPERTY_ID)
  const extendSameRoomMut    = useExtendSameRoom(PROPERTY_ID)
  const extendNewRoomMut     = useExtendNewRoom(PROPERTY_ID)
  const moveExtensionRoomMut = useMoveExtensionRoom(PROPERTY_ID)
  const markNoShowMut   = useMarkNoShow(PROPERTY_ID)
  const revertNoShowMut = useRevertNoShow(PROPERTY_ID)
  const { potentialNoShowWarningHour, noShowCutoffHour } = usePropertySettings()

  const { journeyBlocks: rawJourneyBlocks } = useStayJourneys(PROPERTY_ID, dataWindow.from, dataWindow.to)

  // Propagate `noShowAt` from parent GuestStay to each journey segment block.
  // The journeys endpoint doesn't return this field, but drag/drop conflict
  // detection needs it: a no-show releases inventory (CLAUDE.md §17) — segments
  // belonging to a no-show stay must NOT count as room occupancy.
  const journeyBlocks = useMemo(() => {
    const noShowMap = new Map<string, Date>()
    for (const s of stays) if (s.noShowAt) noShowMap.set(s.id, s.noShowAt)
    if (noShowMap.size === 0) return rawJourneyBlocks
    return rawJourneyBlocks.map((b) =>
      b.guestStayId && noShowMap.has(b.guestStayId)
        ? { ...b, noShowAt: noShowMap.get(b.guestStayId) }
        : b,
    )
  }, [rawJourneyBlocks, stays])

  // SSE: real-time updates when room status changes
  useRoomSSE(PROPERTY_ID)

  // Soft-lock state — Map<roomId, lockedByName> for 🔒 badge in RoomColumn.
  // Populated via SSE events soft:lock:acquired / soft:lock:released.
  // Using useState with functional setter avoids stale closures over the Map.
  const [lockedRooms, setLockedRooms] = useState<Map<string, string>>(new Map())
  useSoftLockSSE(setLockedRooms)

  // Room readiness tasks for visual indicators
  const { data: rawReadinessTasks = [] } = useRoomReadinessTasks(PROPERTY_ID)
  const readinessTasks = useMemo(() =>
    (rawReadinessTasks as Array<Record<string, unknown>>).map((t) => {
      const items = (t.items as Array<Record<string, unknown>>) ?? []
      return {
        roomId: t.roomId as string,
        status: t.status as string,
        itemsDone: items.filter(
          (i) => i.status === 'DONE' || i.status === 'SKIPPED',
        ).length,
        itemsTotal: items.length,
      }
    }),
    [rawReadinessTasks],
  )

  const handleDropSuccess = useCallback((result: DropResult) => {
    // ── Journey segment drag ─────────────────────────────────────────────────
    // ORIGINAL (unlocked) + EXTENSION_SAME/NEW_ROOM are movable.
    // ROOM_MOVE / SPLIT are immutable history and are never draggable.
    const draggedJourneyBlock = journeyBlocks.find(b => b.id === result.stayId)
    const isMovableJourneySegment =
      draggedJourneyBlock?.segmentReason === 'ORIGINAL' ||
      draggedJourneyBlock?.segmentReason === 'EXTENSION_SAME_ROOM' ||
      draggedJourneyBlock?.segmentReason === 'EXTENSION_NEW_ROOM'

    if (draggedJourneyBlock && isMovableJourneySegment) {
      // IN_HOUSE journey segment: moving the entire segment would shift past nights
      // to the new room — incorrect for BI/marketing history (CLAUDE.md §22/§29).
      // Redirect to the split dialog, pre-selecting the target room for part 2.
      const segStatus = getStayStatus(draggedJourneyBlock.checkIn, draggedJourneyBlock.checkOut, draggedJourneyBlock.actualCheckout)
      if (segStatus === 'IN_HOUSE') {
        setMoveRoomDialog({ stayId: draggedJourneyBlock.id, preselectedNewRoomId: result.newRoomId })
        return
      }
      const newRoomRow = flatRows.find(r => r.id === result.newRoomId && r.type === 'room')
      setMoveExtensionConfirm({
        segmentId: draggedJourneyBlock.segmentId!,
        journeyId: draggedJourneyBlock.journeyId!,
        newRoomId: result.newRoomId,
        newRoomNumber: newRoomRow?.room?.number ?? result.newRoomId.slice(0, 8),
        nights: differenceInCalendarDays(draggedJourneyBlock.checkOut, draggedJourneyBlock.checkIn),
        checkIn: draggedJourneyBlock.checkIn,
        checkOut: draggedJourneyBlock.checkOut,
      })
      return
    }

    // ── Plain GuestStay drag ─────────────────────────────────────────────────
    const draggedStay = stays.find(s => s.id === result.stayId) ?? null
    if (!draggedStay) return

    // IN_HOUSE plain stay: block full-block move for the same reason as above.
    // Open MoveRoomDialog in split mode with the target room pre-selected.
    const stayStatus = getStayStatus(draggedStay.checkIn, draggedStay.checkOut, draggedStay.actualCheckout)
    if (stayStatus === 'IN_HOUSE') {
      setMoveRoomDialog({ stayId: draggedStay.id, preselectedNewRoomId: result.newRoomId })
      return
    }

    // ARRIVING / DEPARTING — simple full-block move with confirmation dialog
    // (non-negotiable — see CLAUDE.md §32).
    const newRoomRow = flatRows.find(r => r.id === result.newRoomId && r.type === 'room')
    const fromRoomRow = flatRows.find(r => r.id === draggedStay.roomId && r.type === 'room')
    setMoveReservationConfirm({
      stayId: draggedStay.id,
      guestName: draggedStay.guestName,
      fromRoomId: draggedStay.roomId,
      fromRoomNumber: fromRoomRow?.room?.number,
      newRoomId: result.newRoomId,
      newRoomNumber: newRoomRow?.room?.number ?? result.newRoomId.slice(0, 8),
      nights: Math.max(1, differenceInCalendarDays(draggedStay.checkOut, draggedStay.checkIn)),
      checkIn: draggedStay.checkIn,
      checkOut: draggedStay.checkOut,
    })
  }, [journeyBlocks, flatRows, stays])

  // ─── No-show filter toggle (§34 — default visible) ──────────────────────────
  const [hideNoShows, setHideNoShows] = useState(false)

  // ─── Journey highlight (lifted from BookingsLayer for cross-component sync) ──
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null)

  // Clearing the journey also closes the sheet — single click to reset everything
  const handleSetActiveJourneyId = useCallback((id: string | null) => {
    setActiveJourneyId(id)
    if (id === null) closeSheet()
  }, [closeSheet])

  // ─── Dialogs ────────────────────────────────────────────────
  const [checkInDialog, setCheckInDialog] = useState<{
    open: boolean; roomId?: string; roomNumber?: string; checkIn?: Date
  }>({ open: false })

  const [checkOutDialog, setCheckOutDialog] = useState<{
    open: boolean; stayId: string | null
  }>({ open: false, stayId: null })

  const [noShowDialog, setNoShowDialog] = useState<{ stayId: string } | null>(null)

  const [checkinDialog, setCheckinDialog] = useState<{ stayId: string } | null>(null)
  const confirmCheckinMut = useConfirmCheckin(PROPERTY_ID)
  const noShowTarget = noShowDialog
    ? ([...stays, ...journeyBlocks].find((s) => s.id === noShowDialog.stayId) ?? null)
    : null

  // ─── Extend stay by drag ───────────────────────────────────────
  const [extendState, setExtendState] = useState<ExtendState | null>(null)
  const [extendConfirm, setExtendConfirm] = useState<{
    stayId: string
    journeyId?: string
    originalCheckOut: Date
    newCheckOut: Date
    roomConflict?: boolean
    availableRooms?: import('../dialogs/ExtendConfirmDialog').RoomOption[]
  } | null>(null)

  // ─── Move room dialog ──────────────────────────────────────────
  const [moveRoomDialog, setMoveRoomDialog] = useState<{
    stayId: string
    /** Pre-selects part 2 room when opened via drag-and-drop to a specific target */
    preselectedNewRoomId?: string
  } | null>(null)
  const moveRoomTarget = moveRoomDialog
    ? (stays.find(s => s.id === moveRoomDialog.stayId) ?? journeyBlocks.find(s => s.id === moveRoomDialog.stayId) ?? null)
    : null

  // ─── Move reservation confirm (drag plain stay block to another row) ──
  const [moveReservationConfirm, setMoveReservationConfirm] = useState<{
    stayId: string
    guestName: string
    fromRoomId: string
    fromRoomNumber?: string
    newRoomId: string
    newRoomNumber: string
    nights: number
    checkIn: Date
    checkOut: Date
  } | null>(null)

  // ─── Move extension confirm (drag +ext block to another row) ──
  const [moveExtensionConfirm, setMoveExtensionConfirm] = useState<{
    segmentId: string
    journeyId: string
    newRoomId: string
    newRoomNumber: string
    nights: number
    checkIn: Date
    checkOut: Date
  } | null>(null)

  // ─── Drag & Drop ────────────────────────────────────────────
  // Ghost position is updated via direct DOM mutation (not state) so moving
  // the cursor doesn't trigger a React re-render every frame.
  const ghostRef = useRef<HTMLDivElement | null>(null)

  // GuestStay blocks whose journey is tracked via StayJourney segments are
  // replaced visually by the ORIGINAL + extension/move segments. Hide them
  // from the rendered layer so the original room row is not double-occupied.
  const staysWithoutJourneys = useMemo(
    () => stays.filter((s) => !s.journeyId),
    [stays],
  )

  // Merge journeyBlocks into conflict detection so dragging a stay
  // can't overwrite a pre-planned ROOM_MOVE/EXTENSION segment.
  const allBlocksForDragCheck = useMemo(
    () => [...stays, ...journeyBlocks],
    [stays, journeyBlocks],
  )

  // Pre-built occupancy Set for O(1) per-cell lookup in TimelineGrid.
  // Without this, isOccupied scans all blocks on every cell × every render,
  // costing O(rooms × days × blocks) when dragTargetRoomId changes.
  const occupancySet = useMemo(() => {
    const set = new Set<string>()
    for (const block of allBlocksForDragCheck) {
      if (block.actualCheckout) continue // departed — not an active occupancy
      if (block.noShowAt) continue       // no-show releases inventory (CLAUDE.md §17)
      const checkIn = block.checkIn.getTime()
      const checkOut = block.checkOut.getTime()
      const MS_DAY = 86400000
      for (let t = checkIn; t < checkOut; t += MS_DAY) {
        const d = new Date(t)
        set.add(`${block.roomId}:${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`)
      }
    }
    return set
  }, [allBlocksForDragCheck])

  const isOccupied = useCallback((roomId: string, date: Date) => {
    const d = startOfDay(date)
    return occupancySet.has(`${roomId}:${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`)
  }, [occupancySet])

  const {
    dragState,
    handleDragStart: rawDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  } = useDragDrop({
    flatRows,
    stays: allBlocksForDragCheck,
    onDropSuccess: handleDropSuccess,
    onDropInvalid: (reason) => toast.error(reason),
  })

  const handleDragStartWithPosition = useCallback((stayId: string, clientX: number, clientY: number) => {
    if (ghostRef.current) {
      ghostRef.current.style.transform = `translate(${clientX - 20}px, ${clientY - TIMELINE.ROW_HEIGHT / 2}px)`
    }
    rawDragStart(stayId, clientX)
  }, [rawDragStart])

  const handleExtendStart = useCallback((
    stayId: string,
    roomId: string,
    rowIndex: number,
    groupHeaderOffsetY: number,
    originalCheckOut: Date,
    clientX: number,
  ) => {
    const stayRef = stays.find(s => s.id === stayId) ?? journeyBlocks.find(s => s.id === stayId)
    setExtendState({
      stayId,
      journeyId: stayRef?.journeyId,
      roomId,
      rowIndex,
      groupHeaderOffsetY,
      originalCheckOut,
      previewCheckOut: originalCheckOut,
      startClientX: clientX,
    })
  }, [stays, journeyBlocks])

  // isDraggingActive flips only when drag starts/ends — NOT on every mousemove.
  // This prevents the effect from re-subscribing event listeners every frame.
  const isDraggingActive = !!dragState

  useEffect(() => {
    if (!isDraggingActive) return

    function onMouseMove(e: MouseEvent) {
      // Move ghost via GPU-composited transform — zero React re-renders.
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${e.clientX - 20}px, ${e.clientY - TIMELINE.ROW_HEIGHT / 2}px)`
      }

      const container = scrollContainerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const gridY = e.clientY - containerRect.top + container.scrollTop

      handleDragMove(e.clientX, gridY)
    }

    function onMouseUp() {
      handleDragEnd()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleDragCancel()
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  // handleDragMove/End/Cancel are now stable ([] deps in useDragDrop via refs).
  // isDraggingActive changes only on drag start/end, not on every mousemove.
  }, [isDraggingActive, handleDragMove, handleDragEnd, handleDragCancel])

  const draggedStay = dragState
    ? stays.find(s => s.id === dragState.stayId) ?? journeyBlocks.find(s => s.id === dragState.stayId) ?? null
    : null

  // ─── Extend drag global listeners ─────────────────────────────
  useEffect(() => {
    if (!extendState) return

    function onMouseMove(e: MouseEvent) {
      setExtendState(prev => {
        if (!prev) return null
        // Math.floor: trigger at the MID of each next column (where the block
        // endpoint visually lives — stayToRect places checkOut at dayWidth/2).
        // Math.round triggered at the column boundary, half a cell too early.
        const deltaDays = Math.max(0, Math.floor((e.clientX - prev.startClientX) / dayWidth))
        const newCO = startOfDay(addDays(prev.originalCheckOut, deltaDays))
        return { ...prev, previewCheckOut: newCO }
      })
    }

    function onMouseUp() {
      setExtendState(prev => {
        if (!prev) return null
        const added = differenceInCalendarDays(prev.previewCheckOut, prev.originalCheckOut)
        if (added >= 1) {
          const snap = { ...prev }
          // Pre-flight: check if the original room is available for the extension dates.
          // If the room has a conflict, offer alternative rooms with availability.
          guestStaysApi.checkAvailability(snap.roomId, snap.originalCheckOut, snap.previewCheckOut)
            .then((result) => {
              if (result.available) {
                setExtendConfirm({
                  stayId: snap.stayId,
                  journeyId: snap.journeyId,
                  originalCheckOut: snap.originalCheckOut,
                  newCheckOut: snap.previewCheckOut,
                })
              } else {
                // Room unavailable — collect alternatives from flatRows and filter
                // by same roomTypeId, excluding the conflicting room itself.
                const conflictingRoomRow = flatRows.find(r => r.type === 'room' && r.id === snap.roomId)
                const roomTypeId = conflictingRoomRow?.room?.roomTypeId
                const alternatives = flatRows
                  .filter(r => r.type === 'room' && r.id !== snap.roomId && (!roomTypeId || r.room?.roomTypeId === roomTypeId))
                  .map(r => ({ id: r.id, number: r.room?.number ?? r.id, type: r.room?.roomTypeId ?? '' }))

                setExtendConfirm({
                  stayId: snap.stayId,
                  journeyId: snap.journeyId,
                  originalCheckOut: snap.originalCheckOut,
                  newCheckOut: snap.previewCheckOut,
                  roomConflict: true,
                  availableRooms: alternatives,
                })
              }
            })
            .catch(() => {
              // On network error, fall back to same-room extension and let the server validate.
              setExtendConfirm({
                stayId: snap.stayId,
                journeyId: snap.journeyId,
                originalCheckOut: snap.originalCheckOut,
                newCheckOut: snap.previewCheckOut,
              })
            })
        }
        return null
      })
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setExtendState(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [extendState, dayWidth])

  if (groupsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <div className="animate-spin w-4 h-4 border-2 border-slate-200 border-t-slate-500 rounded-full" />
          Cargando...
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      <TimelineTopBar
        onNewReservation={() => setCheckInDialog({ open: true })}
      />
      <TimelineSubBar
        onNavigate={handleNavigate}
        onGoToToday={handleGoToToday}
        hideNoShows={hideNoShows}
        onToggleHideNoShows={() => setHideNoShows((v) => !v)}
      />

      <div className="flex flex-col flex-1 overflow-hidden relative">
        {/* ── Top row: corner + DateHeader (FUERA del scroll container) ── */}
        <div className="flex flex-shrink-0 border-b border-slate-200 bg-white z-20">
          {/* Esquina superior izquierda — alineada con RoomColumn */}
          <div
            className="border-r border-slate-200 bg-slate-50 flex items-end px-3 pb-2"
            style={{ width: TIMELINE.COLUMN_WIDTH, height: TIMELINE.HEADER_HEIGHT, flexShrink: 0 }}
          >
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Habitaciones
            </span>
          </div>

          {/* DateHeader — overflow:hidden + translateX(-scrollLeft) */}
          <div className="flex-1 overflow-hidden">
            <div
              style={{ transform: `translateX(-${scrollLeft}px)`, width: totalWidth }}
            >
              <DateHeader
                virtualColumns={virtualColumns}
                totalWidth={totalWidth}
                dayWidth={dayWidth}
              />
            </div>
          </div>
        </div>

        {/* ── Body: scroll horizontal + vertical en un solo contenedor ── */}
        <div
          ref={scrollContainerRef}
          className="flex flex-1 overflow-auto"
          onScroll={handleScroll}
        >
          {/* RoomColumn — sticky left, z-[25] > booking block max z-20 */}
          <div
            className="sticky left-0 z-[25] bg-white border-r border-slate-200"
            style={{ width: TIMELINE.COLUMN_WIDTH, flexShrink: 0 }}
          >
            <RoomColumn
              embedded
              flatRows={flatRows}
              groups={groups}
              onToggleGroup={toggleGroup}
              readinessTasks={readinessTasks}
              lockedRooms={lockedRooms}
            />
          </div>

          {/* Grid + bookings — z-0 creates an isolated stacking context so the
              sticky room column (z-[25]) always paints above booking blocks. */}
          <div className="relative flex-shrink-0 z-0" style={{ width: totalWidth }}>
            <TimelineGrid
              virtualColumns={virtualColumns}
              totalWidth={totalWidth}
              dayWidth={dayWidth}
              flatRows={flatRows}
              dragTargetRoomId={dragState?.currentRoomId}
              dragIsValid={dragState?.isValid ?? true}
              isDragging={!!dragState || !!extendState}
              onCellClick={(roomId, date) => {
                if (isOccupied(roomId, date)) return
                const roomRow = flatRows.find(r => r.id === roomId && r.type === 'room')
                setCheckInDialog({ open: true, roomId, roomNumber: roomRow?.room?.number ?? roomId.slice(0, 8), checkIn: date })
              }}
              isOccupied={isOccupied}
              getRoomRate={(roomId) => {
                const group = groups.find(g => g.rooms.some(r => r.id === roomId))
                if (!group) return undefined
                return { rate: group.baseRate, currency: group.currency }
              }}
            />
            <TodayColumnHighlight
              days={days}
              dayWidth={dayWidth}
              flatRows={flatRows}
              poolStart={POOL_START}
            />
            {/* Extend drag preview overlay
                originLeft aligns with the block's right edge: stayToRect places
                checkOut at (checkOutDays * dayWidth + dayWidth/2), so we offset
                by dayWidth/2 to avoid overlapping the original block. */}
            {extendState && (() => {
              const daysAdded = differenceInCalendarDays(extendState.previewCheckOut, extendState.originalCheckOut)
              const topY = extendState.rowIndex * TIMELINE.ROW_HEIGHT + extendState.groupHeaderOffsetY
              const originLeft = differenceInDays(extendState.originalCheckOut, POOL_START) * dayWidth + dayWidth / 2

              // Engagement indicator: shown immediately on mousedown before crossing
              // the first column mid (Djajadiningrat 2004 — gesture must have instant echo).
              if (daysAdded <= 0) {
                return (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: originLeft,
                      top: topY + 3,
                      width: 6,
                      height: TIMELINE.ROW_HEIGHT - 6,
                      background: 'rgba(16,185,129,0.45)',
                      borderLeft: '3px solid rgba(16,185,129,0.85)',
                      borderRadius: '0 3px 3px 0',
                      zIndex: 15,
                    }}
                  />
                )
              }

              const previewWidth = daysAdded * dayWidth
              const showLabel = previewWidth > 28
              return (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    left: originLeft,
                    top: topY + 3,
                    width: previewWidth - 2,
                    height: TIMELINE.ROW_HEIGHT - 6,
                    background: 'rgba(16,185,129,0.10)',
                    borderLeft: '3px solid rgba(16,185,129,0.70)',
                    borderTop: '1px solid rgba(16,185,129,0.25)',
                    borderBottom: '1px solid rgba(16,185,129,0.25)',
                    borderRight: '1px solid rgba(16,185,129,0.25)',
                    borderRadius: '0 5px 5px 0',
                    boxShadow: '0 2px 8px rgba(16,185,129,0.12), inset 0 1px 0 rgba(255,255,255,0.4)',
                    zIndex: 15,
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: 8,
                    overflow: 'hidden',
                  }}
                >
                  {showLabel && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(4,120,87,0.88)', letterSpacing: '-0.02em', lineHeight: 1, whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
                      +{daysAdded}n
                    </span>
                  )}
                </div>
              )
            })()}

            <BookingsLayer
              stays={hideNoShows ? staysWithoutJourneys.filter((s) => !s.noShowAt) : staysWithoutJourneys}
              flatRows={flatRows}
              days={days}
              dayWidth={dayWidth}
              calendarStart={POOL_START}
              totalWidth={totalWidth}
              dragState={dragState}
              onDragStart={handleDragStartWithPosition}
              onExtendStart={handleExtendStart}
              onStayClick={openSheet}
              onCheckout={(stayId) => {
                closeSheet()
                setActiveJourneyId(null)
                setCheckOutDialog({ open: true, stayId })
              }}
              onNoShow={(stayId) => {
                setNoShowDialog({ stayId })
              }}
              onStartCheckin={(stayId) => {
                closeSheet()
                setCheckinDialog({ stayId })
              }}
              onRevertNoShow={(stayId) => {
                revertNoShowMut.mutate(stayId)
              }}
              potentialNoShowWarningHour={potentialNoShowWarningHour}
              noShowCutoffHour={noShowCutoffHour}
              lockedStays={lockedStays}
              onToggleLock={toggleLock}
              scrollLeft={scrollLeft}
              journeyStays={journeyBlocks}
              activeJourneyId={activeJourneyId}
              onSetActiveJourneyId={handleSetActiveJourneyId}
            />
          </div>
        </div>

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-20 pointer-events-none">
            <div className="flex gap-2 items-center text-sm text-slate-400">
              <div className="animate-spin w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full" />
              Cargando reservas...
            </div>
          </div>
        )}
      </div>

      {/* Occupancy footer — sticky at bottom */}
      <OccupancyFooter
        virtualColumns={virtualColumns}
        stays={stays}
        totalRooms={totalRooms}
        dayWidth={dayWidth}
        columnWidth={TIMELINE.COLUMN_WIDTH}
        scrollLeft={scrollLeft}
        readinessTasks={readinessTasks}
      />

      {/* Drag ghost — position updated via DOM ref (no React re-render per frame).
          GPU-composited translate keeps this on the compositor thread. */}
      {dragState && draggedStay && createPortal(
        <div
          ref={ghostRef}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            transform: 'translate(-9999px, -9999px)', // off-screen until first mousemove
            pointerEvents: 'none',
            zIndex: 9998,
            willChange: 'transform',
          }}
        >
          <DragGhost
            dragState={dragState}
            stay={draggedStay}
            dayWidth={dayWidth}
          />
        </div>,
        document.body,
      )}

      {/* ─── Dialogs ─────────────────────────────────────────── */}
      {noShowDialog && noShowTarget && (
        <NoShowConfirmModal
          guestName={noShowTarget.guestName}
          roomNumber={noShowTarget.roomNumber ?? (() => {
            const row = flatRows.find(r => r.id === noShowTarget.roomId && r.type === 'room')
            return row?.room?.number
          })()}
          checkIn={noShowTarget.checkIn}
          checkOut={noShowTarget.checkOut}
          source={noShowTarget.source}
          otaName={noShowTarget.otaName}
          isPending={markNoShowMut.isPending}
          onClose={() => setNoShowDialog(null)}
          onConfirm={() => {
            markNoShowMut.mutate(
              { stayId: noShowDialog.stayId },
              { onSettled: () => setNoShowDialog(null) },
            )
          }}
        />
      )}

      <BookingDetailSheet
        stay={(() => {
          const raw = stays.find(s => s.id === sheetStayId) ?? journeyBlocks.find(s => s.id === sheetStayId) ?? null
          if (!raw) return null
          if (raw.roomNumber) return raw
          const roomRow = flatRows.find(r => r.id === raw.roomId && r.type === 'room')
          return { ...raw, roomNumber: roomRow?.room?.number }
        })()}
        open={sheetOpen}
        onClose={() => {
          setActiveJourneyId(null)
          closeSheet()
        }}
        onCheckout={(stayId) => {
          closeSheet()
          setActiveJourneyId(null)
          setCheckOutDialog({ open: true, stayId })
        }}
        onMoveRoom={(stayId) => {
          setMoveRoomDialog({ stayId })
          setActiveJourneyId(null)
          closeSheet()
        }}
        onNoShow={(stayId, opts) => {
          markNoShowMut.mutate({ stayId, ...opts })
        }}
        onRevertNoShow={(stayId) => {
          revertNoShowMut.mutate(stayId)
        }}
        onStartCheckin={(stayId) => {
          closeSheet()
          setCheckinDialog({ stayId })
        }}
        propertyId={PROPERTY_ID}
      />

      <CheckInDialog
        open={checkInDialog.open}
        initialRoomId={checkInDialog.roomId}
        roomNumber={checkInDialog.roomNumber}
        initialCheckIn={checkInDialog.checkIn}
        propertyId={PROPERTY_ID}
        onClose={() => setCheckInDialog({ open: false })}
        onConfirm={(data: NewStayData) => {
          createStay.mutate({ ...data, propertyId: PROPERTY_ID })
          setCheckInDialog({ open: false })
        }}
      />

      {/* ─── Confirm check-in dialog (Sprint 8) ─────────────── */}
      {checkinDialog && (() => {
        const raw = [...stays, ...journeyBlocks].find(s => s.id === checkinDialog.stayId) ?? null
        if (!raw) return null
        const roomRow = flatRows.find(r => r.id === raw.roomId && r.type === 'room')
        const stay = raw.roomNumber ? raw : { ...raw, roomNumber: roomRow?.room?.number }
        return (
          <ConfirmCheckinDialog
            stay={stay}
            roomLabel={stay.roomNumber ? `Hab. ${stay.roomNumber}` : 'Habitación'}
            open={true}
            onClose={() => setCheckinDialog(null)}
            onConfirm={(data) => {
              confirmCheckinMut.mutate(
                { stayId: checkinDialog.stayId, data },
                { onSettled: () => setCheckinDialog(null) },
              )
            }}
            isPending={confirmCheckinMut.isPending}
          />
        )
      })()}

      <CheckOutDialog
        stay={(() => {
          const raw = stays.find(s => s.id === checkOutDialog.stayId) ?? null
          if (!raw) return null
          if (raw.roomNumber) return raw
          const roomRow = flatRows.find(r => r.id === raw.roomId && r.type === 'room')
          return { ...raw, roomNumber: roomRow?.room?.number }
        })()}
        open={checkOutDialog.open}
        onClose={() => setCheckOutDialog({ open: false, stayId: null })}
        onConfirm={(stayId, _payment) => {
          checkoutMut.mutate(stayId)
          setCheckOutDialog({ open: false, stayId: null })
        }}
      />

      {/* ─── Extend confirm dialog ──────────────────────────── */}
      {extendConfirm && (() => {
        const stay = stays.find(s => s.id === extendConfirm.stayId)
          ?? journeyBlocks.find(s => s.id === extendConfirm.stayId)
        if (!stay) return null
        const roomRow = flatRows.find(r => r.id === stay.roomId && r.type === 'room')
        return (
          <ExtendConfirmDialog
            guestName={stay.guestName}
            roomNumber={stay.roomNumber ?? roomRow?.room?.number}
            originalCheckOut={extendConfirm.originalCheckOut}
            newCheckOut={extendConfirm.newCheckOut}
            ratePerNight={stay.ratePerNight}
            originalTotal={stay.totalAmount}
            currency={stay.currency}
            source={stay.source}
            otaName={stay.otaName}
            roomConflict={extendConfirm.roomConflict}
            availableRooms={extendConfirm.availableRooms}
            isPending={extendStayMut.isPending || extendSameRoomMut.isPending || extendNewRoomMut.isPending}
            onClose={() => setExtendConfirm(null)}
            onConfirmNewRoom={(newRoomId) => {
              if (!extendConfirm.journeyId) return
              extendNewRoomMut.mutate(
                { journeyId: extendConfirm.journeyId, newRoomId, newCheckOut: extendConfirm.newCheckOut },
                { onSettled: () => setExtendConfirm(null) },
              )
            }}
            onConfirm={() => {
              if (extendConfirm.journeyId) {
                // Journey-aware path: creates EXTENSION_SAME_ROOM segment → +ext block appears
                extendSameRoomMut.mutate(
                  { journeyId: extendConfirm.journeyId, newCheckOut: extendConfirm.newCheckOut },
                  { onSettled: () => setExtendConfirm(null) },
                )
              } else {
                // Legacy fallback: no journeyId, update GuestStay directly
                extendStayMut.mutate(
                  { stayId: extendConfirm.stayId, newCheckOut: extendConfirm.newCheckOut },
                  { onSettled: () => setExtendConfirm(null) },
                )
              }
            }}
          />
        )
      })()}

      {/* ─── Move room dialog ────────────────────────────────── */}
      {moveRoomDialog && moveRoomTarget && (() => {
        const stayWithRoom = moveRoomTarget.roomNumber
          ? moveRoomTarget
          : { ...moveRoomTarget, roomNumber: flatRows.find(r => r.id === moveRoomTarget.roomId && r.type === 'room')?.room?.number }
        const stayStatus = getStayStatus(moveRoomTarget.checkIn, moveRoomTarget.checkOut, moveRoomTarget.actualCheckout)
        const isInHouse = stayStatus === 'IN_HOUSE'
        const isBusy = isInHouse
          ? (splitMidStayMut.isPending || splitReservationMut.isPending)
          : (moveRoomMut.isPending || splitReservationMut.isPending)

        return (
          <MoveRoomDialog
            stay={stayWithRoom}
            groups={groups}
            flatRows={flatRows}
            stays={allBlocksForDragCheck}
            isInHouse={isInHouse}
            isPending={isBusy}
            initialNewRoomId={moveRoomDialog.preselectedNewRoomId}
            initialSplitMode={isInHouse && !!moveRoomDialog.preselectedNewRoomId}
            onClose={() => setMoveRoomDialog(null)}
            onConfirm={(newRoomId, effectiveDate) => {
              if (isInHouse && moveRoomTarget.journeyId) {
                // IN_HOUSE: route to stay-journeys endpoint to create ROOM_MOVE segment
                splitMidStayMut.mutate(
                  {
                    journeyId: moveRoomTarget.journeyId,
                    newRoomId,
                    effectiveDate: effectiveDate ?? startOfDay(new Date()),
                    actorId: currentUserId,
                  },
                  { onSettled: () => setMoveRoomDialog(null) },
                )
              } else {
                // ARRIVING (no journey yet): simple moveRoom
                moveRoomMut.mutate(
                  { stayId: moveRoomDialog.stayId, newRoomId },
                  { onSettled: () => setMoveRoomDialog(null) },
                )
              }
            }}
            onSplit={(parts) => {
              if (!moveRoomTarget.journeyId) {
                toast.error('No se puede dividir: la reserva no tiene journey asociado')
                return
              }
              splitReservationMut.mutate(
                { journeyId: moveRoomTarget.journeyId, parts },
                { onSettled: () => setMoveRoomDialog(null) },
              )
            }}
          />
        )
      })()}
      {moveReservationConfirm && (
        <MoveReservationConfirmDialog
          guestName={moveReservationConfirm.guestName}
          fromRoomNumber={moveReservationConfirm.fromRoomNumber}
          toRoomNumber={moveReservationConfirm.newRoomNumber}
          nights={moveReservationConfirm.nights}
          checkIn={moveReservationConfirm.checkIn}
          checkOut={moveReservationConfirm.checkOut}
          isPending={moveRoomMut.isPending}
          onClose={() => setMoveReservationConfirm(null)}
          onConfirm={() => {
            moveRoomMut.mutate(
              { stayId: moveReservationConfirm.stayId, newRoomId: moveReservationConfirm.newRoomId },
              { onSettled: () => setMoveReservationConfirm(null) },
            )
          }}
        />
      )}
      {moveExtensionConfirm && (
        <MoveExtensionConfirmDialog
          newRoomNumber={moveExtensionConfirm.newRoomNumber}
          nights={moveExtensionConfirm.nights}
          checkIn={moveExtensionConfirm.checkIn}
          checkOut={moveExtensionConfirm.checkOut}
          isPending={moveExtensionRoomMut.isPending}
          onClose={() => setMoveExtensionConfirm(null)}
          onConfirm={() => {
            moveExtensionRoomMut.mutate(
              { segmentId: moveExtensionConfirm.segmentId, newRoomId: moveExtensionConfirm.newRoomId },
              { onSettled: () => setMoveExtensionConfirm(null) },
            )
          }}
        />
      )}
    </div>
  )
}
