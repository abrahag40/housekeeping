import { useMemo, useRef, useEffect, useCallback } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { TIMELINE } from '../../utils/timeline.constants'
import { BookingBlock } from './BookingBlock'
import type { GuestStayBlock, FlatRow, DragState } from '../../types/timeline.types'

interface BookingsLayerProps {
  stays: GuestStayBlock[]
  flatRows: FlatRow[]
  days: Date[]
  dayWidth: number
  calendarStart: Date
  totalWidth: number
  dragState?: DragState | null
  onDragStart: (stayId: string, clientX: number, clientY: number) => void
  onExtendStart?: (stayId: string, roomId: string, rowIndex: number, groupHeaderOffsetY: number, originalCheckOut: Date, clientX: number) => void
  onStayClick: (stayId: string) => void
  onCheckout: (stayId: string) => void
  onNoShow?: (stayId: string) => void
  onStartCheckin?: (stayId: string) => void
  onRevertNoShow?: (stayId: string) => void
  potentialNoShowWarningHour?: number
  noShowCutoffHour?: number
  lockedStays?: Set<string>
  onToggleLock?: (stayId: string) => void
  scrollLeft?: number
  journeyStays?: GuestStayBlock[]
  activeJourneyId: string | null
  onSetActiveJourneyId: (id: string | null) => void
}

const SVG_NS = 'http://www.w3.org/2000/svg'

// Compare two dates by calendar day only (ignores time-of-day).
// Used to match predecessor.checkOut with segment.checkIn — the API may store
// them at different times (e.g. noon vs midnight) on the same logical day.
function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth()    === b.getUTCMonth() &&
    a.getUTCDate()     === b.getUTCDate()
  )
}

// Find the predecessor stay for a journey segment.
// A predecessor is a stay whose checkOut falls on the same calendar day as the
// segment's checkIn. Prefer same room (extension), fall back to same guest name
// (room move). Excludes the segment itself.
function findPredecessor(
  seg: GuestStayBlock,
  allStays: GuestStayBlock[],
): GuestStayBlock | undefined {
  return (
    allStays.find(
      (s) => s.id !== seg.id && sameDay(s.checkOut, seg.checkIn) && s.roomId === seg.roomId,
    ) ??
    allStays.find(
      (s) => s.id !== seg.id && sameDay(s.checkOut, seg.checkIn) && s.guestName === seg.guestName,
    )
  )
}

// Given all journey segments (from journeyStays, have journeyId) and the pool
// of all stays, return an ordered list of [predecessor, segment] pairs to draw
// connection lines between.
function buildConnectionPairs(
  journeySegments: GuestStayBlock[],
  allStays: GuestStayBlock[],
): Array<[GuestStayBlock, GuestStayBlock]> {
  const sorted = [...journeySegments].sort(
    (a, b) => a.checkIn.getTime() - b.checkIn.getTime(),
  )

  const pairs: Array<[GuestStayBlock, GuestStayBlock]> = []
  for (const seg of sorted) {
    const predecessor = findPredecessor(seg, allStays)
    if (predecessor) pairs.push([predecessor, seg])
  }
  return pairs
}

// The full set of stay IDs that belong to the active journey — used to determine
// which blocks are "active" (not dimmed). Includes both journey segments and their
// predecessor stays from the regular `stays` array.
function buildActiveStayIds(
  activeJourneyId: string,
  journeyStays: GuestStayBlock[],
  stays: GuestStayBlock[],
): Set<string> {
  const segments = journeyStays.filter((s) => s.journeyId === activeJourneyId)
  const ids = new Set(segments.map((s) => s.id))

  const allStays = [...stays, ...journeyStays]
  for (const seg of segments) {
    const pred = findPredecessor(seg, allStays)
    if (pred) ids.add(pred.id)
  }

  return ids
}

