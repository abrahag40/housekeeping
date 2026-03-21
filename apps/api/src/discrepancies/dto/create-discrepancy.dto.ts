import { IsEnum, IsNotEmpty, IsString, IsUUID } from 'class-validator'
import { DiscrepancyType } from '@housekeeping/shared'

export class CreateDiscrepancyDto {
  @IsUUID()
  bedId: string

  @IsEnum(DiscrepancyType)
  type: DiscrepancyType

  @IsString()
  @IsNotEmpty()
  description: string
}
