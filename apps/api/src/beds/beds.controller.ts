import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { HousekeepingRole } from '@housekeeping/shared'
import { Roles } from '../common/decorators/roles.decorator'
import { BedsService } from './beds.service'
import { CreateBedDto } from './dto/create-bed.dto'

@Controller()
export class BedsController {
  constructor(private service: BedsService) {}

  @Post('rooms/:roomId/beds')
  @Roles(HousekeepingRole.SUPERVISOR)
  create(@Param('roomId') roomId: string, @Body() dto: CreateBedDto) {
    return this.service.create(roomId, dto)
  }

  @Get('rooms/:roomId/beds')
  findByRoom(@Param('roomId') roomId: string) {
    return this.service.findByRoom(roomId)
  }

  @Get('beds/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Patch('beds/:id')
  @Roles(HousekeepingRole.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: Partial<CreateBedDto>) {
    return this.service.update(id, dto)
  }

  @Delete('beds/:id')
  @Roles(HousekeepingRole.SUPERVISOR)
  remove(@Param('id') id: string) {
    return this.service.remove(id)
  }
}
