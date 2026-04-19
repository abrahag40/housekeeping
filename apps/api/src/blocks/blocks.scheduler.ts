import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { BlockStatus } from '@zenix/shared'
import { PrismaService } from '../prisma/prisma.service'
import { PushService } from '../notifications/push.service'
import { BlocksService } from './blocks.service'

@Injectable()
export class BlocksScheduler {
  private readonly logger = new Logger(BlocksScheduler.name)

  constructor(
    private prisma: PrismaService,
    private push: PushService,
    private blocksService: BlocksService,
  ) {}

  /**
   * Cron: cada día a las 00:05 UTC
   * 1. Activa bloques APPROVED cuyo startDate llegó hoy
   * 2. Expira bloques ACTIVE cuyo endDate ya pasó
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processBlocks() {
    this.logger.log('⏰ [BlocksScheduler] Procesando bloqueos programados...')

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    // 1. Activar bloques APPROVED que arrancan hoy o antes
    const toActivate = await this.prisma.roomBlock.findMany({
      where: {
        status: BlockStatus.APPROVED,
        startDate: { lte: today },
      },
      select: { id: true },
    })

    for (const { id } of toActivate) {
      try {
        await this.blocksService.activateBlock(id, null)
        this.logger.log(`✅ Block ${id} activated by scheduler`)
      } catch (e) {
        this.logger.error(`❌ Failed to activate block ${id}: ${e.message}`)
      }
    }

    // 2. Expirar bloques ACTIVE cuyo endDate ya pasó
    const toExpire = await this.prisma.roomBlock.findMany({
      where: {
        status: BlockStatus.ACTIVE,
        endDate: { lt: today },
      },
      select: { id: true },
    })

    for (const { id } of toExpire) {
      try {
        await this.blocksService.expireBlock(id)
        this.logger.log(`⏰ Block ${id} expired by scheduler`)
      } catch (e) {
        this.logger.error(`❌ Failed to expire block ${id}: ${e.message}`)
      }
    }

    this.logger.log(
      `✅ [BlocksScheduler] Activados: ${toActivate.length}, Expirados: ${toExpire.length}`,
    )
  }

  /**
   * Cron: cada día a las 08:00 UTC
   * Envía notificación preventiva a supervisores cuando un bloqueo
   * expira dentro de las próximas 24 horas (para decidir si extender).
   */
  @Cron('0 8 * * *')
  async notifyExpiringBlocks() {
    const tomorrow = new Date()
    tomorrow.setHours(0, 0, 0, 0)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const expiringSoon = await this.prisma.roomBlock.findMany({
      where: {
        status: BlockStatus.ACTIVE,
        endDate: {
          gte: new Date(),
          lte: tomorrow,
        },
      },
      include: {
        bed: { select: { label: true } },
        room: { select: { number: true } },
        requestedBy: { select: { name: true } },
      },
    })

    for (const block of expiringSoon) {
      const location = block.bedId
        ? `Cama ${block.bed?.label}`
        : `Habitación ${block.room?.number}`

      const supervisors = await this.prisma.housekeepingStaff.findMany({
        where: {
          organizationId: block.organizationId,
          propertyId: block.propertyId,
          role: 'SUPERVISOR',
          active: true,
        },
      })

      for (const sup of supervisors) {
        await this.push.sendToStaff(
          sup.id,
          `⏰ Bloqueo expira hoy: ${location}`,
          `El bloqueo de ${location} expira hoy. ¿Extender o liberar?`,
          { blockId: block.id },
        )
      }
    }

    if (expiringSoon.length > 0) {
      this.logger.log(`📬 Notificados ${expiringSoon.length} bloqueos que expiran hoy`)
    }
  }
}
