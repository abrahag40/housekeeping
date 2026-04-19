import { IsDateString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'
import { BlockReason, BlockSemantic } from '@zenix/shared'

export class CreateBlockDto {
  @IsOptional()
  @IsUUID()
  roomId?: string

  @IsOptional()
  @IsUUID()
  bedId?: string

  @IsEnum(BlockSemantic)
  semantic: BlockSemantic

  @IsEnum(BlockReason)
  reason: BlockReason

  @IsOptional()
  @IsString()
  notes?: string

  @IsOptional()
  @IsString()
  internalNotes?: string

  /** ISO date string (date only). Defaults to today if omitted. */
  @IsOptional()
  @IsDateString()
  startDate?: string

  /** ISO date string (date only). Null = indefinido. */
  @IsOptional()
  @IsDateString()
  endDate?: string
}
