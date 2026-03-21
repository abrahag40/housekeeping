import { Injectable, NotFoundException } from '@nestjs/common'
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator'
import { JwtPayload, MaintenanceCategory } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

export class CreateIssueDto {
  @IsEnum(MaintenanceCategory)
  category: MaintenanceCategory

  @IsString()
  @MinLength(5)
  description: string

  @IsOptional()
  @IsString()
  photoUrl?: string
}

@Injectable()
export class MaintenanceService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(taskId: string, dto: CreateIssueDto, actor: JwtPayload) {
    const task = await this.prisma.cleaningTask.findUnique({
      where: { id: taskId },
      include: { bed: { include: { room: { include: { property: true } } } } },
    })
    if (!task) throw new NotFoundException('Task not found')

    const issue = await this.prisma.maintenanceIssue.create({
      data: {
        taskId,
        reportedById: actor.sub,
        category: dto.category,
        description: dto.description,
        photoUrl: dto.photoUrl,
      },
      include: { reportedBy: { select: { id: true, name: true } } },
    })

    this.notifications.emit(task.bed.room.property.id, 'maintenance:reported', {
      issueId: issue.id,
      taskId,
      roomNumber: task.bed.room.number,
      category: dto.category,
    })

    return issue
  }

  findByTask(taskId: string) {
    return this.prisma.maintenanceIssue.findMany({
      where: { taskId },
      include: { reportedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  findByProperty(propertyId: string, resolved?: boolean) {
    return this.prisma.maintenanceIssue.findMany({
      where: {
        task: { bed: { room: { propertyId } } },
        ...(resolved !== undefined ? { resolved } : {}),
      },
      include: {
        task: { include: { bed: { include: { room: true } } } },
        reportedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async resolve(id: string) {
    const issue = await this.prisma.maintenanceIssue.findUnique({ where: { id } })
    if (!issue) throw new NotFoundException('Issue not found')
    return this.prisma.maintenanceIssue.update({ where: { id }, data: { resolved: true } })
  }
}
