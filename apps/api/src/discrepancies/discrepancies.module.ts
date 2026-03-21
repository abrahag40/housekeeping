import { Module } from '@nestjs/common'
import { DiscrepanciesController } from './discrepancies.controller'
import { DiscrepanciesService } from './discrepancies.service'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [NotificationsModule],
  controllers: [DiscrepanciesController],
  providers: [DiscrepanciesService],
})
export class DiscrepanciesModule {}
