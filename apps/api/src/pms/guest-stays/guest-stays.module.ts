import { Module } from '@nestjs/common'
import { GuestStaysController } from './guest-stays.controller'
import { GuestStaysService } from './guest-stays.service'
import { NightAuditScheduler } from './night-audit.scheduler'
import { TenantContextService } from '../../common/tenant-context.service'

@Module({
  controllers: [GuestStaysController],
  providers: [GuestStaysService, NightAuditScheduler, TenantContextService],
  exports: [GuestStaysService],
})
export class GuestStaysModule {}
