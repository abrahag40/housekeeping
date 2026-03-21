import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateRoomDto } from './dto/create-room.dto'

@Injectable()
export class RoomsService {
  constructor(private prisma: PrismaService) {}

  create(propertyId: string, dto: CreateRoomDto) {
    return this.prisma.room.create({
      data: { ...dto, propertyId },
      include: { beds: true },
    })
  }

  findByProperty(propertyId: string) {
    return this.prisma.room.findMany({
      where: { propertyId },
      include: { beds: { orderBy: { label: 'asc' } } },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    })
  }

  async findOne(id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: { beds: { orderBy: { label: 'asc' } }, property: true },
    })
    if (!room) throw new NotFoundException('Room not found')
    return room
  }

  async findByCloudbedsId(cloudbedsRoomId: string, propertyId: string) {
    return this.prisma.room.findFirst({ where: { cloudbedsRoomId, propertyId } })
  }

  async update(id: string, dto: Partial<CreateRoomDto>) {
    await this.findOne(id)
    return this.prisma.room.update({
      where: { id },
      data: dto,
      include: { beds: true },
    })
  }

  async remove(id: string) {
    await this.findOne(id)
    return this.prisma.room.delete({ where: { id } })
  }
}
