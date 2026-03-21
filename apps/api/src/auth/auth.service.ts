import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcrypt'
import { AuthResponse, JwtPayload } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'
import { LoginDto } from './dto/login.dto'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<AuthResponse> {
    const staff = await this.prisma.housekeepingStaff.findUnique({
      where: { email: dto.email.toLowerCase() },
    })

    if (!staff || !staff.active) throw new UnauthorizedException('Invalid credentials')

    const passwordMatch = await bcrypt.compare(dto.password, staff.passwordHash)
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials')

    const payload: JwtPayload = {
      sub: staff.id,
      email: staff.email,
      role: staff.role as any,
      propertyId: staff.propertyId,
    }

    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: staff.role as any,
        propertyId: staff.propertyId,
      },
    }
  }
}
