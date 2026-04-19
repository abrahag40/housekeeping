import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { HousekeepingRole, JwtPayload } from '@housekeeping/shared'

/**
 * Allows SUPERVISOR users to switch the active property context at runtime
 * by sending the `X-Property-Id` request header.
 *
 * The interceptor runs after JwtAuthGuard (req.user is already populated),
 * mutates req.user.propertyId in-place so that every downstream controller
 * calling actor.propertyId receives the scoped value transparently — no
 * controller changes required.
 *
 * Only SUPERVISOR role can override; other roles ignore the header.
 */
@Injectable()
export class PropertyScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest()
    const overrideId = req.headers['x-property-id'] as string | undefined
    const user: JwtPayload | undefined = req.user

    if (overrideId && user && user.role === HousekeepingRole.SUPERVISOR) {
      req.user = { ...user, propertyId: overrideId }
    }

    return next.handle()
  }
}
