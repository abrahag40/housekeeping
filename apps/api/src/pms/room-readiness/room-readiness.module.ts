import { Module } from '@nestjs/common'
import { RoomReadinessService } from './room-readiness.service'
import { RoomReadinessController } from './room-readiness.controller'
import { TenantContextService } from '../../common/tenant-context.service'

@Module({
  controllers: [RoomReadinessController],
  providers: [RoomReadinessService, TenantContextService],
  exports: [RoomReadinessService],
})
export class RoomReadinessModule {}
