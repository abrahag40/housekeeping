import { Type } from 'class-transformer'
import {
  IsArray, IsBoolean, IsEnum, IsNumber, IsOptional,
  IsString, Min, ValidateNested,
} from 'class-validator'
import { KeyDeliveryType, PaymentMethod } from '@zenix/shared'

export class PaymentEntryDto {
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

export class ConfirmCheckinDto {
  @IsBoolean()
  documentVerified: boolean

  @IsString()
  @IsOptional()
  documentType?: string

  @IsString()
  @IsOptional()
  documentNumber?: string

  @IsString()
  @IsOptional()
  arrivalNotes?: string

  @IsEnum(KeyDeliveryType)
  @IsOptional()
  keyType?: KeyDeliveryType

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentEntryDto)
  payments: PaymentEntryDto[]

  @IsString()
  @IsOptional()
  managerApprovalCode?: string

  @IsString()
  @IsOptional()
  managerApprovalReason?: string
}
