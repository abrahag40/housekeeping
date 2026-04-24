import { Injectable, Logger } from '@nestjs/common'

/**
 * WhatsAppService — stub para integración con 360Dialog (WhatsApp Business API).
 *
 * Recomendación de proveedor: 360Dialog (costo fijo ~$50/mes por número,
 * sin markup por mensaje, aprobado por Meta para LATAM).
 *
 * Configuración requerida (env vars):
 *   WHATSAPP_API_KEY     → D360 API key
 *   WHATSAPP_NAMESPACE   → namespace del template aprobado en Meta
 *
 * Fail-soft: si la key no está configurada, loguea y retorna sin lanzar.
 * Esto garantiza que un fallo de red a 360Dialog nunca rompa el flujo operacional.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name)

  /**
   * Envía un template de WhatsApp aprobado por Meta.
   * fire-and-forget: el caller NO debe await dentro de una transacción crítica.
   */
  async sendTemplate(opts: {
    to: string
    templateName: string
    languageCode?: string
    components?: Array<{ type: string; parameters: Array<{ type: string; text: string }> }>
  }): Promise<void> {
    const apiKey = process.env.WHATSAPP_API_KEY
    if (!apiKey) {
      this.logger.warn(`[STUB] WhatsApp sendTemplate → ${opts.to} (${opts.templateName}) — WHATSAPP_API_KEY no configurada`)
      return
    }

    try {
      const body = {
        messaging_product: 'whatsapp',
        to: opts.to,
        type: 'template',
        template: {
          name: opts.templateName,
          language: { code: opts.languageCode ?? 'es_MX' },
          components: opts.components ?? [],
        },
      }

      const res = await fetch('https://waba.360dialog.io/v1/messages', {
        method: 'POST',
        headers: {
          'D360-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        this.logger.error(`[WhatsApp] Error ${res.status} sending to ${opts.to}: ${await res.text()}`)
      } else {
        this.logger.log(`[WhatsApp] Template "${opts.templateName}" enviado a ${opts.to}`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`[WhatsApp] Network error sending to ${opts.to}: ${msg}`)
    }
  }

  /**
   * Alerta de potencial no-show al huésped: "¿Sigues en camino?".
   * Template debe estar pre-aprobado en Meta Business Manager.
   */
  async sendPotentialNoShowAlert(opts: {
    guestPhone: string
    guestName: string
    propertyName: string
    roomNumber: string
  }): Promise<void> {
    await this.sendTemplate({
      to: opts.guestPhone.replace(/\D/g, ''),
      templateName: 'potential_noshow_alert',
      languageCode: 'es_MX',
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: opts.guestName },
            { type: 'text', text: opts.propertyName },
            { type: 'text', text: opts.roomNumber },
          ],
        },
      ],
    })
  }
}
