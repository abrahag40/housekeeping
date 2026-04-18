import { Module } from '@nestjs/common'
import { GuestStaysController } from './guest-stays.controller'
import { GuestStaysService } from './guest-stays.service'
import { TenantContextService } from '../../common/tenant-context.service'

@Module({
  controllers: [GuestStaysController],
  providers: [GuestStaysService, TenantContextService],
  exports: [GuestStaysService],
})
export class GuestStaysModule {}
