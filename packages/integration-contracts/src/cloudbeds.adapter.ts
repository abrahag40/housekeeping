import { GenericHmacAdapter, PmsCheckoutEvent } from './pms.interface'

/**
 * CloudbedsAdapter — parses CloudBeds reservation.checkedOut webhook events.
 *
 * CloudBeds webhook payload shape (relevant fields only):
 * {
 *   event: "reservation/checkedOut",
 *   data: {
 *     reservation_id: string
 *     room_id: string
 *     guest_name: string
 *     checkout_date: string (ISO)
 *   }
 * }
 */
export class CloudbedsAdapter extends GenericHmacAdapter {
  readonly name = 'cloudbeds'

  parseWebhookCheckouts(payload: unknown): PmsCheckoutEvent[] {
    const p = payload as Record<string, unknown>
    if (p.event !== 'reservation/checkedOut') return []

    const data = p.data as Record<string, unknown>
    return [
      {
        reservationId: String(data.reservation_id),
        roomId: String(data.room_id),
        guestName: data.guest_name ? String(data.guest_name) : undefined,
        checkoutAt: new Date(String(data.checkout_date)),
        isEarlyCheckout: false,
        hasSameDayCheckIn: Boolean(data.has_same_day_checkin ?? false),
        notes: data.notes ? String(data.notes) : undefined,
      },
    ]
  }
}
