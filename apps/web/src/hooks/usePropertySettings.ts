import { useQuery } from '@tanstack/react-query'
import { PropertyType } from '@zenix/shared'
import { api } from '@/api/client'

export function usePropertySettings() {
  const { data } = useQuery<{
    potentialNoShowWarningHour?: number
    noShowCutoffHour?: number
    propertyType?: PropertyType
  }>({
    queryKey: ['property-settings'],
    queryFn: () => api.get('/settings'),
    staleTime: 5 * 60 * 1000,
  })

  return {
    potentialNoShowWarningHour: data?.potentialNoShowWarningHour ?? 20,
    noShowCutoffHour:           data?.noShowCutoffHour ?? 2,
    propertyType:               data?.propertyType ?? PropertyType.HOSTAL,
  }
}
