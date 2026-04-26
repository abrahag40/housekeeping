import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma, StaySegment } from '@prisma/client'
import { eachDayOfInterval, isBefore, startOfDay, subDays } from 'date-fns'
import { NotificationsService } from '../../notifications/notifications.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AvailabilityService } from '../availability/availability.service'
import {
  ExtendNewRoomDto,
  ExtendSameRoomDto,
  RoomMoveDto,
  SplitReservationServiceDto,
} from './dto/stay-journey.dto'

type ActiveSegment = {
  id: string
  roomId: string
  checkIn: Date
  checkOut: Date
  status: string
  locked: boolean
  rateSnapshot: Prisma.Decimal | null
}

@Injectable()
export class StayJourneyService {
  private readonly logger = new Logger(StayJourneyService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly notifications: NotificationsService,
    private readonly availability: AvailabilityService,
  ) {}

  async findById(journeyId: string) {
    const journey = await this.prisma.stayJourney.findUnique({
      where: { id: journeyId },
      include: {
        segments: {
          orderBy: { checkIn: 'asc' },
          include: {
            nights: true,
            room: { select: { id: true, number: true } },
          },
        },
      },
    })
    if (!journey) throw new NotFoundException(`Journey ${journeyId} not found`)
    return journey
  }

  async findActiveForTimeline(propertyId: string, from: Date, to: Date) {
    return this.prisma.stayJourney.findMany({
      where: {
        propertyId,
        // Include NO_SHOW journeys so their segments appear in the calendar as
        // NS stripe blocks. The frontend filters them when hideNoShows=true.
        status: { in: ['ACTIVE', 'NO_SHOW'] },
        journeyCheckIn: { lt: to },
        journeyCheckOut: { gt: from },
      },
      include: {
        segments: {
          where: { status: { not: 'CANCELLED' } },
          include: {
            room: { select: { id: true, number: true } },
          },
        },
      },
      orderBy: { journeyCheckIn: 'asc' },
    })
  }

  async extendSameRoom(dto: ExtendSameRoomDto): Promise<StaySegment> {
    const journey = await this.findById(dto.journeyId)
    const activeSegment = this.getActiveSegment(journey.segments)

    const newCheckOut = startOfDay(new Date(dto.newCheckOut))
    if (newCheckOut <= activeSegment.checkOut) {
      throw new BadRequestException('newCheckOut must be after the current segment checkOut')
    }

    await this.assertRoomAvailable(
      activeSegment.roomId,
      activeSegment.checkOut,
      newCheckOut,
      activeSegment.id,
      dto.journeyId,
    )

    const newSegment = await this.prisma.$transaction(async (tx) => {
      const segment = await tx.staySegment.create({
        data: {
          journeyId: dto.journeyId,
          roomId: activeSegment.roomId,
          checkIn: startOfDay(activeSegment.checkOut),
          checkOut: newCheckOut,
          status: 'ACTIVE',
          locked: false,
          reason: 'EXTENSION_SAME_ROOM',
          rateSnapshot: activeSegment.rateSnapshot,
        },
      })

      await this.createSegmentNights(
        tx,
        segment.id,
        segment.checkIn,
        segment.checkOut,
        activeSegment.rateSnapshot,
      )

      await tx.stayJourney.update({
        where: { id: dto.journeyId },
        data: { journeyCheckOut: newCheckOut },
      })

      await tx.stayJourneyEvent.create({
        data: {
          journeyId: dto.journeyId,
          eventType: 'EXTENSION_APPROVED',
          actorId: dto.actorId,
          payload: {
            reason: 'EXTENSION_SAME_ROOM',
            roomId: activeSegment.roomId,
            previousCheckOut: activeSegment.checkOut,
            newCheckOut,
          },
        },
      })

      return segment
    })

    this.events.emit('stay.extended', {
      journeyId: dto.journeyId,
      roomId: activeSegment.roomId,
      newCheckOut,
    })

    return newSegment
  }

