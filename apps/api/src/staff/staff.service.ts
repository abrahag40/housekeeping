import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import * as bcrypt from 'bcrypt'
import { JwtPayload } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'
import { CreateStaffDto, UpdateStaffDto } from './dto/create-staff.dto'

const SELECT_SAFE = {
  id: true,
  propertyId: true,
  name: true,
  email: true,
  role: true,
  active: true,
  capabilities: true,
  createdAt: true,
}

@Injectable()
export class StaffService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateStaffDto, actor: JwtPayload) {
    const existing = await this.prisma.housekeepingStaff.findUnique({
      where: { email: dto.email.toLowerCase() },
    })
    if (existing) throw new ConflictException('Email already in use')

    const passwordHash = await bcrypt.hash(dto.password, 12)
    return this.prisma.housekeepingStaff.create({
      data: {
        propertyId: actor.propertyId,
        name: dto.name,
        email: dto.email.toLowerCase(),
        passwordHash,
        role: dto.role,
        capabilities: dto.capabilities ?? [],
      },
      select: SELECT_SAFE,
    })
  }

  findAll(propertyId: string) {
    return this.prisma.housekeepingStaff.findMany({
      where: { propertyId },
      select: SELECT_SAFE,
      orderBy: { name: 'asc' },
    })
  }

  async findOne(id: string) {
    const staff = await this.prisma.housekeepingStaff.findUnique({
      where: { id },
      select: SELECT_SAFE,
    })
    if (!staff) throw new NotFoundException('Staff not found')
    return staff
  }

  async update(id: string, dto: UpdateStaffDto) {
    await this.findOne(id)

    // Extraer password y email del DTO; el resto se puede pasar directamente a Prisma.
    const { password, email, ...rest } = dto

    // Construir el objeto de datos para Prisma.
    // password: se hashea solo si el supervisor envió un valor (no se toca si está undefined).
    // email: se normaliza a minúsculas para consistencia con el proceso de login.
    const data: Record<string, unknown> = { ...rest }
    if (email) data.email = email.toLowerCase()
    if (password) data.passwordHash = await bcrypt.hash(password, 12)

    return this.prisma.housekeepingStaff.update({
      where: { id },
      data,
      select: SELECT_SAFE,
    })
  }

  async remove(id: string) {
    await this.findOne(id)
    // Soft delete — deactivate instead of hard delete to preserve task history
    return this.prisma.housekeepingStaff.update({
      where: { id },
      data: { active: false },
      select: SELECT_SAFE,
    })
  }
}
