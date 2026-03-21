import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { HousekeepingRole, JwtPayload } from '@housekeeping/shared'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { RoomsService } from './rooms.service'
import { CreateRoomDto } from './dto/create-room.dto'

@Controller()
export class RoomsController {
  constructor(private service: RoomsService) {}

  @Post('properties/:propertyId/rooms')
  @Roles(HousekeepingRole.SUPERVISOR)
  create(@Param('propertyId') propertyId: string, @Body() dto: CreateRoomDto) {
    return this.service.create(propertyId, dto)
  }

  /** Convenience: list all rooms for the caller's property */
  @Get('rooms')
  findForProperty(@CurrentUser() actor: JwtPayload) {
    return this.service.findByProperty(actor.propertyId)
  }

  /** Convenience: create a room for the caller's property */
  @Post('rooms')
  @Roles(HousekeepingRole.SUPERVISOR)
  createForProperty(@CurrentUser() actor: JwtPayload, @Body() dto: CreateRoomDto) {
    return this.service.create(actor.propertyId, dto)
  }

  @Get('properties/:propertyId/rooms')
  findByProperty(@Param('propertyId') propertyId: string) {
    return this.service.findByProperty(propertyId)
  }

  @Get('rooms/:id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
  }

  @Patch('rooms/:id')
  @Roles(HousekeepingRole.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: Partial<CreateRoomDto>) {
    return this.service.update(id, dto)
  }

  @Delete('rooms/:id')
  @Roles(HousekeepingRole.SUPERVISOR)
  remove(@Param('id') id: string) {
    return this.service.remove(id)
  }
}
