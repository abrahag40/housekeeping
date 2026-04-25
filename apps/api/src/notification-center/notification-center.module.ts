import { Module } from '@nestjs/common'
import { NotificationCenterService } from './notification-center.service'
import { NotificationCenterController } from './notification-center.controller'
import { NotificationsModule } from '../notifications/notifications.module'
import { TenantContextService } from '../common/tenant-context.service'

@Module({
  imports: [NotificationsModule],
  providers: [NotificationCenterService, TenantContextService],
  controllers: [NotificationCenterController],
  exports: [NotificationCenterService],
})
export class NotificationCenterModule {}
