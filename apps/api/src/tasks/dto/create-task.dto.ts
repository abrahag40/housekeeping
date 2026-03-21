import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'
import { Capability, Priority, TaskType } from '@housekeeping/shared'

export class CreateTaskDto {
  @IsUUID()
  bedId: string

  @IsOptional()
  @IsUUID()
  assignedToId?: string

  @IsOptional()
  @IsEnum(TaskType)
  taskType?: TaskType

  @IsOptional()
  @IsEnum(Capability)
  requiredCapability?: Capability

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority
}

export class AssignTaskDto {
  @IsUUID()
  assignedToId: string
}

export class QueryTaskDto {
  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsUUID()
  assignedToId?: string

  @IsOptional()
  @IsUUID()
  bedId?: string

  @IsOptional()
  @IsUUID()
  roomId?: string
}