  /**
   * Creates a StayJourney from scratch for a plain GuestStay and adds an
   * EXTENSION_SAME_ROOM segment. Called when the receptionist drags the extend
   * handle on a block that has no journey yet.
   */
  async initJourneyAndExtend(params: {
    guestStayId: string
    guestName: string
    guestEmail: string | null
    organizationId: string
    propertyId: string
    roomId: string
    checkinAt: Date
    scheduledCheckout: Date
    newCheckOut: Date
    ratePerNight: Prisma.Decimal
    actorId: string | null
  }): Promise<StaySegment> {
    const {
      guestStayId, guestName, guestEmail, organizationId, propertyId,
      roomId, checkinAt, scheduledCheckout, newCheckOut: rawNewCheckOut, ratePerNight, actorId,
    } = params

    const origCheckIn = startOfDay(checkinAt)
    const origCheckOut = startOfDay(scheduledCheckout)
    const extCheckOut = startOfDay(rawNewCheckOut)

    if (extCheckOut <= origCheckOut) {
      throw new BadRequestException('newCheckOut must be after the current scheduledCheckout')
    }

    await this.assertRoomAvailable(roomId, origCheckOut, extCheckOut)

    const extSegment = await this.prisma.$transaction(async (tx) => {
      const journey = await tx.stayJourney.create({
        data: {
          organizationId,
          propertyId,
          guestStayId,
          guestName,
          guestEmail,
          journeyCheckIn: origCheckIn,
          journeyCheckOut: extCheckOut,
          status: 'ACTIVE',
        },
      })

      const origSeg = await tx.staySegment.create({
        data: {
          journeyId: journey.id,
          roomId,
          guestStayId,
          checkIn: origCheckIn,
          checkOut: origCheckOut,
          status: 'ACTIVE',
          locked: true,
          reason: 'ORIGINAL',
          rateSnapshot: ratePerNight,
        },
      })
      await this.createSegmentNights(tx, origSeg.id, origCheckIn, origCheckOut, ratePerNight)

      const extSeg = await tx.staySegment.create({
        data: {
          journeyId: journey.id,
          roomId,
          checkIn: origCheckOut,
          checkOut: extCheckOut,
          status: 'ACTIVE',
          locked: false,
          reason: 'EXTENSION_SAME_ROOM',
          rateSnapshot: ratePerNight,
        },
      })
      await this.createSegmentNights(tx, extSeg.id, origCheckOut, extCheckOut, ratePerNight)

      await tx.stayJourneyEvent.create({
        data: {
          journeyId: journey.id,
          eventType: 'EXTENSION_APPROVED',
          actorId,
          payload: {
            reason: 'EXTENSION_SAME_ROOM',
            roomId,
            previousCheckOut: origCheckOut,
            newCheckOut: extCheckOut,
          },
        },
      })

      return extSeg
    })

    this.events.emit('stay.extended', {
      guestStayId,
      roomId,
      newCheckOut: extCheckOut,
    })

    return extSegment
  }

  async extendNewRoom(dto: ExtendNewRoomDto): Promise<StaySegment> {
    const journey = await this.findById(dto.journeyId)
    const activeSegment = this.getActiveSegment(journey.segments)

    const newCheckOut = startOfDay(new Date(dto.newCheckOut))
    if (newCheckOut <= activeSegment.checkOut) {
      throw new BadRequestException('newCheckOut must be after the current segment checkOut')
    }

    await this.assertRoomAvailable(
      dto.newRoomId,
      activeSegment.checkOut,
      newCheckOut,
      undefined,
      dto.journeyId,
    )

    const newSegment = await this.prisma.$transaction(async (tx) => {
      const segment = await tx.staySegment.create({
        data: {
          journeyId: dto.journeyId,
          roomId: dto.newRoomId,
          checkIn: startOfDay(activeSegment.checkOut),
          checkOut: newCheckOut,
          status: 'ACTIVE',
          locked: false,
          reason: 'EXTENSION_NEW_ROOM',
          rateSnapshot: activeSegment.rateSnapshot,
        },
      })

      await this.createSegmentNights(
        tx,
        segment.id,
        segment.checkIn,
        segment.checkOut,
        activeSegment.rateSnapshot,
      )

      await tx.stayJourney.update({
        where: { id: dto.journeyId },
        data: { journeyCheckOut: newCheckOut },
      })

      await tx.stayJourneyEvent.create({
        data: {
          journeyId: dto.journeyId,
          eventType: 'EXTENSION_APPROVED',
          actorId: dto.actorId,
          payload: {
            reason: 'EXTENSION_NEW_ROOM',
            previousRoomId: activeSegment.roomId,
            newRoomId: dto.newRoomId,
            previousCheckOut: activeSegment.checkOut,
            newCheckOut,
          },
        },
      })

      return segment
    })

    this.events.emit('stay.extended', {
      journeyId: dto.journeyId,
      roomId: dto.newRoomId,
      newCheckOut,
    })

    // Housekeeping bridge: the old room is vacated at activeSegment.checkOut.
    // Create PENDING cleaning tasks for each unit in that room so housekeeping
    // knows it needs servicing (room change, not checkout — guest is still in-house).
    await this.createRoomChangeTasks(
      journey.propertyId,
      activeSegment.roomId,
    )

    return newSegment
  }

