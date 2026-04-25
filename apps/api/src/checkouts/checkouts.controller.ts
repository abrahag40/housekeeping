import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { HousekeepingRole, JwtPayload } from '@zenix/shared'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { TenantResource } from '../common/guards/tenant.guard'
import { CheckoutsService } from './checkouts.service'
import { CreateCheckoutDto, BatchCheckoutDto } from './dto/create-checkout.dto'
import { CancelCheckoutDto } from './dto/cancel-checkout.dto'

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
      source: 'MANUAL',
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
  @TenantResource({ model: 'checkout', paramName: 'id' })
  @Roles(HousekeepingRole.SUPERVISOR, HousekeepingRole.RECEPTIONIST)
  cancel(@Param('id') id: string, @Body() body: CancelCheckoutDto, @CurrentUser() actor: JwtPayload) {
    return this.service.cancelCheckout(id, actor.propertyId, body.unitId)
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
  /**
   * Revierte la confirmación de salida física (error humano, huésped aún no salió).
   * Solo disponible mientras la tarea esté en READY o UNASSIGNED (antes de que
   * housekeeping inicie la limpieza). Una vez IN_PROGRESS, requiere supervisor.
   */
  @Post('checkouts/:id/undo-depart')
  @TenantResource({ model: 'checkout', paramName: 'id' })
  @Roles(HousekeepingRole.SUPERVISOR, HousekeepingRole.RECEPTIONIST)
  undoDeparture(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
    @Body() body: { unitId?: string },
  ) {
    return this.service.undoDeparture(id, actor.sub, actor.propertyId, body.unitId)
  }

  @Post('checkouts/:id/depart')
  @TenantResource({ model: 'checkout', paramName: 'id' })
  @Roles(HousekeepingRole.SUPERVISOR, HousekeepingRole.RECEPTIONIST)
  confirmDeparture(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
    @Body() body: { unitId?: string },
  ) {
    return this.service.confirmDeparture(id, actor.sub, actor.propertyId, body.unitId)
  }
}
