import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { PaymentMethod } from '@zenix/shared'

export class RegisterPaymentDto {
  @IsEnum(PaymentMethod)
  method: PaymentMethod

  @IsNumber()
  @Min(0)
  amount: number

  @IsString()
  @IsOptional()
  reference?: string

  @IsString()
  @IsOptional()
  approvedById?: string

  @IsString()
  @IsOptional()
  approvalReason?: string
}
