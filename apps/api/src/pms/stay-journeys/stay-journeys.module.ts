import { Module } from '@nestjs/common'
import { StayJourneyService } from './stay-journeys.service'
import { StayJourneyController } from './stay-journeys.controller'

@Module({
  controllers: [StayJourneyController],
  providers: [StayJourneyService],
  exports: [StayJourneyService],
})
export class StayJourneysModule {}
