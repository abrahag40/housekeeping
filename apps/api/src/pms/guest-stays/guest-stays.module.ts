import { Module } from '@nestjs/common'
import { GuestStaysController } from './guest-stays.controller'
import { GuestStaysService } from './guest-stays.service'
import { NightAuditScheduler } from './night-audit.scheduler'
import { PotentialNoShowScheduler } from './potential-noshow.scheduler'
import { TenantContextService } from '../../common/tenant-context.service'
import { StayJourneysModule } from '../stay-journeys/stay-journeys.module'
import { NotificationsModule } from '../../notifications/notifications.module'
import { ChannexModule } from '../../integrations/channex/channex.module'
import { NotificationCenterModule } from '../../notification-center/notification-center.module'

@Module({
  imports: [StayJourneysModule, NotificationsModule, ChannexModule, NotificationCenterModule],
  controllers: [GuestStaysController],
  providers: [GuestStaysService, NightAuditScheduler, PotentialNoShowScheduler, TenantContextService],
  exports: [GuestStaysService],
})
export class GuestStaysModule {}
