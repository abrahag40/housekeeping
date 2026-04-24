import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common'
import {
  AppNotificationType,
  AppNotificationCategory,
  AppNotificationPriority,
  HousekeepingRole,
  NotificationRecipient,
  ApprovalDecision,
} from '@prisma/client'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { TenantContextService } from '../common/tenant-context.service'
import { NotificationsService } from '../notifications/notifications.service'

export interface SendNotificationDto {
  propertyId?: string
  type: AppNotificationType
  category: AppNotificationCategory
  priority?: AppNotificationPriority
  title: string
  body: string
  metadata?: Record<string, unknown>
  actionUrl?: string
  recipientType: NotificationRecipient
  recipientId?: string
  recipientRole?: HousekeepingRole
  triggeredById?: string
  expiresAt?: Date
}

@Injectable()
export class NotificationCenterService {
  private readonly logger = new Logger(NotificationCenterService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly sse: NotificationsService,
  ) {}

  async send(dto: SendNotificationDto): Promise<string> {
    const orgId = this.tenant.getOrganizationId()

    const notification = await this.prisma.appNotification.create({
      data: {
        organizationId: orgId,
        propertyId:     dto.propertyId ?? null,
        type:           dto.type,
        category:       dto.category,
        priority:       dto.priority ?? 'MEDIUM',
        title:          dto.title,
        body:           dto.body,
        metadata:       dto.metadata !== undefined ? (dto.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        actionUrl:      dto.actionUrl ?? null,
        recipientType:  dto.recipientType,
        recipientId:    dto.recipientId ?? null,
        recipientRole:  dto.recipientRole ?? null,
        triggeredById:  dto.triggeredById ?? null,
        expiresAt:      dto.expiresAt ?? null,
      },
    })

    // Push real-time via SSE to the property (best-effort — SSE may have no subscribers)
    if (dto.propertyId) {
      this.sse.emit(dto.propertyId, 'notification:new' as any, {
        id:        notification.id,
        type:      notification.type,
        category:  notification.category,
        priority:  notification.priority,
        title:     notification.title,
        body:      notification.body,
        metadata:  notification.metadata,
        actionUrl: notification.actionUrl,
        createdAt: notification.createdAt,
      })
    }

    this.logger.log(
      `[NotifCenter] sent category=${dto.category} type=${dto.type} ` +
      `recipient=${dto.recipientType}:${dto.recipientRole ?? dto.recipientId ?? 'all'} ` +
      `triggered_by=${dto.triggeredById ?? 'system'}`,
    )

    return notification.id
  }

  async listForUser(staffId: string, propertyId: string, limit = 50) {
    const orgId = this.tenant.getOrganizationId()

    const staff = await this.prisma.housekeepingStaff.findFirst({
      where: { id: staffId, organizationId: orgId },
      select: { role: true },
    })
    if (!staff) return []

    const now = new Date()

    // Build recipient filter: user-targeted OR role-targeted OR broadcast
    const recipientFilter = [
      { recipientType: 'USER' as NotificationRecipient,         recipientId: staffId },
      { recipientType: 'ROLE' as NotificationRecipient,         recipientRole: staff.role },
      { recipientType: 'PROPERTY_ALL' as NotificationRecipient },
    ]

    const notifications = await this.prisma.appNotification.findMany({
      where: {
        organizationId: orgId,
        propertyId,
        OR: recipientFilter,
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
        ],
      },
      include: {
        reads:       { where: { readById: staffId } },
        approvals:   { orderBy: { actionAt: 'desc' }, take: 1 },
        triggeredBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take:    limit,
    })

    return notifications.map((n) => ({
      id:          n.id,
      type:        n.type,
      category:    n.category,
      priority:    n.priority,
      title:       n.title,
      body:        n.body,
      metadata:    n.metadata,
      actionUrl:   n.actionUrl,
      createdAt:   n.createdAt,
      isRead:      n.reads.length > 0,
      readAt:      n.reads[0]?.readAt ?? null,
      approval:    n.approvals[0] ?? null,
      triggeredBy: n.triggeredBy?.name ?? null,
    }))
  }

  async markRead(notificationId: string, staffId: string) {
    const orgId = this.tenant.getOrganizationId()
    const notification = await this.prisma.appNotification.findFirst({
      where: { id: notificationId, organizationId: orgId },
    })
    if (!notification) throw new NotFoundException('Notificación no encontrada')

    await this.prisma.appNotificationRead.upsert({
      where:  { notificationId_readById: { notificationId, readById: staffId } },
      create: { notificationId, readById: staffId },
      update: {},
    })
  }

  async markAllRead(staffId: string, propertyId: string) {
    const orgId = this.tenant.getOrganizationId()
    const staff = await this.prisma.housekeepingStaff.findFirst({
      where: { id: staffId, organizationId: orgId },
      select: { role: true },
    })
    if (!staff) return

    const now = new Date()
    const notifications = await this.prisma.appNotification.findMany({
      where: {
        organizationId: orgId,
        propertyId,
        OR: [
          { recipientType: 'USER' as NotificationRecipient,         recipientId: staffId },
          { recipientType: 'ROLE' as NotificationRecipient,         recipientRole: staff.role },
          { recipientType: 'PROPERTY_ALL' as NotificationRecipient },
        ],
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
        ],
        reads: { none: { readById: staffId } },
      },
      select: { id: true },
    })

    if (notifications.length === 0) return

    await this.prisma.appNotificationRead.createMany({
      data:           notifications.map((n) => ({ notificationId: n.id, readById: staffId })),
      skipDuplicates: true,
    })
  }

