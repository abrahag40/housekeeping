/**
 * BlocksLayer — renders SmartBlock (RoomBlock) visual elements over the
 * timeline grid. Separate from BookingsLayer to keep the rendering paths
 * independent and avoid re-render coupling between guest-stays and blocks.
 *
 * Design language:
 *  · Diagonal-stripe background per semantic (same visual grammar as NS stripes)
 *    — OOS: amber, OOO: red, OOI: blue, HOUSE_USE: purple
 *  · Pending-approval blocks rendered with dashed border and 60% opacity
 *  · Blocks are non-draggable (pointer-events none on the stripe area)
 *  · Click opens the BlockModal detail from the TimelineScheduler
 *  · Width cap: if no endDate, extend to the calendarEnd prop
 */
import { useMemo } from 'react'
import { differenceInCalendarDays, parseISO, addDays, startOfDay } from 'date-fns'
import { BlockSemantic, BlockStatus, type RoomBlockDto } from '@zenix/shared'
import { TIMELINE } from '../../utils/timeline.constants'
import type { FlatRow } from '../../types/timeline.types'

// ── Semantic colour tokens ─────────────────────────────────────────────────────

const SEMANTIC_COLORS: Record<
  BlockSemantic,
  { bg: string; border: string; text: string; stripe: string }
> = {
  [BlockSemantic.OUT_OF_SERVICE]: {
    bg:     'rgba(245,158,11,0.09)',
    border: 'rgba(245,158,11,0.70)',
    text:   'rgba(180,83,9,0.90)',
    stripe: 'rgba(245,158,11,0.18)',
  },
  [BlockSemantic.OUT_OF_ORDER]: {
    bg:     'rgba(239,68,68,0.09)',
    border: 'rgba(239,68,68,0.65)',
    text:   'rgba(185,28,28,0.90)',
    stripe: 'rgba(239,68,68,0.18)',
  },
  [BlockSemantic.OUT_OF_INVENTORY]: {
    bg:     'rgba(59,130,246,0.09)',
    border: 'rgba(59,130,246,0.65)',
    text:   'rgba(29,78,216,0.90)',
    stripe: 'rgba(59,130,246,0.18)',
  },
  [BlockSemantic.HOUSE_USE]: {
    bg:     'rgba(168,85,247,0.09)',
    border: 'rgba(168,85,247,0.65)',
    text:   'rgba(126,34,206,0.90)',
    stripe: 'rgba(168,85,247,0.18)',
  },
}

const SEMANTIC_ICONS: Record<BlockSemantic, string> = {
  [BlockSemantic.OUT_OF_SERVICE]:   '🔧',
  [BlockSemantic.OUT_OF_ORDER]:     '🚫',
  [BlockSemantic.OUT_OF_INVENTORY]: '📦',
  [BlockSemantic.HOUSE_USE]:        '🏠',
}

const SEMANTIC_SHORT: Record<BlockSemantic, string> = {
  [BlockSemantic.OUT_OF_SERVICE]:   'OOS',
  [BlockSemantic.OUT_OF_ORDER]:     'OOO',
  [BlockSemantic.OUT_OF_INVENTORY]: 'OOI',
  [BlockSemantic.HOUSE_USE]:        'Uso',
}

// ── Row Y-offset lookup ────────────────────────────────────────────────────────

function buildRowYMap(flatRows: FlatRow[]): Map<string, number> {
  const map = new Map<string, number>()
  let y = 0
  for (const row of flatRows) {
    if (row.type === 'room') map.set(row.id, y)
    y += row.type === 'group' ? TIMELINE.GROUP_HEADER_HEIGHT : TIMELINE.ROW_HEIGHT
  }
  return map
}

// ── Component ─────────────────────────────────────────────────────────────────

interface BlocksLayerProps {
  blocks: RoomBlockDto[]
  flatRows: FlatRow[]
  dayWidth: number
  calendarStart: Date
  calendarEnd: Date
  totalWidth: number
  onBlockClick?: (block: RoomBlockDto) => void
}

