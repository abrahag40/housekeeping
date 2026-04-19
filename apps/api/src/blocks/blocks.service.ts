import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  BlockLogEvent,
  BlockReason,
  BlockSemantic,
  BlockStatus,
  CleaningStatus,
  HousekeepingRole,
  JwtPayload,
  TaskType,
  Priority,
  Capability,
} from '@zenix/shared'
import { PrismaService } from '../prisma/prisma.service'
import { TenantContextService } from '../common/tenant-context.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PushService } from '../notifications/push.service'
import { CreateBlockDto } from './dto/create-block.dto'
import {
  ApproveBlockDto,
  CancelBlockDto,
  ExtendBlockDto,
  RejectBlockDto,
} from './dto/approve-block.dto'

// ─── Motivos que fuerzan semántica OOO sin importar lo que envíe el cliente ─
const FORCE_OOO_REASONS = new Set<BlockReason>([
  BlockReason.PEST_CONTROL,
  BlockReason.WATER_DAMAGE,
  BlockReason.ELECTRICAL,
  BlockReason.STRUCTURAL,
])

// ─── Motivos que fuerzan semántica OOI ───────────────────────────────────────
const FORCE_OOI_REASONS = new Set<BlockReason>([BlockReason.RENOVATION])

// ─── Semánticas que requieren siempre aprobación de supervisor ───────────────
const ALWAYS_REQUIRES_APPROVAL = new Set<BlockSemantic>([
  BlockSemantic.OUT_OF_ORDER,
  BlockSemantic.OUT_OF_INVENTORY,
])

const BLOCK_INCLUDE = {
  room: { select: { id: true, number: true, floor: true } },
  bed: { select: { id: true, label: true, status: true } },
  requestedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  cleaningTask: { select: { id: true, status: true, assignedToId: true } },
  logs: {
    orderBy: { createdAt: 'asc' as const },
    include: { staff: { select: { id: true, name: true } } },
  },
}

@Injectable()
export class BlocksService {
  private readonly logger = new Logger(BlocksService.name)

