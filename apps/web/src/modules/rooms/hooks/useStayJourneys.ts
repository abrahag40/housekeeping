import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { differenceInCalendarDays, startOfDay } from 'date-fns'
import { api } from '@/api/client'
import type { GuestStayBlock } from '../types/timeline.types'

type SegmentReason = GuestStayBlock['segmentReason']

interface ApiSegment {
  id: string
  checkIn: string
  checkOut: string
  status: string
  locked: boolean
  reason: SegmentReason
  rateSnapshot: number | null
  room: { id: string; number: string }
}

interface ApiJourney {
  id: string
  guestName: string
  segments: ApiSegment[]
}

function adaptJourneys(journeys: ApiJourney[]): GuestStayBlock[] {
  const blocks: GuestStayBlock[] = []

  for (const journey of journeys) {
    const activeSegments = journey.segments.filter((s) => s.status !== 'CANCELLED')
    const hasMultiple = activeSegments.length > 1

    // Determine first/last by checkIn/checkOut dates
    const sorted = [...activeSegments].sort(
      (a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime(),
    )
    const firstId = sorted[0]?.id
    const lastId = sorted[sorted.length - 1]?.id

    for (let i = 0; i < sorted.length; i++) {
      const seg = sorted[i]
      let checkIn = new Date(seg.checkIn)
      const checkOut = new Date(seg.checkOut)

      // Clip checkIn so this segment never visually overlaps the previous one.
      // Overlap can happen when the backend stores an extension starting 1 day
      // before the preceding segment's checkout (e.g. Apr 13 vs Apr 14).
      if (i > 0) {
        const prevCheckOut = new Date(sorted[i - 1].checkOut)
        if (checkIn < prevCheckOut) checkIn = prevCheckOut
      }

      const nights = Math.max(1, differenceInCalendarDays(checkOut, checkIn))
      const ratePerNight = seg.rateSnapshot ?? 0

      blocks.push({
        id: seg.id,
        roomId: seg.room.id,
        guestName: journey.guestName,
        checkIn,
        checkOut,
        nights,
        ratePerNight,
        paymentStatus: 'PENDING',
        source: 'direct',
        totalAmount: nights * ratePerNight,
        amountPaid: 0,
        currency: 'USD',
        paxCount: 1,
        isLocked: seg.locked,
        journeyId: journey.id,
        segmentId: seg.id,
        segmentReason: seg.reason,
        segmentLocked: seg.locked,
        isFirstSegment: seg.id === firstId,
        isLastSegment: seg.id === lastId,
        hasMultipleSegments: hasMultiple,
        roomNumber: seg.room.number,
      })
    }
  }

  return blocks
}

export function useStayJourneys(propertyId: string, from: Date, to: Date) {
  const { data, isLoading, error } = useQuery({
    queryKey: [
      'stay-journeys-timeline',
      propertyId,
      startOfDay(from).toISOString(),
      startOfDay(to).toISOString(),
    ],
    queryFn: async () => {
      const raw = await api.get<ApiJourney[]>(
        `/v1/stay-journeys/timeline?propertyId=${propertyId}&from=${from.toISOString()}&to=${to.toISOString()}`,
      )
      return adaptJourneys(raw)
    },
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    enabled: !!propertyId,
    placeholderData: keepPreviousData,
  })

  const filteredBlocks = (data ?? []).filter(
    b => b.segmentReason !== 'ORIGINAL'
  )

  return { journeyBlocks: filteredBlocks, isLoading, error }
}
