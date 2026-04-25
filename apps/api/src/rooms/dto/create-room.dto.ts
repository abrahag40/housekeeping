import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator'
import { RoomCategory } from '@zenix/shared'

export class CreateRoomDto {
  @IsString()
  @MinLength(1)
  number: string

  @IsEnum(RoomCategory)
  category: RoomCategory

  @IsInt()
  @Min(1)
  capacity: number

  @IsOptional()
  @IsInt()
  floor?: number

}
