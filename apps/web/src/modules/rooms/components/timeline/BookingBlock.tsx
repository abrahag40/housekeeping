import { memo, useMemo, useRef } from 'react'
import { Lock, Unlock, LogOut, UserX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STAY_STATUS_COLORS, OTA_ACCENT_COLORS, TIMELINE } from '../../utils/timeline.constants'
import type { StayStatusKey } from '../../utils/timeline.constants'
import { stayToRect, getStayStatus } from '../../utils/timeline.utils'
import type { GuestStayBlock } from '../../types/timeline.types'
import { useTooltip } from '../../hooks/useTooltip'
import { TooltipPortal } from './TooltipPortal'

interface BookingBlockProps {
  stay: GuestStayBlock
  rowIndex: number
  calendarStart: Date
  dayWidth: number
  groupHeaderOffsetY: number
  staggerIndex: number
  onDragStart: (stayId: string, clientX: number, clientY: number) => void
  onExtendStart?: (stayId: string, roomId: string, rowIndex: number, groupHeaderOffsetY: number, originalCheckOut: Date, clientX: number) => void
  onClick: () => void
  onCheckout?: (stayId: string) => void
  onNoShow?: (stayId: string) => void
  isDragging?: boolean
  isLocked?: boolean
  onToggleLock?: (stayId: string) => void
  scrollLeft?: number
  dimmed?: boolean
  isInActiveJourney?: boolean
}

const BLOCK_SHADOW = [
  'inset 0 1px 0 rgba(255,255,255,0.55)',
  'inset 1px 0 0 rgba(255,255,255,0.35)',
  'inset -1px 0 0 rgba(0,0,0,0.06)',
  'inset 0 -1px 0 rgba(0,0,0,0.08)',
  '0 1px 2px rgba(0,0,0,0.06)',
  '0 2px 4px rgba(0,0,0,0.04)',
].join(', ')

const DRAG_THRESHOLD = 5
const JOURNEY_DOT_COLOR = '#378ADD'

function JourneyDot({ x, y, side }: { x: number; y: number; side: 'left' | 'right' }) {
  const R = 5 // dot radius px
  return (
    <div
      style={{
        position: 'absolute',
        left: x - R,
        top: y - R,
        width: R * 2,
        height: R * 2,
        pointerEvents: 'none',
        zIndex: 28,
      }}
    >
      {/* Expanding ring — SwiftUI-style pulse */}
      <span
        className="journey-pulse-ring"
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          backgroundColor: JOURNEY_DOT_COLOR,
          opacity: 0.55,
        }}
      />
      {/* Solid center dot */}
      <span
        style={{
          position: 'absolute',
          inset: 2,
          borderRadius: '50%',
          backgroundColor: JOURNEY_DOT_COLOR,
          boxShadow: '0 0 0 1.5px white',
        }}
      />
    </div>
  )
}

