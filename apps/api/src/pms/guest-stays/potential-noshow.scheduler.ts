/**
 * PotentialNoShowScheduler — Detección temprana de posibles no-shows.
 *
 * Corre cada 30 minutos (igual que NightAuditScheduler). Para cada propiedad:
 *   1. Obtiene timezone de PropertySettings y calcula hora local.
 *   2. Si hora local >= potentialNoShowWarningHour (default 20 = 8 PM) Y la fecha
 *      local no coincide con potentialNoShowProcessedDate → procesa.
 *   3. Busca estadías cuyo checkinAt ya pasó, sin checkout real y sin noShowAt
 *      (no-shows confirmados). Estas son las "potenciales".
 *   4. Emite SSE arrival:at_risk por cada una → frontend anima el bloque.
 *   5. Si enableAutoOutreach = true → envía WhatsApp + email al huésped y
 *      registra el intento en GuestContactLog.
 *   6. Actualiza potentialNoShowProcessedDate para idempotencia.
 *
 * Diferencia con NightAuditScheduler:
 *   - Este NO marca el no-show (eso lo hace NightAuditScheduler a las 2 AM).
 *   - Este corre ANTES (8 PM default) para avisar al equipo y contactar al huésped.
 *   - Propósito: dar oportunidad de resolver antes del corte nocturno.
 */
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsService } from '../../notifications/notifications.service'
import { WhatsAppService } from '../../notifications/whatsapp.service'
import { EmailService } from '../../common/email/email.service'

function toLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function toLocalHour(date: Date, timezone: string): number {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).format(date)
  return Number(formatted) % 24
}

@Injectable()
export class PotentialNoShowScheduler {
  private readonly logger = new Logger(PotentialNoShowScheduler.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly whatsapp: WhatsAppService,
    private readonly email: EmailService,
  ) {}

  @Cron('0,30 * * * *')
  async detectPotentialNoShows() {
    const now = new Date()

    const allSettings = await this.prisma.propertySettings.findMany({
      select: {
        propertyId:                      true,
        timezone:                        true,
        potentialNoShowWarningHour:      true,
        potentialNoShowProcessedDate:    true,
        enableAutoOutreach:              true,
        property: {
          select: {
            organizationId: true,
            isActive:       true,
            name:           true,
          },
        },
      },
    })

    for (const settings of allSettings) {
      if (!settings.property?.isActive) continue

      const tz        = settings.timezone || 'UTC'
      const localHour = toLocalHour(now, tz)
      const localDate = toLocalDate(now, tz)

      if (localHour < settings.potentialNoShowWarningHour) continue

      const lastProcessed = settings.potentialNoShowProcessedDate
        ? toLocalDate(settings.potentialNoShowProcessedDate, tz)
        : null
      if (lastProcessed === localDate) continue

      const dayStart = new Date(`${localDate}T00:00:00.000Z`)
      const dayEnd   = new Date(`${localDate}T23:59:59.999Z`)

      // Huéspedes que debían llegar hoy, no han hecho checkout real, y aún no son no-show
      const potentialNoShows = await this.prisma.guestStay.findMany({
        where: {
          organizationId: settings.property.organizationId ?? undefined,
          propertyId:     settings.propertyId,
          deletedAt:      null,
          actualCheckout: null,
          noShowAt:       null,
          checkinAt: { gte: dayStart, lte: dayEnd },
        },
        include: {
          room: { select: { number: true } },
        },
      })

      if (potentialNoShows.length > 0) {
        this.logger.log(
          `[PotentialNoShow] property=${settings.propertyId} tz=${tz} ` +
          `localDate=${localDate} detected=${potentialNoShows.length}`,
        )
      }

      for (const stay of potentialNoShows) {
        // Emitir SSE para animación visual en el calendario
        this.notifications.emit(settings.propertyId, 'arrival:at_risk', {
          stayId:    stay.id,
          roomId:    stay.roomId,
          guestName: stay.guestName,
        })

        if (settings.enableAutoOutreach) {
          const propertyName = settings.property.name ?? 'el hotel'
          const roomNumber   = stay.room?.number ?? ''

          // WhatsApp — fire-and-forget, NO await en el loop crítico
          if (stay.guestPhone) {
            this.whatsapp.sendPotentialNoShowAlert({
              guestPhone:   stay.guestPhone,
              guestName:    stay.guestName,
              propertyName,
              roomNumber,
            }).catch((err: Error) =>
              this.logger.error(`[PotentialNoShow] WhatsApp error stay=${stay.id}: ${err.message}`)
            )

            this.prisma.guestContactLog.create({
              data: {
                stayId:         stay.id,
                channel:        'WHATSAPP',
                sentById:       null,
                messagePreview: `Alerta automática de potencial no-show — ha. ${roomNumber}`,
              },
            }).catch(() => {/* log best-effort */})
          }

          // Email — fire-and-forget
          if (stay.guestEmail) {
            this.email.sendPotentialNoShowAlert({
              to:          stay.guestEmail,
              guestName:   stay.guestName,
              roomNumber,
              propertyName,
              checkInDate: stay.checkinAt,
            }).catch((err: Error) =>
              this.logger.error(`[PotentialNoShow] Email error stay=${stay.id}: ${err.message}`)
            )

            this.prisma.guestContactLog.create({
              data: {
                stayId:         stay.id,
                channel:        'EMAIL',
                sentById:       null,
                messagePreview: `Alerta automática de potencial no-show — ha. ${roomNumber}`,
              },
            }).catch(() => {/* log best-effort */})
          }
        }
      }

      // Marcar como procesado (aunque potentialNoShows.length === 0)
      await this.prisma.propertySettings.update({
        where: { propertyId: settings.propertyId },
        data:  { potentialNoShowProcessedDate: new Date(`${localDate}T00:00:00.000Z`) },
      })
    }
  }
}
