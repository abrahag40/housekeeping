import { IsUUID, IsDateString } from 'class-validator'

export class ExtendSameRoomDto {
  @IsUUID()
  journeyId: string

  @IsDateString()
  newCheckOut: string

  @IsUUID()
  actorId: string
}

export class ExtendNewRoomDto {
  @IsUUID()
  journeyId: string

  @IsUUID()
  newRoomId: string

  @IsDateString()
  newCheckOut: string

  @IsUUID()
  actorId: string
}

export class RoomMoveDto {
  @IsUUID()
  journeyId: string

  @IsUUID()
  newRoomId: string

  @IsDateString()
  effectiveDate: string

  @IsUUID()
  actorId: string
}