export function BlocksLayer({
  blocks,
  flatRows,
  dayWidth,
  calendarStart,
  calendarEnd,
  totalWidth,
  onBlockClick,
}: BlocksLayerProps) {
  const rowYMap = useMemo(() => buildRowYMap(flatRows), [flatRows])

  const rendered = useMemo(() => {
    return blocks
      .filter((b) => b.roomId) // only room-level blocks rendered on timeline (unit-level TBD)
      .map((block) => {
        const rowY = rowYMap.get(block.roomId!)
        if (rowY === undefined) return null

        // Slice to YYYY-MM-DD before parseISO so date-fns treats it as local
        // midnight. Without this, a UTC-midnight ISO string ("2026-04-29T00:00Z")
        // becomes April 28 19:00 in UTC-5 → startOfDay shifts it one day back.
        const cal0  = startOfDay(calendarStart)
        const start = startOfDay(parseISO(block.startDate.slice(0, 10)))
        const end   = block.endDate
          ? startOfDay(parseISO(block.endDate.slice(0, 10)))
          : addDays(cal0, differenceInCalendarDays(startOfDay(calendarEnd), cal0) + 1)

        const leftDays = differenceInCalendarDays(start, cal0)
        const endDays  = differenceInCalendarDays(end, cal0)

        // Mirror stayToRect convention: block starts at the right-half (PM) of the
        // startDate column (like a check-in) and ends at the right-half (AM) of the
        // endDate column (like a check-out).  This keeps visual parity with guest
        // stay blocks so the calendar reads as a single coherent timeline.
        //
        // TODO(mobile): replicate this same halfDayWidth offset in the React Native
        // timeline component (apps/mobile) so block rendering stays consistent
        // across platforms without needing a separate fix sprint.
        const left  = leftDays * dayWidth + dayWidth / 2
        const width = Math.max((endDays - leftDays) * dayWidth, dayWidth / 2)

        // Clip to avoid extremely wide offscreen elements
        if (left + width < 0 || left > totalWidth) return null

        const colors  = SEMANTIC_COLORS[block.semantic]
        const isPending = block.status === BlockStatus.PENDING_APPROVAL
        const opacity   = isPending ? 0.65 : 1

        return { block, left, width, rowY, colors, isPending, opacity }
      })
      .filter(Boolean)
  }, [blocks, flatRows, rowYMap, calendarStart, calendarEnd, dayWidth, totalWidth])

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 8 }}>
      {rendered.map((item) => {
        if (!item) return null
        const { block, left, width, rowY, colors, isPending, opacity } = item
        const isCompact = width < 50

        return (
          <div
            key={block.id}
            title={`${SEMANTIC_SHORT[block.semantic]} — ${block.reason}`}
            style={{
              position: 'absolute',
              top: rowY + 2,
              left,
              width,
              height: TIMELINE.ROW_HEIGHT - 4,
              background: colors.bg,
              borderLeft: `3px solid ${colors.border}`,
              borderTop:    isPending ? `1px dashed ${colors.border}` : `1px solid ${colors.border}`,
              borderBottom: isPending ? `1px dashed ${colors.border}` : `1px solid ${colors.border}`,
              borderRight:  isPending ? `1px dashed ${colors.border}` : `1px solid ${colors.border}`,
              borderRadius: '0 4px 4px 0',
              opacity,
              // Diagonal stripe texture — same visual grammar as NS stripes
              backgroundImage: `repeating-linear-gradient(
                -45deg,
                transparent,
                transparent 6px,
                ${colors.stripe} 6px,
                ${colors.stripe} 8px
              )`,
              backgroundBlendMode: 'normal',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              paddingLeft: 6,
              overflow: 'hidden',
              pointerEvents: 'auto',
              cursor: 'pointer',
            }}
            onClick={() => onBlockClick?.(block)}
          >
            {!isCompact && (
              <>
                <span style={{ fontSize: 11, lineHeight: 1, flexShrink: 0 }}>
                  {SEMANTIC_ICONS[block.semantic]}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: colors.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    letterSpacing: '-0.01em',
                    fontFamily: 'inherit',
                  }}
                >
                  {isPending ? '⏳ ' : ''}{SEMANTIC_SHORT[block.semantic]}
                </span>
              </>
            )}
            {isCompact && (
              <span style={{ fontSize: 10, lineHeight: 1 }}>
                {SEMANTIC_ICONS[block.semantic]}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
