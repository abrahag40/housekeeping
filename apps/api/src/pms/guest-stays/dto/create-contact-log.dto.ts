import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'
import { ContactChannel } from '@prisma/client'

export class CreateContactLogDto {
  @IsEnum(ContactChannel)
  channel: ContactChannel

  @IsOptional()
  @IsString()
  @MaxLength(160)
  messagePreview?: string
}
