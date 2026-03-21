import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { HousekeepingRole, JwtPayload } from '@housekeeping/shared'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { CheckoutsService } from './checkouts.service'
import { CreateCheckoutDto, BatchCheckoutDto } from './dto/create-checkout.dto'
import { CheckoutSource } from '@housekeeping/shared'

@Controller()
export class CheckoutsController {
  constructor(private service: CheckoutsService) {}

  /** Individual ad-hoc checkout */
  @Post('checkouts')
  @Roles(HousekeepingRole.SUPERVISOR, HousekeepingRole.RECEPTIONIST)
  create(@Body() dto: CreateCheckoutDto, @CurrentUser() actor: JwtPayload) {
    return this.service.processCheckout({
      roomId: dto.roomId,
      guestName: dto.guestName,
      actualCheckoutAt: dto.actualCheckoutAt ? new Date(dto.actualCheckoutAt) : new Date(),
      source: CheckoutSource.MANUAL,
      isEarlyCheckout: dto.isEarlyCheckout,
      hasSameDayCheckIn: dto.hasSameDayCheckIn,
      notes: dto.notes,
      enteredById: actor.sub,
    })
  }

  /** Morning batch planning */
  @Post('checkouts/batch')
  @Roles(HousekeepingRole.SUPERVISOR, HousekeepingRole.RECEPTIONIST)
  batchCheckout(@Body() dto: BatchCheckoutDto, @CurrentUser() actor: JwtPayload) {
    return this.service.batchCheckout(dto, actor.sub, actor.propertyId)
  }

  @Get('checkouts')
  findAll(@CurrentUser() actor: JwtPayload) {
    return this.service.findByProperty(actor.propertyId)
  }

  /** Daily planning grid for DailyPlanningPage */
  @Get('planning/daily')
  dailyGrid(@CurrentUser() actor: JwtPayload, @Query('date') date?: string) {
    const today = date ?? new Date().toISOString().split('T')[0]
    return this.service.getDailyGrid(actor.propertyId, today)
  }

  /** Cancel checkout (guest extended stay) */
  @Patch('checkouts/:id/cancel')
  @Roles(HousekeepingRole.SUPERVISOR, HousekeepingRole.RECEPTIONIST)
  cancel(@Param('id') id: string, @CurrentUser() actor: JwtPayload) {
    return this.service.cancelCheckout(id, actor.propertyId)
  }

  /**
   * Confirma la salida física del huésped (Fase 2 del ciclo de checkout).
   *
   * Activa las tareas PENDING → READY/UNASSIGNED y marca la(s) cama(s) como DIRTY.
   * Notifica a housekeeping que puede empezar a limpiar.
   *
   * @param body.bedId - (opcional) ID de cama específica. Si se omite, activa
   *                     TODAS las camas pendientes del checkout. Necesario en dorms
   *                     compartidos donde cada cama puede tener su propio huésped.
   */
  @Post('checkouts/:id/depart')
  @Roles(HousekeepingRole.SUPERVISOR, HousekeepingRole.RECEPTIONIST)
  confirmDeparture(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
    @Body() body: { bedId?: string },
  ) {
    return this.service.confirmDeparture(id, actor.sub, actor.propertyId, body.bedId)
  }
}
