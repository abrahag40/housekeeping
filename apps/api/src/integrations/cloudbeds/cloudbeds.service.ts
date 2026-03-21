import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { CheckoutSource } from '@housekeeping/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { CheckoutsService } from '../../checkouts/checkouts.service'

export interface CloudbedsCheckoutPayload {
  reservationID: string
  propertyID: string
  guestName?: string
  checkOutDate?: string
  roomID?: string
  roomName?: string
}

@Injectable()
export class CloudbedsService {
  private readonly logger = new Logger(CloudbedsService.name)

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private checkouts: CheckoutsService,
  ) {}

  verifySignature(rawBody: Buffer, signature: string | undefined): void {
    if (!signature) throw new UnauthorizedException('Missing webhook signature')

    const secret = this.config.get<string>('cloudbeds.webhookSecret')
    if (!secret) {
      this.logger.warn('CLOUDBEDS_WEBHOOK_SECRET not configured — skipping verification')
      return
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    const actualBuf = Buffer.from(signature.replace('sha256=', ''), 'hex')

    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw new UnauthorizedException('Invalid webhook signature')
    }
  }

  async handleCheckout(payload: CloudbedsCheckoutPayload, propertyId: string) {
    this.logger.log(`CloudBeds checkout: reservation ${payload.reservationID}`)

    // Find matching room by cloudbedsRoomId
    const room = await this.prisma.room.findFirst({
      where: { cloudbedsRoomId: payload.roomID, propertyId },
    })

    if (!room) {
      this.logger.warn(
        `No room found for CloudBeds roomID: ${payload.roomID} in property: ${propertyId}`,
      )
      return { ignored: true, reason: 'Room not mapped' }
    }

    return this.checkouts.processCheckout({
      roomId: room.id,
      guestName: payload.guestName,
      actualCheckoutAt: payload.checkOutDate ? new Date(payload.checkOutDate) : new Date(),
      source: CheckoutSource.CLOUDBEDS,
      cloudbedsReservationId: payload.reservationID,
    })
  }

  async resolvePropertyId(cloudbedsPropertyId: string): Promise<string | null> {
    const config = await this.prisma.pmsConfig.findFirst({
      where: { type: 'CLOUDBEDS', active: true },
      include: { property: true },
    })
    return config?.propertyId ?? null
  }
}
