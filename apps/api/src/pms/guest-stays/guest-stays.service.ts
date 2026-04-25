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
import { PaymentMethod } from '@zenix/shared'
import { Prisma } from '@prisma/client'
import { ConfirmCheckinDto } from './dto/confirm-checkin.dto'
import { RegisterPaymentDto } from './dto/register-payment.dto'
import { VoidPaymentDto } from './dto/void-payment.dto'
import { StayJourneyService } from '../stay-journeys/stay-journeys.service'
import { ChannexGateway } from '../../integrations/channex/channex.gateway'
import { NotificationCenterService } from '../../notification-center/notification-center.service'

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
    private readonly journeyService: StayJourneyService,
    private readonly channex: ChannexGateway,
    private readonly notifCenter: NotificationCenterService,
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

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const checkInDay = new Date(checkIn)
    checkInDay.setHours(0, 0, 0, 0)
    const isSameDayCheckin = checkInDay.getTime() === todayStart.getTime()

    // Operational status blocks ALL bookings only for MAINTENANCE / OUT_OF_SERVICE.
    // OCCUPIED / DIRTY / CHECKING_OUT are transient housekeeping states — they do NOT
    // block future or same-day reservations. Date-range availability (checkAvailability
    // above) is the authoritative inventory guard; room.status reflects physical state,
    // not calendar availability. Blocking on OCCUPIED here would prevent legitimate
    // same-day turnover (guest A checking out today while guest B checks in today).
    if (room.status === 'MAINTENANCE' || room.status === 'OUT_OF_SERVICE') {
      throw new ConflictException(`Habitación fuera de servicio: estado ${room.status}`)
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

    const stay = await this.prisma.$transaction(async (tx) => {
      const newStay = await tx.guestStay.create({
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
      })

      // Create StayJourney + ORIGINAL segment so extensions route through
      // the journey-aware path (extendSameRoom) instead of the legacy
      // PATCH /guest-stays/:id/extend that stretches the original block.
      const journey = await tx.stayJourney.create({
        data: {
          organizationId: orgId,
          propertyId: dto.propertyId,
          guestName,
          guestEmail: dto.guestEmail,
          guestStayId: newStay.id,
          journeyCheckIn: checkIn,
          journeyCheckOut: checkOut,
        },
      })
      await tx.staySegment.create({
        data: {
          journeyId: journey.id,
          roomId: dto.roomId,
          guestStayId: newStay.id,
          checkIn,
          checkOut,
          status: 'ACTIVE',
          reason: 'ORIGINAL',
          rateSnapshot: dto.ratePerNight,
        },
      })

      // Only flip room status immediately for same-day check-ins.
      // Future reservations keep the room AVAILABLE until the guest physically arrives.
      if (isSameDayCheckin) {
        await tx.room.update({
          where: { id: dto.roomId },
          data: { status: 'OCCUPIED' },
        })
      }

      return newStay
    })

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
   * TODO(sprint8-migrate): migrar a AvailabilityService.check() para cubrir
   * Channex channel manager (ver CLAUDE.md §29). Hoy este método NO detecta
   * overbooking cross-channel (una reserva llegando por Booking.com mientras
   * el recepcionista crea la estadía manualmente).
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
      include: {
        stayJourney: { select: { id: true } },
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
    ])

    this.events.emit('checkout.confirmed', {
      roomId: stay.roomId,
      propertyId: stay.propertyId,
      orgId,
      guestName: stay.guestName,
    })

    return updated
  }

  /**
   * POST /v1/guest-stays/:id/early-checkout
   *
   * El huésped sale antes de la fecha de checkout programada.
   *
   * Diferencias vs checkout regular:
   *  - GuestStay.actualCheckout = ahora (no scheduledCheckout)
   *  - paymentStatus permanece PENDING — puede haber reembolso parcial (Sprint 8)
   *  - Se crea Checkout + CleaningTask(PENDING) para las unidades de la habitación
   *  - Si localHour < HOUSEKEEPING_END_HOUR (20): tarea muestra en el grid de HOY
   *  - Si localHour >= HOUSEKEEPING_END_HOUR (20): tarea muestra en el grid de MAÑANA
   *    (usando checkout.actualCheckoutAt con fecha de mañana)
   *  - Las noches liberadas se notifican a Channex (best-effort, fire-and-forget)
   *  - Emite SSE checkout:early para actualizar el calendario en tiempo real
   *
   * TODO(sprint9-marketing): enviar mensaje WhatsApp/email "early checkout" al huésped
   */
  async earlyCheckout(stayId: string, actorId: string, notes?: string) {
    const orgId = this.tenant.getOrganizationId()

    // Constante de corte de turno de housekeeping (hora local).
    // Si el early checkout ocurre ANTES de esta hora, la tarea aparece en el grid de hoy.
    // Si ocurre DESPUÉS, la tarea queda para el grid de mañana.
    // TODO(cfg): hacer configurable via PropertySettings.housekeepingEndHour
    const HOUSEKEEPING_END_HOUR = 20

    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      include: {
        room: {
          select: {
            id: true,
            number: true,
            channexRoomTypeId: true,
            units: { select: { id: true } },
            property: { select: { id: true, settings: true } },
          },
        },
        stayJourney: {
          select: {
            id: true,
            segments: {
              where: { status: { in: ['ACTIVE', 'PENDING'] } },
              orderBy: { checkIn: 'asc' },
            },
          },
        },
      },
    })

    if (!stay) throw new NotFoundException()
    if (stay.actualCheckout) {
      throw new BadRequestException('El huésped ya realizó checkout')
    }
    if (stay.noShowAt) {
      throw new BadRequestException('No se puede realizar checkout de un no-show')
    }

    const now = new Date()
    if (now >= stay.scheduledCheckout) {
      throw new BadRequestException(
        'La fecha de checkout ya pasó — usa el checkout regular',
      )
    }

    const tz = stay.room.property.settings?.timezone ?? 'UTC'
    const localHour = toLocalHour(now, tz)

    // Determinar la fecha del Checkout record para el grid de housekeeping
    let taskCheckoutAt: Date
    if (localHour < HOUSEKEEPING_END_HOUR) {
      // Dentro del turno → la tarea aparece en el planning de HOY
      taskCheckoutAt = now
    } else {
      // Fuera del turno → la tarea aparece en el planning de MAÑANA
      const tomorrowLocal = toLocalDate(new Date(now.getTime() + 86_400_000), tz)
      // Fijamos a las 09:00 UTC para que quede dentro del rango UTC del día local de mañana
      taskCheckoutAt = new Date(`${tomorrowLocal}T09:00:00.000Z`)
    }

    // Transacción principal: actualizar stay + crear housekeeping records
    await this.prisma.$transaction(async (tx) => {
      // 1. Marcar GuestStay como early-checkout
      await tx.guestStay.update({
        where: { id: stayId },
        data: {
          actualCheckout: now,
          checkedOutById: actorId,
          // paymentStatus queda PENDING: puede haber reembolso parcial (Sprint 8)
        },
      })

      // 2. Actualizar estado de la habitación
      await tx.room.update({
        where: { id: stay.roomId },
        data: { status: 'CHECKING_OUT' },
      })

      // 3. Crear el Checkout record para el módulo de housekeeping
      const checkout = await tx.checkout.create({
        data: {
          organizationId: orgId,
          roomId: stay.roomId,
          guestName: stay.guestName,
          actualCheckoutAt: taskCheckoutAt,
          source: 'MANUAL',
          isEarlyCheckout: true,
          notes: notes ?? null,
        },
      })

      // 4. Crear CleaningTask(PENDING) por cada unidad (cama) de la habitación
      //    Misma lógica que batchCheckout: PENDING porque el housekeeper aún
      //    debe confirmar salida física (Fase 2 del flujo de 2 fases).
      for (const unit of stay.room.units) {
        const task = await tx.cleaningTask.create({
          data: {
            organizationId: orgId,
            unitId: unit.id,
            checkoutId: checkout.id,
            status: 'PENDING',
            taskType: 'CLEANING',
            priority: 'MEDIUM',
            hasSameDayCheckIn: false,
          },
        })
        await tx.taskLog.create({
          data: {
            organizationId: orgId,
            taskId: task.id,
            staffId: actorId,
            event: 'CREATED',
            note: `Early checkout registrado${notes ? ` — ${notes}` : ''}`,
          },
        })
      }

      // 5. Si hay journey activo, recortar el segmento activo a la fecha de hoy
      if (stay.stayJourney?.id && stay.stayJourney.segments.length > 0) {
        const activeSegment = stay.stayJourney.segments[stay.stayJourney.segments.length - 1]
        if (activeSegment && activeSegment.checkOut > now) {
          await tx.staySegment.update({
            where: { id: activeSegment.id },
            data: { checkOut: now, status: 'COMPLETED' },
          })
        }
        await tx.stayJourney.update({
          where: { id: stay.stayJourney.id },
          data: { status: 'CHECKED_OUT', journeyCheckOut: now },
        })
        await tx.stayJourneyEvent.create({
          data: {
            journeyId: stay.stayJourney.id,
            eventType: 'CHECKED_OUT',
            actorId,
            payload: {
              freedFrom: now.toISOString(),
              freedTo: stay.scheduledCheckout.toISOString(),
              tasksScheduledFor:
                localHour < HOUSEKEEPING_END_HOUR ? 'today' : 'tomorrow',
              notes: notes ?? null,
            },
          },
        })
      }
    })

    // Post-transaction: notificaciones best-effort (no revertir si fallan)
    this.events.emit('checkout.early', {
      roomId: stay.roomId,
      propertyId: stay.propertyId,
      orgId,
      stayId,
      guestName: stay.guestName,
      freedFrom: now.toISOString(),
      freedTo: stay.scheduledCheckout.toISOString(),
    })

    // Notify relevant staff about early checkout (best-effort — do NOT await)
    void this.notifCenter.send({
      propertyId:    stay.propertyId,
      type:          'INFORMATIONAL',
      category:      'EARLY_CHECKOUT',
      priority:      'MEDIUM',
      title:         `Salida anticipada — ${stay.guestName}`,
      body:          `${stay.guestName} salió anticipadamente de Hab. ${stay.room.number}. ` +
                     `Noches liberadas: ${now.toISOString()} → ${stay.scheduledCheckout.toISOString()}. ` +
                     `Limpieza programada para ${localHour < HOUSEKEEPING_END_HOUR ? 'hoy' : 'mañana'}.`,
      metadata:      { stayId, roomId: stay.roomId, freedFrom: now.toISOString(), freedTo: stay.scheduledCheckout.toISOString() },
      actionUrl:     `/reservations/${stayId}`,
      recipientType: 'ROLE',
      recipientRole: 'SUPERVISOR',
      triggeredById: actorId,
    }).catch((err: Error) =>
      this.logger.warn(`[EarlyCheckout] notification failed: ${err?.message}`),
    )

    // Liberar noches liberadas en Channex (best-effort, NO await dentro de tx)
    const propSettings = stay.room?.property?.settings
    const channexRoomTypeId = (stay.room as any)?.channexRoomTypeId as string | null | undefined
    if (propSettings?.channexPropertyId && channexRoomTypeId) {
      void this.channex.pushInventory({
        channexPropertyId: propSettings.channexPropertyId,
        roomTypeId:        channexRoomTypeId,
        dateFrom:          toLocalDate(now, tz),
        dateTo:            toLocalDate(stay.scheduledCheckout, tz),
        delta:             +1,  // release freed nights
        reason:            'RELEASE',
        traceId:           `early_checkout_${stayId}`,
      }).catch((err: Error) =>
        this.logger.warn(`[EarlyCheckout] Channex push failed (non-critical): ${err?.message}`),
      )
    }

    this.logger.log(
      `[EarlyCheckout] stay=${stayId} guest="${stay.guestName}" ` +
        `freedFrom=${now.toISOString()} freedTo=${stay.scheduledCheckout.toISOString()} ` +
        `taskScheduled=${localHour < HOUSEKEEPING_END_HOUR ? 'today' : 'tomorrow'}`,
    )

    return {
      success: true,
      freedFrom: now.toISOString(),
      freedTo: stay.scheduledCheckout.toISOString(),
      tasksScheduledFor: localHour < HOUSEKEEPING_END_HOUR ? 'today' : 'tomorrow',
    }
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
   * extendStay — Extiende la fecha de checkout de una estadía activa.
   *
   * Validaciones:
   *  - newCheckOut debe ser posterior al scheduledCheckout actual
   *  - La habitación no debe tener otra reserva en el período de extensión
   *  - La estadía no debe haber sido marcada como no-show ni como checkout
   *
   * Recalcula totalAmount en base al nuevo número de noches × ratePerNight.
   */
  async extendStay(stayId: string, newCheckOut: Date, actorId: string) {
    const orgId = this.tenant.getOrganizationId()
    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      include: { stayJourney: { select: { id: true } } },
    })
    if (!stay) throw new NotFoundException('Estadía no encontrada')

    if (stay.actualCheckout !== null) {
      throw new BadRequestException('No se puede extender una estadía que ya realizó checkout')
    }
    if (stay.noShowAt !== null) {
      throw new BadRequestException('No se puede extender una estadía marcada como no-show')
    }
    if (newCheckOut <= stay.scheduledCheckout) {
      throw new BadRequestException('La nueva fecha de checkout debe ser posterior a la actual')
    }

    // Always route through the journey-aware path so the extend creates a new
    // EXTENSION_SAME_ROOM segment instead of stretching the original block.
    if (stay.stayJourney) {
      return this.journeyService.extendSameRoom({
        journeyId: stay.stayJourney.id,
        newCheckOut: newCheckOut.toISOString(),
        actorId,
      })
    }

    // Stay has no journey yet (e.g. legacy seed data): bootstrap journey + extension.
    return this.journeyService.initJourneyAndExtend({
      guestStayId: stayId,
      guestName: stay.guestName,
      guestEmail: stay.guestEmail,
      organizationId: orgId,
      propertyId: stay.propertyId,
      roomId: stay.roomId,
      checkinAt: stay.checkinAt,
      scheduledCheckout: stay.scheduledCheckout,
      newCheckOut,
      ratePerNight: stay.ratePerNight,
      actorId,
    })
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
            units:    { select: { id: true } },
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

    // Guard: no se puede marcar no-show antes de la hora de alerta del día de llegada.
    // El recepcionista debe esperar hasta potentialNoShowWarningHour (default 20:00 hora local)
    // para que haya suficiente evidencia de que el huésped no llegará.
    const warningHour = stay.room.property.settings?.potentialNoShowWarningHour ?? 20
    const currentLocalHour = toLocalHour(new Date(), tz)
    if (checkinLocal === todayLocal && currentLocalHour < warningHour) {
      throw new ConflictException(
        `No se puede marcar no-show antes de las ${warningHour}:00 hora local`,
      )
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

    // Notify supervisor about the no-show (best-effort — do NOT await)
    void this.notifCenter.send({
      propertyId:    stay.propertyId,
      type:          chargeStatus === 'PENDING' ? 'ACTION_REQUIRED' : 'INFORMATIONAL',
      category:      'NO_SHOW',
      priority:      'HIGH',
      title:         `No-show — ${stay.guestName}`,
      body:          `${stay.guestName} fue marcado como no-show en Hab. ${stay.room.number}.` +
                     (chargeStatus === 'PENDING' ? ' Cargo pendiente de procesamiento.' : ''),
      metadata:      { stayId, roomId: stay.roomId },
      actionUrl:     `/reservations/${stayId}`,
      recipientType: 'ROLE',
      recipientRole: 'SUPERVISOR',
      triggeredById: actorId ?? undefined,
    }).catch((err: Error) =>
      this.logger.warn(`[NoShow] notification failed: ${err?.message}`),
    )

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
        room:        { select: { channexRoomTypeId: true } },
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

    // Notificar a Channex que la unidad vuelve a estar ocupada — best-effort (§31).
    const propertySettings = await this.prisma.propertySettings.findUnique({
      where:  { propertyId: stay.propertyId },
      select: { channexPropertyId: true, timezone: true },
    })
    const channexRoomTypeId = stay.room?.channexRoomTypeId
    if (propertySettings?.channexPropertyId && channexRoomTypeId) {
      const tz        = propertySettings.timezone ?? 'UTC'
      const localDate = toLocalDate(new Date(), tz)
      this.channex.pushInventory({
        channexPropertyId: propertySettings.channexPropertyId,
        roomTypeId:        channexRoomTypeId,
        dateFrom:          localDate,
        dateTo:            toLocalDate(stay.scheduledCheckout, tz),
        delta:             -1,  // re-ocupar unidad
        reason:            'RESERVATION',
        traceId:           `noshow_revert_${stayId}`,
      }).catch((err: Error) =>
        this.logger.error(`[revertNoShow] Channex push failed stay=${stayId}: ${err.message}`)
      )
    }

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

  // ─── Check-in Confirmation (Sprint 8) ────────────────────────────────────

  /**
   * POST /v1/guest-stays/:id/confirm-checkin
   *
   * Confirma la llegada física del huésped. Este es el único endpoint que escribe
   * `actualCheckin` — sin él el status permanece UNCONFIRMED y el night audit
   * puede marcar no-show.
   *
   * Guards (en orden, antes de cualquier mutación):
   *  1. Ya confirmado → ConflictException
   *  2. No-show → BadRequestException
   *  3. checkIn > hoy (localmente) → BadRequestException
   *  4. documentVerified !== true → BadRequestException
   *  5. balance > 0 sin pago ni override COMP → BadRequestException { code: 'BALANCE_UNPAID' }
   *  6. method = COMP sin approvedById + approvalReason → ForbiddenException
   *  7. CARD_TERMINAL / BANK_TRANSFER sin reference → BadRequestException
   *
   * Transacción:
   *  - Crear PaymentLog[] por cada entrada en dto.payments
   *  - Actualizar GuestStay: amountPaid, paymentStatus, actualCheckin, checkinConfirmedById
   *  - Actualizar Room.status → OCCUPIED
   *  - Crear StayJourneyEvent(CHECKED_IN)
   *
   * Post-tx (fire-and-forget):
   *  - SSE checkin:confirmed
   *  - NotificationCenter INFO → housekeeping (SUPERVISOR)
   */
  async confirmCheckin(stayId: string, dto: ConfirmCheckinDto, actorId: string) {
    const orgId = this.tenant.getOrganizationId()

    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      include: {
        room: {
          select: {
            id: true,
            number: true,
            status: true,
            property: { select: { id: true, settings: true } },
          },
        },
        stayJourney: { select: { id: true } },
        paymentLogs:  { where: { isVoid: false } },
      },
    })
    if (!stay) throw new NotFoundException('Estadía no encontrada')

    // Guard 1: ya confirmado
    if (stay.actualCheckin !== null) {
      throw new ConflictException('El check-in ya fue confirmado')
    }

    // Guard 2: no-show
    if (stay.noShowAt !== null) {
      throw new BadRequestException('No se puede confirmar check-in de un no-show')
    }

    // Guard 3: fecha aún no llegó
    const tz = stay.room.property.settings?.timezone ?? 'UTC'
    const todayLocal   = toLocalDate(new Date(), tz)
    const checkinLocal = toLocalDate(stay.checkinAt, tz)
    if (checkinLocal > todayLocal) {
      throw new BadRequestException('La fecha de check-in aún no ha llegado')
    }

    // Guard 4: documento no verificado
    if (!dto.documentVerified) {
      throw new BadRequestException('Se requiere verificar el documento de identidad del huésped')
    }

    // Guard 6 & 7: validar cada entrada de pago antes de tocar BD
    for (const p of dto.payments) {
      if (
        (p.method === PaymentMethod.CARD_TERMINAL || p.method === PaymentMethod.BANK_TRANSFER) &&
        !p.reference?.trim()
      ) {
        throw new BadRequestException(
          `El método ${p.method} requiere un número de referencia de la terminal`,
        )
      }
      if (
        (p.method === PaymentMethod.COMP || p.amount === 0) &&
        (!p.approvedById?.trim() || !p.approvalReason?.trim())
      ) {
        throw new ForbiddenException(
          'Pagos en $0 o tipo COMP requieren código y razón de aprobación del manager',
        )
      }
    }

    // Guard 5: balance pendiente sin pago
    const paidSoFar        = Number(stay.amountPaid)
    const totalAmount      = Number(stay.totalAmount)
    const paymentSum       = dto.payments.reduce((s, p) => s + p.amount, 0)
    const projectedBalance = totalAmount - paidSoFar - paymentSum
    const hasOtaPrepaid    = dto.payments.some((p) => p.method === PaymentMethod.OTA_PREPAID)
    const hasComp          = dto.payments.some((p) => p.method === PaymentMethod.COMP)

    if (projectedBalance > 0 && !hasOtaPrepaid && !hasComp) {
      throw new BadRequestException({
        code:    'BALANCE_UNPAID',
        balance: projectedBalance,
        message: `Saldo pendiente de $${projectedBalance.toFixed(2)} ${stay.currency} sin cubrir`,
      })
    }

    const now = new Date()
    const shiftDate = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z')

    await this.prisma.$transaction(async (tx) => {
      // 1. Crear registros de pago (append-only)
      for (const p of dto.payments) {
        await tx.paymentLog.create({
          data: {
            organizationId: orgId,
            propertyId:     stay.propertyId,
            stayId,
            method:         p.method as any,
            amount:         p.amount,
            currency:       stay.currency,
            reference:      p.reference ?? null,
            approvedById:   p.approvedById ?? null,
            approvalReason: p.approvalReason ?? null,
            shiftDate,
            collectedById:  actorId,
          },
        })
      }

      // 2. Calcular nuevo amountPaid y paymentStatus
      const newAmountPaid = paidSoFar + paymentSum
      const paymentStatus =
        hasOtaPrepaid || hasComp || newAmountPaid >= totalAmount
          ? 'PAID'
          : newAmountPaid > 0
            ? 'PARTIAL'
            : 'PENDING'

      // 3. Confirmar check-in
      await tx.guestStay.update({
        where: { id: stayId },
        data: {
          actualCheckin:          now,
          checkinConfirmedById:   actorId,
          amountPaid:             newAmountPaid,
          paymentStatus,
          documentType:           dto.documentType   ?? stay.documentType,
          documentNumber:         dto.documentNumber ?? stay.documentNumber,
          arrivalNotes:           dto.arrivalNotes   ?? null,
          keyType:                dto.keyType        ?? null,
        },
      })

      // 4. Marcar habitación como ocupada
      await tx.room.update({
        where: { id: stay.roomId },
        data: { status: 'OCCUPIED' },
      })

      // 5. Audit trail
      if (stay.stayJourney?.id) {
        await tx.stayJourneyEvent.create({
          data: {
            journeyId: stay.stayJourney.id,
            eventType: 'CHECKED_IN',
            actorId,
            payload: {
              confirmedAt:      now.toISOString(),
              documentVerified: dto.documentVerified,
              documentType:     dto.documentType,
              // PII: enmascarar últimos 4 dígitos — nunca loguear número completo
              documentNumber:   dto.documentNumber ? `***${dto.documentNumber.slice(-4)}` : undefined,
              keyType:          dto.keyType,
              arrivalNotes:     dto.arrivalNotes,
              paymentSum,
              paymentStatus,
              methods:          dto.payments.map((p) => p.method),
            },
          },
        })
      }
    })

    // Post-tx: SSE + notificación (fire-and-forget)
    this.events.emit('checkin.confirmed', {
      stayId,
      roomId:     stay.roomId,
      propertyId: stay.propertyId,
      orgId,
      guestName:  stay.guestName,
    })

    void this.notifCenter.send({
      propertyId:    stay.propertyId,
      type:          'INFORMATIONAL',
      category:      'CHECKIN_UNCONFIRMED',
      priority:      'MEDIUM',
      title:         `Check-in confirmado — ${stay.guestName}`,
      body:          `${stay.guestName} ingresó a Hab. ${stay.room.number}. Habitación en estado OCCUPIED.`,
      metadata:      { stayId, roomId: stay.roomId },
      actionUrl:     `/reservations/${stayId}`,
      recipientType: 'ROLE',
      recipientRole: 'SUPERVISOR',
      triggeredById: actorId,
    }).catch((err: Error) =>
      this.logger.warn(`[ConfirmCheckin] notification failed: ${err?.message}`),
    )

    this.logger.log(`[ConfirmCheckin] stay=${stayId} guest="${stay.guestName}" paid=${paidSoFar + paymentSum}`)
    return { success: true, actualCheckin: now.toISOString() }
  }

  /**
   * POST /v1/guest-stays/:id/payments
   * Registra un pago adicional sobre una estadía (sin tocar actualCheckin).
   * Útil para abonos parciales, cobros extra de mini-bar, extensiones, etc.
   */
  async registerPayment(stayId: string, dto: RegisterPaymentDto, actorId: string) {
    const orgId = this.tenant.getOrganizationId()

    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      select: { id: true, propertyId: true, currency: true, amountPaid: true, totalAmount: true, noShowAt: true },
    })
    if (!stay) throw new NotFoundException('Estadía no encontrada')
    if (stay.noShowAt) throw new BadRequestException('No se puede registrar pago en un no-show')

    if (
      (dto.method === PaymentMethod.CARD_TERMINAL || dto.method === PaymentMethod.BANK_TRANSFER) &&
      !dto.reference?.trim()
    ) {
      throw new BadRequestException(`El método ${dto.method} requiere número de referencia`)
    }
    if (
      (dto.method === PaymentMethod.COMP || dto.amount === 0) &&
      (!dto.approvedById?.trim() || !dto.approvalReason?.trim())
    ) {
      throw new ForbiddenException('Pagos COMP o $0 requieren aprobación del manager')
    }

    const now = new Date()
    const shiftDate = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z')
    const newAmountPaid = Number(stay.amountPaid) + dto.amount
    const totalAmount   = Number(stay.totalAmount)

    const [log] = await this.prisma.$transaction([
      this.prisma.paymentLog.create({
        data: {
          organizationId: orgId,
          propertyId:     stay.propertyId,
          stayId,
          method:         dto.method as any,
          amount:         dto.amount,
          currency:       stay.currency,
          reference:      dto.reference ?? null,
          approvedById:   dto.approvedById ?? null,
          approvalReason: dto.approvalReason ?? null,
          shiftDate,
          collectedById:  actorId,
        },
      }),
      this.prisma.guestStay.update({
        where: { id: stayId },
        data: {
          amountPaid:    newAmountPaid,
          paymentStatus: newAmountPaid >= totalAmount ? 'PAID' : newAmountPaid > 0 ? 'PARTIAL' : 'PENDING',
        },
      }),
    ])

    this.logger.log(`[RegisterPayment] stay=${stayId} method=${dto.method} amount=${dto.amount}`)
    return log
  }

  /**
   * POST /v1/guest-stays/payments/:paymentLogId/void
   * Anula un PaymentLog creando una entrada negativa (append-only).
   * El registro original nunca se modifica (USALI audit trail requirement).
   */
  async voidPayment(paymentLogId: string, dto: VoidPaymentDto, actorId: string) {
    const orgId = this.tenant.getOrganizationId()

    const original = await this.prisma.paymentLog.findUnique({
      where: { id: paymentLogId },
      include: { stay: { select: { organizationId: true, amountPaid: true, totalAmount: true, currency: true, propertyId: true } } },
    })
    if (!original) throw new NotFoundException('Registro de pago no encontrado')
    if (original.stay.organizationId !== orgId) throw new ForbiddenException()
    if (original.isVoid) throw new ConflictException('Este registro ya fue anulado')

    const voidEntry = await this.prisma.paymentLog.findFirst({ where: { voidsLogId: paymentLogId } })
    if (voidEntry) throw new ConflictException('Ya existe una anulación para este pago')

    const now         = new Date()
    const shiftDate   = new Date(now.toISOString().split('T')[0] + 'T00:00:00.000Z')
    const voidAmount  = -Number(original.amount)
    const newPaid     = Math.max(0, Number(original.stay.amountPaid) + voidAmount)
    const totalAmount = Number(original.stay.totalAmount)

    await this.prisma.$transaction([
      this.prisma.paymentLog.create({
        data: {
          organizationId: orgId,
          propertyId:     original.stay.propertyId,
          stayId:         original.stayId,
          method:         original.method,
          amount:         voidAmount,
          currency:       original.currency,
          isVoid:         true,
          voidedAt:       now,
          voidedById:     actorId,
          voidReason:     dto.voidReason,
          voidsLogId:     paymentLogId,
          shiftDate,
          collectedById:  actorId,
        },
      }),
      this.prisma.guestStay.update({
        where: { id: original.stayId },
        data: {
          amountPaid:    newPaid,
          paymentStatus: newPaid >= totalAmount ? 'PAID' : newPaid > 0 ? 'PARTIAL' : 'PENDING',
        },
      }),
    ])

    this.logger.log(`[VoidPayment] paymentLogId=${paymentLogId} amount=${original.amount} voided by ${actorId}`)
    return { success: true }
  }

  /**
   * GET /v1/guest-stays/cash-summary?propertyId=X&date=YYYY-MM-DD
   * Suma PaymentLog del turno por colector — para reconciliación de caja al cierre.
   */
  async getCashSummary(propertyId: string, dateStr: string) {
    const orgId    = this.tenant.getOrganizationId()
    const shiftDate = new Date(`${dateStr}T00:00:00.000Z`)

    const logs = await this.prisma.paymentLog.findMany({
      where: {
        organizationId: orgId,
        propertyId,
        shiftDate,
        method: 'CASH' as any,
        isVoid: false,
      },
      include: {
        collectedBy: { select: { id: true, name: true } },
      },
    })

    const byCollector = new Map<string, { name: string; total: number; count: number }>()
    let totalCash = 0

    for (const log of logs) {
      const amount = Number(log.amount)
      totalCash += amount
      const entry = byCollector.get(log.collectedById) ?? {
        name:  log.collectedBy.name,
        total: 0,
        count: 0,
      }
      entry.total += amount
      entry.count += 1
      byCollector.set(log.collectedById, entry)
    }

    return {
      date:        dateStr,
      propertyId,
      totalCash:   totalCash.toFixed(2),
      byCollector: Array.from(byCollector.entries()).map(([id, v]) => ({
        collectedById: id,
        collectorName: v.name,
        total:         v.total.toFixed(2),
        count:         v.count,
      })),
    }
  }

  /**
   * POST /v1/guest-stays/:id/contact-log
   * Registra un intento de contacto al huésped (WhatsApp, email, teléfono).
   * Append-only — el registro queda como evidencia ante disputas o chargebacks.
   */
  async logContact(
    stayId: string,
    actorId: string | null,
    channel: import('@prisma/client').ContactChannel,
    messagePreview?: string,
  ) {
    const orgId = this.tenant.getOrganizationId()
    const stay = await this.prisma.guestStay.findUnique({
      where: { id: stayId, organizationId: orgId },
      select: { id: true },
    })
    if (!stay) throw new NotFoundException(`Estadía ${stayId} no encontrada`)

    return this.prisma.guestContactLog.create({
      data: {
        stayId,
        channel,
        sentById: actorId,
        messagePreview: messagePreview?.slice(0, 160),
      },
    })
  }
}
