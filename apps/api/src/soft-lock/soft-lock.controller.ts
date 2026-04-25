import { Controller, Post, Delete, Patch, Param, Body, HttpCode } from '@nestjs/common'
import { IsString, IsNotEmpty } from 'class-validator'
import { SoftLockService } from './soft-lock.service'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { JwtPayload } from '@zenix/shared'

class AcquireLockDto {
  @IsString()
  @IsNotEmpty()
  propertyId: string

  @IsString()
  @IsNotEmpty()
  userName: string
}

@Controller('v1/rooms/:roomId/soft-lock')
export class SoftLockController {
  constructor(private readonly softLock: SoftLockService) {}

  @Post('acquire')
  @HttpCode(200)
  acquire(
    @Param('roomId') roomId: string,
    @Body() dto: AcquireLockDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const acquired = this.softLock.acquire(roomId, user.sub, dto.userName, dto.propertyId)
    if (!acquired) {
      const status = this.softLock.getStatus(roomId, user.sub)
      return { acquired: false, lockedByName: status.lockedByName }
    }
    return { acquired: true }
  }

  @Delete()
  @HttpCode(204)
  release(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    this.softLock.release(roomId, user.sub)
  }

  @Patch('heartbeat')
  @HttpCode(204)
  heartbeat(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    this.softLock.heartbeat(roomId, user.sub)
  }
}
