import { Controller, Get, Query } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { TenantContextService } from '../../common/tenant-context.service'

@Controller('v1/room-types')
export class RoomTypesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  @Get()
  async findAll(@Query('propertyId') propertyId: string) {
    const orgId = this.tenant.getOrganizationId()

    const [roomTypes, unassignedRooms] = await Promise.all([
      this.prisma.roomType.findMany({
        where: { organizationId: orgId, propertyId, isActive: true, deletedAt: null },
        include: {
          rooms: { where: { deletedAt: null }, orderBy: { number: 'asc' } },
        },
        orderBy: { name: 'asc' },
      }),
      // Rooms that exist but have no roomTypeId — shown as a fallback group
      this.prisma.room.findMany({
        where: { propertyId, deletedAt: null, roomTypeId: null },
        orderBy: { number: 'asc' },
      }),
    ])

    if (unassignedRooms.length === 0) return roomTypes

    // Create a virtual fallback group for rooms not yet linked to a room type
    const fallbackGroup = {
      id: `fallback-${propertyId}`,
      organizationId: orgId,
      propertyId,
      name: 'Habitaciones',
      code: 'DEFAULT',
      description: null,
      maxOccupancy: 0,
      baseRate: 0,
      currency: 'USD',
      amenities: [],
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      rooms: unassignedRooms,
    }

    return [...roomTypes, fallbackGroup]
  }
}
