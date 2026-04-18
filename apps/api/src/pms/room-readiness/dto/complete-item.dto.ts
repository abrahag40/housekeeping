import { IsString, IsOptional, IsEnum } from 'class-validator'

export class CompleteItemDto {
  @IsString()
  itemId: string

  @IsEnum(['DONE', 'ISSUE_FOUND', 'SKIPPED'])
  status: 'DONE' | 'ISSUE_FOUND' | 'SKIPPED'

  @IsString()
  @IsOptional()
  photoUrl?: string

  @IsString()
  @IsOptional()
  notes?: string
}
