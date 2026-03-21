import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common'
import { IsString } from 'class-validator'
import { Request, Response } from 'express'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import { JwtPayload } from '@housekeeping/shared'
import { NotificationsService } from './notifications.service'
import { PushService } from './push.service'

class RegisterTokenDto {
  @IsString()
  token: string

  @IsString()
  platform: string
}

@Controller()
export class NotificationsController {
  constructor(
    private notificationsService: NotificationsService,
    private pushService: PushService,
  ) {}

  /**
   * SSE endpoint — clients subscribe to real-time task/room events
   */
  @Get('events')
  sse(@CurrentUser() actor: JwtPayload, @Res() res: Response, @Req() req: Request) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    // Send a ping every 30s to keep the connection alive
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(heartbeat)
      }
    }, 30_000)

    req.on('close', () => clearInterval(heartbeat))

    this.notificationsService.addClient(actor.propertyId, res)
  }

  /**
   * Register / refresh an Expo push token for the authenticated housekeeper
   */
  @Post('notifications/token')
  registerToken(@Body() dto: RegisterTokenDto, @CurrentUser() actor: JwtPayload) {
    return this.pushService.registerToken(actor.sub, dto.token, dto.platform)
  }
}