  async approve(notificationId: string, staffId: string, reason?: string) {
    return this.recordApproval(notificationId, staffId, 'APPROVED', reason)
  }

  async reject(notificationId: string, staffId: string, reason?: string) {
    return this.recordApproval(notificationId, staffId, 'REJECTED', reason)
  }

  private async recordApproval(
    notificationId: string,
    staffId: string,
    action: ApprovalDecision,
    reason?: string,
  ) {
    const orgId = this.tenant.getOrganizationId()
    const notification = await this.prisma.appNotification.findFirst({
      where: { id: notificationId, organizationId: orgId },
    })
    if (!notification) throw new NotFoundException('Notificación no encontrada')
    if (notification.type !== 'APPROVAL_REQUIRED') {
      throw new ForbiddenException('Esta notificación no requiere aprobación')
    }

    const approval = await this.prisma.appNotificationApproval.create({
      data: { notificationId, action, actionById: staffId, reason: reason ?? null },
    })

    this.logger.log(
      `[NotifCenter] approval notif=${notificationId} action=${action} by=${staffId}`,
    )

    return approval
  }

  async getAuditLog(propertyId: string, from: Date, to: Date) {
    const orgId = this.tenant.getOrganizationId()
    return this.prisma.appNotification.findMany({
      where: {
        organizationId: orgId,
        propertyId,
        createdAt: { gte: from, lte: to },
      },
      include: {
        reads:       { include: { readBy: { select: { name: true, role: true } } } },
        approvals:   { include: { actionBy: { select: { name: true, role: true } } } },
        triggeredBy: { select: { name: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async unreadCount(staffId: string, propertyId: string): Promise<number> {
    const orgId = this.tenant.getOrganizationId()
    const staff = await this.prisma.housekeepingStaff.findFirst({
      where: { id: staffId, organizationId: orgId },
      select: { role: true },
    })
    if (!staff) return 0

    const now = new Date()
    return this.prisma.appNotification.count({
      where: {
        organizationId: orgId,
        propertyId,
        OR: [
          { recipientType: 'USER' as NotificationRecipient,         recipientId: staffId },
          { recipientType: 'ROLE' as NotificationRecipient,         recipientRole: staff.role },
          { recipientType: 'PROPERTY_ALL' as NotificationRecipient },
        ],
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
        ],
        reads: { none: { readById: staffId } },
      },
    })
  }
}
