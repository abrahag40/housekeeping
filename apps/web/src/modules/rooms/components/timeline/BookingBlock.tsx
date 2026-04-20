import { useMemo, useRef } from 'react'
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
  onClick: () => void
  onCheckout?: (stayId: string) => void
  onNoShow?: (stayId: string) => void
  isDragging?: boolean
  isLocked?: boolean
  onToggleLock?: (stayId: string) => void
  scrollLeft?: number
  dimmed?: boolean
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

export function BookingBlock({
  stay,
  rowIndex,
  calendarStart,
  dayWidth,
  groupHeaderOffsetY,
  staggerIndex,
  onDragStart,
  onClick,
  onCheckout,
  onNoShow,
  isDragging = false,
  isLocked = false,
  onToggleLock,
  scrollLeft = 0,
  dimmed = false,
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

  const stayStatus = getStayStatus(stay.checkIn, stay.checkOut, stay.actualCheckout)
  const isDeparting = stayStatus === 'DEPARTING'
  // IN_HOUSE without noShowAt = guest was expected but hasn't been marked no-show yet
  const isPotentialNoShow = stayStatus === 'IN_HOUSE' && !stay.noShowAt
  const colors = STAY_STATUS_COLORS[stayStatus as StayStatusKey]
  const otaAccent = OTA_ACCENT_COLORS[stay.source] ?? OTA_ACCENT_COLORS.other
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
  const showSegmentBadge = rect.width > 80 && (
    stay.segmentReason === 'EXTENSION_SAME_ROOM' ||
    stay.segmentReason === 'EXTENSION_NEW_ROOM' ||
    stay.segmentReason === 'ROOM_MOVE'
  )
  const segmentBadgeLabel =
    stay.segmentReason === 'ROOM_MOVE' ? '+mov' : '+ext'
  const segmentBadgeStyle: React.CSSProperties =
    stay.segmentReason === 'ROOM_MOVE'
      ? { backgroundColor: '#B5D4F4', color: '#0C447C' }
      : { backgroundColor: '#FAC775', color: '#633806' }
  const lastSegmentBorder =
    stay.hasMultipleSegments && stay.isLastSegment && stay.segmentReason !== 'ORIGINAL'
      ? '2px solid #1D9E75'
      : undefined

  if (rect.width < 4) return null

  function handleMouseDown(e: React.MouseEvent) {
    if (isLocked || isSegmentLocked) return
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    e.stopPropagation()

    // Past stays are read-only: allow click to open details, no drag
    if (isPast) {
      function handleMouseUpPast() {
        window.removeEventListener('mouseup', handleMouseUpPast)
        onClick()
      }
      window.addEventListener('mouseup', handleMouseUpPast)
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
          backgroundColor: colors.bg,
          color: colors.text,
          boxShadow: BLOCK_SHADOW,
          borderRadius: 6,
          pointerEvents: isDragging ? 'none' : 'auto',
          opacity: dimmed
            ? 0.15
            : isDragging
            ? 0.3
            : isSegmentLocked || stayStatus === 'DEPARTED'
            ? 0.72
            : 1,
          cursor: isPast || isLocked || isSegmentLocked ? 'default' : isDragging ? 'grabbing' : 'grab',
          borderRight: lastSegmentBorder,
          animationFillMode: 'forwards',
          animationDelay: `${staggerIndex * 20}ms`,
          zIndex: dimmed ? 3 : visible ? 20 : 6,
        }}
      >
        {/* OTA accent bar — left border stripe */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md"
          style={{ backgroundColor: otaAccent }}
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
                {showDot ? (
                  <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
                ) : (
                  showSegmentBadge && (
                    <div
                      className="shrink-0"
                      style={{ ...segmentBadgeStyle, fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, lineHeight: 1.4, pointerEvents: 'none' }}
                    >
                      {segmentBadgeLabel}
                    </div>
                  )
                )}
                <span className="text-[11px] font-medium truncate leading-none">
                  {displayName}
                </span>
              </div>
            )}
            {/* OUT button — always anchored to right edge of the block */}
            {isDeparting && onCheckout && !isDragging && !isSegmentLocked && (
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
            {showDot ? (
              <div style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
            ) : (
              showSegmentBadge && (
                <div
                  className="shrink-0"
                  style={{ ...segmentBadgeStyle, fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 3, lineHeight: 1.4, pointerEvents: 'none' }}
                >
                  {segmentBadgeLabel}
                </div>
              )
            )}
            {(showDot || showText) && (
              <span className="text-[11px] font-medium truncate leading-none">
                {displayName}
              </span>
            )}

            {/* DEPARTING — absolute right, same as clipped layout */}
            {isDeparting && rect.width > 80 && onCheckout && !isDragging && !isSegmentLocked && (
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
            {/* POTENTIAL NO-SHOW — badge NS con pulsing dot */}
            {isPotentialNoShow && rect.width > 70 && !isDragging && !isSegmentLocked && (
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
            {/* Lock toggle — hidden for past stays */}
            {!isPast && !isDragging && !isSegmentLocked && !isDeparting && !isPotentialNoShow && (
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

      </div>

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