  async executeMidStayRoomMove(dto: RoomMoveDto): Promise<StaySegment> {
    const journey = await this.findById(dto.journeyId)

    if (journey.status !== 'ACTIVE') {
      throw new BadRequestException('No se puede cambiar de habitación a un huésped que ya realizó checkout')
    }

    const activeSegment = this.getActiveSegment(journey.segments)

    const effectiveDate = startOfDay(new Date(dto.effectiveDate))
    const today = startOfDay(new Date())

    if (isBefore(effectiveDate, today)) {
      throw new BadRequestException('effectiveDate cannot be in the past')
    }

    if (dto.newRoomId === activeSegment.roomId) {
      throw new BadRequestException('newRoomId must be different from the current room')
    }

    await this.assertRoomAvailable(
      dto.newRoomId,
      effectiveDate,
      activeSegment.checkOut,
      undefined,
      dto.journeyId,
    )

    const originalCheckOut = activeSegment.checkOut

    const newSegment = await this.prisma.$transaction(async (tx) => {
      await tx.segmentNight.updateMany({
        where: {
          segmentId: activeSegment.id,
          date: { lt: effectiveDate },
          locked: false,
        },
        data: { locked: true, status: 'LOCKED' },
      })

      await tx.segmentNight.deleteMany({
        where: {
          segmentId: activeSegment.id,
          date: { gte: effectiveDate },
          locked: false,
        },
      })

      await tx.staySegment.update({
        where: { id: activeSegment.id },
        data: { checkOut: effectiveDate, status: 'COMPLETED', locked: true },
      })

      const segment = await tx.staySegment.create({
        data: {
          journeyId: dto.journeyId,
          roomId: dto.newRoomId,
          checkIn: effectiveDate,
          checkOut: originalCheckOut,
          status: 'ACTIVE',
          locked: false,
          reason: 'ROOM_MOVE',
          rateSnapshot: activeSegment.rateSnapshot,
        },
      })

      await this.createSegmentNights(
        tx,
        segment.id,
        segment.checkIn,
        segment.checkOut,
        activeSegment.rateSnapshot,
      )

      await tx.stayJourneyEvent.create({
        data: {
          journeyId: dto.journeyId,
          eventType: 'ROOM_MOVE_EXECUTED',
          actorId: dto.actorId,
          payload: {
            fromRoomId: activeSegment.roomId,
            toRoomId: dto.newRoomId,
            effectiveDate,
            fromSegmentId: activeSegment.id,
            toSegmentId: segment.id,
          },
        },
      })

      return segment
    })

    this.events.emit('stay.room_moved', {
      journeyId: dto.journeyId,
      fromRoomId: activeSegment.roomId,
      toRoomId: dto.newRoomId,
      effectiveDate,
    })

    // Housekeeping bridge: the old room is vacated at effectiveDate.
    // Create PENDING cleaning tasks so housekeeping is notified of the room change.
    await this.createRoomChangeTasks(
      journey.propertyId,
      activeSegment.roomId,
    )

    // Channel manager sync — fire-and-forget (CLAUDE.md §31).
    // Release old room from effectiveDate onward; reserve new room for the same window.
    const mmTraceId = `room-move-${dto.journeyId}-${Date.now()}`
    void this.availability.notifyRelease({
      roomId: activeSegment.roomId,
      from: effectiveDate,
      to: originalCheckOut,
      reason: 'ROOM_MOVE',
      traceId: mmTraceId,
    })
    void this.availability.notifyReservation({
      roomId: dto.newRoomId,
      from: effectiveDate,
      to: originalCheckOut,
      reason: 'ROOM_MOVE',
      traceId: mmTraceId,
    })

    return newSegment
  }

