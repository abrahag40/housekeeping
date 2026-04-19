import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtPayload } from '@zenix/shared'
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

  /**
   * GET /reports/no-shows?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * Reporte de auditoría de no-shows con KPIs de ingresos y distribución por canal.
   * Filtros: rango de fechas por noShowAt (cuándo se marcó, no cuándo fue la llegada).
   * Default: últimos 30 días.
   */
  @Get('no-shows')
  noShowReport(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getNoShowReport(
      user.propertyId,
      from ?? daysAgo(29),
      to  ?? toYMD(new Date()),
    )
  }
}
