import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { guestStaysApi } from '../api/guest-stays.api'
import type { DropResult, GuestStayBlock } from '../types/timeline.types'

export function useOptimisticMove(propertyId: string) {
  const queryClient = useQueryClient()

  const applyOptimisticMove = useCallback((result: DropResult) => {
    const queryKey = ['guest-stays', propertyId]

    // Snapshot for rollback
    const snapshot = queryClient.getQueryData<GuestStayBlock[]>(queryKey)

    // Apply immediately in cache
    queryClient.setQueryData<GuestStayBlock[]>(queryKey, (old = []) =>
      old.map(stay =>
        stay.id === result.stayId
          ? {
              ...stay,
              roomId: result.newRoomId,
              checkIn: result.newCheckIn,
              checkOut: result.newCheckOut,
            }
          : stay
      )
    )

    // Fire API call — rollback on error
    guestStaysApi
      .moveRoom(result.stayId, result.newRoomId, 'complimentary')
      .catch(() => {
        if (snapshot) queryClient.setQueryData(queryKey, snapshot)
      })

    return snapshot
  }, [queryClient, propertyId])

  return { applyOptimisticMove }
}
