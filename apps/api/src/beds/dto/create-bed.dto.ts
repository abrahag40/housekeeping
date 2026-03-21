import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator'
import { BedStatus } from '@housekeeping/shared'

export class CreateBedDto {
  @IsString()
  @MinLength(1)
  label: string

  @IsOptional()
  @IsEnum(BedStatus)
  status?: BedStatus
}
