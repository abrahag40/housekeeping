import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { JwtPayload } from '@housekeeping/shared'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { NotesService, CreateNoteDto } from './notes.service'

@Controller('tasks/:taskId/notes')
export class NotesController {
  constructor(private service: NotesService) {}

  @Post()
  create(
    @Param('taskId') taskId: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.create(taskId, dto, actor)
  }

  @Get()
  findAll(@Param('taskId') taskId: string) {
    return this.service.findByTask(taskId)
  }
}
