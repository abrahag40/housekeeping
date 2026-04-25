import { api } from '@/api/client'
import type { RoomAvailabilityResult, ConfirmCheckinInput, PaymentEntryInput } from '@zenix/shared'

export type { ConfirmCheckinInput, PaymentEntryInput }

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

  earlyCheckout: (stayId: string, notes?: string) =>
    api.post<{ success: boolean; freedFrom: string; freedTo: string; tasksScheduledFor: 'today' | 'tomorrow' }>(
      `${BASE}/${stayId}/early-checkout`,
      { notes },
    ),

  moveRoom: (stayId: string, newRoomId: string, pricingDecision: string) =>
    api.patch(`${BASE}/${stayId}/move-room`, { newRoomId, pricingDecision }),

  extendStay: (stayId: string, newCheckOut: Date) =>
    api.patch(`${BASE}/${stayId}/extend`, { newCheckOut: newCheckOut.toISOString() }),

  extendSameRoom: (journeyId: string, newCheckOut: Date) =>
    api.post(`/v1/stay-journeys/${journeyId}/extend-same-room`, {
      newCheckOut: newCheckOut.toISOString(),
    }),

  extendNewRoom: (journeyId: string, newRoomId: string, newCheckOut: Date) =>
    api.post(`/v1/stay-journeys/${journeyId}/extend-new-room`, {
      newRoomId,
      newCheckOut: newCheckOut.toISOString(),
    }),

  moveExtensionRoom: (segmentId: string, newRoomId: string) =>
    api.patch(`/v1/stay-journeys/segments/${segmentId}/move-room`, { newRoomId }),

  splitReservation: (
    journeyId: string,
    parts: Array<{ roomId: string; checkIn: Date; checkOut: Date }>,
  ) =>
    api.post(`/v1/stay-journeys/${journeyId}/split`, {
      parts: parts.map((p) => ({
        roomId: p.roomId,
        checkIn: p.checkIn.toISOString(),
        checkOut: p.checkOut.toISOString(),
      })),
    }),

  confirmCheckin: (stayId: string, data: ConfirmCheckinInput) =>
    api.post<{ success: boolean; actualCheckin: string }>(
      `${BASE}/${stayId}/confirm-checkin`,
      data,
    ),
}
