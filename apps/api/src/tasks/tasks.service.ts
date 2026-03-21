import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { CleaningStatus, HousekeepingRole, JwtPayload, TaskLogEvent } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PushService } from '../notifications/push.service'
import { CreateTaskDto, AssignTaskDto, QueryTaskDto } from './dto/create-task.dto'

const TASK_INCLUDE = {
  bed: { include: { room: true } },
  assignedTo: { select: { id: true, name: true, email: true, role: true } },
  verifiedBy: { select: { id: true, name: true } },
}

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private push: PushService,
  ) {}

  async create(dto: CreateTaskDto, actor: JwtPayload) {
    const bed = await this.prisma.bed.findUnique({
      where: { id: dto.bedId },
      include: { room: { include: { property: true } } },
    })
    if (!bed) throw new NotFoundException('Bed not found')

    if (dto.assignedToId) {
      const staff = await this.prisma.housekeepingStaff.findUnique({
        where: { id: dto.assignedToId },
      })
      if (!staff || !staff.active) throw new NotFoundException('Staff not found or inactive')
      if (dto.requiredCapability && !staff.capabilities.includes(dto.requiredCapability as any)) {
        throw new ConflictException('Staff does not have the required capability')
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const task = await tx.cleaningTask.create({
        data: {
          bedId: dto.bedId,
          assignedToId: dto.assignedToId,
          taskType: dto.taskType ?? 'CLEANING',
          requiredCapability: dto.requiredCapability ?? 'CLEANING',
          priority: dto.priority ?? 'MEDIUM',
          status: dto.assignedToId ? CleaningStatus.PENDING : CleaningStatus.UNASSIGNED,
        },
        include: TASK_INCLUDE,
      })

      await tx.taskLog.create({
        data: { taskId: task.id, staffId: actor.sub, event: TaskLogEvent.CREATED },
      })

      if (dto.assignedToId) {
        await tx.taskLog.create({
          data: { taskId: task.id, staffId: actor.sub, event: TaskLogEvent.ASSIGNED },
        })
      }

      return task
    })
  }

  findAll(query: QueryTaskDto, actor: JwtPayload) {
    const where: any = { bed: { room: { propertyId: actor.propertyId } } }

    // Housekeepers only see their own tasks
    if (actor.role === HousekeepingRole.HOUSEKEEPER) {
      where.assignedToId = actor.sub
    } else if (query.assignedToId) {
      where.assignedToId = query.assignedToId
    }

    if (query.status) {
      const statuses = query.status.split(',')
      where.status = statuses.length > 1 ? { in: statuses } : statuses[0]
    }

    if (query.bedId) where.bedId = query.bedId

    if (query.roomId) where.bed = { ...where.bed, roomId: query.roomId }

    return this.prisma.cleaningTask.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    })
  }

  async findOne(id: string) {
    const task = await this.prisma.cleaningTask.findUnique({
      where: { id },
      include: { ...TASK_INCLUDE, logs: { orderBy: { createdAt: 'asc' } }, notes: true, issues: true },
    })
    if (!task) throw new NotFoundException('Task not found')
    return task
  }

  async startTask(taskId: string, actor: JwtPayload) {
    const task = await this.prisma.cleaningTask.findUnique({
      where: { id: taskId },
      include: { bed: { include: { room: { include: { property: true } } } } },
    })
    if (!task) throw new NotFoundException('Task not found')

    if (task.status !== CleaningStatus.READY && task.status !== CleaningStatus.PENDING) {
      throw new ConflictException(`Cannot start task with status: ${task.status}`)
    }

    // Only the assigned housekeeper (or a supervisor) can start the task
    if (
      actor.role === HousekeepingRole.HOUSEKEEPER &&
      task.assignedToId !== actor.sub
    ) {
      throw new ForbiddenException('You are not assigned to this task')
    }

    // Prevent starting if housekeeper already has an IN_PROGRESS task
    if (actor.role === HousekeepingRole.HOUSEKEEPER) {
      const activeTask = await this.prisma.cleaningTask.findFirst({
        where: { assignedToId: actor.sub, status: CleaningStatus.IN_PROGRESS },
      })
      if (activeTask) {
        throw new ConflictException('You already have an active task in progress')
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.cleaningTask.update({
        where: { id: taskId },
        data: {
          status: CleaningStatus.IN_PROGRESS,
          startedAt: new Date(),
          assignedToId: task.assignedToId ?? actor.sub,
        },
        include: TASK_INCLUDE,
      })

      await tx.taskLog.create({
        data: { taskId, staffId: actor.sub, event: TaskLogEvent.STARTED },
      })

      // Update bed status to CLEANING
      await tx.bed.update({ where: { id: task.bedId }, data: { status: 'CLEANING' } })

      return updated
    })

    this.notifications.emit(task.bed.room.property.id, 'task:started', {
      taskId,
      bedId: task.bedId,
      roomNumber: task.bed.room.number,
      assignedToId: actor.sub,
    })

    return updated
  }

  async endTask(taskId: string, actor: JwtPayload) {
    const task = await this.prisma.cleaningTask.findUnique({
      where: { id: taskId },
      include: {
        bed: { include: { room: { include: { property: true } } } },
        notes: true,
      },
    })
    if (!task) throw new NotFoundException('Task not found')

    if (task.status !== CleaningStatus.IN_PROGRESS && task.status !== CleaningStatus.PAUSED) {
      throw new ConflictException(`Cannot end task with status: ${task.status}`)
    }

    if (actor.role === HousekeepingRole.HOUSEKEEPER && task.assignedToId !== actor.sub) {
      throw new ForbiddenException('You are not assigned to this task')
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.cleaningTask.update({
        where: { id: taskId },
        data: { status: CleaningStatus.DONE, finishedAt: new Date() },
        include: TASK_INCLUDE,
      })

      await tx.taskLog.create({
        data: { taskId, staffId: actor.sub, event: TaskLogEvent.COMPLETED },
      })

      // Bed is now AVAILABLE (clean)
      await tx.bed.update({ where: { id: task.bedId }, data: { status: 'AVAILABLE' } })

      return updated
    })

    const propertyId = task.bed.room.property.id

    this.notifications.emit(propertyId, 'task:done', {
      taskId,
      bedId: task.bedId,
      roomId: task.bed.roomId,
      roomNumber: task.bed.room.number,
      assignedToId: actor.sub,
      hasNotes: task.notes.length > 0,
    })

    return updated
  }

  async pauseTask(taskId: string, actor: JwtPayload) {
    const task = await this.prisma.cleaningTask.findUnique({ where: { id: taskId } })
    if (!task) throw new NotFoundException('Task not found')
    if (task.status !== CleaningStatus.IN_PROGRESS) {
      throw new ConflictException('Can only pause an in-progress task')
    }
    if (actor.role === HousekeepingRole.HOUSEKEEPER && task.assignedToId !== actor.sub) {
      throw new ForbiddenException('You are not assigned to this task')
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.cleaningTask.update({
        where: { id: taskId },
        data: { status: CleaningStatus.PAUSED },
        include: TASK_INCLUDE,
      })
      await tx.taskLog.create({ data: { taskId, staffId: actor.sub, event: TaskLogEvent.PAUSED } })
      return updated
    })
  }

  async resumeTask(taskId: string, actor: JwtPayload) {
    const task = await this.prisma.cleaningTask.findUnique({ where: { id: taskId } })
    if (!task) throw new NotFoundException('Task not found')
    if (task.status !== CleaningStatus.PAUSED) {
      throw new ConflictException('Can only resume a paused task')
    }
    if (actor.role === HousekeepingRole.HOUSEKEEPER && task.assignedToId !== actor.sub) {
      throw new ForbiddenException('You are not assigned to this task')
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.cleaningTask.update({
        where: { id: taskId },
        data: { status: CleaningStatus.IN_PROGRESS },
        include: TASK_INCLUDE,
      })
      await tx.taskLog.create({ data: { taskId, staffId: actor.sub, event: TaskLogEvent.RESUMED } })
      return updated
    })
  }

  async verifyTask(taskId: string, actor: JwtPayload) {
    const task = await this.prisma.cleaningTask.findUnique({
      where: { id: taskId },
      include: { bed: { include: { room: { include: { property: true } } } } },
    })
    if (!task) throw new NotFoundException('Task not found')
    if (task.status !== CleaningStatus.DONE) {
      throw new ConflictException('Task must be DONE before verification')
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.cleaningTask.update({
        where: { id: taskId },
        data: { status: CleaningStatus.VERIFIED, verifiedAt: new Date(), verifiedById: actor.sub },
        include: TASK_INCLUDE,
      })
      await tx.taskLog.create({ data: { taskId, staffId: actor.sub, event: TaskLogEvent.VERIFIED } })
      return updated
    })
  }

  async assignTask(taskId: string, dto: AssignTaskDto, actor: JwtPayload) {
    const task = await this.prisma.cleaningTask.findUnique({ where: { id: taskId } })
    if (!task) throw new NotFoundException('Task not found')
    if ([CleaningStatus.DONE, CleaningStatus.VERIFIED, CleaningStatus.CANCELLED].includes(task.status as CleaningStatus)) {
      throw new ConflictException('Cannot assign a completed or cancelled task')
    }

    const staff = await this.prisma.housekeepingStaff.findUnique({
      where: { id: dto.assignedToId },
    })
    if (!staff || !staff.active) throw new NotFoundException('Staff not found or inactive')

    const newStatus =
      task.status === CleaningStatus.UNASSIGNED ? CleaningStatus.READY : task.status

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.cleaningTask.update({
        where: { id: taskId },
        data: { assignedToId: dto.assignedToId, status: newStatus as CleaningStatus },
        include: TASK_INCLUDE,
      })
      await tx.taskLog.create({
        data: { taskId, staffId: actor.sub, event: TaskLogEvent.ASSIGNED },
      })

      if (newStatus === CleaningStatus.READY) {
        await this.push.sendToStaff(
          dto.assignedToId,
          '🛏️ Nueva tarea asignada',
          `Hab. ${(updated.bed as any).room.number} — Lista para limpiar`,
          { type: 'task:ready', taskId },
        )
      }

      return updated
    })
  }
}
