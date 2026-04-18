import {
  IsString,
  IsEmail,
  IsOptional,
  IsNumber,
  IsInt,
  IsDateString,
  Min,
} from 'class-validator'
import { Transform } from 'class-transformer'

export class CreateGuestStayDto {
  @IsString()
  propertyId: string

  @IsString()
  roomId: string

  @IsString()
  firstName: string

  @IsString()
  lastName: string

  @IsEmail()
  @IsOptional()
  guestEmail?: string

  @IsString()
  @IsOptional()
  guestPhone?: string

  @IsString()
  @IsOptional()
  nationality?: string

  @IsString()
  @IsOptional()
  documentType?: string

  @IsString()
  @IsOptional()
  documentNumber?: string

  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  adults: number

  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(0)
  children: number

  @IsDateString()
  checkIn: string

  @IsDateString()
  checkOut: string

  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  ratePerNight: number

  @IsString()
  currency: string

  @IsString()
  source: string

  @IsString()
  @IsOptional()
  otaName?: string

  @Transform(({ value }) => parseFloat(value))
  @IsNumber()
  @Min(0)
  amountPaid: number

  @IsString()
  @IsOptional()
  paymentMethod?: string

  @IsString()
  @IsOptional()
  notes?: string
}
