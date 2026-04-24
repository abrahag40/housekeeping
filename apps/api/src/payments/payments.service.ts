import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common'
import Stripe = require('stripe')
import { PrismaService } from '../prisma/prisma.service'

type StripeInstance = InstanceType<typeof Stripe>

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)
  private stripe: StripeInstance | null = null

  constructor(private readonly prisma: PrismaService) {
    const apiKey = process.env.STRIPE_SECRET_KEY
    if (apiKey) {
      // Stripe docs: always pin the API version to avoid unexpected breaking changes.
      // Update the version intentionally after reviewing Stripe's changelog.
      this.stripe = new Stripe(apiKey, { apiVersion: '2026-03-25.dahlia' })
    } else {
      this.logger.warn('[Stripe] STRIPE_SECRET_KEY not set — payment features disabled (dev mode)')
    }
  }

  // ─── SetupIntent — guardar tarjeta en check-in ───────────────────────────
  //
  // Stripe best practice: usar SetupIntent con usage='off_session' para guardar
  // el método de pago del huésped en el momento del check-in (cliente presente).
  // La autenticación SCA/3DS ocurre aquí, con el titular presente.
  // El cargo del no-show se hace después (off_session) sin fricción adicional.
  //
  // Docs: https://stripe.com/docs/payments/save-and-reuse
  async createSetupIntent(stayId: string): Promise<{ clientSecret: string }> {
    this.assertStripeConfigured()

    const stay = await this.prisma.guestStay.findUniqueOrThrow({ where: { id: stayId } })

    // Crear o recuperar el Customer de Stripe para este huésped.
    // Idempotente: si el Customer ya existe se reutiliza.
    let customerId = stay.stripeCustomerId
    if (!customerId) {
      const customer = await this.stripe!.customers.create({
        name: stay.guestName,
        email: stay.guestEmail ?? undefined,
        phone: stay.guestPhone ?? undefined,
        metadata: { stayId, propertyId: stay.propertyId },
      })
      customerId = customer.id
      await this.prisma.guestStay.update({
        where: { id: stayId },
        data: { stripeCustomerId: customerId },
      })
    }

    const setupIntent = await this.stripe!.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      // automatic_payment_methods acepta tarjeta, Apple Pay, Google Pay, etc.
      // sin necesidad de configurar cada método manualmente.
      automatic_payment_methods: { enabled: true },
      metadata: { stayId },
    })

    if (!setupIntent.client_secret) {
      throw new ConflictException('No se pudo crear el SetupIntent')
    }
    return { clientSecret: setupIntent.client_secret }
  }

  // ─── Webhook: SetupIntent succeeded — guardar PaymentMethod ──────────────
  async onSetupIntentSucceeded(setupIntentId: string): Promise<void> {
    const si = await this.stripe!.setupIntents.retrieve(setupIntentId)
    const stayId = si.metadata?.stayId
    if (!stayId || !si.payment_method) return

    await this.prisma.guestStay.update({
      where: { id: stayId },
      data: { stripePaymentMethodId: si.payment_method as string },
    })
    this.logger.log(`[Stripe] PaymentMethod saved for stay=${stayId}`)
  }

  // ─── Cargo de no-show (off-session) ──────────────────────────────────────
  //
  // Stripe best practice para cargos sin presencia del titular:
  //   - PaymentIntent con confirm=true + off_session=true
  //   - Idempotency key determinista por stayId para prevenir doble cobro en retries
  //   - El estado final llega por webhook (payment_intent.succeeded/failed)
  //   - NO usar la Charges API legacy (deprecada desde 2019)
  //
  // Docs: https://stripe.com/docs/payments/save-and-reuse#charge-later
  async chargeNoShow(stayId: string, actorId: string): Promise<void> {
    this.assertStripeConfigured()

    const stay = await this.prisma.guestStay.findUniqueOrThrow({ where: { id: stayId } })

    if (!stay.noShowAt) throw new BadRequestException('La estadía no está marcada como no-show')
    if (stay.noShowChargeStatus === 'CHARGED') throw new ConflictException('El cargo ya fue procesado')
    if (!stay.stripeCustomerId || !stay.stripePaymentMethodId) {
      throw new BadRequestException('No hay tarjeta guardada para esta estadía')
    }
    if (!stay.noShowFeeAmount || stay.noShowFeeAmount.isZero()) {
      throw new BadRequestException('El monto del cargo de no-show no está configurado')
    }

    // Stripe trabaja en centavos (enteros sin decimales)
    const amountCents = stay.noShowFeeAmount.mul(100).toNumber()
    const currency = (stay.noShowFeeCurrency ?? 'MXN').toLowerCase()

    // Idempotency key estable por operación lógica — Stripe retorna el mismo
    // PaymentIntent si se envía la misma key dentro de 24h.
    const idempotencyKey = `noshow_charge_${stayId}`

    const pi = await this.stripe!.paymentIntents.create(
      {
        amount: amountCents,
        currency,
        customer: stay.stripeCustomerId,
        payment_method: stay.stripePaymentMethodId,
        confirm: true,
        off_session: true,
        capture_method: 'automatic',
        description: `No-show charge — stay ${stayId}`,
        metadata: { stayId, actorId, propertyId: stay.propertyId },
      },
      { idempotencyKey },
    )

    // El estado provisional se actualiza aquí; el definitivo llega por webhook.
    // Si el PI ya fue 'succeeded' síncronamente (tarjetas sin 3DS), se marca
    // como CHARGED inmediatamente. De lo contrario queda PENDING hasta webhook.
    await this.prisma.guestStay.update({
      where: { id: stayId },
      data: {
        stripePaymentIntentId: pi.id,
        noShowChargeStatus: pi.status === 'succeeded' ? 'CHARGED' : 'PENDING',
      },
    })

    this.logger.log(
      `[Stripe] PaymentIntent created pi=${pi.id} stay=${stayId} status=${pi.status}`,
    )
  }

  // ─── Waive (perdonar cargo) — acción del supervisor ───────────────────────
  async waiveNoShowCharge(stayId: string, actorId: string, reason: string): Promise<void> {
    const stay = await this.prisma.guestStay.findUniqueOrThrow({ where: { id: stayId } })

    if (stay.noShowChargeStatus === 'CHARGED') {
      throw new ConflictException(
        'El cargo ya fue procesado. Para reembolsar, usa el Stripe Dashboard directamente.',
      )
    }

    await this.prisma.guestStay.update({
      where: { id: stayId },
      data: { noShowChargeStatus: 'WAIVED' },
    })

    this.logger.log(`[Stripe] Charge waived stay=${stayId} actor=${actorId} reason="${reason}"`)
  }

  // ─── Webhook handler ──────────────────────────────────────────────────────
  //
  // Stripe firma todos los webhooks con STRIPE_WEBHOOK_SECRET.
  // CRÍTICO: verificar la firma ANTES de procesar — previene ataques de replay
  // y solicitudes falsas. constructEvent() lanza si la firma no es válida.
  //
  // Docs: https://stripe.com/docs/webhooks/signatures
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    if (!this.stripe) return  // fail-soft si Stripe no configurado

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
    if (!webhookSecret) {
      this.logger.warn('[Stripe] STRIPE_WEBHOOK_SECRET not set — skipping webhook verification')
      return
    }

    // constructEvent returns a typed Stripe.Event but namespace access differs by
    // Stripe SDK version. We use `any` for the event object to avoid version-specific
    // type gymnastics — the HMAC signature already validates the payload is authentic.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let event: any
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`[Stripe] Webhook signature verification failed: ${msg}`)
      throw new BadRequestException('Stripe webhook signature inválida')
    }

    this.logger.debug(`[Stripe] Webhook received type=${event.type}`)

    switch (event.type as string) {
      case 'setup_intent.succeeded': {
        const si = event.data.object as { id: string }
        await this.onSetupIntentSucceeded(si.id)
        break
      }

      case 'payment_intent.succeeded': {
        const pi = event.data.object as { id: string; metadata: Record<string, string> }
        const stayId = pi.metadata?.stayId
        if (stayId) {
          await this.prisma.guestStay.update({
            where: { id: stayId },
            data: { noShowChargeStatus: 'CHARGED', stripePaymentIntentId: pi.id },
          })
          this.logger.log(`[Stripe] Charge confirmed stay=${stayId} pi=${pi.id}`)
        }
        break
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object as {
          id: string
          metadata: Record<string, string>
          last_payment_error?: { message?: string }
        }
        const stayId = pi.metadata?.stayId
        const failureMsg = pi.last_payment_error?.message ?? 'desconocido'
        if (stayId) {
          await this.prisma.guestStay.update({
            where: { id: stayId },
            data: { noShowChargeStatus: 'FAILED' },
          })
          this.logger.warn(`[Stripe] Charge failed stay=${stayId} reason="${failureMsg}"`)
        }
        break
      }

      default:
        // Ignorar eventos no relevantes — Stripe puede enviar muchos tipos
        break
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private assertStripeConfigured(): void {
    if (!this.stripe) {
      throw new BadRequestException(
        'Stripe no está configurado. Agrega STRIPE_SECRET_KEY al .env',
      )
    }
  }
}
