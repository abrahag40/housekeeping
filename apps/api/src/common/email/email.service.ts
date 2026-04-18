import { Injectable, Logger } from '@nestjs/common'
import { MailerService } from '@nestjs-modules/mailer'

export interface CheckinConfirmationData {
  guestEmail:    string
  guestName:     string
  propertyName:  string
  roomNumber:    string
  checkIn:       Date
  checkOut:      Date
  nights:        number
  totalAmount:   number
  currency:      string
  pmsId:         string
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)

  constructor(private readonly mailer: MailerService) {}

  async sendCheckinConfirmation(data: CheckinConfirmationData): Promise<void> {
    const checkInFmt  = data.checkIn.toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })
    const checkOutFmt = data.checkOut.toLocaleDateString('es-MX', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })

    try {
      await this.mailer.sendMail({
        to:      data.guestEmail,
        subject: `Confirmación de check-in — ${data.propertyName}`,
        html: `
          <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
            <h2 style="color:#1e293b">¡Bienvenido, ${data.guestName}!</h2>
            <p style="color:#475569">Tu reserva ha sido confirmada.</p>
            <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0">
              <p><strong>Propiedad:</strong> ${data.propertyName}</p>
              <p><strong>Habitación:</strong> ${data.roomNumber}</p>
              <p><strong>Check-in:</strong> ${checkInFmt} a las 15:00</p>
              <p><strong>Check-out:</strong> ${checkOutFmt} a las 12:00</p>
              <p><strong>Noches:</strong> ${data.nights}</p>
              <p><strong>Total:</strong> ${data.currency} ${data.totalAmount.toLocaleString()}</p>
              <p style="color:#94a3b8;font-size:12px">Reserva ID: ${data.pmsId}</p>
            </div>
            <p style="color:#94a3b8;font-size:12px">
              Hospitalidad OS · powered by ZaharDev
            </p>
          </div>
        `,
      })
      this.logger.log(`Confirmation sent to ${data.guestEmail}`)
    } catch (err) {
      // No lanzar — el check-in no debe fallar si el email falla
      this.logger.error(`Failed to send confirmation: ${err}`)
    }
  }

  async sendHousekeepingAlert(to: string, roomNumber: string): Promise<void> {
    // Housekeeping puede llamar esto cuando una habitación queda lista
  }

  async sendMaintenanceAlert(to: string, ticketId: string): Promise<void> {
    // Mantenimiento puede llamar esto cuando un ticket se escala
  }
}
