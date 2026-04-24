import { Module } from '@nestjs/common'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'
import { PushService } from './push.service'
import { WhatsAppService } from './whatsapp.service'

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PushService, WhatsAppService],
  exports: [NotificationsService, PushService, WhatsAppService],
})
export class NotificationsModule {}
