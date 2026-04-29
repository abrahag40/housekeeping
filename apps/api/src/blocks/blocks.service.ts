import {
  BadRequestException,
  ConflictException,
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
import { AvailabilityService } from '../pms/availability/availability.service'
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
  unit: { select: { id: true, label: true, status: true } },
  requestedBy: { select: { id: true, name: true, role: true } },
  approvedBy: { select: { id: true, name: true, role: true } },
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
    private availability: AvailabilityService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // CREATE
  // ─────────────────────────────────────────────────────────────────────────────

  async createBlock(dto: CreateBlockDto, actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()

    // Validación: roomId XOR unitId — exactamente uno debe existir
    if (!dto.roomId && !dto.unitId)
      throw new BadRequestException('Debes especificar roomId o unitId')
    if (dto.roomId && dto.unitId)
      throw new BadRequestException('No puedes especificar roomId y unitId a la vez')

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

    // Validar que la unidad / habitación pertenezca a la organización
    let propertyId = actor.propertyId
    if (dto.unitId) {
      const unit = await this.prisma.unit.findUnique({
        where: { id: dto.unitId, organizationId: orgId },
        include: { room: { select: { propertyId: true } } },
      })
      if (!unit) throw new NotFoundException('Unidad no encontrada')
      propertyId = unit.room.propertyId
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

    // Guard: verificar que no haya huéspedes activos en el período (solo bloqueos de habitación)
    if (dto.roomId) {
      const farFuture = new Date('2099-12-31T00:00:00.000Z')
      const avail = await this.availability.check({
        roomId: dto.roomId,
        from: startDate,
        to: endDate ?? farFuture,
      })
      const guestConflicts = avail.conflicts.filter(
        (c) => c.source === 'LOCAL_STAY' || c.source === 'LOCAL_SEGMENT',
      )
      if (guestConflicts.length > 0) {
        const names = [...new Set(guestConflicts.map((c) => c.label))].join(', ')
        throw new ConflictException(
          `La habitación tiene huéspedes activos en ese período: ${names}`,
        )
      }
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
          unitId: dto.unitId ?? null,
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
        `${actor.role === HousekeepingRole.RECEPTIONIST ? 'Recepción' : 'Staff'} solicitó bloquear ${dto.unitId ? 'unidad' : 'habitación'}. Motivo: ${dto.reason}`,
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
      include: { unit: true, room: { include: { units: true } } },
    })
    if (!block) throw new NotFoundException('Bloqueo no encontrado')
    if (block.status === BlockStatus.ACTIVE) return // idempotente

    await this.prisma.$transaction(async (tx) => {
      // 1. Crear CleaningTask(MAINTENANCE) automáticamente
      //
      // DISEÑO ACTUAL — hostel-first (deuda técnica para hoteles):
      //   CleaningTask.bedId es NOT NULL — la tarea siempre se vincula a una cama,
      //   nunca directamente a una habitación. Esto es correcto para hostales donde
      //   cada cama es la unidad vendible independiente.
      //
      //   Para bloqueo de cama individual → 1 tarea para esa cama.
      //   Para bloqueo de habitación completa → 1 tarea POR CADA cama en el cuarto.
      //
      // TODO(hotel-room-granularity): En hoteles, una habitación doble/twin tiene
      //   2 camas pero es UNA unidad vendible. El bloqueo de habitación debería
      //   generar 1 sola CleaningTask vinculada a la habitación (no al par de camas).
      //   Para implementarlo se necesita:
      //     a) Añadir `roomId String?` opcional a CleaningTask (nullable, XOR con bedId)
      //     b) Añadir campo `roomType` o `isPrivate` en Room para distinguir hostel vs hotel
      //     c) En activateBlock: si room.type === PRIVATE (hotel) → 1 tarea con roomId,
      //        si room.type === SHARED (hostal dorm) → N tareas con bedId (comportamiento actual)
      //     d) Mobile task detail y KanbanPage deben renderizar roomId en lugar de bedId
      //        cuando la tarea sea room-level
      //   Impacto: migración Prisma + cambios en CleaningTask serialización + TasksService
      //
      const unitIds = block.unitId
        ? [block.unitId]
        : (block.room?.units.map((u) => u.id) ?? [])

      let cleaningTaskId: string | null = null

      if (unitIds.length > 0) {
        // Para bloqueo de unidad individual → 1 tarea, guardamos el id
        // Para habitación completa → múltiples tareas (solo guardamos el primero en cleaningTaskId)
        for (const uId of unitIds) {
          const task = await tx.cleaningTask.create({
            data: {
              organizationId: block.organizationId,
              unitId: uId,
              taskType: TaskType.MAINTENANCE,
              requiredCapability: Capability.MAINTENANCE,
              status: CleaningStatus.UNASSIGNED,
              priority: Priority.HIGH,
            },
          })
          if (!cleaningTaskId) cleaningTaskId = task.id

          // Marcar unidad como BLOCKED
          await tx.unit.update({
            where: { id: uId },
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
          metadata: { cleaningTaskId, unitIds },
        },
      })
    })

    this.notifications.emit(block.propertyId, 'block:activated', { blockId })
    this.logger.log(`Block ${blockId} activated → MAINTENANCE task created`)
    void this.syncChannex(block)
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
      await this.releaseUnits(tx, block)

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
    void this.syncChannex(block)
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

    // Guard: verificar que el rango extendido no colisione con huéspedes activos
    if (block.roomId) {
      const checkFrom = currentEnd ?? new Date()
      const avail = await this.availability.check({
        roomId: block.roomId,
        from:   checkFrom,
        to:     newEndDate,
      })
      const guestConflicts = avail.conflicts.filter(
        (c) => c.source === 'LOCAL_STAY' || c.source === 'LOCAL_SEGMENT',
      )
      if (guestConflicts.length > 0) {
        const names = [...new Set(guestConflicts.map((c) => c.label))].join(', ')
        throw new ConflictException(
          `No se puede extender: hay huéspedes en ese período (${names})`,
        )
      }
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
    // Push the full range (idempotent) so Channex reflects the extended window
    void this.syncChannex({ roomId: block.roomId, unitId: block.unitId, startDate: block.startDate, endDate: newEndDate, unit: block.unit })
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

      await this.releaseUnits(tx, block)

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
    void this.syncChannex(block)
    return this.prisma.roomBlock.findUnique({ where: { id: blockId }, include: BLOCK_INCLUDE })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXPIRE (llamado por scheduler)
  // ─────────────────────────────────────────────────────────────────────────────

  async expireBlock(blockId: string) {
    const block = await this.prisma.roomBlock.findUnique({
      where: { id: blockId },
      include: { unit: true, room: { include: { units: true } } },
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

      await this.releaseUnits(tx, block)

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
    void this.syncChannex(block)
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUERY
  // ─────────────────────────────────────────────────────────────────────────────

  async findAll(actor: JwtPayload, filters: {
    status?: BlockStatus
    semantic?: BlockSemantic
    unitId?: string
    roomId?: string
  } = {}) {
    const orgId = this.tenant.getOrganizationId()
    return this.prisma.roomBlock.findMany({
      where: {
        organizationId: orgId,
        propertyId: actor.propertyId,
        ...(filters.status && { status: filters.status }),
        ...(filters.semantic && { semantic: filters.semantic }),
        ...(filters.unitId && { unitId: filters.unitId }),
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
      include: { unit: true, room: { include: { units: true } } },
    })
    if (!block) throw new NotFoundException('Bloqueo no encontrado')
    return block
  }

  private async releaseUnits(tx: any, block: any) {
    const unitIds = block.unitId
      ? [block.unitId]
      : (block.room?.units.map((u: any) => u.id) ?? [])

    for (const uId of unitIds) {
      await tx.unit.update({
        where: { id: uId },
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

  // ─────────────────────────────────────────────────────────────────────────────
  // CHANNEX SYNC — fire-and-forget helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /** Resolves the canonical roomId for a block (unit-level blocks need unit.roomId). */
  private resolveRoomIdForBlock(block: {
    roomId: string | null
    unit?: { roomId: string } | null
  }): string | null {
    return block.roomId ?? block.unit?.roomId ?? null
  }

  /**
   * Generates a Date[] (midnight UTC each day) covering the block's range.
   * Capped at 365 days to prevent runaway loops for indefinite blocks.
   */
  private blockDateRange(block: { startDate: Date; endDate: Date | null }): Date[] {
    const start = new Date(block.startDate)
    start.setUTCHours(0, 0, 0, 0)

    const cap = new Date(start)
    cap.setUTCDate(cap.getUTCDate() + 365)
    const end = block.endDate ? new Date(Math.min(new Date(block.endDate).getTime(), cap.getTime())) : cap
    end.setUTCHours(0, 0, 0, 0)

    const dates: Date[] = []
    const current = new Date(start)
    while (current < end) {
      dates.push(new Date(current))
      current.setUTCDate(current.getUTCDate() + 1)
    }
    return dates
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CHECK AVAILABILITY (pre-flight para el formulario de creación)
  // ─────────────────────────────────────────────────────────────────────────────

  async checkBlockAvailability(
    dto: { roomId: string; startDate: string; endDate?: string },
    actor: JwtPayload,
  ) {
    const orgId = this.tenant.getOrganizationId()

    // Validar que la habitación pertenezca a la organización del actor
    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId, organizationId: orgId },
      select: { id: true, number: true },
    })
    if (!room) throw new NotFoundException('Habitación no encontrada')

    if (!dto.startDate) throw new BadRequestException('startDate es requerido')

    const from = new Date(dto.startDate + 'T00:00:00.000Z')
    // Sin fecha fin → usar 1 año desde el inicio (bloqueo indefinido potencial)
    const to = dto.endDate
      ? new Date(dto.endDate + 'T00:00:00.000Z')
      : new Date(from.getTime() + 365 * 24 * 60 * 60 * 1000)

    const result = await this.availability.check({ roomId: dto.roomId, from, to })

    return {
      available: result.available,
      conflicts: result.conflicts
        .filter((c) => c.source === 'LOCAL_STAY' || c.source === 'LOCAL_SEGMENT')
        .map((c) => ({
          source: c.source,
          label: c.label,
          from: (c.from as Date).toISOString().slice(0, 10),
          to:   (c.to as Date).toISOString().slice(0, 10),
        })),
    }
  }

  /**
   * Computes absolute availability for the block's room and pushes to Channex.
   * Called after every lifecycle transition that changes the room's occupancy.
   * Fire-and-forget: failures are logged inside computeAndPushInventory.
   */
  private async syncChannex(block: {
    roomId: string | null
    unitId: string | null
    startDate: Date
    endDate: Date | null
    unit?: { roomId: string } | null
  }): Promise<void> {
    const roomId = this.resolveRoomIdForBlock(block)
    if (!roomId) return
    const dates = this.blockDateRange(block)
    if (dates.length === 0) return
    await this.availability.computeAndPushInventory(roomId, dates)
  }
}