  /**
   * splitReservation — Reemplaza los segmentos ACTIVE del journey con N segmentos
   * nuevos, cada uno en su propia habitación y rango. Soporta ARRIVING (toda la
   * reserva futura) e IN_HOUSE (conserva las noches ya pasadas en la habitación
   * actual; el primer part debe usar esa misma habitación).
   *
   * Validaciones:
   *   - journey ACTIVE
   *   - parts cubren exactamente [journey.checkIn, journey.checkOut] sin gaps/overlaps
   *   - cada part.roomId disponible en su rango
   *   - IN_HOUSE: parts[0].roomId === activeSegment.roomId y parts[0].checkOut > today
   */
  async splitReservation(dto: SplitReservationServiceDto): Promise<StaySegment[]> {
    const journey = await this.findById(dto.journeyId)

    if (journey.status !== 'ACTIVE') {
      throw new BadRequestException(
        'No se puede dividir una reserva que no está ACTIVE',
      )
    }

    const today = startOfDay(new Date())
    const parts = dto.parts
      .map((p) => ({
        roomId: p.roomId,
        checkIn: startOfDay(new Date(p.checkIn)),
        checkOut: startOfDay(new Date(p.checkOut)),
      }))
      .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())

    const journeyIn = startOfDay(new Date(journey.journeyCheckIn))
    const journeyOut = startOfDay(new Date(journey.journeyCheckOut))
    if (parts[0].checkIn.getTime() !== journeyIn.getTime()) {
      throw new BadRequestException(
        'La primera parte debe empezar en el check-in del journey',
      )
    }
    if (parts[parts.length - 1].checkOut.getTime() !== journeyOut.getTime()) {
      throw new BadRequestException(
        'La última parte debe terminar en el check-out del journey',
      )
    }
    for (let i = 0; i < parts.length; i++) {
      if (!isBefore(parts[i].checkIn, parts[i].checkOut)) {
        throw new BadRequestException(`Parte ${i + 1}: checkIn debe ser anterior a checkOut`)
      }
      if (i > 0 && parts[i].checkIn.getTime() !== parts[i - 1].checkOut.getTime()) {
        throw new BadRequestException(
          `Gap u overlap entre parte ${i} y parte ${i + 1}`,
        )
      }
    }

    // Detección IN_HOUSE: algún segmento ACTIVE cuyo checkIn ya pasó
    const activeSegments = journey.segments.filter(
      (s) => s.status === 'ACTIVE',
    )
    const isInHouse = activeSegments.some(
      (s) => !isBefore(today, startOfDay(s.checkIn)),
    )

    let activeSegment: ActiveSegment | null = null
    if (isInHouse) {
      activeSegment = this.getActiveSegment(journey.segments)
      if (parts[0].roomId !== activeSegment.roomId) {
        throw new BadRequestException(
          'IN_HOUSE: la primera parte debe mantener la habitación actual del huésped',
        )
      }
      if (!isBefore(today, parts[0].checkOut)) {
        throw new BadRequestException(
          'IN_HOUSE: la primera parte debe incluir al menos hasta hoy',
        )
      }
    }

