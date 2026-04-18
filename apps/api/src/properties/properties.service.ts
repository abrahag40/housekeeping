import { Injectable, NotFoundException } from '@nestjs/common'
import { HousekeepingRole, JwtPayload } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePropertyDto } from './dto/create-property.dto'

@Injectable()
export class PropertiesService {
  constructor(private prisma: PrismaService) {}

  create(dto: CreatePropertyDto) {
    return this.prisma.property.create({ data: dto })
  }

  findAll() {
    return this.prisma.property.findMany({ orderBy: { name: 'asc' } })
  }

  async findMine(actor: JwtPayload) {
    if (actor.role === HousekeepingRole.SUPERVISOR) {
      return this.prisma.property.findMany({ orderBy: { name: 'asc' } })
    }
    const property = await this.findOne(actor.propertyId)
    return [property]
  }

  async findOne(id: string) {
    const property = await this.prisma.property.findUnique({ where: { id } })
    if (!property) throw new NotFoundException('Property not found')
    return property
  }

  async update(id: string, dto: Partial<CreatePropertyDto>) {
    await this.findOne(id)
    return this.prisma.property.update({ where: { id }, data: dto })
  }

  async remove(id: string) {
    await this.findOne(id)
    return this.prisma.property.delete({ where: { id } })
  }
}
