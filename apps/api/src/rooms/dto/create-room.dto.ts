import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'
import { RoomType } from '@housekeeping/shared'

export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  number: string

  @IsEnum(RoomType)
  type: RoomType

  @IsInt()
  @Min(1)
  capacity: number

  @IsOptional()
  @IsInt()
  floor?: number

  @IsOptional()
  @IsString()
  cloudbedsRoomId?: string
}
