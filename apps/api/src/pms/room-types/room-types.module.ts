import { Module } from '@nestjs/common'
import { RoomTypesController } from './room-types.controller'
import { TenantContextService } from '../../common/tenant-context.service'

@Module({
  controllers: [RoomTypesController],
  providers: [TenantContextService],
})
export class RoomTypesModule {}
