/**
 * IPmsAdapter — Port/Adapter contract for PMS integration.
 *
 * This interface defines the boundary between the Housekeeping module
 * and any Property Management System (CloudBeds, Opera, Mews, etc.).
 *
 * Two implementations:
 *   - StandaloneAdapter  : no PMS, recepción registra checkouts manualmente
 *   - ConnectedAdapter   : PMS pushes events via webhook or polling
 *
 * To add a new PMS integration:
 *   1. Create a new class that implements IPmsAdapter
 *   2. Register it in the PmsAdapterFactory
 *   3. Set pmsMode = 'CONNECTED' in PropertySettings
 */

export interface PmsCheckoutEvent {
  reservationId: string
  roomId: string          // External PMS room ID (maps to Room.cloudbedsRoomId)
  guestName?: string
  checkoutAt: Date
  isEarlyCheckout: boolean
  hasSameDayCheckIn: boolean
  notes?: string
}

export interface PmsRoomStatus {
  externalRoomId: string  // PMS-side room ID
  status: 'OCCUPIED' | 'VACANT' | 'DIRTY' | 'MAINTENANCE'
  guestName?: string
  checkInDate?: Date
  checkOutDate?: Date
}

export interface IPmsAdapter {
  /** Adapter identifier — used for logging and registry */
  readonly name: string

  /**
   * Verify the authenticity of an incoming webhook payload.
   * Returns true if the signature matches, false otherwise.
   * Standalone adapter always returns true (no webhook to verify).
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean

  /**
   * Parse a raw webhook payload into a PmsCheckoutEvent array.
   * One webhook may represent multiple checkout events (batch).
   * Returns empty array if the event is not a checkout (e.g. check-in, modification).
   */
  parseWebhookCheckouts(payload: unknown): PmsCheckoutEvent[]

  /**
   * Optional: poll the PMS for current room statuses.
   * Used when the PMS does not support webhooks.
   * Returns null if polling is not supported.
   */
  pollRoomStatuses?(): Promise<PmsRoomStatus[] | null>
}

/**
 * StandaloneAdapter — no external PMS.
 * Webhooks are rejected (should never arrive), manual checkout flow is the primary path.
 */
export class StandaloneAdapter implements IPmsAdapter {
  readonly name = 'standalone'

  verifyWebhookSignature(_rawBody: Buffer, _header: string): boolean {
    return false // No external PMS — incoming webhooks are not expected
  }

  parseWebhookCheckouts(_payload: unknown): PmsCheckoutEvent[] {
    return [] // No-op
  }
}

/**
 * GenericHmacAdapter — base class for HMAC-verified PMS adapters (CloudBeds, etc.)
 * Subclass this and implement parseWebhookCheckouts for each specific PMS.
 */
export abstract class GenericHmacAdapter implements IPmsAdapter {
  abstract readonly name: string

  constructor(private readonly webhookSecret: string) {}

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    const crypto = require('crypto') as typeof import('crypto')
    const expected = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex')
    // Constant-time comparison prevents timing attacks
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
  }

  abstract parseWebhookCheckouts(payload: unknown): PmsCheckoutEvent[]
}
