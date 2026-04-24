import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common'
import { Request } from 'express'
import { JwtPayload } from '@zenix/shared'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { Public } from '../common/decorators/public.decorator'
import { PaymentsService } from './payments.service'
import { WaiveNoShowDto } from './dto/waive-noshow.dto'

@Controller('v1/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  // POST /v1/payments/guest-stays/:id/setup-intent
  // Crea un SetupIntent para guardar la tarjeta del huésped al check-in.
  // El clientSecret se envía al frontend (Stripe.js) para completar el flujo.
  @Post('guest-stays/:id/setup-intent')
  createSetupIntent(@Param('id') stayId: string) {
    return this.payments.createSetupIntent(stayId)
  }

  // POST /v1/payments/guest-stays/:id/charge-noshow
  // Dispara el cobro de no-show para una estadía marcada.
  // Requiere tarjeta guardada (stripePaymentMethodId en GuestStay).
  @Post('guest-stays/:id/charge-noshow')
  chargeNoShow(
    @Param('id') stayId: string,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.payments.chargeNoShow(stayId, actor.sub)
  }

  // POST /v1/payments/guest-stays/:id/waive-noshow
  // Perdona el cargo de no-show. Razón obligatoria (auditabilidad).
  @Post('guest-stays/:id/waive-noshow')
  waiveNoShow(
    @Param('id') stayId: string,
    @Body() dto: WaiveNoShowDto,
    @CurrentUser() actor: JwtPayload,
  ) {
    return this.payments.waiveNoShowCharge(stayId, actor.sub, dto.reason)
  }
}

// ─── Stripe Webhook Controller (público) ────────────────────────────────────
//
// CRÍTICO: este endpoint NO puede tener JwtAuthGuard — Stripe no envía JWT.
// El body debe llegar como Buffer raw para que constructEvent() pueda verificar
// la firma HMAC-SHA256. La configuración de rawBody se hace en main.ts.
//
// La clase está separada del controller principal para tener @Public() limpio
// sin mezclar con las rutas autenticadas.
@Controller('v1/webhooks')
export class StripeWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('stripe')
  handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const rawBody = req.rawBody
    if (!rawBody) {
      return { received: false }
    }
    return this.payments.handleWebhook(rawBody, signature)
  }
}
