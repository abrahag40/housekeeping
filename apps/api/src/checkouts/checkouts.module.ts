import { Module } from '@nestjs/common'
import { CheckoutsController } from './checkouts.controller'
import { CheckoutsService } from './checkouts.service'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [NotificationsModule],
  controllers: [CheckoutsController],
  providers: [CheckoutsService],
  exports: [CheckoutsService],
})
export class CheckoutsModule {}
