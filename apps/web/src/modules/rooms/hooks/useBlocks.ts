import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BlockStatus, type RoomBlockDto, type CreateBlockDto } from '@zenix/shared'
import { api } from '@/api/client'

/**
 * Active + approved blocks for the calendar timeline.
 * ACTIVE = currently blocking the room.
 * APPROVED = starts in the future — still needs to appear on the timeline.
 * PENDING_APPROVAL = shown with amber visual to signal it needs action.
 */
const CALENDAR_STATUSES = [
  BlockStatus.ACTIVE,
  BlockStatus.APPROVED,
  BlockStatus.PENDING_APPROVAL,
]

export function useBlocks(propertyId: string) {
  return useQuery<RoomBlockDto[]>({
    queryKey: ['blocks', 'calendar', propertyId],
    queryFn: async () => {
      const results = await Promise.all(
        CALENDAR_STATUSES.map((status) =>
          api.get<RoomBlockDto[]>(`/blocks?status=${status}`),
        ),
      )
      return results.flat()
    },
    enabled: !!propertyId,
    staleTime: 60_000,
  })
}

export function useCreateBlock(propertyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dto: CreateBlockDto) => api.post<RoomBlockDto>('/blocks', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocks'] })
    },
  })
}
