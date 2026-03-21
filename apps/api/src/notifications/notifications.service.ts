import { Injectable, Logger } from '@nestjs/common'
import { Response } from 'express'
import { SseEvent, SseEventType } from '@housekeeping/shared'

interface SseClient {
  propertyId: string
  res: Response
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)
  private readonly clients = new Set<SseClient>()

  addClient(propertyId: string, res: Response) {
    const client: SseClient = { propertyId, res }
    this.clients.add(client)

    res.on('close', () => {
      this.clients.delete(client)
      this.logger.debug(`SSE client disconnected (property: ${propertyId}). Total: ${this.clients.size}`)
    })

    this.logger.debug(`SSE client connected (property: ${propertyId}). Total: ${this.clients.size}`)
  }

  emit<T>(propertyId: string, type: SseEventType, data: T) {
    const event: SseEvent<T> = { type, data }
    const payload = `data: ${JSON.stringify(event)}\n\n`

    for (const client of this.clients) {
      if (client.propertyId === propertyId) {
        try {
          client.res.write(`event: ${type}\n`)
          client.res.write(payload)
        } catch {
          this.clients.delete(client)
        }
      }
    }
  }
}
