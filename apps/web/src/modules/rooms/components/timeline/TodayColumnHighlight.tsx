import { useMemo } from 'react'
import { isToday, differenceInCalendarDays, startOfDay } from 'date-fns'
import { TIMELINE } from '../../utils/timeline.constants'
import type { FlatRow } from '../../types/timeline.types'

interface TodayColumnHighlightProps {
  days: Date[]
  dayWidth: number
  flatRows: FlatRow[]
  poolStart?: Date
}

export function TodayColumnHighlight({ days, dayWidth, flatRows, poolStart }: TodayColumnHighlightProps) {
  const totalHeight = useMemo(() => {
    let h = 0
    flatRows.forEach((row) => {
      h += row.type === 'group' ? TIMELINE.GROUP_HEADER_HEIGHT : TIMELINE.ROW_HEIGHT
    })
    return h
  }, [flatRows])

  // When poolStart is provided, compute absolute position from pool start
  const todayLeft = useMemo(() => {
    if (poolStart) {
      const today = startOfDay(new Date())
      const idx = differenceInCalendarDays(today, startOfDay(poolStart))
      if (idx < 0) return null
      return idx * dayWidth
    }
    // Fallback: find today in the days array
    const idx = days.findIndex((d) => isToday(d))
    if (idx < 0) return null
    return idx * dayWidth
  }, [days, dayWidth, poolStart])

  if (todayLeft === null) return null

  return (
    <div
      className="absolute top-0 pointer-events-none"
      style={{
        left: todayLeft,
        width: dayWidth,
        height: totalHeight,
        backgroundColor: 'rgba(16, 185, 129, 0.06)',
        borderLeft: '1px solid rgba(16, 185, 129, 0.25)',
        borderRight: '1px solid rgba(16, 185, 129, 0.25)',
        zIndex: 1,
      }}
    />
  )
}
