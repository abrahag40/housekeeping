import { useMemo, useState, useCallback } from 'react'
import { isBefore, startOfDay, isToday } from 'date-fns'
import { cn } from '@/lib/utils'
import { TIMELINE } from '../../utils/timeline.constants'
import type { FlatRow, VirtualColumn } from '../../types/timeline.types'

interface TimelineGridProps {
  virtualColumns: VirtualColumn[]
  totalWidth: number
  dayWidth: number
  flatRows: FlatRow[]
  dragTargetRoomId?: string | null
  dragIsValid?: boolean
  /** Suppress ghost block while a drag or resize gesture is in progress */
  isDragging?: boolean
  onCellClick?: (roomId: string, date: Date) => void
  /** Right-click on any cell (occupied or not) — used to open BlockModal */
  onCellContextMenu?: (roomId: string, date: Date) => void
  isOccupied?: (roomId: string, date: Date) => boolean
  /** Returns base rate + currency for a room — used to render ghost block price */
  getRoomRate?: (roomId: string) => { rate: number; currency: string } | undefined
}

export function TimelineGrid({
  virtualColumns,
  totalWidth,
  dayWidth,
  flatRows,
  dragTargetRoomId,
  dragIsValid = true,
  isDragging = false,
  onCellClick,
  onCellContextMenu,
  isOccupied,
  getRoomRate,
}: TimelineGridProps) {
  const isCompact = dayWidth <= 20

  // Ghost block for empty cells — Apple Calendar / Google Calendar pattern.
  // Suppressed during drag/resize: isDragging guard prevents conflict with those gestures.
  const [hoveredCell, setHoveredCell] = useState<{
    roomId: string
    date: Date
    colStart: number
    rowY: number
    colWidth: number
  } | null>(null)

  const clearHover = useCallback(() => setHoveredCell(null), [])

  // Precompute cumulative Y offsets and total height
  const { rowYOffsets, totalHeight } = useMemo(() => {
    const offsets: number[] = []
    let y = 0
    flatRows.forEach((row) => {
      offsets.push(y)
      y += row.type === 'group' ? TIMELINE.GROUP_HEADER_HEIGHT : TIMELINE.ROW_HEIGHT
    })
    return { rowYOffsets: offsets, totalHeight: y + 16 }
  }, [flatRows])

  // Find today column for the vertical line
  const todayCol = virtualColumns.find((vc) => isToday(vc.date))

  return (
    <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
      {/* Vertical day columns — only render visible (virtualized) */}
      {virtualColumns.map((vc) => {
        const isPast = isBefore(startOfDay(vc.date), startOfDay(new Date()))
        return (
          <div
            key={vc.key}
            className={cn(
              'absolute top-0 border-r border-slate-200/70',
              isPast && 'bg-slate-50/80',
            )}
            style={{
              left: vc.start,
              width: vc.size,
              height: totalHeight,
            }}
          />
        )
      })}

      {/* Horizontal row lines + split-day cells */}
      {flatRows.map((row, i) => {
        const y = rowYOffsets[i]
        const h =
          row.type === 'group' ? TIMELINE.GROUP_HEADER_HEIGHT : TIMELINE.ROW_HEIGHT
        const isDropTarget = row.type === 'room' && dragTargetRoomId === row.id

        return (
          <div
            key={`row-${row.type}-${row.id}`}
            className={cn(
              'absolute left-0 border-b transition-colors duration-100',
              row.type === 'group'
                ? 'border-slate-200 bg-slate-50/80'
                : 'border-slate-200/70',
              isDropTarget && dragIsValid && 'bg-emerald-50/60',
              isDropTarget && !dragIsValid && 'bg-red-50/40',
            )}
            style={{ top: y, width: totalWidth, height: h }}
          >
            {/* Split-day cells for room rows — only render visible columns */}
            {row.type === 'room' &&
              !isCompact &&
              virtualColumns.map((vc) => {
                const isPastDay = isBefore(startOfDay(vc.date), startOfDay(new Date()))
                return (
                  <div
                    key={vc.key}
                    className="absolute top-0"
                    style={{
                      left: vc.start,
                      width: vc.size,
                      height: h,
                    }}
                    onContextMenu={(e) => {
                      if (!isPastDay) {
                        e.preventDefault()
                        onCellContextMenu?.(row.id, vc.date)
                      }
                    }}
                  >
                    {/* AM half (left) — checkout zone, no interaction */}
                    <div className="absolute inset-y-0 left-0 w-1/2" />
                    {/* PM half (right) — checkin zone: shows ghost block on hover */}
                    {(() => {
                      const cellOccupied = isOccupied?.(row.id, vc.date) ?? false
                      const blocked = isPastDay || cellOccupied || isDragging
                      return (
                        <div
                          className={cn(
                            'absolute inset-y-0 right-0 w-1/2',
                            isDragging ? '' : blocked ? 'cursor-not-allowed' : 'cursor-pointer',
                          )}
                          onMouseEnter={!blocked ? () => setHoveredCell({
                            roomId: row.id,
                            date: vc.date,
                            colStart: vc.start,
                            rowY: y,
                            colWidth: vc.size,
                          }) : clearHover}
                          onMouseLeave={clearHover}
                          onClick={!blocked ? () => {
                            onCellClick?.(row.id, vc.date)
                          } : undefined}
                        />
                      )
                    })()}
                  </div>
                )
              })}
          </div>
        )
      })}

      {/* Today line — thin, subtle */}
      {todayCol && (
        <div
          className="absolute top-0 animate-today pointer-events-none"
          style={{
            left: todayCol.start + todayCol.size / 2,
            width: 1,
            height: totalHeight,
            backgroundColor: 'rgba(16, 185, 129, 0.35)',
            zIndex: 2,
          }}
        />
      )}

      {/* Ghost block — Apple Calendar / Google Calendar empty-cell hover pattern.
          Suppressed during drag/resize (isDragging guard).
          Design language: left-border stripe (Mews/Cloudbeds blocks) + emerald tint.
          Rate is ALWAYS the primary value-add — rendered unconditionally.
          "Nueva reserva" label shown only when column is wide enough (≥90px).
          Emerald = availability signal (Mehrabian-Russell 1974). */}
      {!isDragging && hoveredCell && getRoomRate && !isCompact && (() => {
        const rateInfo = getRoomRate(hoveredCell.roomId)
        if (!rateInfo) return null
        const colW   = hoveredCell.colWidth
        const blockW = Math.max(colW - 2, dayWidth / 2)
        const showLabel = blockW >= 90

        return (
          <div
            style={{
              position: 'absolute',
              top: hoveredCell.rowY + 3,
              left: hoveredCell.colStart,
              width: blockW,
              height: TIMELINE.ROW_HEIGHT - 6,
              background: 'rgba(16,185,129,0.08)',
              borderLeft: '3px solid rgba(16,185,129,0.52)',
              borderRadius: '0 5px 5px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingLeft: 6,
              paddingRight: 5,
              pointerEvents: 'none',
              zIndex: 5,
              overflow: 'hidden',
              gap: 3,
            }}
          >
            {/* Left: + indicator, optionally "Nueva reserva" when space allows */}
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 11,
                fontWeight: 700,
                color: 'rgba(4,120,87,0.82)',
                letterSpacing: '-0.015em',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                lineHeight: 1,
                fontFamily: 'inherit',
                flexShrink: 1,
                minWidth: 0,
              }}
            >
              <span style={{ fontSize: 13, lineHeight: 1, fontWeight: 600, flexShrink: 0 }}>+</span>
              {showLabel && (
                <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  Nueva reserva
                </span>
              )}
            </span>

            {/* Right: rate — always rendered, primary value-add of the ghost block */}
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'rgba(4,120,87,0.72)',
                fontVariantNumeric: 'tabular-nums',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                letterSpacing: '-0.01em',
                lineHeight: 1,
                background: 'rgba(16,185,129,0.14)',
                borderRadius: 4,
                padding: '2px 4px',
                flexShrink: 0,
              }}
            >
              {rateInfo.currency} {rateInfo.rate.toLocaleString()}
            </span>
          </div>
        )
      })()}
    </div>
  )
}
