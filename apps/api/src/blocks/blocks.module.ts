import { Module } from '@nestjs/common'
import { PrismaModule } from '../prisma/prisma.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { TenantContextService } from '../common/tenant-context.service'
import { BlocksController } from './blocks.controller'
import { BlocksService } from './blocks.service'
import { BlocksScheduler } from './blocks.scheduler'

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [BlocksController],
  providers: [BlocksService, BlocksScheduler, TenantContextService],
  exports: [BlocksService],
})
export class BlocksModule {}