    // Validación de disponibilidad vía AvailabilityService — cubre local DB
    // (GuestStay + StaySegment + RoomBlock) Y Channex.io (channel manager).
    // Sprint 8+: un split rechaza si Channex reporta stop-sell o allotment=0.
    // Ver CLAUDE.md §29 — toda operación de inventario pasa por este servicio.
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const result = await this.availability.check({
        roomId: part.roomId,
        from: part.checkIn,
        to: part.checkOut,
        // Los segmentos del propio journey se van a cancelar/reemplazar — excluirlos.
        excludeJourneyId: dto.journeyId,
      })
      if (!result.available) {
        const c = result.conflicts[0]
        throw new ConflictException(
          `Parte ${i + 1}: habitación no disponible — ${c.label}` +
            (c.source === 'CHANNEX' ? ' (canal externo)' : ''),
        )
      }
    }

    const rateSnapshot =
      activeSegment?.rateSnapshot ?? activeSegments[0]?.rateSnapshot ?? null

    const createdSegments = await this.prisma.$transaction(async (tx) => {
      // Lock noches pasadas, borrar noches futuras de cada segmento ACTIVE
      for (const seg of activeSegments) {
        await tx.segmentNight.updateMany({
          where: { segmentId: seg.id, date: { lt: today }, locked: false },
          data: { locked: true, status: 'LOCKED' },
        })
        await tx.segmentNight.deleteMany({
          where: { segmentId: seg.id, date: { gte: today }, locked: false },
        })
      }

      // Truncar/cancelar segmentos ACTIVE
      for (const seg of activeSegments) {
        if (isInHouse && activeSegment && seg.id === activeSegment.id) {
          // Truncar el segmento activo principal a `today` como COMPLETED+locked
          await tx.staySegment.update({
            where: { id: seg.id },
            data: { checkOut: today, status: 'COMPLETED', locked: true },
          })
        } else {
          // Resto: cancelar. En ARRIVING esto incluye el ORIGINAL.
          await tx.staySegment.update({
            where: { id: seg.id },
            data: { status: 'CANCELLED' },
          })
        }
      }

      // Crear N segmentos nuevos
      const created: StaySegment[] = []
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        // En IN_HOUSE parts[0] se materializa como: (truncated original hasta today) + (nuevo segment hoy→part.checkOut)
        // Por eso, para parts[0] en IN_HOUSE creamos un segmento SPLIT que arranca en `today`.
        const segCheckIn =
          isInHouse && i === 0 ? today : part.checkIn
        if (!isBefore(segCheckIn, part.checkOut)) {
          // Defensivo: si por timezone el rango queda vacío, saltar
          continue
        }
        const isFirstAndArriving = !isInHouse && i === 0
        const reason = isFirstAndArriving ? 'ORIGINAL' : 'SPLIT'
        const segment = await tx.staySegment.create({
          data: {
            journeyId: dto.journeyId,
            roomId: part.roomId,
            guestStayId: isFirstAndArriving ? journey.guestStayId : null,
            checkIn: segCheckIn,
            checkOut: part.checkOut,
            status: 'ACTIVE',
            locked: false,
            reason,
            rateSnapshot,
          },
        })
        await this.createSegmentNights(
          tx,
          segment.id,
          segCheckIn,
          part.checkOut,
          rateSnapshot,
        )
        created.push(segment)
      }

      await tx.stayJourneyEvent.create({
        data: {
          journeyId: dto.journeyId,
          eventType: 'JOURNEY_SPLIT',
          actorId: dto.actorId,
          payload: {
            parts: parts.map((p) => ({
              roomId: p.roomId,
              checkIn: p.checkIn,
              checkOut: p.checkOut,
            })),
            isInHouse,
          },
        },
      })

      return created
    })

    this.events.emit('stay.split', {
      journeyId: dto.journeyId,
      partsCount: parts.length,
    })

    // Housekeeping bridge: crear CleaningTask(PENDING) para cada habitación
    // liberada (estaba en algún segmento activo previo y NO aparece en ningún part).
    const previousRoomIds = new Set(activeSegments.map((s) => s.roomId))
    const newRoomIds = new Set(parts.map((p) => p.roomId))
    for (const roomId of previousRoomIds) {
      if (!newRoomIds.has(roomId)) {
        await this.createRoomChangeTasks(journey.propertyId, roomId)
      }
    }

    // Channel manager sync (Channex.io) — fire-and-forget. Each new part
    // decrements allotment for its range, each fully-released room increments.
    // Gateway is a stub until Sprint 8; calls are already wired so the migration
    // is zero-refactor. Failures are logged inside the service, never thrown.
    const traceId = `split-${dto.journeyId}-${Date.now()}`
    for (const part of parts) {
      void this.availability.notifyReservation({
        roomId: part.roomId,
        from: part.checkIn,
        to: part.checkOut,
        reason: 'SPLIT',
        traceId,
      })
    }
    for (const roomId of previousRoomIds) {
      if (!newRoomIds.has(roomId)) {
        const prev = activeSegments.find((s) => s.roomId === roomId)
        if (prev) {
          void this.availability.notifyRelease({
            roomId,
            from: prev.checkIn,
            to: prev.checkOut,
            reason: 'SPLIT',
            traceId,
          })
        }
      }
    }

    return createdSegments
  }

  /**
   * moveExtensionRoom — Reasigna un segmento del journey a una habitación diferente.
   *
   * Acepta segmentos **no bloqueados** con reason ORIGINAL, EXTENSION_SAME_ROOM o
   * EXTENSION_NEW_ROOM. ROOM_MOVE y SPLIT son inmutables (representan historia
   * planeada — mover su roomId rompería el audit trail del journey).
   *
   * Para extensiones, el `reason` se recalcula según si el nuevo cuarto coincide
   * con el ORIGINAL del journey (EXTENSION_SAME_ROOM vs EXTENSION_NEW_ROOM).
   * Para ORIGINAL, el reason se mantiene y, si hay `guestStayId` asociado,
   * también se sincroniza `GuestStay.roomId` para que vistas legacy (planning,
   * housekeeping) queden consistentes.
   */
  async moveExtensionRoom(segmentId: string, newRoomId: string) {
    const segment = await this.prisma.staySegment.findUniqueOrThrow({
      where: { id: segmentId },
      include: {
        journey: {
          include: {
            segments: {
              where: { reason: 'ORIGINAL' },
              select: { roomId: true },
            },
          },
        },
      },
    })

    const movableReasons: Array<typeof segment.reason> = [
      'ORIGINAL',
      'EXTENSION_SAME_ROOM',
      'EXTENSION_NEW_ROOM',
    ]
    if (!movableReasons.includes(segment.reason)) {
      throw new BadRequestException(
        'Solo se pueden reubicar segmentos ORIGINAL o de extensión (ROOM_MOVE y SPLIT son inmutables)',
      )
    }
    if (segment.locked) {
      throw new BadRequestException(
        'El segmento está bloqueado y no puede reubicarse',
      )
    }

    await this.assertRoomAvailable(
      newRoomId,
      segment.checkIn,
      segment.checkOut,
      segmentId,
      segment.journeyId,
    )

    const originalRoomId = segment.journey.segments[0]?.roomId
    const newReason =
      segment.reason === 'ORIGINAL'
        ? 'ORIGINAL'
        : newRoomId === originalRoomId
          ? 'EXTENSION_SAME_ROOM'
          : 'EXTENSION_NEW_ROOM'

    const updated = await this.prisma.$transaction(async (tx) => {
      const seg = await tx.staySegment.update({
        where: { id: segmentId },
        data: { roomId: newRoomId, reason: newReason },
      })

      // For ORIGINAL segments linked to a GuestStay, keep GuestStay.roomId in
      // sync so planning/housekeeping queries resolve the right room. Skipped
      // for extensions (they live only in the journey layer).
      if (segment.reason === 'ORIGINAL' && segment.guestStayId) {
        await tx.guestStay.update({
          where: { id: segment.guestStayId },
          data: { roomId: newRoomId },
        })
      }

      return seg
    })

    // Channel manager sync — fire-and-forget (CLAUDE.md §31).
    const erTraceId = `ext-move-${segmentId}-${Date.now()}`
    void this.availability.notifyRelease({
      roomId: segment.roomId,
      from: segment.checkIn,
      to: segment.checkOut,
      reason: 'ROOM_MOVE',
      traceId: erTraceId,
    })
    void this.availability.notifyReservation({
      roomId: newRoomId,
      from: segment.checkIn,
      to: segment.checkOut,
      reason: 'ROOM_MOVE',
      traceId: erTraceId,
    })

    return updated
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /** Creates PENDING cleaning tasks for all units in a vacated room (room-change bridge
   *  to housekeeping) and emits `task:planned` SSE so the dashboard updates immediately. */
  private async createRoomChangeTasks(
    propertyId: string,
    roomId: string,
  ): Promise<void> {
    const units = await this.prisma.unit.findMany({
      where: { roomId },
      select: { id: true },
    })

    if (units.length === 0) return

    await this.prisma.cleaningTask.createMany({
      data: units.map((unit) => ({
        unitId: unit.id,
        taskType: 'CLEANING' as const,
        status: 'PENDING' as const,
        priority: 'MEDIUM' as const,
      })),
    })

    this.notifications.emit(propertyId, 'task:planned', { roomId })
  }

  private getActiveSegment(segments: ActiveSegment[]): ActiveSegment {
    // The "active" segment is the LAST one chronologically that is ACTIVE and unlocked.
    // Using find() (first match) was wrong: when a ROOM_MOVE is followed by an
    // EXTENSION_SAME_ROOM, both are unlocked ACTIVE — find() returned the ROOM_MOVE
    // causing assertRoomAvailable to conflict against the existing EXTENSION.
    const active = [...segments]
      .filter((s) => s.status === 'ACTIVE' && !s.locked)
      .sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())[0]
    if (!active) {
      throw new BadRequestException('No active unlocked segment found for this journey')
    }
    return active
  }

  // TODO(sprint8-migrate): reemplazar por this.availability.check(...).
  // Motivo: CLAUDE.md §29 exige que TODA validación de inventario pase por
  // AvailabilityService (cubre local DB + Channex channel manager). Esta función
  // solo consulta StaySegment local, dejando invisible el cross-channel overbooking.
  // Ya fue migrado en splitReservation(); extendSameRoom / extendNewRoom /
  // executeMidStayRoomMove / moveExtensionRoom deben migrarse en Sprint 8.
  private async assertRoomAvailable(
    roomId: string,
    from: Date,
    to: Date,
    excludeSegmentId?: string,
    excludeJourneyId?: string,
  ) {
    // Segments belonging to the SAME journey represent the same guest being
    // rearranged across rooms/dates — they must not block each other as inventory
    // conflicts. This also neutralises fractional-hour overlaps caused by the
    // inconsistency between real hotel times (15:00 check-in, 12:00 check-out on
    // legacy ORIGINAL segments) and `startOfDay` normalization applied to new
    // extension segments. See CLAUDE.md §29 (sprint8-migrate) — AvailabilityService
    // will centralise this check for all inventory queries.
    const conflict = await this.prisma.staySegment.findFirst({
      where: {
        roomId,
        status: { in: ['ACTIVE', 'PENDING'] },
        ...(excludeSegmentId && { id: { not: excludeSegmentId } }),
        ...(excludeJourneyId && { journeyId: { not: excludeJourneyId } }),
        checkIn: { lt: to },
        checkOut: { gt: from },
        // Exclude segments belonging to no-show stays — noShowAt releases inventory
        // immediately (CLAUDE.md §17). Their segments remain ACTIVE in DB but should
        // not block new reservations for the same period.
        journey: { guestStay: { noShowAt: null } },
      },
    })
    if (conflict) {
      throw new ConflictException(`Room ${roomId} is not available for the requested period`)
    }
  }

  private async createSegmentNights(
    tx: Prisma.TransactionClient,
    segmentId: string,
    checkIn: Date,
    checkOut: Date,
    rate: Prisma.Decimal | null,
  ) {
    if (checkIn >= checkOut) return

    const lastNight = subDays(checkOut, 1)
    const dates = eachDayOfInterval({ start: checkIn, end: lastNight })
    const today = startOfDay(new Date())

    await tx.segmentNight.createMany({
      data: dates.map((date) => {
        const locked = isBefore(date, today)
        return {
          segmentId,
          date,
          rate: rate ?? 0,
          locked,
          status: locked ? ('LOCKED' as const) : ('PENDING' as const),
        }
      }),
    })
  }
}
