import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

export function usePropertySettings() {
  const { data } = useQuery<{
    potentialNoShowWarningHour?: number
    noShowCutoffHour?: number
  }>({
    queryKey: ['property-settings'],
    queryFn: () => api.get('/settings'),
    staleTime: 5 * 60 * 1000,
  })

  return {
    potentialNoShowWarningHour: data?.potentialNoShowWarningHour ?? 20,
    noShowCutoffHour:           data?.noShowCutoffHour ?? 2,
  }
}
