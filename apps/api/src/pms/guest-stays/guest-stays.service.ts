import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../prisma/prisma.service'
import { TenantContextService } from '../../common/tenant-context.service'
import { EmailService } from '../../common/email/email.service'
import { CreateGuestStayDto } from './dto/create-guest-stay.dto'
import { MoveRoomDto } from './dto/move-room.dto'
import type { AvailabilityConflict, RoomAvailabilityResult } from '@housekeeping/shared'
import { Prisma } from '@prisma/client'

@Injectable()
export class GuestStaysService {
  private readonly logger = new Logger(GuestStaysService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly events: EventEmitter2,
    private readonly email: EmailService,
  ) {}

  async create(dto: CreateGuestStayDto, actorId: string) {
    const orgId = this.tenant.getOrganizationId()

    const room = await this.prisma.room.findUnique({
      where: { id: dto.roomId, organizationId: orgId },
      include: { property: true },
    })
    if (!room) throw new NotFoundException('Habitación no encontrada')

    const checkIn = new Date(dto.checkIn)
    const checkOut = new Date(dto.checkOut)

    // Validate date-range availability before mutating any state.
    // This is the authoritative backend guard — the frontend pre-flight check
    // is advisory only and cannot replace this server-side validation.
    const availability = await this.checkAvailability(dto.roomId, checkIn, checkOut)
    if (!availability.available) {
      const hard = availability.conflicts.find(c => c.severity === 'HARD')
      const soft = availability.conflicts.find(c => c.severity === 'SOFT')
      const message = hard?.guestName
        ? `La habitación ya tiene una reserva de "${hard.guestName}" que se solapa ${hard.overlapDays} noche(s) con las fechas solicitadas`
        : soft
        ? `Habitación fuera de servicio: ${room.status}`
        : 'Habitación no disponible para las fechas seleccionadas'
      throw new ConflictException({ message, conflicts: availability.conflicts })
    }

    // For same-day arrivals the room must be physically available right now.
    // Future reservations are only blocked by date-range conflicts (checked above).
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const checkInDay = new Date(checkIn)
    checkInDay.setHours(0, 0, 0, 0)
    const isSameDayCheckin = checkInDay.getTime() === todayStart.getTime()

    if (isSameDayCheckin && room.status !== 'AVAILABLE') {
      throw new ConflictException(`Habitación no disponible: estado ${room.status}`)
    }
    const nights = Math.max(
      1,
      Math.round(
        (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24),
      ),
    )
    const total = dto.ratePerNight * nights

    const count = await this.prisma.guestStay.count({
      where: { organizationId: orgId },
    })
    const pmsId = `PMS-${new Date().getFullYear()}-${String(count + 1).padStart(4, '0')}`

    const guestName = `${dto.firstName} ${dto.lastName}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ops: Prisma.PrismaPromise<any>[] = [
      this.prisma.guestStay.create({
        data: {
          organizationId: orgId,
          propertyId: dto.propertyId,
          roomId: dto.roomId,
          guestName,
          guestEmail: dto.guestEmail,
          guestPhone: dto.guestPhone,
          nationality: dto.nationality,
          documentType: dto.documentType,
          paxCount: dto.adults + (dto.children ?? 0),
          checkinAt: checkIn,
          scheduledCheckout: checkOut,
          ratePerNight: dto.ratePerNight,
          currency: dto.currency,
          totalAmount: total,
          amountPaid: dto.amountPaid,
          paymentStatus:
            dto.amountPaid >= total
              ? 'PAID'
              : dto.amountPaid > 0
                ? 'PARTIAL'
                : 'PENDING',
          source: dto.source,
          notes: dto.notes,
          checkedInById: actorId,
        },
      }),
    ]

    // Only flip room status immediately for same-day check-ins.
    // Future reservations keep the room AVAILABLE until the guest physically arrives.
    if (isSameDayCheckin) {
      ops.push(
        this.prisma.room.update({
          where: { id: dto.roomId },
          data: { status: 'OCCUPIED' },
        }),
        this.prisma.roomStatusLog.create({
          data: {
            organizationId: orgId,
            propertyId: dto.propertyId,
            roomId: dto.roomId,
            fromStatus: room.status,
            toStatus: 'OCCUPIED',
            changedById: actorId,
            reason: `Check-in: ${guestName}`,
          },
        }),
      )
    }

    const [stay] = await this.prisma.$transaction(ops)

    this.events.emit('checkin.completed', {
      stayId: stay.id,
      roomId: dto.roomId,
      propertyId: dto.propertyId,
      orgId,
      guestName: stay.guestName,
    })

    if (dto.guestEmail) {
      this.email
        .sendCheckinConfirmation({
          guestEmail: dto.guestEmail,
          guestName: `${dto.firstName} ${dto.lastName}`,
          propertyName: room.property.name,
          roomNumber: room.number,
          checkIn,
          checkOut,
          nights,
          totalAmount: total,
          currency: dto.currency,
          pmsId,
        })
        .catch((err) => {
          this.logger.error(`Failed to send checkin email: ${err}`)
        })
    }

    return { ...stay, pmsReservationId: pmsId }
  }

  /**
   * Checks whether a room is available for the given date range.
   *
   * Algorithm: half-open interval [checkIn, checkOut)
   *   Two ranges overlap iff: existingCheckIn < newCheckOut AND existingCheckOut > newCheckIn
   *   Same-day turnover (existing.checkOut == new.checkIn) is intentionally NOT a conflict.
   *
   * Sources checked (in priority order):
   *   1. Room operational status — MAINTENANCE / OUT_OF_SERVICE block all bookings (SOFT severity)
   *   2. GuestStay date-range overlap — active reservation on the same room (HARD severity)
   *
   * @param excludeStayId - optional stayId to exclude (used by moveRoom to ignore the stay being moved)
   */
  async checkAvailability(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
    excludeStayId?: string,
  ): Promise<RoomAvailabilityResult> {
    const orgId = this.tenant.getOrganizationId()
    const conflicts: AvailabilityConflict[] = []

    const room = await this.prisma.room.findUnique({
      where: { id: roomId, organizationId: orgId },
      select: { status: true },
    })
    if (!room) throw new NotFoundException('Habitación no encontrada')

    // 1. Operational status check
    if (room.status === 'MAINTENANCE' || room.status === 'OUT_OF_SERVICE') {
      const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000)
      conflicts.push({
        source: 'ROOM_STATUS',
        severity: 'SOFT',
        conflictStart: checkIn.toISOString(),
        conflictEnd: checkOut.toISOString(),
        overlapDays: Math.max(0, nights),
      })
    }

    // 2. Date-range overlap against active GuestStay records
    //    Conditions: not deleted, not yet physically checked out, not the excluded stay
    const conflictingStay = await this.prisma.guestStay.findFirst({
      where: {
        roomId,
        organizationId: orgId,
        deletedAt: null,
        actualCheckout: null,
        ...(excludeStayId ? { id: { not: excludeStayId } } : {}),
        // Half-open interval overlap: A.start < B.end AND A.end > B.start
        checkinAt:        { lt: checkOut },
        scheduledCheckout: { gt: checkIn },
      },
      select: {
        guestName:        true,
        checkinAt:        true,
        scheduledCheckout: true,
      },
    })

    if (conflictingStay) {
      // Compute exact overlap window for precise day count
      const overlapStart = new Date(Math.max(checkIn.getTime(), conflictingStay.checkinAt.getTime()))
      const overlapEnd   = new Date(Math.min(checkOut.getTime(), conflictingStay.scheduledCheckout.getTime()))
      const overlapDays  = Math.max(0, Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86400000))

      conflicts.push({
        source:        'GUEST_STAY',
        severity:      'HARD',
        guestName:     conflictingStay.guestName,
        conflictStart: conflictingStay.checkinAt.toISOString(),
        conflictEnd:   conflictingStay.scheduledCheckout.toISOString(),
        overlapDays,
      })
    }

    return { available: conflicts.length === 0, conflicts }
  }

  async findByProperty(propertyId: string, from?: Date, to?: Date) {
    const orgId = this.tenant.getOrganizationId()
    return this.prisma.guestStay.findMany({
      where: {
        organizationId: orgId,
        propertyId,
        deletedAt: null,
        ...(from &&
          to && {
            OR: [
              { checkinAt: { lte: to } },
              { scheduledCheckout: { gte: from } },
            ],
          }),
      },
      orderBy: { checkinAt: 'desc' },
    })
  }

  async checkout(stayId: string, actorId: string) {
    const orgId = this.tenant.getOrganizationId()
    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      include: { room: { include: { property: true } } },
    })
    if (!stay) throw new NotFoundException()

    const now = new Date()
    const [updated] = await this.prisma.$transaction([
      this.prisma.guestStay.update({
        where: { id: stayId },
        data: { actualCheckout: now, checkedOutById: actorId, paymentStatus: 'PAID' },
      }),
      this.prisma.room.update({
        where: { id: stay.roomId },
        data: { status: 'CHECKING_OUT' },
      }),
      this.prisma.roomStatusLog.create({
        data: {
          organizationId: orgId,
          propertyId: stay.propertyId,
          roomId: stay.roomId,
          fromStatus: 'OCCUPIED',
          toStatus: 'CHECKING_OUT',
          changedById: actorId,
          reason: 'Checkout confirmado',
        },
      }),
    ])

    this.events.emit('checkout.confirmed', {
      roomId: stay.roomId,
      propertyId: stay.propertyId,
      orgId,
      guestName: stay.guestName,
    })

    return updated
  }

  async moveRoom(stayId: string, dto: MoveRoomDto, actorId: string) {
    const orgId = this.tenant.getOrganizationId()
    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
    })
    if (!stay) throw new NotFoundException()

    // Cannot move a guest who has already checked out
    if (stay.actualCheckout !== null) {
      throw new BadRequestException('No se puede cambiar de habitación a un huésped que ya realizó checkout')
    }

    // Same room — no-op
    if (stay.roomId === dto.newRoomId) return { success: true }

    const newRoom = await this.prisma.room.findUnique({
      where: { id: dto.newRoomId, organizationId: orgId },
    })
    if (!newRoom) throw new NotFoundException('Habitación destino no encontrada')

    // Check for overlapping stays in the destination room (date-range conflict,
    // not room.status which reflects current operational state, not future bookings)
    const overlap = await this.prisma.guestStay.findFirst({
      where: {
        roomId: dto.newRoomId,
        organizationId: orgId,
        deletedAt: null,
        actualCheckout: null,           // exclude already checked-out stays
        id: { not: stayId },            // exclude the stay being moved
        checkinAt:   { lt: stay.scheduledCheckout },
        scheduledCheckout: { gt: stay.checkinAt },
      },
    })
    if (overlap) {
      throw new ConflictException(
        `La habitación destino ya tiene una reserva para ese período (${overlap.guestName})`,
      )
    }

    // Check if the old room has other active stays before freeing it
    const otherStaysInOldRoom = await this.prisma.guestStay.count({
      where: {
        roomId: stay.roomId,
        organizationId: orgId,
        deletedAt: null,
        actualCheckout: null,
        id: { not: stayId },
      },
    })

    await this.prisma.$transaction([
      // Only mark old room available if no other active guests remain in it
      this.prisma.room.update({
        where: { id: stay.roomId },
        data: { status: otherStaysInOldRoom > 0 ? 'OCCUPIED' : 'AVAILABLE' },
      }),
      this.prisma.room.update({
        where: { id: dto.newRoomId },
        data: { status: 'OCCUPIED' },
      }),
      this.prisma.guestStay.update({
        where: { id: stayId },
        data: { roomId: dto.newRoomId },
      }),
    ])

    this.events.emit('room.moved', {
      stayId,
      fromRoomId: stay.roomId,
      toRoomId: dto.newRoomId,
      propertyId: stay.propertyId,
      orgId,
    })

    return { success: true }
  }
}
