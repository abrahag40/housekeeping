import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useCallback, useMemo } from 'react'
import { addDays, subDays, startOfDay } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { guestStaysApi } from '../api/guest-stays.api'
import type { VirtualColumn } from '../types/timeline.types'

const TOTAL_DAYS = 730

export function useDateVirtualizer(
  propertyId: string,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  dayWidth: number,
) {
  const queryClient = useQueryClient()

  const TODAY = useMemo(() => startOfDay(new Date()), [])
  const POOL_START = useMemo(() => subDays(TODAY, 365), [TODAY])

  // Initial scroll offset: 2 days before today (index 363 * dayWidth)
  const initialOffset = useMemo(() => (365 - 2) * dayWidth, [dayWidth])

  const virtualizer = useVirtualizer({
    count: TOTAL_DAYS,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => dayWidth,
    horizontal: true,
    overscan: 7,
    initialOffset,
  })

  // Re-measure when dayWidth changes (view mode switch)
  useEffect(() => {
    virtualizer.measure()
  }, [dayWidth, virtualizer])

  const indexToDate = useCallback(
    (index: number) => addDays(POOL_START, index),
    [POOL_START],
  )

  // Silent prefetch — fills cache ahead of viewport, no re-renders.
  // Re-runs only when the visible window crosses a 7-day bucket.
  const items = virtualizer.getVirtualItems()
  const PREFETCH_AHEAD = 30
  const PREFETCH_BEHIND = 14
  const firstVisibleIndex = items[0]?.index ?? 0
  const lastVisibleIndex = items[items.length - 1]?.index ?? 0
  const windowBucket = Math.floor(firstVisibleIndex / 7)

  useEffect(() => {
    if (!propertyId) return
    if (lastVisibleIndex === 0 && firstVisibleIndex === 0) return

    const visibleFrom = addDays(POOL_START, firstVisibleIndex)
    const visibleTo = addDays(POOL_START, lastVisibleIndex)
    const prefetchFrom = subDays(visibleFrom, PREFETCH_BEHIND)
    const prefetchTo = addDays(visibleTo, PREFETCH_AHEAD)

    queryClient.prefetchQuery({
      queryKey: [
        'guest-stays',
        propertyId,
        startOfDay(prefetchFrom).toISOString(),
        startOfDay(prefetchTo).toISOString(),
      ],
      queryFn: () => guestStaysApi.list(propertyId, prefetchFrom, prefetchTo),
      staleTime: 5 * 60_000,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowBucket, propertyId])

  const scrollToDate = useCallback(
    (date: Date) => {
      const index = Math.round(
        (startOfDay(date).getTime() - POOL_START.getTime()) / (1000 * 60 * 60 * 24),
      )
      virtualizer.scrollToIndex(
        Math.max(0, Math.min(index, TOTAL_DAYS - 1)),
        { align: 'start' },
      )
    },
    [virtualizer, POOL_START],
  )

  // Build VirtualColumn array with dates
  const virtualColumns: VirtualColumn[] = useMemo(
    () =>
      items.map((item) => ({
        key: String(item.key),
        index: item.index,
        date: addDays(POOL_START, item.index),
        start: item.start,
        size: item.size,
      })),
    [items, POOL_START],
  )

  return {
    virtualizer,
    indexToDate,
    scrollToDate,
    virtualColumns,
    totalWidth: virtualizer.getTotalSize(),
    POOL_START,
  }
}
