import { Injectable, NotFoundException } from '@nestjs/common'
import { HousekeepingRole, JwtPayload } from '@zenix/shared'
import { PrismaService } from '../prisma/prisma.service'
import { TenantContextService } from '../common/tenant-context.service'
import { CreatePropertyDto } from './dto/create-property.dto'

@Injectable()
export class PropertiesService {
  constructor(
    private prisma: PrismaService,
    private tenant: TenantContextService,
  ) {}

  create(dto: CreatePropertyDto) {
    const orgId = this.tenant.getOrganizationId()
    return this.prisma.property.create({ data: { ...dto, organizationId: orgId } })
  }

  findAll() {
    const orgId = this.tenant.getOrganizationId()
    return this.prisma.property.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
    })
  }

  async findMine(actor: JwtPayload) {
    if (actor.role === HousekeepingRole.SUPERVISOR) {
      return this.prisma.property.findMany({ orderBy: { name: 'asc' } })
    }
    const property = await this.findOne(actor.propertyId)
    return [property]
  }

  async findOne(id: string) {
    const orgId = this.tenant.getOrganizationId()
    const property = await this.prisma.property.findUnique({
      where: { id, organizationId: orgId },
    })
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
