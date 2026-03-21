import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name)
  private readonly expo: Expo

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.expo = new Expo({
      accessToken: this.config.get<string>('expo.accessToken') || undefined,
    })
  }

  async sendToStaff(staffId: string, title: string, body: string, data?: Record<string, unknown>) {
    const tokens = await this.prisma.pushToken.findMany({
      where: { staffId, active: true },
      select: { token: true, id: true },
    })

    if (!tokens.length) return

    const messages: ExpoPushMessage[] = tokens
      .filter((t) => Expo.isExpoPushToken(t.token))
      .map((t) => ({
        to: t.token,
        title,
        body,
        data,
        sound: 'default',
        priority: 'high',
      }))

    if (!messages.length) return

    await this.sendBatch(messages)
  }

  async sendToMultipleStaff(
    staffIds: string[],
    title: string,
    body: string,
    data?: Record<string, unknown>,
  ) {
    for (const staffId of staffIds) {
      await this.sendToStaff(staffId, title, body, data)
    }
  }

  private async sendBatch(messages: ExpoPushMessage[]) {
    const chunks = this.expo.chunkPushNotifications(messages)
    const tickets: ExpoPushTicket[] = []

    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk)
        tickets.push(...ticketChunk)
      } catch (err) {
        this.logger.error('Failed to send push notification chunk', err)
      }
    }

    // Log errors from tickets
    for (const ticket of tickets) {
      if (ticket.status === 'error') {
        this.logger.warn(`Push notification error: ${ticket.message}`)
        if (ticket.details?.error === 'DeviceNotRegistered') {
          await this.deactivateToken(ticket.message ?? '')
        }
      }
    }
  }

  private async deactivateToken(message: string) {
    // Extract token from error message pattern: "... to ExponentPushToken[xxx] ..."
    const match = message.match(/ExponentPushToken\[([^\]]+)\]/)
    if (!match) return
    const token = `ExponentPushToken[${match[1]}]`
    await this.prisma.pushToken.updateMany({ where: { token }, data: { active: false } })
    this.logger.log(`Deactivated invalid push token: ${token}`)
  }

  async registerToken(staffId: string, token: string, platform: string) {
    if (!Expo.isExpoPushToken(token)) {
      throw new Error(`Invalid Expo push token: ${token}`)
    }

    return this.prisma.pushToken.upsert({
      where: { token },
      update: { staffId, platform, active: true, lastSeenAt: new Date() },
      create: { staffId, token, platform, active: true },
    })
  }
}
