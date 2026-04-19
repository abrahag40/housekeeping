import { IsOptional, IsString } from 'class-validator'

export class ApproveBlockDto {
  @IsOptional()
  @IsString()
  approvalNotes?: string
}

export class RejectBlockDto {
  @IsString()
  approvalNotes: string
}

export class CancelBlockDto {
  @IsString()
  reason: string
}

export class ExtendBlockDto {
  @IsString()
  endDate: string // ISO date string
}
