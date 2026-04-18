import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common'
import { StayJourneyService } from './stay-journeys.service'
import { ExtendSameRoomDto, ExtendNewRoomDto, RoomMoveDto } from './dto/stay-journey.dto'
import { TenantResource } from '../../common/guards/tenant.guard'

@Controller('v1/stay-journeys')
export class StayJourneyController {
  constructor(private readonly service: StayJourneyService) {}

  @Get('timeline')
  findActiveForTimeline(
    @Query('propertyId') propertyId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.service.findActiveForTimeline(propertyId, new Date(from), new Date(to))
  }

  @Get(':id')
  @TenantResource({ model: 'stayJourney', paramName: 'id' })
  findById(@Param('id') id: string) {
    return this.service.findById(id)
  }

  @Post(':id/extend-same-room')
  @TenantResource({ model: 'stayJourney', paramName: 'id' })
  extendSameRoom(@Body() dto: ExtendSameRoomDto) {
    return this.service.extendSameRoom(dto)
  }

  @Post(':id/extend-new-room')
  @TenantResource({ model: 'stayJourney', paramName: 'id' })
  extendNewRoom(@Body() dto: ExtendNewRoomDto) {
    return this.service.extendNewRoom(dto)
  }

  @Post(':id/room-move')
  @TenantResource({ model: 'stayJourney', paramName: 'id' })
  roomMove(@Body() dto: RoomMoveDto) {
    return this.service.executeMidStayRoomMove(dto)
  }
}
