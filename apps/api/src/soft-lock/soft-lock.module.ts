import { Module } from '@nestjs/common'
import { SoftLockService } from './soft-lock.service'
import { SoftLockController } from './soft-lock.controller'

@Module({
  controllers: [SoftLockController],
  providers: [SoftLockService],
  exports: [SoftLockService],
})
export class SoftLockModule {}
