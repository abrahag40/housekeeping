import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { RoomTypeGroup, RoomRow } from '../types/timeline.types'

interface ApiRoom {
  id: string
  number: string
  floor: number | null
  status: string
  roomTypeId: string | null
}

interface ApiRoomType {
  id: string
  name: string
  code: string
  baseRate: number | string
  currency: string
  rooms: ApiRoom[]
}

function adaptGroups(data: ApiRoomType[]): RoomTypeGroup[] {
  return data.map((rt) => ({
    id: rt.id,
    name: rt.name,
    code: rt.code,
    baseRate: Number(rt.baseRate),
    currency: rt.currency,
    collapsed: false,
    rooms: rt.rooms.map((r) => ({
      id: r.id,
      number: r.number,
      floor: r.floor,
      status: r.status as RoomRow['status'],
      roomTypeId: r.roomTypeId ?? rt.id,
    })),
  }))
}

export function useRoomGroups(propertyId: string) {
  return useQuery({
    queryKey: ['room-groups', propertyId],
    queryFn: async () => {
      const data = await api.get<ApiRoomType[]>(
        `/v1/room-types?propertyId=${propertyId}`,
      )
      return adaptGroups(data)
    },
    staleTime: 5 * 60_000,
    enabled: !!propertyId,
  })
}
