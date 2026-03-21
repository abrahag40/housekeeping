import { IsOptional, IsString, Matches } from 'class-validator'

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'defaultCheckoutTime must be HH:mm' })
  defaultCheckoutTime?: string

  @IsOptional()
  @IsString()
  timezone?: string

  @IsOptional()
  @IsString()
  pmsMode?: string
}
