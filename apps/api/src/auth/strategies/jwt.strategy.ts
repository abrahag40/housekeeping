import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { JwtPayload } from '@zenix/shared'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      // SSE clients can't set custom headers (EventSource API limitation),
      // so they pass the JWT as a ?token= query param. Accept both forms.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => req?.query?.token as string | null ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') ?? 'changeme',
    })
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const staff = await this.prisma.housekeepingStaff.findUnique({
      where: { id: payload.sub },
      select: { id: true, active: true },
    })
    if (!staff || !staff.active) throw new UnauthorizedException()
    return payload
  }
}
