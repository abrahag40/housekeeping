import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreateBedDto } from './dto/create-bed.dto'
import { BedStatus } from '@housekeeping/shared'

@Injectable()
export class BedsService {
  constructor(private prisma: PrismaService) {}

  create(roomId: string, dto: CreateBedDto) {
    return this.prisma.bed.create({
      data: { ...dto, roomId, status: dto.status ?? BedStatus.AVAILABLE },
    })
  }

  findByRoom(roomId: string) {
    return this.prisma.bed.findMany({
      where: { roomId },
      orderBy: { label: 'asc' },
    })
  }

  async findOne(id: string) {
    const bed = await this.prisma.bed.findUnique({
      where: { id },
      include: { room: { include: { property: true } } },
    })
    if (!bed) throw new NotFoundException('Bed not found')
    return bed
  }

  async update(id: string, dto: Partial<CreateBedDto> & { status?: BedStatus }) {
    await this.findOne(id)
    return this.prisma.bed.update({ where: { id }, data: dto })
  }

  async remove(id: string) {
    await this.findOne(id)
    return this.prisma.bed.delete({ where: { id } })
  }
}
