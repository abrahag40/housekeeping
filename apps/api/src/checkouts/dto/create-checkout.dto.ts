import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator'
import { Type } from 'class-transformer'

export class CreateCheckoutDto {
  @IsUUID()
  roomId: string

  @IsOptional()
  @IsString()
  guestName?: string

  @IsOptional()
  @IsDateString()
  actualCheckoutAt?: string

  @IsOptional()
  @IsBoolean()
  isEarlyCheckout?: boolean

  @IsOptional()
  @IsBoolean()
  hasSameDayCheckIn?: boolean

  @IsOptional()
  @IsString()
  notes?: string
}

export class BatchCheckoutItemDto {
  @IsString()
  @IsNotEmpty()
  bedId: string

  @IsBoolean()
  hasSameDayCheckIn: boolean

  @IsOptional()
  @IsString()
  notes?: string
}

export class BatchCheckoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchCheckoutItemDto)
  items: BatchCheckoutItemDto[]

  @IsOptional()
  @IsDateString()
  checkoutDate?: string
}
