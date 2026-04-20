import {
  BadRequestException,
  ForbiddenException,
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
import type { AvailabilityConflict, RoomAvailabilityResult } from '@zenix/shared'
import { Prisma } from '@prisma/client'

/** Returns the local date string (YYYY-MM-DD) for a given UTC date in the specified IANA timezone. */
function toLocalDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Returns the local hour (0-23) for a given UTC date in the specified IANA timezone. */
function toLocalHour(date: Date, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(date),
  )
}

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
        deletedAt:      null,
        actualCheckout: null,
        noShowAt:       null, // stays marcados no-show liberan el inventario
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

  async findOne(stayId: string) {
    const orgId = this.tenant.getOrganizationId()
    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      include: { room: { select: { number: true } } },
    })
    if (!stay) throw new NotFoundException('Estadía no encontrada')
    return stay
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

  /**
   * markAsNoShow — Marca una estadía como no-show.
   *
   * Precondiciones:
   *  - La estadía debe estar en estado activo (sin actualCheckout ni noShowAt).
   *  - La fecha de llegada ya debe haber pasado (no se puede marcar no-show anticipado).
   *  - Se evalúa la fecha de llegada en la timezone de la propiedad para evitar
   *    errores por diferencias UTC vs local (crítico para propiedades en UTC-5 a UTC-12).
   *
   * Efectos (todos en transacción):
   *  1. Registra noShowAt, noShowById, noShowReason, fee y chargeStatus en GuestStay.
   *  2. Libera la habitación (OCCUPIED → AVAILABLE) si no hay otros huéspedes activos.
   *  3. Cancela tareas de limpieza PENDING/UNASSIGNED de las unidades de la habitación.
   *  4. Actualiza StayJourney.status → NO_SHOW y registra StayJourneyEvent.
   *
   * El cargo (feeAmount) es la primera noche (ratePerNight). Para políticas distintas
   * se configurará en el futuro via RateCode.noShowPolicy (Roadmap P2-noshow).
   * El supervisor puede exonerar el cargo con waiveCharge: true.
   *
   * IMPORTANTE FISCAL: Este registro es inmutable (no se borra, solo se puede revertir).
   * noShowFeeAmount + noShowChargeStatus quedan en la auditoría permanente de la estadía.
   */
  async markAsNoShow(
    stayId: string,
    actorId: string,
    opts?: { reason?: string; waiveCharge?: boolean },
  ) {
    const orgId = this.tenant.getOrganizationId()
    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      include: {
        room: {
          include: {
            units: { select: { id: true } },
            property: { include: { settings: true } },
          },
        },
        stayJourney: { select: { id: true } },
      },
    })
    if (!stay) throw new NotFoundException('Estadía no encontrada')
    if (stay.actualCheckout) throw new ConflictException('El huésped ya realizó checkout')
    if (stay.noShowAt)        throw new ConflictException('La estadía ya está marcada como no-show')

    const tz = stay.room.property.settings?.timezone ?? 'UTC'
    const todayLocal    = toLocalDate(new Date(), tz)
    const checkinLocal  = toLocalDate(stay.checkinAt, tz)
    if (checkinLocal > todayLocal) {
      throw new ConflictException('No se puede marcar no-show antes de la fecha de llegada')
    }

    const feeAmount    = opts?.waiveCharge ? new Prisma.Decimal(0) : stay.ratePerNight
    const chargeStatus = opts?.waiveCharge ? 'WAIVED' : 'PENDING'

    const now = new Date()

    await this.prisma.$transaction(async (tx) => {
      // 1. Marcar la estadía
      await tx.guestStay.update({
        where: { id: stayId },
        data: {
          noShowAt:          now,
          noShowById:        actorId,
          noShowReason:      opts?.reason ?? null,
          noShowFeeAmount:   feeAmount,
          noShowFeeCurrency: stay.currency,
          noShowChargeStatus: chargeStatus,
        },
      })

      // 2. Liberar habitación si no hay otros huéspedes activos
      const othersActive = await tx.guestStay.count({
        where: {
          roomId:       stay.roomId,
          organizationId: orgId,
          deletedAt:    null,
          actualCheckout: null,
          noShowAt:     null,
          id: { not: stayId },
        },
      })
      if (othersActive === 0 && stay.room.status === 'OCCUPIED') {
        await tx.room.update({ where: { id: stay.roomId }, data: { status: 'AVAILABLE' } })
        await tx.roomStatusLog.create({
          data: {
            organizationId: orgId,
            propertyId: stay.propertyId,
            roomId:     stay.roomId,
            fromStatus: 'OCCUPIED',
            toStatus:   'AVAILABLE',
            changedById: actorId,
            reason:     `No-show: ${stay.guestName}`,
          },
        })
      }

      // 3. Cancelar tareas de limpieza activas de las unidades de la habitación
      //    Solo cancela PENDING/UNASSIGNED/READY — las IN_PROGRESS las deja (equipo supervisará)
      const unitIds = stay.room.units.map((u) => u.id)
      if (unitIds.length > 0) {
        const dayStart = new Date(`${todayLocal}T00:00:00.000Z`)
        const dayEnd   = new Date(`${todayLocal}T23:59:59.999Z`)
        await tx.cleaningTask.updateMany({
          where: {
            unitId: { in: unitIds },
            status: { in: ['PENDING', 'UNASSIGNED', 'READY'] },
            createdAt: { gte: dayStart, lte: dayEnd },
          },
          data: { status: 'CANCELLED' },
        })
      }

      // 4. Actualizar StayJourney si existe
      if (stay.stayJourney?.id) {
        await tx.stayJourney.update({
          where: { id: stay.stayJourney.id },
          data: { status: 'NO_SHOW' },
        })
        await tx.stayJourneyEvent.create({
          data: {
            journeyId: stay.stayJourney.id,
            eventType: 'NO_SHOW_MARKED',
            actorId,
            payload: {
              reason:      opts?.reason ?? null,
              feeAmount:   feeAmount.toString(),
              chargeStatus,
              markedAt:    now.toISOString(),
            },
          },
        })
      }
    })

    this.events.emit('stay.no_show', {
      stayId,
      roomId:     stay.roomId,
      propertyId: stay.propertyId,
      orgId,
      guestName:  stay.guestName,
    })

    this.logger.log(`No-show marcado: stay=${stayId} guest="${stay.guestName}" fee=${feeAmount} ${chargeStatus}`)
    return { success: true, feeAmount: feeAmount.toString(), chargeStatus }
  }

  /**
   * revertNoShow — Revierte un no-show dentro de la ventana de 48 horas.
   *
   * Casos de uso: vuelo retrasado, error del recepcionista, huésped llega tarde.
   *
   * Ventana de gracia de 48h: alineada con ISAHC (Int'l Society of Hospitality Consultants)
   * y práctica de Mews/Clock PMS+. Pasadas las 48h, la reversión solo puede hacerla
   * un manager manualmente a nivel de BD (fuera de scope de la app).
   *
   * El cargo (si ya procesado) se pone en estado PENDING para revisión manual;
   * no se hace refund automático (requiere integración de pasarela).
   */
  async revertNoShow(stayId: string, actorId: string) {
    const orgId = this.tenant.getOrganizationId()
    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      include: {
        stayJourney: { select: { id: true } },
      },
    })
    if (!stay) throw new NotFoundException('Estadía no encontrada')
    if (!stay.noShowAt) throw new ConflictException('La estadía no está marcada como no-show')

    const hoursSince = (Date.now() - stay.noShowAt.getTime()) / 3_600_000
    if (hoursSince > 48) {
      throw new ForbiddenException('La ventana de reversión de 48 horas ha expirado')
    }

    const now = new Date()

    await this.prisma.$transaction(async (tx) => {
      await tx.guestStay.update({
        where: { id: stayId },
        data: {
          noShowAt:          null,
          noShowById:        null,
          noShowReason:      null,
          noShowFeeAmount:   null,
          noShowFeeCurrency: null,
          // Si el cargo estaba CHARGED lo ponemos PENDING para revisión manual
          noShowChargeStatus: stay.noShowChargeStatus === 'CHARGED' ? 'PENDING' : null,
          noShowRevertedAt:   now,
          noShowRevertedById: actorId,
        },
      })

      // Restaurar habitación a OCCUPIED si no hay otra razón para que esté disponible
      const room = await tx.room.findUnique({ where: { id: stay.roomId }, select: { status: true } })
      if (room?.status === 'AVAILABLE') {
        await tx.room.update({ where: { id: stay.roomId }, data: { status: 'OCCUPIED' } })
        await tx.roomStatusLog.create({
          data: {
            organizationId: orgId,
            propertyId: stay.propertyId,
            roomId:     stay.roomId,
            fromStatus: 'AVAILABLE',
            toStatus:   'OCCUPIED',
            changedById: actorId,
            reason:     `No-show revertido: ${stay.guestName}`,
          },
        })
      }

      if (stay.stayJourney?.id) {
        await tx.stayJourney.update({
          where: { id: stay.stayJourney.id },
          data: { status: 'ACTIVE' },
        })
        await tx.stayJourneyEvent.create({
          data: {
            journeyId: stay.stayJourney.id,
            eventType: 'NO_SHOW_REVERTED',
            actorId,
            payload: { revertedAt: now.toISOString() },
          },
        })
      }
    })

    this.events.emit('stay.no_show_reverted', {
      stayId,
      roomId:     stay.roomId,
      propertyId: stay.propertyId,
      orgId,
    })

    this.logger.log(`No-show revertido: stay=${stayId}`)
    return { success: true }
  }

  // ─── Helpers exposed for night-audit scheduler ────────────────────────────

  /** Exported so NightAuditScheduler can call it without tenant context (system actor). */
  async markAsNoShowSystem(stayId: string, orgId: string, propertyId: string) {
    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId },
      include: {
        room: { include: { units: { select: { id: true } }, property: { include: { settings: true } } } },
        stayJourney: { select: { id: true } },
      },
    })
    if (!stay || stay.actualCheckout || stay.noShowAt) return

    const tz = stay.room.property.settings?.timezone ?? 'UTC'
    const todayLocal = toLocalDate(new Date(), tz)

    await this.prisma.$transaction(async (tx) => {
      await tx.guestStay.update({
        where: { id: stayId },
        data: {
          noShowAt:           new Date(),
          noShowChargeStatus: 'PENDING',
          noShowFeeAmount:    stay.ratePerNight,
          noShowFeeCurrency:  stay.currency,
          noShowReason:       'Marcado automáticamente por night audit',
        },
      })

      const othersActive = await tx.guestStay.count({
        where: {
          roomId:        stay.roomId,
          organizationId: orgId,
          deletedAt:     null,
          actualCheckout: null,
          noShowAt:      null,
          id: { not: stayId },
        },
      })
      if (othersActive === 0 && stay.room.status === 'OCCUPIED') {
        await tx.room.update({ where: { id: stay.roomId }, data: { status: 'AVAILABLE' } })
        await tx.roomStatusLog.create({
          data: {
            organizationId: orgId,
            propertyId,
            roomId:     stay.roomId,
            fromStatus: 'OCCUPIED',
            toStatus:   'AVAILABLE',
            changedById: 'system',
            reason:     `No-show automático (night audit): ${stay.guestName}`,
          },
        })
      }

      const unitIds = stay.room.units.map((u) => u.id)
      if (unitIds.length > 0) {
        const dayStart = new Date(`${todayLocal}T00:00:00.000Z`)
        const dayEnd   = new Date(`${todayLocal}T23:59:59.999Z`)
        await tx.cleaningTask.updateMany({
          where: {
            unitId: { in: unitIds },
            status: { in: ['PENDING', 'UNASSIGNED', 'READY'] },
            createdAt: { gte: dayStart, lte: dayEnd },
          },
          data: { status: 'CANCELLED' },
        })
      }

      if (stay.stayJourney?.id) {
        await tx.stayJourney.update({ where: { id: stay.stayJourney.id }, data: { status: 'NO_SHOW' } })
        await tx.stayJourneyEvent.create({
          data: {
            journeyId: stay.stayJourney.id,
            eventType: 'NO_SHOW_MARKED',
            actorId:   null,
            payload:   { source: 'NIGHT_AUDIT', markedAt: new Date().toISOString() },
          },
        })
      }
    })

    this.logger.log(`[NightAudit] No-show automático: stay=${stayId} guest="${stay.guestName}"`)
  }
}