export function BookingsLayer({
  stays,
  flatRows,
  days,
  dayWidth,
  calendarStart,
  totalWidth,
  dragState,
  onDragStart,
  onExtendStart,
  onStayClick,
  onCheckout,
  onNoShow,
  onStartCheckin,
  onRevertNoShow,
  potentialNoShowWarningHour,
  noShowCutoffHour,
  lockedStays,
  onToggleLock,
  scrollLeft = 0,
  journeyStays = [],
  activeJourneyId,
  onSetActiveJourneyId,
}: BookingsLayerProps) {
  const calendarEnd = days[days.length - 1]
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Map roomId → row index (room rows only, accounting for group header offsets)
  const roomIndexMap = useMemo(() => {
    const map = new Map<string, { rowIndex: number; groupHeaderOffsetY: number }>()
    let roomRowCount = 0
    let groupHeaderTotal = 0
    flatRows.forEach((row) => {
      if (row.type === 'group') {
        groupHeaderTotal += TIMELINE.GROUP_HEADER_HEIGHT
      } else {
        map.set(row.id, { rowIndex: roomRowCount, groupHeaderOffsetY: groupHeaderTotal })
        roomRowCount++
      }
    })
    return map
  }, [flatRows])

  // Filter stays visible in current viewport
  const visibleStays = useMemo(
    () =>
      stays.filter((stay) => {
        const mapping = roomIndexMap.get(stay.roomId)
        if (!mapping) return false
        if (!calendarEnd) return false
        return (
          differenceInCalendarDays(stay.checkOut, calendarStart) > 0 &&
          differenceInCalendarDays(stay.checkIn, calendarEnd) < 1
        )
      }),
    [stays, roomIndexMap, calendarStart, calendarEnd],
  )

  // Total height
  const totalHeight = flatRows.reduce(
    (sum, row) =>
      sum + (row.type === 'group' ? TIMELINE.GROUP_HEADER_HEIGHT : TIMELINE.ROW_HEIGHT),
    0,
  )

  // IDs of all stays that belong to the active journey (segments + predecessors).
  // Used for dimmed logic so original stays aren't incorrectly dimmed.
  const activeStayIds = useMemo<Set<string>>(() => {
    if (!activeJourneyId) return new Set()
    return buildActiveStayIds(activeJourneyId, journeyStays, stays)
  }, [activeJourneyId, journeyStays, stays])

  // Draw / clear SVG journey lines whenever activeJourneyId changes.
  // Finds predecessor→segment pairs from data, then looks up their DOM elements
  // by data-stay-id / data-segment-id to get pixel positions.
  useEffect(() => {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container) return

    if (!activeJourneyId) {
      svg.style.opacity = '0'
      const timer = setTimeout(() => { svg.innerHTML = '' }, 150)
      return () => clearTimeout(timer)
    }

    const journeySegments = journeyStays.filter((s) => s.journeyId === activeJourneyId)
    const allStays = [...stays, ...journeyStays]
    const pairs = buildConnectionPairs(journeySegments, allStays)

    if (pairs.length === 0) {
      svg.style.opacity = '0'
      return
    }

    const containerRect = container.getBoundingClientRect()

    interface Point { rightX: number; leftX: number; y: number }

    function getPoint(stay: GuestStayBlock): Point | null {
      // Prefer segment-id lookup (journey blocks); fall back to stay-id (regular blocks)
      const el =
        (stay.segmentId
          ? container!.querySelector<HTMLElement>(`[data-segment-id="${stay.segmentId}"]`)
          : null) ??
        container!.querySelector<HTMLElement>(`[data-stay-id="${stay.id}"]`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        rightX: r.right - containerRect.left,
        leftX:  r.left  - containerRect.left,
        y:      r.top   - containerRect.top + r.height / 2,
      }
    }

    svg.innerHTML = ''
    let drew = false

    for (const [prev, curr] of pairs) {
      const a = getPoint(prev)
      const b = getPoint(curr)
      if (!a || !b) continue

      // Only draw line if segments are on different rows — same-row continuity is
      // visually obvious from block adjacency; the line just adds noise.
      if (Math.abs(a.y - b.y) <= 10) continue

      drew = true
      const path = document.createElementNS(SVG_NS, 'path')
      const d = `M ${a.rightX} ${a.y} C ${a.rightX + 40} ${a.y} ${b.leftX - 40} ${b.y} ${b.leftX} ${b.y}`
      path.setAttribute('d', d)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', '#378ADD')
      path.setAttribute('stroke-width', '1.5')
      path.setAttribute('stroke-dasharray', '5 3')
      path.classList.add('journey-line')
      svg.appendChild(path)

      // Endpoint dots
      for (const pt of [{ x: a.rightX, y: a.y }, { x: b.leftX, y: b.y }]) {
        const circle = document.createElementNS(SVG_NS, 'circle')
        circle.setAttribute('cx', String(pt.x))
        circle.setAttribute('cy', String(pt.y))
        circle.setAttribute('r', '3')
        circle.setAttribute('fill', '#378ADD')
        svg.appendChild(circle)
      }

      // For far-apart rows, add room-label anchors so the user knows
      // where the connection goes even when one endpoint is off-screen.
      const FAR_ROW_THRESHOLD = 180
      if (Math.abs(a.y - b.y) > FAR_ROW_THRESHOLD) {
        const labelStyle = { fill: '#378ADD', fontSize: '9', fontWeight: '700', fontFamily: 'inherit' }

        if (curr.roomNumber) {
          const tA = document.createElementNS(SVG_NS, 'text')
          Object.entries({ ...labelStyle, x: String(a.rightX + 7), y: String(a.y + 3) })
            .forEach(([k, v]) => tA.setAttribute(k, v))
          tA.textContent = `→ Hab. ${curr.roomNumber}`
          svg.appendChild(tA)
        }

        if (prev.roomNumber) {
          const tB = document.createElementNS(SVG_NS, 'text')
          Object.entries({ ...labelStyle, x: String(b.leftX - 7), y: String(b.y + 3), 'text-anchor': 'end' })
            .forEach(([k, v]) => tB.setAttribute(k, v))
          tB.textContent = `← Hab. ${prev.roomNumber}`
          svg.appendChild(tB)
        }
      }
    }

    svg.style.opacity = drew ? '1' : '0'
  }, [activeJourneyId, stays, journeyStays])


  const visibleJourneyStays = useMemo(
    () =>
      journeyStays.filter((stay) => {
        const mapping = roomIndexMap.get(stay.roomId)
        if (!mapping) return false
        if (!calendarEnd) return false
        return (
          differenceInCalendarDays(stay.checkOut, calendarStart) > 0 &&
          differenceInCalendarDays(stay.checkIn, calendarEnd) < 1
        )
      }),
    [journeyStays, roomIndexMap, calendarStart, calendarEnd],
  )

  // Stable block-click handler — wrapped in useCallback so BookingBlock (memo'd)
  // doesn't re-render just because BookingsLayer re-renders.
  const handleBlockClickCb = useCallback((stay: GuestStayBlock) => {
    if (stay.journeyId) {
      onSetActiveJourneyId(stay.journeyId)
    } else {
      const allStays = [...stays, ...journeyStays]
      const asSegment = journeyStays.find(
        (seg) => findPredecessor(seg, allStays)?.id === stay.id,
      )
      onSetActiveJourneyId(asSegment?.journeyId ?? null)
    }
    onStayClick(stay.id)
  }, [onSetActiveJourneyId, onStayClick, stays, journeyStays])

  return (
    <div
      ref={containerRef}
      className="absolute top-0 left-0"
      style={{
        width: totalWidth,
        height: totalHeight,
        pointerEvents: 'none',
      }}
    >
      {/* Canvas click deactivation overlay — below blocks (z-index 2).
          Single click clears both the journey highlight AND the detail sheet. */}
      {activeJourneyId && (
        <div
          className="absolute inset-0"
          style={{ pointerEvents: 'auto', zIndex: 2 }}
          onClick={() => onSetActiveJourneyId(null)}
        />
      )}

      {/* Dark scrim — between canvas (z-2) and blocks (z-6), pointer-events none */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.15)',
          opacity: activeJourneyId ? 1 : 0,
          transition: 'opacity 150ms ease-out',
          pointerEvents: 'none',
          zIndex: 4,
        }}
      />

      {visibleStays.map((stay, i) => {
        const mapping = roomIndexMap.get(stay.roomId)!
        return (
          <BookingBlock
            key={stay.id}
            stay={stay}
            rowIndex={mapping.rowIndex}
            calendarStart={calendarStart}
            dayWidth={dayWidth}
            groupHeaderOffsetY={mapping.groupHeaderOffsetY}
            staggerIndex={i}
            isDragging={dragState?.stayId === stay.id}
            onDragStart={onDragStart}
            onExtendStart={onExtendStart}
            onClick={() => handleBlockClickCb(stay)}
            onCheckout={onCheckout}
            onNoShow={onNoShow}
            onStartCheckin={onStartCheckin}
            onRevertNoShow={onRevertNoShow}
            potentialNoShowWarningHour={potentialNoShowWarningHour}
            noShowCutoffHour={noShowCutoffHour}
            isLocked={lockedStays?.has(stay.id)}
            onToggleLock={onToggleLock}
            scrollLeft={scrollLeft}
            dimmed={activeJourneyId !== null && !activeStayIds.has(stay.id)}
            isInActiveJourney={activeJourneyId !== null && activeStayIds.has(stay.id)}
          />
        )
      })}

      {visibleJourneyStays.map((stay, i) => {
        const mapping = roomIndexMap.get(stay.roomId)!
        return (
          <BookingBlock
            key={`journey-${stay.id}`}
            stay={stay}
            rowIndex={mapping.rowIndex}
            calendarStart={calendarStart}
            dayWidth={dayWidth}
            groupHeaderOffsetY={mapping.groupHeaderOffsetY}
            staggerIndex={visibleStays.length + i}
            isDragging={dragState?.stayId === stay.id}
            onDragStart={onDragStart}
            onExtendStart={onExtendStart}
            onClick={() => handleBlockClickCb(stay)}
            onCheckout={onCheckout}
            onNoShow={onNoShow}
            onStartCheckin={onStartCheckin}
            onRevertNoShow={onRevertNoShow}
            potentialNoShowWarningHour={potentialNoShowWarningHour}
            noShowCutoffHour={noShowCutoffHour}
            isLocked={lockedStays?.has(stay.id)}
            onToggleLock={onToggleLock}
            scrollLeft={scrollLeft}
            dimmed={activeJourneyId !== null && !activeStayIds.has(stay.id)}
            isInActiveJourney={activeJourneyId !== null && activeStayIds.has(stay.id)}
          />
        )
      })}

      {/* SVG layer for journey connection lines — above blocks (z-index 30) */}
      <svg
        ref={svgRef}
        className="absolute top-0 left-0 w-full h-full"
        style={{ pointerEvents: 'none', zIndex: 30, opacity: 0 }}
        aria-hidden="true"
      />
    </div>
  )
}