  constructor(
    private prisma: PrismaService,
    private tenant: TenantContextService,
    private notifications: NotificationsService,
    private push: PushService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // CREATE
  // ─────────────────────────────────────────────────────────────────────────────

  async createBlock(dto: CreateBlockDto, actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()

    // Validación: roomId XOR bedId — exactamente uno debe existir
    if (!dto.roomId && !dto.bedId)
      throw new BadRequestException('Debes especificar roomId o bedId')
    if (dto.roomId && dto.bedId)
      throw new BadRequestException('No puedes especificar roomId y bedId a la vez')

    // Forzar semántica por motivo crítico
    let semantic = dto.semantic
    if (FORCE_OOO_REASONS.has(dto.reason)) semantic = BlockSemantic.OUT_OF_ORDER
    if (FORCE_OOI_REASONS.has(dto.reason)) semantic = BlockSemantic.OUT_OF_INVENTORY

    // Solo supervisores pueden crear OOI
    if (
      semantic === BlockSemantic.OUT_OF_INVENTORY &&
      actor.role !== HousekeepingRole.SUPERVISOR
    ) {
      throw new ForbiddenException('Solo los supervisores pueden crear bloqueos OUT_OF_INVENTORY')
    }

    // Validar que la cama / habitación pertenezca a la organización
    let propertyId = actor.propertyId
    if (dto.bedId) {
      const bed = await this.prisma.bed.findUnique({
        where: { id: dto.bedId, organizationId: orgId },
        include: { room: { select: { propertyId: true } } },
      })
      if (!bed) throw new NotFoundException('Cama no encontrada')
      propertyId = bed.room.propertyId
    } else {
      const room = await this.prisma.room.findUnique({
        where: { id: dto.roomId!, organizationId: orgId },
        select: { propertyId: true },
      })
      if (!room) throw new NotFoundException('Habitación no encontrada')
      propertyId = room.propertyId
    }

    // Validar fechas
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const startDate = dto.startDate ? new Date(dto.startDate) : today
    const endDate = dto.endDate ? new Date(dto.endDate) : null

    if (endDate && endDate <= startDate) {
      throw new BadRequestException('endDate debe ser posterior a startDate')
    }

    // Determinar si requiere aprobación
    // OOS + HOUSE_USE creados por SUPERVISOR → auto-aprobados
    const requiresApproval =
      ALWAYS_REQUIRES_APPROVAL.has(semantic) ||
      actor.role !== HousekeepingRole.SUPERVISOR

    const initialStatus = requiresApproval ? BlockStatus.PENDING_APPROVAL : BlockStatus.APPROVED

    const block = await this.prisma.$transaction(async (tx) => {
      const created = await tx.roomBlock.create({
        data: {
          organizationId: orgId,
          propertyId,
          roomId: dto.roomId ?? null,
          bedId: dto.bedId ?? null,
          semantic,
          reason: dto.reason,
          status: initialStatus,
          notes: dto.notes ?? null,
          internalNotes: dto.internalNotes ?? null,
          startDate,
          endDate,
          requestedById: actor.sub,
          approvedById: requiresApproval ? null : actor.sub,
          approvalNotes: null,
          approvedAt: requiresApproval ? null : new Date(),
        },
        include: BLOCK_INCLUDE,
      })

      await tx.blockLog.create({
        data: {
          blockId: created.id,
          staffId: actor.sub,
          event: BlockLogEvent.CREATED,
          note: `Bloqueo ${semantic} creado por ${actor.role}. Motivo: ${dto.reason}`,
          metadata: { initialStatus, semantic, reason: dto.reason },
        },
      })

      // Si fue auto-aprobado, registrar también el evento de aprobación
      if (!requiresApproval) {
        await tx.blockLog.create({
          data: {
            blockId: created.id,
            staffId: actor.sub,
            event: BlockLogEvent.APPROVED,
            note: 'Auto-aprobado (supervisor)',
          },
        })
      }

      return created
    })

    // Si ya quedó APPROVED y startDate es hoy o anterior → activar inmediatamente
    if (block.status === BlockStatus.APPROVED && startDate <= today) {
      await this.activateBlock(block.id, null)
      const activated = await this.prisma.roomBlock.findUnique({
        where: { id: block.id },
        include: BLOCK_INCLUDE,
      })
      this.notifications.emit(propertyId, 'block:created', activated)
      return activated
    }

    this.notifications.emit(
      propertyId,
      block.status === BlockStatus.PENDING_APPROVAL ? 'block:created' : 'block:approved',
      block,
    )

    // Notificar a supervisores si requiere aprobación
    if (requiresApproval) {
      await this.notifySupervisors(
        orgId,
        propertyId,
        `🔒 Solicitud de bloqueo pendiente de aprobación`,
        `${actor.role === HousekeepingRole.RECEPTIONIST ? 'Recepción' : 'Staff'} solicitó bloquear ${dto.bedId ? 'cama' : 'habitación'}. Motivo: ${dto.reason}`,
        block.id,
      )
    }

    return block
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // APPROVE
  // ─────────────────────────────────────────────────────────────────────────────

  async approveBlock(blockId: string, dto: ApproveBlockDto, actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()
    const block = await this.findOrThrow(blockId, orgId)

    if (block.status !== BlockStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`El bloqueo no está pendiente de aprobación (estado: ${block.status})`)
    }

    const now = new Date()
    const startDate = new Date(block.startDate)
    startDate.setHours(0, 0, 0, 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    await this.prisma.$transaction(async (tx) => {
      await tx.roomBlock.update({
        where: { id: blockId },
        data: {
          status: BlockStatus.APPROVED,
          approvedById: actor.sub,
          approvedAt: now,
          approvalNotes: dto.approvalNotes ?? null,
        },
      })
      await tx.blockLog.create({
        data: {
          blockId,
          staffId: actor.sub,
          event: BlockLogEvent.APPROVED,
          note: dto.approvalNotes ?? null,
        },
      })
    })

    this.notifications.emit(block.propertyId, 'block:approved', { blockId, approvedBy: actor.sub })

    // Notificar al solicitante
    await this.notifyStaff(
      orgId,
      block.requestedById,
      '✅ Bloqueo aprobado',
      `Tu solicitud de bloqueo fue aprobada por el supervisor.`,
    )

    // Si startDate es hoy o anterior → activar inmediatamente
    if (startDate <= today) {
      await this.activateBlock(blockId, actor.sub)
    }

    return this.prisma.roomBlock.findUnique({ where: { id: blockId }, include: BLOCK_INCLUDE })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // REJECT
  // ─────────────────────────────────────────────────────────────────────────────

  async rejectBlock(blockId: string, dto: RejectBlockDto, actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()
    const block = await this.findOrThrow(blockId, orgId)

    if (block.status !== BlockStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`El bloqueo no está pendiente de aprobación`)
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.roomBlock.update({
        where: { id: blockId },
        data: {
          status: BlockStatus.REJECTED,
          approvedById: actor.sub,
          approvedAt: new Date(),
          approvalNotes: dto.approvalNotes,
        },
      })
      await tx.blockLog.create({
        data: {
          blockId,
          staffId: actor.sub,
          event: BlockLogEvent.REJECTED,
          note: dto.approvalNotes,
        },
      })
    })

    this.notifications.emit(block.propertyId, 'block:rejected', { blockId })

    await this.notifyStaff(
      orgId,
      block.requestedById,
      '❌ Bloqueo rechazado',
      `Tu solicitud fue rechazada. Motivo: ${dto.approvalNotes}`,
    )

    return this.prisma.roomBlock.findUnique({ where: { id: blockId }, include: BLOCK_INCLUDE })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ACTIVATE (usado internamente por approve + scheduler)
  // ─────────────────────────────────────────────────────────────────────────────

  async activateBlock(blockId: string, actorId: string | null) {
    const block = await this.prisma.roomBlock.findUnique({
      where: { id: blockId },
      include: { bed: true, room: { include: { beds: true } } },
    })
    if (!block) throw new NotFoundException('Bloqueo no encontrado')
    if (block.status === BlockStatus.ACTIVE) return // idempotente

    await this.prisma.$transaction(async (tx) => {
      // 1. Crear CleaningTask(MAINTENANCE) automáticamente
      //    Si es bloqueo de habitación completa → una tarea por cama
      const bedIds = block.bedId
        ? [block.bedId]
        : (block.room?.beds.map((b) => b.id) ?? [])

      let cleaningTaskId: string | null = null

      if (bedIds.length > 0) {
        // Para bloqueo de cama individual → 1 tarea, guardamos el id
        // Para habitación completa → múltiples tareas (solo guardamos el primero en cleaningTaskId)
        for (const bId of bedIds) {
          const task = await tx.cleaningTask.create({
            data: {
              organizationId: block.organizationId,
              bedId: bId,
              taskType: TaskType.MAINTENANCE,
              requiredCapability: Capability.MAINTENANCE,
              status: CleaningStatus.UNASSIGNED,
              priority: Priority.HIGH,
            },
          })
          if (!cleaningTaskId) cleaningTaskId = task.id

          // Marcar cama como BLOCKED
          await tx.bed.update({
            where: { id: bId },
            data: { status: 'BLOCKED' },
          })
        }
      }

      // 2. Activar el bloqueo
      await tx.roomBlock.update({
        where: { id: blockId },
        data: {
          status: BlockStatus.ACTIVE,
          cleaningTaskId,
        },
      })

      // 3. Bitácora
      await tx.blockLog.create({
        data: {
          blockId,
          staffId: actorId,
          event: BlockLogEvent.ACTIVATED,
          note: 'Bloqueo activado. Tarea de mantenimiento creada.',
          metadata: { cleaningTaskId, bedIds },
        },
      })
    })

    this.notifications.emit(block.propertyId, 'block:activated', { blockId })
    this.logger.log(`Block ${blockId} activated → MAINTENANCE task created`)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CANCEL
  // ─────────────────────────────────────────────────────────────────────────────

  async cancelBlock(blockId: string, dto: CancelBlockDto, actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()
    const block = await this.findOrThrow(blockId, orgId)

    if ([BlockStatus.EXPIRED, BlockStatus.REJECTED, BlockStatus.CANCELLED].includes(block.status as any)) {
      throw new BadRequestException(`No se puede cancelar un bloqueo en estado ${block.status}`)
    }

    // Si hay tarea de mantenimiento en progreso → no cancelar
    if (block.cleaningTaskId) {
      const task = await this.prisma.cleaningTask.findUnique({
        where: { id: block.cleaningTaskId },
      })
      if (task && [CleaningStatus.IN_PROGRESS, CleaningStatus.DONE, CleaningStatus.VERIFIED].includes(task.status as any)) {
        throw new ForbiddenException(
          `No se puede cancelar: la tarea de mantenimiento está ${task.status}. Complétala primero.`,
        )
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // Cancelar tarea MAINTENANCE si está pendiente
      if (block.cleaningTaskId) {
        await tx.cleaningTask.update({
          where: { id: block.cleaningTaskId },
          data: { status: CleaningStatus.CANCELLED },
        })
      }

      // Liberar las camas
      await this.releaseBeds(tx, block)

      await tx.roomBlock.update({
        where: { id: blockId },
        data: { status: BlockStatus.CANCELLED },
      })

      await tx.blockLog.create({
        data: {
          blockId,
          staffId: actor.sub,
          event: BlockLogEvent.CANCELLED,
          note: dto.reason,
        },
      })
    })

    this.notifications.emit(block.propertyId, 'block:cancelled', { blockId })
    return this.prisma.roomBlock.findUnique({ where: { id: blockId }, include: BLOCK_INCLUDE })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXTEND
  // ─────────────────────────────────────────────────────────────────────────────

  async extendBlock(blockId: string, dto: ExtendBlockDto, actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()
    const block = await this.findOrThrow(blockId, orgId)

    if (block.status !== BlockStatus.ACTIVE && block.status !== BlockStatus.APPROVED) {
      throw new BadRequestException('Solo se pueden extender bloqueos ACTIVE o APPROVED')
    }

    const newEndDate = new Date(dto.endDate)
    const currentEnd = block.endDate ? new Date(block.endDate) : null

    if (currentEnd && newEndDate <= currentEnd) {
      throw new BadRequestException('La nueva fecha debe ser posterior a la fecha actual de expiración')
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.roomBlock.update({
        where: { id: blockId },
        data: { endDate: newEndDate },
        include: BLOCK_INCLUDE,
      })
      await tx.blockLog.create({
        data: {
          blockId,
          staffId: actor.sub,
          event: BlockLogEvent.EXTENDED,
          note: `Extendido hasta ${dto.endDate}`,
          metadata: { previousEnd: block.endDate, newEnd: dto.endDate },
        },
      })
      return u
    })

    this.notifications.emit(block.propertyId, 'block:extended', { blockId, endDate: dto.endDate })
    return updated
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EARLY RELEASE
  // ─────────────────────────────────────────────────────────────────────────────

  async earlyRelease(blockId: string, actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()
    const block = await this.findOrThrow(blockId, orgId)

    if (block.status !== BlockStatus.ACTIVE) {
      throw new BadRequestException('Solo se pueden liberar anticipadamente bloqueos ACTIVE')
    }

    await this.prisma.$transaction(async (tx) => {
      if (block.cleaningTaskId) {
        const task = await tx.cleaningTask.findUnique({ where: { id: block.cleaningTaskId } })
        if (task && ![CleaningStatus.IN_PROGRESS, CleaningStatus.DONE, CleaningStatus.VERIFIED].includes(task.status as any)) {
          await tx.cleaningTask.update({
            where: { id: block.cleaningTaskId },
            data: { status: CleaningStatus.CANCELLED },
          })
        }
      }

      await this.releaseBeds(tx, block)

      await tx.roomBlock.update({
        where: { id: blockId },
        data: { status: BlockStatus.CANCELLED, endDate: new Date() },
      })

      await tx.blockLog.create({
        data: {
          blockId,
          staffId: actor.sub,
          event: BlockLogEvent.EARLY_RELEASE,
          note: 'Liberado anticipadamente por supervisor',
        },
      })
    })

    this.notifications.emit(block.propertyId, 'block:cancelled', { blockId, earlyRelease: true })
    return this.prisma.roomBlock.findUnique({ where: { id: blockId }, include: BLOCK_INCLUDE })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPIRE (llamado por scheduler)
  // ─────────────────────────────────────────────────────────────────────────────

  async expireBlock(blockId: string) {
    const block = await this.prisma.roomBlock.findUnique({
      where: { id: blockId },
      include: { bed: true, room: { include: { beds: true } } },
    })
    if (!block || block.status !== BlockStatus.ACTIVE) return

    await this.prisma.$transaction(async (tx) => {
      if (block.cleaningTaskId) {
        const task = await tx.cleaningTask.findUnique({ where: { id: block.cleaningTaskId } })
        if (task && [CleaningStatus.PENDING, CleaningStatus.READY, CleaningStatus.UNASSIGNED].includes(task.status as any)) {
          await tx.cleaningTask.update({
            where: { id: block.cleaningTaskId },
            data: { status: CleaningStatus.CANCELLED },
          })
        }
      }

      await this.releaseBeds(tx, block)

      await tx.roomBlock.update({
        where: { id: blockId },
        data: { status: BlockStatus.EXPIRED },
      })

      await tx.blockLog.create({
        data: {
          blockId,
          staffId: null, // evento del sistema
          event: BlockLogEvent.EXPIRED,
          note: 'Expirado automáticamente por el sistema',
        },
      })
    })

    this.notifications.emit(block.propertyId, 'block:expired', { blockId })
    this.logger.log(`Block ${blockId} expired automatically`)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUERY
  // ─────────────────────────────────────────────────────────────────────────────

  async findAll(actor: JwtPayload, filters: {
    status?: BlockStatus
    semantic?: BlockSemantic
    bedId?: string
    roomId?: string
  } = {}) {
    const orgId = this.tenant.getOrganizationId()
    return this.prisma.roomBlock.findMany({
      where: {
        organizationId: orgId,
        propertyId: actor.propertyId,
        ...(filters.status && { status: filters.status }),
        ...(filters.semantic && { semantic: filters.semantic }),
        ...(filters.bedId && { bedId: filters.bedId }),
        ...(filters.roomId && { roomId: filters.roomId }),
      },
      include: BLOCK_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })
  }

  async findOne(blockId: string, actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()
    const block = await this.prisma.roomBlock.findUnique({
      where: { id: blockId, organizationId: orgId },
      include: BLOCK_INCLUDE,
    })
    if (!block) throw new NotFoundException('Bloqueo no encontrado')
    if (block.propertyId !== actor.propertyId)
      throw new ForbiddenException('Bloqueo de otra propiedad')
    return block
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private async findOrThrow(blockId: string, orgId: string) {
    const block = await this.prisma.roomBlock.findUnique({
      where: { id: blockId, organizationId: orgId },
      include: { bed: true, room: { include: { beds: true } } },
    })
    if (!block) throw new NotFoundException('Bloqueo no encontrado')
    return block
  }

  private async releaseBeds(tx: any, block: any) {
    const bedIds = block.bedId
      ? [block.bedId]
      : (block.room?.beds.map((b: any) => b.id) ?? [])

    for (const bId of bedIds) {
      await tx.bed.update({
        where: { id: bId },
        data: { status: 'AVAILABLE' },
      })
    }
  }

  private async notifySupervisors(
    orgId: string,
    propertyId: string,
    title: string,
    body: string,
    blockId: string,
  ) {
    const supervisors = await this.prisma.housekeepingStaff.findMany({
      where: {
        organizationId: orgId,
        propertyId,
        role: HousekeepingRole.SUPERVISOR,
        active: true,
      },
    })

    for (const sup of supervisors) {
      await this.push.sendToStaff(sup.id, title, body, { blockId })
    }
  }

  private async notifyStaff(_orgId: string, staffId: string, title: string, body: string) {
    await this.push.sendToStaff(staffId, title, body, {})
  }
}
