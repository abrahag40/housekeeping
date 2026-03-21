import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtPayload } from '@housekeeping/shared'
import { ReportsService } from './reports.service'
function toYMD(d: Date) {
  return d.toISOString().slice(0, 10)
}
function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toYMD(d)
}

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get('overview')
  overview(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const today = toYMD(new Date())
    return this.service.getOverview(user.propertyId, from ?? today, to ?? today)
  }

  @Get('staff-performance')
  staffPerformance(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getStaffPerformance(user.propertyId, from ?? daysAgo(6), to ?? toYMD(new Date()))
  }

  @Get('daily-trend')
  dailyTrend(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getDailyTrend(user.propertyId, from ?? daysAgo(6), to ?? toYMD(new Date()))
  }
}
