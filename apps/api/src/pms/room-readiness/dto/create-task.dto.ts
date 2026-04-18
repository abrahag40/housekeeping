import { IsString, IsOptional, IsDateString } from 'class-validator'

export class CreateReadinessTaskDto {
  @IsString()
  roomId: string

  @IsString()
  propertyId: string

  @IsString()
  @IsOptional()
  triggeredBy?: string

  @IsDateString()
  @IsOptional()
  dueBy?: string
}
