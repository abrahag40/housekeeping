import { Module } from '@nestjs/common'
import { NotificationCenterService } from './notification-center.service'
import { NotificationCenterController } from './notification-center.controller'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [NotificationsModule],
  providers: [NotificationCenterService],
  controllers: [NotificationCenterController],
  exports: [NotificationCenterService],
})
export class NotificationCenterModule {}
