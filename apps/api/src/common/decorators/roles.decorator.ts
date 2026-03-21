import { SetMetadata } from '@nestjs/common'
import { HousekeepingRole } from '@housekeeping/shared'

export const ROLES_KEY = 'roles'
export const Roles = (...roles: HousekeepingRole[]) => SetMetadata(ROLES_KEY, roles)
