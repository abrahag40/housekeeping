import { api } from '@/api/client'
import type { RoomAvailabilityResult } from '@zenix/shared'

const BASE = '/v1/guest-stays'

export const guestStaysApi = {
  list: (propertyId: string, from: Date, to: Date) =>
    api.get<Record<string, unknown>[]>(
      `${BASE}?propertyId=${propertyId}&from=${from.toISOString()}&to=${to.toISOString()}`
    ),

  /**
   * Pre-flight availability check — no side effects.
   * Returns the full conflict list so the dialog can show detailed inline warnings
   * before the user submits the form.
   */
  checkAvailability: (roomId: string, checkIn: Date, checkOut: Date) =>
    api.get<RoomAvailabilityResult>(
      `${BASE}/availability?roomId=${roomId}&checkIn=${checkIn.toISOString()}&checkOut=${checkOut.toISOString()}`
    ),

  create: (data: {
    propertyId: string
    roomId: string
    firstName: string
    lastName: string
    guestEmail?: string
    guestPhone?: string
    nationality?: string
    documentType?: string
    adults: number
    children: number
    checkIn: string
    checkOut: string
    ratePerNight: number
    currency: string
    source: string
    amountPaid: number
    paymentMethod?: string
    notes?: string
  }) => api.post<Record<string, unknown>>(BASE, data),

  get: (stayId: string) =>
    api.get<Record<string, unknown>>(`${BASE}/${stayId}`),

  checkout: (stayId: string) =>
    api.post(`${BASE}/${stayId}/checkout`, {}),

  moveRoom: (stayId: string, newRoomId: string, pricingDecision: string) =>
    api.patch(`${BASE}/${stayId}/move-room`, { newRoomId, pricingDecision }),
}
