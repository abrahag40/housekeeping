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
import { IsBoolean, IsOptional, IsString } from 'class-validator'
import { CreateContactLogDto } from './dto/create-contact-log.dto'
import { ConfirmCheckinDto } from './dto/confirm-checkin.dto'
import { RegisterPaymentDto } from './dto/register-payment.dto'
import { VoidPaymentDto } from './dto/void-payment.dto'

class MarkNoShowDto {
  @IsOptional()
  @IsString()
  reason?: string

  @IsOptional()
  @IsBoolean()
  waiveCharge?: boolean
}

class ExtendStayDto {
  @IsString()
  newCheckOut: string
}
import { GuestStaysService } from './guest-stays.service'
import { CreateGuestStayDto } from './dto/create-guest-stay.dto'
import { MoveRoomDto } from './dto/move-room.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { JwtPayload } from '@zenix/shared'

@Controller('v1/guest-stays')
export class GuestStaysController {
  constructor(private readonly service: GuestStaysService) {}

  @Post()
  create(@Body() dto: CreateGuestStayDto, @CurrentUser() actor: JwtPayload) {
    return this.service.create(dto, actor.sub)
  }

  /**
   * GET /v1/guest-stays/cash-summary?propertyId=X&date=YYYY-MM-DD
   * Reconciliación de caja de efectivo por turno.
   * IMPORTANT: declarado antes de :id para evitar que NestJS lo resuelva como param.
   */
  @Get('cash-summary')
  getCashSummary(
    @Query('propertyId') propertyId: string,
    @Query('date')       date:       string,
  ) {
    if (!propertyId || !date) throw new BadRequestException('propertyId y date son requeridos')
    return this.service.getCashSummary(propertyId, date)
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

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id)
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

  @Post(':id/early-checkout')
  earlyCheckout(
    @Param('id') id: string,
    @Body() dto: { notes?: string },
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.earlyCheckout(id, actor.sub, dto.notes)
  }

  @Patch(':id/extend')
  extendStay(
    @Param('id') id: string,
    @Body() dto: ExtendStayDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    if (!dto.newCheckOut) throw new BadRequestException('newCheckOut es requerido')
    return this.service.extendStay(id, new Date(dto.newCheckOut), actor.sub)
  }

  @Patch(':id/move-room')
  moveRoom(
    @Param('id') id: string,
    @Body() dto: MoveRoomDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.moveRoom(id, dto, actor.sub)
  }

  /**
   * POST /v1/guest-stays/:id/confirm-checkin
   * Confirma la llegada física del huésped y registra los pagos de ingreso.
   */
  @Post(':id/confirm-checkin')
  confirmCheckin(
    @Param('id') id: string,
    @Body() dto: ConfirmCheckinDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.confirmCheckin(id, dto, actor.sub)
  }

  /**
   * POST /v1/guest-stays/:id/payments
   * Registra un pago adicional sobre una estadía (abono, cargo extra, etc.).
   */
  @Post(':id/payments')
  registerPayment(
    @Param('id') id: string,
    @Body() dto: RegisterPaymentDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.registerPayment(id, dto, actor.sub)
  }

  /**
   * POST /v1/guest-stays/payments/:paymentLogId/void
   * Anula un PaymentLog (crea entrada negativa — original intacto).
   * IMPORTANT: declarado antes de :id para evitar ambigüedad de routing.
   */
  @Post('payments/:paymentLogId/void')
  voidPayment(
    @Param('paymentLogId') paymentLogId: string,
    @Body() dto: VoidPaymentDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.voidPayment(paymentLogId, dto, actor.sub)
  }

  /**
   * POST /v1/guest-stays/:id/no-show
   * Marca manualmente una estadía como no-show.
   * El recepcionista puede exonerar el cargo con waiveCharge: true
   * (requiere rol SUPERVISOR — validación en frontend; el servicio registra quién lo hizo).
   */
  @Post(':id/no-show')
  markAsNoShow(
    @Param('id') id: string,
    @Body() dto: MarkNoShowDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.markAsNoShow(id, actor.sub, dto)
  }

  /**
   * POST /v1/guest-stays/:id/revert-no-show
   * Revierte el no-show dentro de la ventana de 48h.
   * Útil para: vuelo retrasado, llegada tardía, error del recepcionista.
   */
  @Post(':id/revert-no-show')
  revertNoShow(
    @Param('id') id: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.revertNoShow(id, actor.sub)
  }

  /**
   * POST /v1/guest-stays/:id/contact-log
   * Registra un intento de contacto al huésped para documentación de disputas.
   * Append-only — no hay endpoint de actualización ni borrado.
   */
  @Post(':id/contact-log')
  logContact(
    @Param('id') id: string,
    @Body() dto: CreateContactLogDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.service.logContact(id, actor.sub, dto.channel, dto.messagePreview)
  }
}
