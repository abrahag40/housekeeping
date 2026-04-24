import { Module } from '@nestjs/common'
import { PaymentsService } from './payments.service'
import { PaymentsController, StripeWebhookController } from './payments.controller'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
