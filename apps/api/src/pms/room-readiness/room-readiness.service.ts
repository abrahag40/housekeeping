import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class RoomReadinessService {
  private readonly logger = new Logger(RoomReadinessService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** Triggered automatically when a guest checks out */
  @OnEvent('checkout.confirmed')
  async onCheckoutConfirmed(payload: {
    roomId: string
    propertyId: string
    orgId: string
  }) {
    await this.createReadinessTask({
      roomId: payload.roomId,
      propertyId: payload.propertyId,
      orgId: payload.orgId,
      triggeredBy: 'checkout',
    })
  }

  async createReadinessTask(params: {
    roomId: string
    propertyId: string
    orgId: string
    triggeredBy: string
    dueBy?: Date
  }) {
    // Find active checklist for this property
    const checklist = await this.prisma.roomTypeChecklist.findFirst({
      where: {
        organizationId: params.orgId,
        propertyId: params.propertyId,
        isActive: true,
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })

    if (!checklist) {
      this.logger.warn(
        `No active checklist for property ${params.propertyId}`,
      )
      return null
    }

    // Find next check-in for this room to set dueBy
    const nextCheckin = await this.prisma.guestStay.findFirst({
      where: {
        roomId: params.roomId,
        organizationId: params.orgId,
        checkinAt: { gte: new Date() },
        actualCheckout: null,
      },
      orderBy: { checkinAt: 'asc' },
    })

    const task = await this.prisma.roomReadinessTask.create({
      data: {
        organizationId: params.orgId,
        propertyId: params.propertyId,
        roomId: params.roomId,
        checklistId: checklist.id,
        triggeredBy: params.triggeredBy,
        dueBy: nextCheckin?.checkinAt ?? params.dueBy,
        items: {
          create: checklist.items.map((item) => ({
            checklistItemId: item.id,
            status: 'PENDING',
          })),
        },
      },
      include: { items: true },
    })

    this.logger.log(
      `Readiness task created for room ${params.roomId}: ${task.id} (${task.items.length} items)`,
    )
    return task
  }

  async completeItem(params: {
    taskId: string
    itemId: string
    staffId: string
    photoUrl?: string
    status: 'DONE' | 'ISSUE_FOUND' | 'SKIPPED'
    notes?: string
    orgId: string
  }) {
    const updated = await this.prisma.roomReadinessTaskItem.update({
      where: { id: params.itemId },
      data: {
        status: params.status,
        completedById: params.staffId,
        completedAt: new Date(),
        photoUrl: params.photoUrl,
        notes: params.notes,
      },
    })

    // If ISSUE_FOUND → mark task as NEEDS_MAINTENANCE
    if (params.status === 'ISSUE_FOUND') {
      await this.prisma.roomReadinessTask.update({
        where: { id: params.taskId },
        data: { status: 'NEEDS_MAINTENANCE' },
      })
    }

    // Check if all required items are complete → auto-promote to READY
    const task = await this.prisma.roomReadinessTask.findUnique({
      where: { id: params.taskId },
      include: {
        items: { include: { checklistItem: true } },
      },
    })

    if (task && task.status !== 'NEEDS_MAINTENANCE') {
      const requiredItems = task.items.filter(
        (i) => i.checklistItem.isRequired,
      )
      const allDone = requiredItems.every(
        (i) => i.status === 'DONE' || i.status === 'SKIPPED',
      )
      if (allDone) {
        await this.prisma.roomReadinessTask.update({
          where: { id: params.taskId },
          data: { status: 'READY' },
        })
      }
    }

    return updated
  }

  async approveTask(taskId: string, supervisorId: string, orgId: string) {
    const task = await this.prisma.roomReadinessTask.findFirst({
      where: { id: taskId, organizationId: orgId },
      include: { room: true },
    })
    if (!task) throw new NotFoundException('Task not found')

    const updated = await this.prisma.roomReadinessTask.update({
      where: { id: taskId },
      data: {
        status: 'APPROVED',
        approvedById: supervisorId,
        approvedAt: new Date(),
      },
    })

    // Room becomes AVAILABLE
    await this.prisma.room.update({
      where: { id: task.roomId },
      data: { status: 'AVAILABLE' },
    })

    this.events.emit('room.ready', {
      roomId: task.roomId,
      propertyId: task.propertyId,
      orgId,
    })

    return updated
  }

  /** Daily cron at 7:00 AM — generate readiness tasks for today's checkouts */
  @Cron('0 7 * * *')
  async generateDailyTasks() {
    this.logger.log('Running daily readiness task generation...')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const checkouts = await this.prisma.guestStay.findMany({
      where: {
        scheduledCheckout: { gte: today, lt: tomorrow },
        actualCheckout: null,
      },
    })

    let created = 0
    for (const checkout of checkouts) {
      const existing = await this.prisma.roomReadinessTask.findFirst({
        where: {
          roomId: checkout.roomId,
          createdAt: { gte: today },
        },
      })
      if (!existing) {
        await this.createReadinessTask({
          roomId: checkout.roomId,
          propertyId: checkout.propertyId,
          orgId: checkout.organizationId,
          triggeredBy: 'cron',
        })
        created++
      }
    }

    this.logger.log(
      `Daily generation complete: ${created}/${checkouts.length} tasks created`,
    )
  }

  async getTasksForProperty(propertyId: string, orgId: string) {
    return this.prisma.roomReadinessTask.findMany({
      where: {
        organizationId: orgId,
        propertyId,
        status: {
          in: ['PENDING', 'IN_PROGRESS', 'NEEDS_MAINTENANCE', 'READY'],
        },
      },
      include: {
        room: true,
        checklist: true,
        items: {
          include: { checklistItem: true },
          orderBy: { checklistItem: { sortOrder: 'asc' } },
        },
      },
      orderBy: { dueBy: 'asc' },
    })
  }

  async getTaskById(taskId: string, orgId: string) {
    const task = await this.prisma.roomReadinessTask.findFirst({
      where: { id: taskId, organizationId: orgId },
      include: {
        room: true,
        checklist: true,
        items: {
          include: { checklistItem: true },
          orderBy: { checklistItem: { sortOrder: 'asc' } },
        },
      },
    })
    if (!task) throw new NotFoundException('Task not found')
    return task
  }
}
