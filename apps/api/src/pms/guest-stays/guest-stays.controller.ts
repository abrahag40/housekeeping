import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
} from '@nestjs/common'
import { GuestStaysService } from './guest-stays.service'
import { CreateGuestStayDto } from './dto/create-guest-stay.dto'
import { MoveRoomDto } from './dto/move-room.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtPayload } from '@housekeeping/shared'

@Controller('v1/guest-stays')
export class GuestStaysController {
  constructor(private readonly service: GuestStaysService) {}

  @Post()
  create(@Body() dto: CreateGuestStayDto, @CurrentUser() actor: JwtPayload) {
    return this.service.create(dto, actor.sub)
  }

  /**
   * Pre-flight availability check — no side effects.
   * Called by the frontend as the user selects dates in the check-in dialog.
   *
   * GET /v1/guest-stays/availability?roomId=<id>&checkIn=<ISO>&checkOut=<ISO>
   *
   * IMPORTANT: this route must be declared before any parameterized routes
   * (e.g. :id) to prevent NestJS from matching "availability" as an :id param.
   */
  @Get('availability')
  checkAvailability(
    @Query('roomId')   roomId:   string,
    @Query('checkIn')  checkIn:  string,
    @Query('checkOut') checkOut: string,
  ) {
    if (!roomId || !checkIn || !checkOut) {
      throw new BadRequestException('roomId, checkIn y checkOut son requeridos')
    }
    const ciDate = new Date(checkIn)
    const coDate = new Date(checkOut)
    if (isNaN(ciDate.getTime()) || isNaN(coDate.getTime())) {
      throw new BadRequestException('Fechas inválidas')
    }
    if (coDate <= ciDate) {
      throw new BadRequestException('checkOut debe ser posterior a checkIn')
    }
    return this.service.checkAvailability(roomId, ciDate, coDate)
  }

  @Get()
  findByProperty(
    @Query('propertyId') propertyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findByProperty(
      propertyId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    )
  }

  @Post(':id/checkout')
  checkout(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.service.checkout(id, actor.sub)
  }

  @Patch(':id/move-room')
  moveRoom(
    @Param('id') id: string,
    @Body() dto: MoveRoomDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.moveRoom(id, dto, actor.sub)
  }
}
