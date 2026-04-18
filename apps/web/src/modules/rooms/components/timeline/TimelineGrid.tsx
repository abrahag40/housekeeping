import { useMemo } from 'react'
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
  onCellClick?: (roomId: string, date: Date) => void
  isOccupied?: (roomId: string, date: Date) => boolean
}

export function TimelineGrid({
  virtualColumns,
  totalWidth,
  dayWidth,
  flatRows,
  dragTargetRoomId,
  dragIsValid = true,
  onCellClick,
  isOccupied,
}: TimelineGridProps) {
  const isCompact = dayWidth <= 20

  // Precompute cumulative Y offsets and total height
  const { rowYOffsets, totalHeight } = useMemo(() => {
    const offsets: number[] = []
    let y = 0
    flatRows.forEach((row) => {
      offsets.push(y)
      y += row.type === 'group' ? TIMELINE.GROUP_HEADER_HEIGHT : TIMELINE.ROW_HEIGHT
    })
    return { rowYOffsets: offsets, totalHeight: y }
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
                  >
                    {/* AM half (left) — checkout zone, no interaction */}
                    <div className="absolute inset-y-0 left-0 w-1/2" />
                    {/* PM half (right) — checkin zone hover hint */}
                    {(() => {
                      const cellOccupied = isOccupied?.(row.id, vc.date) ?? false
                      const blocked = isPastDay || cellOccupied
                      return (
                        <div
                          className={cn(
                            'absolute inset-y-0 right-0 w-1/2',
                            'transition-opacity duration-100',
                            !blocked && 'opacity-0 hover:opacity-100 bg-emerald-50/40 cursor-pointer',
                            blocked && 'cursor-not-allowed',
                          )}
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
    </div>
  )
}
