import { IsString } from 'class-validator'

export class VoidPaymentDto {
  @IsString()
  voidReason: string
}
