import { IsString, MinLength } from 'class-validator'

export class CreatePropertyDto {
  @IsString()
  @MinLength(2)
  name: string
}
