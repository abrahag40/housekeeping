import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { HousekeepingRole, JwtPayload } from '@housekeeping/shared'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { MaintenanceService, CreateIssueDto } from './maintenance.service'

@Controller()
export class MaintenanceController {
  constructor(private service: MaintenanceService) {}

  @Post('tasks/:taskId/issues')
  create(
    @Param('taskId') taskId: string,
    @Body() dto: CreateIssueDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.create(taskId, dto, actor)
  }

  @Get('tasks/:taskId/issues')
  findByTask(@Param('taskId') taskId: string) {
    return this.service.findByTask(taskId)
  }

  @Get('maintenance')
  @Roles(HousekeepingRole.SUPERVISOR)
  findAll(
    @CurrentUser() actor: JwtPayload,
    @Query('resolved') resolved?: string,
  ) {
    const resolvedFilter = resolved === 'true' ? true : resolved === 'false' ? false : undefined
    return this.service.findByProperty(actor.propertyId, resolvedFilter)
  }

  @Patch('maintenance/:id/resolve')
  @Roles(HousekeepingRole.SUPERVISOR)
  resolve(@Param('id') id: string) {
    return this.service.resolve(id)
  }
}
