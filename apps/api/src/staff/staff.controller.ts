import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { HousekeepingRole, JwtPayload } from '@housekeeping/shared'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { StaffService } from './staff.service'
import { CreateStaffDto, UpdateStaffDto } from './dto/create-staff.dto'

@Controller('staff')
export class StaffController {
  constructor(private service: StaffService) {}

  @Post()
  @Roles(HousekeepingRole.SUPERVISOR)
  create(@Body() dto: CreateStaffDto, @CurrentUser() actor: JwtPayload) {
    return this.service.create(dto, actor)
  }

  @Get()
  findAll(@CurrentUser() actor: JwtPayload) {
    return this.service.findAll(actor.propertyId)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Patch(':id')
  @Roles(HousekeepingRole.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.service.update(id, dto)
  }

  @Delete(':id')
  @Roles(HousekeepingRole.SUPERVISOR)
  remove(@Param('id') id: string) {
    return this.service.remove(id)
  }
}
