import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { subDays, addDays, differenceInDays } from 'date-fns'
import { useTimelineStore } from '../../stores/timeline.store'
import { TIMELINE } from '../../utils/timeline.constants'
import { useDragDrop } from '../../hooks/useDragDrop'
import { useGuestStays, useCreateGuestStay, useCheckout, useMoveRoom, useMarkNoShow, useRevertNoShow, useRoomReadinessTasks } from '../../hooks/useGuestStays'
import { useStayJourneys } from '../../hooks/useStayJourneys'
import { useRoomSSE } from '../../hooks/useRoomSSE'
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
import { NoShowConfirmModal } from './NoShowConfirmModal'
import type {
  FlatRow,
  DropResult,
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
  const createStay     = useCreateGuestStay(PROPERTY_ID)
  const checkoutMut    = useCheckout(PROPERTY_ID)
  const moveRoomMut    = useMoveRoom(PROPERTY_ID)
  const markNoShowMut  = useMarkNoShow(PROPERTY_ID)
  const revertNoShowMut = useRevertNoShow(PROPERTY_ID)

  const { journeyBlocks } = useStayJourneys(PROPERTY_ID, dataWindow.from, dataWindow.to)

  // SSE: real-time updates when room status changes
  useRoomSSE(PROPERTY_ID)

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
    moveRoomMut.mutate({ stayId: result.stayId, newRoomId: result.newRoomId })
  }, [moveRoomMut])

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
  const noShowTarget = noShowDialog
    ? ([...stays, ...journeyBlocks].find((s) => s.id === noShowDialog.stayId) ?? null)
    : null

  // ─── Drag & Drop ────────────────────────────────────────────
  const [ghostPosition, setGhostPosition] = useState({ x: -9999, y: -9999 })

  const {
    dragState,
    handleDragStart: rawDragStart,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  } = useDragDrop({
    flatRows,
    stays,
    onDropSuccess: handleDropSuccess,
  })

  const handleDragStartWithPosition = useCallback((stayId: string, clientX: number, clientY: number) => {
    setGhostPosition({ x: clientX, y: clientY })
    rawDragStart(stayId, clientX)
  }, [rawDragStart])

  useEffect(() => {
    if (!dragState) return

    function onMouseMove(e: MouseEvent) {
      setGhostPosition({ x: e.clientX, y: e.clientY })

      const container = scrollContainerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      const gridY =
        e.clientY - containerRect.top + container.scrollTop

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
  }, [dragState, handleDragMove, handleDragEnd, handleDragCancel])

  const draggedStay = dragState
    ? stays.find(s => s.id === dragState.stayId) ?? null
    : null

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
              onCellClick={(roomId, date) => {
                const allBlocks = [...stays, ...journeyBlocks]
                const occupied = allBlocks.some(
                  (s) => s.roomId === roomId && date >= s.checkIn && date < s.checkOut,
                )
                if (occupied) return
                const roomRow = flatRows.find(r => r.id === roomId && r.type === 'room')
                setCheckInDialog({ open: true, roomId, roomNumber: roomRow?.room?.number ?? roomId.slice(0, 8), checkIn: date })
              }}
              isOccupied={(roomId, date) => {
                const allBlocks = [...stays, ...journeyBlocks]
                return allBlocks.some(
                  (s) => s.roomId === roomId && date >= s.checkIn && date < s.checkOut,
                )
              }}
            />
            <TodayColumnHighlight
              days={days}
              dayWidth={dayWidth}
              flatRows={flatRows}
              poolStart={POOL_START}
            />
            <BookingsLayer
              stays={stays}
              flatRows={flatRows}
              days={days}
              dayWidth={dayWidth}
              calendarStart={POOL_START}
              totalWidth={totalWidth}
              dragState={dragState}
              onDragStart={handleDragStartWithPosition}
              onStayClick={openSheet}
              onCheckout={(stayId) => {
                closeSheet()
                setActiveJourneyId(null)
                setCheckOutDialog({ open: true, stayId })
              }}
              onNoShow={(stayId) => {
                setNoShowDialog({ stayId })
              }}
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

      {/* Drag ghost — follows cursor via portal */}
      {dragState && draggedStay && createPortal(
        <div
          style={{
            position: 'fixed',
            left: ghostPosition.x,
            top: ghostPosition.y - (TIMELINE.ROW_HEIGHT / 2),
            pointerEvents: 'none',
            zIndex: 9998,
            transform: 'translateX(-20px)',
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
          console.log('TODO: mover habitación', stayId)
          closeSheet()
        }}
        onNoShow={(stayId, opts) => {
          markNoShowMut.mutate({ stayId, ...opts })
        }}
        onRevertNoShow={(stayId) => {
          revertNoShowMut.mutate(stayId)
        }}
      />

      <CheckInDialog
        open={checkInDialog.open}
        initialRoomId={checkInDialog.roomId}
        roomNumber={checkInDialog.roomNumber}
        initialCheckIn={checkInDialog.checkIn}
        onClose={() => setCheckInDialog({ open: false })}
        onConfirm={(data: NewStayData) => {
          createStay.mutate({ ...data, propertyId: PROPERTY_ID })
          setCheckInDialog({ open: false })
        }}
      />

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
    </div>
  )
}
