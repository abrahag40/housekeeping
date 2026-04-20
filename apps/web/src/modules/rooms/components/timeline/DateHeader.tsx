import { useMemo } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { formatDayHeader } from '../../utils/timeline.utils'
import { TIMELINE } from '../../utils/timeline.constants'
import type { VirtualColumn } from '../../types/timeline.types'

interface DateHeaderProps {
  virtualColumns: VirtualColumn[]
  totalWidth: number
  dayWidth: number
}

export function DateHeader({ virtualColumns, totalWidth, dayWidth }: DateHeaderProps) {
  const isQuarter = dayWidth <= 20

  // Group visible days by month for month labels
  const monthBreaks = useMemo(() => {
    const breaks: { start: number; label: string }[] = []
    let lastMonth = ''
    virtualColumns.forEach((vc) => {
      const month = format(vc.date, 'MMMM yyyy', { locale: es })
      if (month !== lastMonth) {
        breaks.push({ start: vc.start, label: month })
        lastMonth = month
      }
    })
    return breaks
  }, [virtualColumns])

  return (
    <div
      className="sticky top-0 z-30 bg-white border-b border-slate-200"
      style={{ height: TIMELINE.HEADER_HEIGHT }}
    >
      {/* Month labels row */}
      <div className="relative h-6 border-b border-slate-100" style={{ width: totalWidth }}>
        {monthBreaks.map(({ start, label }) => (
          <span
            key={`${label}-${start}`}
            className="absolute top-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider"
            style={{ left: start + 8 }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Day columns — only render visible (virtualized) */}
      <div className="relative" style={{ width: totalWidth, height: TIMELINE.HEADER_HEIGHT - 24 }}>
        {virtualColumns.map((vc) => {
          const h = formatDayHeader(vc.date)

          if (isQuarter) {
            return (
              <div
                key={vc.key}
                className={cn(
                  'absolute top-0 flex flex-col items-center justify-center border-r border-slate-100',
                  h.isToday && 'bg-emerald-50',
                )}
                style={{ left: vc.start, width: vc.size, height: TIMELINE.HEADER_HEIGHT - 24 }}
              >
                <span
                  className={cn(
                    'text-[8px] font-mono leading-none',
                    h.isToday ? 'text-emerald-700 font-bold' : 'text-slate-400',
                  )}
                >
                  {h.dayNum}
                </span>
              </div>
            )
          }

          return (
            <div
              key={vc.key}
              className={cn(
                'absolute top-0 flex flex-col items-center justify-center border-r border-slate-100',
                h.isToday && 'bg-emerald-50',
              )}
              style={{ left: vc.start, width: vc.size, height: TIMELINE.HEADER_HEIGHT - 24 }}
            >
              {/* Day name */}
              <span
                className={cn(
                  'text-[10px] leading-none',
                  h.isToday ? 'text-emerald-700 font-semibold' : 'text-slate-400',
                )}
              >
                {dayWidth >= 32 ? h.dayName : h.dayName.charAt(0)}
              </span>

              {/* Day number */}
              <span
                className={cn(
                  'text-sm font-semibold leading-tight mt-0.5',
                  h.isToday
                    ? 'text-white bg-emerald-600 rounded-full w-6 h-6 flex items-center justify-center text-xs'
                    : 'text-slate-700',
                )}
              >
                {h.dayNum}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
