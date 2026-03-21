import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { JwtPayload } from '@housekeeping/shared'
import { PrismaService } from '../../prisma/prisma.service'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
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
