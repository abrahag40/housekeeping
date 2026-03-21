import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtPayload, DiscrepancyStatus } from '@housekeeping/shared'
import { DiscrepanciesService } from './discrepancies.service'
import { CreateDiscrepancyDto } from './dto/create-discrepancy.dto'

@UseGuards(JwtAuthGuard)
@Controller('discrepancies')
export class DiscrepanciesController {
  constructor(private service: DiscrepanciesService) {}

  @Post()
  create(@Body() dto: CreateDiscrepancyDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub, user.propertyId)
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('status') status?: DiscrepancyStatus) {
    return this.service.findByProperty(user.propertyId, status)
  }

  @Patch(':id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return this.service.acknowledge(id)
  }

  @Patch(':id/resolve')
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body('resolution') resolution: string,
  ) {
    return this.service.resolve(id, user.sub, resolution)
  }
}