function BookingBlockInner({
  stay,
  rowIndex,
  calendarStart,
  dayWidth,
  groupHeaderOffsetY,
  staggerIndex,
  onDragStart,
  onExtendStart,
  onClick,
  onCheckout,
  onNoShow,
  isDragging = false,
  isLocked = false,
  onToggleLock,
  scrollLeft = 0,
  dimmed = false,
  isInActiveJourney = false,
}: BookingBlockProps) {
  const forceAbove = stay.hasMultipleSegments === true && stay.isLastSegment !== true
  const { triggerRef, registerTooltipRef, visible, position, hide } = useTooltip({ forceAbove })
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null)
  const didDrag = useRef(false)

  const rect = useMemo(
    () =>
      stayToRect({
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        rowIndex,
        calendarStart,
        dayWidth,
        rowHeight: TIMELINE.ROW_HEIGHT,
      }),
    [stay.checkIn, stay.checkOut, rowIndex, calendarStart, dayWidth],
  )

  // How many px the block extends past the left of the viewport
  const textOffset = useMemo(() => {
    const blockLeft = rect.x + 1 // matches the style `left` below
    if (blockLeft < scrollLeft) {
      return scrollLeft - blockLeft
    }
    return 0
  }, [rect.x, scrollLeft])

  // When the block is clipped on the left, the visible portion width
  const visibleWidth = useMemo(() => {
    return textOffset > 0 ? rect.width - textOffset : rect.width
  }, [rect.width, textOffset])

  const rawStatus = getStayStatus(stay.checkIn, stay.checkOut, stay.actualCheckout)
  // If this segment has a successor (extension or room move), the guest is still in-house
  // even if checkOut = today — show IN_HOUSE (green) rather than DEPARTING (amber).
  const stayStatus = (rawStatus === 'DEPARTING' && stay.hasMultipleSegments && !stay.isLastSegment)
    ? 'IN_HOUSE'
    : rawStatus
  const isDeparting = stayStatus === 'DEPARTING'
  // Confirmed no-show: noShowAt is set
  const isConfirmedNoShow = !!stay.noShowAt
  // Potential no-show: IN_HOUSE status but no confirmed no-show yet
  const isPotentialNoShow = stayStatus === 'IN_HOUSE' && !stay.noShowAt
  const colors = STAY_STATUS_COLORS[stayStatus as StayStatusKey]
  const otaAccent = OTA_ACCENT_COLORS[stay.source] ?? OTA_ACCENT_COLORS.other
  // Journey block flags: segments whose roomId can be reassigned via drag.
  // - ORIGINAL, EXTENSION_SAME_ROOM, EXTENSION_NEW_ROOM: draggable when not locked.
  // - ROOM_MOVE, SPLIT: always click-only (represent placed history; changing
  //   their room would break the audit trail of the stay journey).
  const isJourneyBlock = !!stay.segmentReason
  const isMovableSegment =
    !stay.segmentLocked &&
    (stay.segmentReason === 'ORIGINAL' ||
      stay.segmentReason === 'EXTENSION_SAME_ROOM' ||
      stay.segmentReason === 'EXTENSION_NEW_ROOM')
  const isMovableExtension =
    stay.segmentReason === 'EXTENSION_SAME_ROOM' ||
    stay.segmentReason === 'EXTENSION_NEW_ROOM'
  const isCompact = dayWidth <= 20
  const showText = rect.width > TIMELINE.MIN_BLOCK_WIDTH
  const showEdgeLabels = !isCompact && rect.width > 80

  // Progressive density helpers
  const nameParts = stay.guestName.split(' ')
  const firstName = nameParts[0]
  const lastInitial = nameParts[1]?.[0] ?? ''
  const showDot = rect.width <= 80
  const dotColor = isDeparting
    ? '#BA7517'
    : stay.segmentReason === 'ROOM_MOVE'
    ? '#378ADD'
    : stay.segmentReason === 'SPLIT'
    ? '#378ADD'
    : stay.segmentReason === 'EXTENSION_SAME_ROOM' || stay.segmentReason === 'EXTENSION_NEW_ROOM'
    ? '#378ADD'
    : '#1D9E75'
  const displayName =
    rect.width <= 50
      ? `${firstName[0] ?? ''}${firstName[1] ?? ''}.`
      : rect.width <= 80
      ? `${firstName} ${lastInitial}.`
      : stay.guestName

  // Departed stays are read-only — no drag, no lock, no actions
  const isPast = stayStatus === 'DEPARTED'

  // Segment-derived style flags
  const isSegmentLocked = stay.segmentLocked === true
  const lastSegmentBorder =
    stay.hasMultipleSegments && stay.isLastSegment && stay.segmentReason !== 'ORIGINAL'
      ? '2px solid #1D9E75'
      : undefined

  // Journey edge dots — replace the old +mov/+ext text badges.
  // hasPredecessor: this block is a journey continuation (has something before it).
  // hasSuccessor:   this block has at least one following segment in the journey.
  const hasPredecessor = !!stay.segmentReason && stay.segmentReason !== 'ORIGINAL'
  const hasSuccessor   = !!stay.hasMultipleSegments && !stay.isLastSegment

  if (rect.width < 4) return null

  function handleMouseDown(e: React.MouseEvent) {
    if (isLocked) return
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    e.stopPropagation()

    // Past stays, no-shows, locked journey segments (ORIGINAL with extensions), and
    // ROOM_MOVE segments: click-only. EXTENSION segments are draggable — drop on
    // different row → MoveExtensionConfirmDialog.
    if (isPast || isConfirmedNoShow || isSegmentLocked || (isJourneyBlock && !isMovableSegment)) {
      // Read-only blocks still need drag-threshold detection so a "drag then release
      // outside the block" gesture does NOT trigger onClick (which would open the
      // side panel). Cursor moved beyond threshold = user intent was not a click.
      const startX = e.clientX
      const startY = e.clientY
      let movedPastThreshold = false

      function handleMouseMoveReadOnly(ev: MouseEvent) {
        if (movedPastThreshold) return
        if (
          Math.abs(ev.clientX - startX) > DRAG_THRESHOLD ||
          Math.abs(ev.clientY - startY) > DRAG_THRESHOLD
        ) {
          movedPastThreshold = true
          hide()
        }
      }
      function handleMouseUpReadOnly() {
        window.removeEventListener('mousemove', handleMouseMoveReadOnly)
        window.removeEventListener('mouseup', handleMouseUpReadOnly)
        if (!movedPastThreshold) onClick()
      }
      window.addEventListener('mousemove', handleMouseMoveReadOnly)
      window.addEventListener('mouseup', handleMouseUpReadOnly)
      return
    }

    mouseDownPos.current = { x: e.clientX, y: e.clientY }
    didDrag.current = false

    function handleMouseMove(ev: MouseEvent) {
      if (!mouseDownPos.current) return
      const deltaX = Math.abs(ev.clientX - mouseDownPos.current.x)
      const deltaY = Math.abs(ev.clientY - mouseDownPos.current.y)

      if (deltaX > DRAG_THRESHOLD || deltaY > DRAG_THRESHOLD) {
        if (!didDrag.current) {
          didDrag.current = true
          hide()
          onDragStart(stay.id, ev.clientX, ev.clientY)
        }
      }
    }

    function handleMouseUp() {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)

      if (!didDrag.current) {
        onClick()
      }
      mouseDownPos.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <>
      <div
        ref={triggerRef}
        role="button"
        tabIndex={0}
        onMouseDown={handleMouseDown}
        data-stay-id={stay.id}
        data-journey-id={stay.journeyId}
        data-segment-id={stay.segmentId}
        className={cn(
          'absolute select-none overflow-hidden group',
          'transition-all duration-150 ease-out',
          !isDragging && 'hover:shadow-[0_4px_8px_rgba(0,0,0,0.12),0_8px_16px_rgba(0,0,0,0.08)]',
          !isDragging && 'hover:z-10',
          !isDragging && 'active:scale-[0.995] active:shadow-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500',
        )}
        style={{
          left: rect.x + 1,
          top: rect.y + groupHeaderOffsetY + 3,
          width: rect.width - 3,
          height: rect.height - 4,
          background: isConfirmedNoShow
            ? `repeating-linear-gradient(-45deg, rgba(239,68,68,0.13) 0px, rgba(239,68,68,0.13) 2px, transparent 2px, transparent 8px), ${colors.bg}`
            : colors.bg,
          color: isConfirmedNoShow ? '#7F1D1D' : colors.text,
          boxShadow: isConfirmedNoShow
            ? `inset 0 0 0 1.5px rgba(239,68,68,0.50), ${BLOCK_SHADOW}`
            : isPotentialNoShow
            ? `inset 0 0 0 1.5px rgba(245,158,11,0.70), ${BLOCK_SHADOW}`
            : isInActiveJourney
            ? `0 0 0 2px #378ADD, 0 4px 12px rgba(55,138,221,0.35), ${BLOCK_SHADOW}`
            : BLOCK_SHADOW,
          borderRadius: 6,
          pointerEvents: isDragging ? 'none' : 'auto',
          opacity: dimmed
            ? 0.15
            : isDragging
            ? 0.3
            : isSegmentLocked || stayStatus === 'DEPARTED' || isConfirmedNoShow
            ? 0.72
            : 1,
          cursor: isLocked
            ? 'default'
            : isPast || isConfirmedNoShow || isJourneyBlock || isSegmentLocked
            ? 'pointer'
            : isDragging
            ? 'grabbing'
            : 'grab',
          borderRight: lastSegmentBorder,
          animationFillMode: 'forwards',
          animationDelay: `${staggerIndex * 20}ms`,
          zIndex: dimmed ? 3 : visible ? 20 : 6,
        }}
      >
        {/* OTA accent bar — left border stripe. Wider + brighter red for confirmed no-shows. */}
        <div
          className="absolute left-0 top-0 bottom-0 rounded-l-md"
          style={{
            width: isConfirmedNoShow ? 4 : 3,
            backgroundColor: isConfirmedNoShow ? '#DC2626' : otaAccent,
          }}
        />

        {isCompact ? (
          <div className="w-full h-full" />
        ) : textOffset > 0 ? (
          /* ── Clipped layout: block starts before the visible viewport ──
             Absolutely position name + OUT side-by-side at the visible left edge,
             so the receptionist always knows whose checkout they're confirming. */
          <>
            {/* Name — anchored to visible left edge */}
            {visibleWidth > 20 && (
              <div
                className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden"
                style={{
                  left: textOffset + 6,
                  right: isDeparting && onCheckout && !isDragging && !isSegmentLocked ? 58 : 6,
                }}
              >
                {showDot && (
                  <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
                )}
                <span
                  className="text-[11px] font-medium truncate leading-none"
                >
                  {displayName}
                </span>
              </div>
            )}
            {/* OUT button — always anchored to right edge of the block */}
            {!isConfirmedNoShow && isDeparting && onCheckout && !isDragging && !isSegmentLocked && (
              <button
                className="absolute inset-y-0 right-1.5 my-auto flex items-center gap-0.5 bg-amber-600 hover:bg-amber-700
                           text-white rounded px-1.5 py-0.5 text-[9px] font-bold h-fit
                           transition-colors shadow-sm shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  onCheckout(stay.id)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Confirmar checkout"
              >
                <LogOut className="h-2.5 w-2.5" />
                OUT
              </button>
            )}
          </>
        ) : (
          <div
            className="h-full flex items-center gap-1.5 overflow-hidden relative"
            style={{
              paddingLeft: 8,
              // Reserve right space: OUT (~52px) | NS badge (~28px) | lock (~20px)
              paddingRight:
                isDeparting && rect.width > 80 && onCheckout && !isDragging && !isSegmentLocked
                  ? 58
                  : isPotentialNoShow && rect.width > 70 && !isDragging && !isSegmentLocked
                  ? 36
                  : !isPast && !isDragging && !isSegmentLocked
                  ? 22
                  : 8,
            }}
          >
            {showDot && (
              <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
            )}
            {(showDot || showText) && (
              <span
                className="text-[11px] font-medium truncate leading-none"
              >
                {displayName}
              </span>
            )}

            {/* CONFIRMED NO-SHOW badge — stable pill (no pulse), replaces potential NS */}
            {isConfirmedNoShow && rect.width > 30 && !isDragging && (
              <div
                className="absolute inset-y-0 right-1.5 my-auto flex items-center shrink-0 h-fit"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span
                  className="inline-flex items-center gap-0.5 font-bold"
                  style={{ backgroundColor: '#FEE2E2', color: '#991B1B', fontSize: 9, padding: '1px 5px', borderRadius: 3, lineHeight: 1.5 }}
                >
                  <UserX style={{ width: 8, height: 8 }} />
                  NS
                </span>
              </div>
            )}

            {/* DEPARTING — absolute right, same as clipped layout */}
            {!isConfirmedNoShow && isDeparting && rect.width > 80 && onCheckout && !isDragging && !isSegmentLocked && (
              <button
                className="absolute inset-y-0 right-1.5 my-auto flex items-center gap-0.5 bg-amber-600 hover:bg-amber-700
                           text-white rounded px-1.5 py-0.5 text-[9px] font-bold h-fit
                           transition-colors shadow-sm shrink-0"
                onClick={(e) => {
                  e.stopPropagation()
                  onCheckout(stay.id)
                }}
                onMouseDown={(e) => e.stopPropagation()}
                title="Confirmar checkout"
              >
                <LogOut className="h-2.5 w-2.5" />
                OUT
              </button>
            )}
            {/* POTENTIAL NO-SHOW — badge NS con pulsing dot (only when not yet confirmed) */}
            {isPotentialNoShow && !isConfirmedNoShow && rect.width > 70 && !isDragging && !isSegmentLocked && (
              <div
                className="absolute inset-y-0 right-1.5 my-auto flex items-center shrink-0 h-fit"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <span
                  className="inline-flex items-center gap-0.5 font-bold"
                  style={{ backgroundColor: '#FED7AA', color: '#9A3412', fontSize: 9, padding: '1px 5px', borderRadius: 3, lineHeight: 1.5 }}
                >
                  <UserX style={{ width: 8, height: 8 }} />
                  NS
                </span>
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              </div>
            )}
            {/* Lock toggle — hidden for past stays, no-shows, and journey blocks */}
            {!isPast && !isConfirmedNoShow && !isJourneyBlock && !isDragging && !isSegmentLocked && !isDeparting && !isPotentialNoShow && (
              <div
                className={cn(
                  'absolute inset-y-0 right-1 my-auto p-0.5 rounded hover:bg-black/10 transition-opacity duration-150 h-fit',
                  isLocked ? 'opacity-70' : 'opacity-0 group-hover:opacity-60',
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleLock?.(stay.id)
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {isLocked
                  ? <Lock className="h-3 w-3" style={{ color: colors.text }} />
                  : <Unlock className="h-3 w-3" style={{ color: colors.text }} />
                }
              </div>
            )}
          </div>
        )}

        {/* Right-edge extend handle — visible on the last segment of a journey (even if the
            ORIGINAL is locked) and on plain non-journey blocks. Locked mid-journey segments
            (not last) stay non-resizable so only one active tail can be extended at a time. */}
        {!isPast && !isConfirmedNoShow && !isLocked && !isDragging && onExtendStart
          && (!isSegmentLocked || stay.isLastSegment === true) && (
          <div
            className="absolute right-0 top-0 bottom-0 w-3 z-10"
            style={{ cursor: 'ew-resize' }}
            title="Arrastrar para extender estadía"
            onMouseDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              onExtendStart(stay.id, stay.roomId, rowIndex, groupHeaderOffsetY, stay.checkOut, e.clientX)
            }}
          />
        )}
      </div>

      {/* Journey edge dots — left (predecessor) and/or right (successor).
          Rendered outside the block div so overflow:hidden doesn't clip them.
          Positioned in the same coordinate space as the block (BookingsLayer container). */}
      {!isCompact && hasPredecessor && isInActiveJourney && (
        <JourneyDot
          x={rect.x + 1}
          y={rect.y + groupHeaderOffsetY + 3 + rect.height / 2}
          side="left"
        />
      )}
      {!isCompact && hasSuccessor && isInActiveJourney && (
        <JourneyDot
          x={rect.x + 1 + rect.width}
          y={rect.y + groupHeaderOffsetY + 3 + rect.height / 2}
          side="right"
        />
      )}

      <TooltipPortal
        stay={stay}
        position={position}
        visible={visible}
        registerTooltipRef={registerTooltipRef}
        onNoShow={onNoShow ? (stayId) => { hide(); onNoShow(stayId) } : undefined}
        isPotentialNoShow={isPotentialNoShow}
      />
    </>
  )
}

// Skip re-render when only callback references change (inline closures in BookingsLayer).
// Data-driven props are the only ones that actually change during drag/scroll:
//   - isDragging: true only for the one block being dragged
//   - dimmed:     changes when journey highlight activates
//   - isLocked:   changes on user toggle
//   - scrollLeft: changes on horizontal scroll
//   - dayWidth:   changes on zoom
//   - stay:       stable React Query reference
export const BookingBlock = memo(BookingBlockInner, (prev, next) =>
  prev.stay === next.stay &&
  prev.rowIndex === next.rowIndex &&
  prev.groupHeaderOffsetY === next.groupHeaderOffsetY &&
  prev.dayWidth === next.dayWidth &&
  prev.isDragging === next.isDragging &&
  prev.isLocked === next.isLocked &&
  prev.scrollLeft === next.scrollLeft &&
  prev.dimmed === next.dimmed &&
  prev.staggerIndex === next.staggerIndex &&
  prev.isInActiveJourney === next.isInActiveJourney,
)
