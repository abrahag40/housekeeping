import { IsString, MinLength } from 'class-validator'

export class WaiveNoShowDto {
  @IsString()
  @MinLength(5)
  reason: string
}
