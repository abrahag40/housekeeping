import { Injectable, NotFoundException } from '@nestjs/common'
import { IsString, MinLength } from 'class-validator'
import { JwtPayload, TaskLogEvent } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

export class CreateNoteDto {
  @IsString()
  @MinLength(1)
  content: string
}

@Injectable()
export class NotesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  async create(taskId: string, dto: CreateNoteDto, actor: JwtPayload) {
    const task = await this.prisma.cleaningTask.findUnique({
      where: { id: taskId },
      include: { bed: { include: { room: { include: { property: true } } } } },
    })
    if (!task) throw new NotFoundException('Task not found')

    const [note] = await this.prisma.$transaction([
      this.prisma.cleaningNote.create({
        data: { taskId, staffId: actor.sub, content: dto.content },
        include: { staff: { select: { id: true, name: true } } },
      }),
      this.prisma.taskLog.create({
        data: { taskId, staffId: actor.sub, event: TaskLogEvent.NOTE_ADDED, note: dto.content },
      }),
    ])

    // SSE: notify reception/supervisor that a note was added
    this.notifications.emit(task.bed.room.property.id, 'task:done', {
      taskId,
      noteAdded: true,
      roomNumber: task.bed.room.number,
    })

    return note
  }

  findByTask(taskId: string) {
    return this.prisma.cleaningNote.findMany({
      where: { taskId },
      include: { staff: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    })
  }
}
