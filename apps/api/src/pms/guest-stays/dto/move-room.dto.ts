import { IsString, IsEnum, IsNumber, IsOptional } from 'class-validator'

export class MoveRoomDto {
  @IsString()
  newRoomId: string

  @IsEnum(['charge', 'complimentary', 'discount'])
  pricingDecision: 'charge' | 'complimentary' | 'discount'

  @IsNumber()
  @IsOptional()
  discountPercent?: number
}
