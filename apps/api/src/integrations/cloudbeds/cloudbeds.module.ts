import { Module } from '@nestjs/common'
import { CloudbedsController } from './cloudbeds.controller'
import { CloudbedsService } from './cloudbeds.service'
import { CheckoutsModule } from '../../checkouts/checkouts.module'

@Module({
  imports: [CheckoutsModule],
  controllers: [CloudbedsController],
  providers: [CloudbedsService],
})
export class CloudbedsModule {}
