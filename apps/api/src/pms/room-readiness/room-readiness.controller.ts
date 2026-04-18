import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common'
import { RoomReadinessService } from './room-readiness.service'
import { CompleteItemDto } from './dto/complete-item.dto'
import { CreateReadinessTaskDto } from './dto/create-task.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtPayload } from '@housekeeping/shared'
import { TenantContextService } from '../../common/tenant-context.service'

@Controller('v1/room-readiness')
export class RoomReadinessController {
  constructor(
    private readonly service: RoomReadinessService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  findByProperty(@Query('propertyId') propertyId: string) {
    const orgId = this.tenant.getOrganizationId()
    return this.service.getTasksForProperty(propertyId, orgId)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    const orgId = this.tenant.getOrganizationId()
    return this.service.getTaskById(id, orgId)
  }

  @Post()
  create(@Body() dto: CreateReadinessTaskDto) {
    const orgId = this.tenant.getOrganizationId()
    return this.service.createReadinessTask({
      roomId: dto.roomId,
      propertyId: dto.propertyId,
      orgId,
      triggeredBy: dto.triggeredBy ?? 'manual',
      dueBy: dto.dueBy ? new Date(dto.dueBy) : undefined,
    })
  }

  @Post(':id/items/complete')
  completeItem(
    @Param('id') taskId: string,
    @Body() dto: CompleteItemDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    const orgId = this.tenant.getOrganizationId()
    return this.service.completeItem({
      taskId,
      itemId: dto.itemId,
      staffId: actor.sub,
      photoUrl: dto.photoUrl,
      status: dto.status,
      notes: dto.notes,
      orgId,
    })
  }

  @Patch(':id/approve')
  approve(@Param('id') taskId: string, @CurrentUser() actor: JwtPayload) {
    const orgId = this.tenant.getOrganizationId()
    return this.service.approveTask(taskId, actor.sub, orgId)
  }
}
