import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import {
  ChannexGateway,
  ChannexInventoryUpdate,
} from '../../integrations/channex/channex.gateway'

// ── AvailabilityService ─────────────────────────────────────────────────────
//
// Single source of truth for "is this room bookable in this range?".
// Combines:
//   (a) LOCAL  — GuestStay + StaySegment + SmartBlock queries
//   (b) REMOTE — Channex allotment (Sprint 8+, via ChannexGateway)
//
// Every feature that reserves/releases inventory MUST go through this service.
// Direct queries to GuestStay/StaySegment from feature services for availability
// checks are considered tech debt (see CLAUDE.md §29).

export interface AvailabilityCheckDto {
  roomId: string
  from: Date
  to: Date
  /** Exclude these segments/stays from the local check (they belong to the caller) */
  excludeSegmentIds?: string[]
  excludeStayIds?: string[]
  /** When the journey is being rearranged (split/move), all of its segments are excluded */
  excludeJourneyId?: string
}

export interface AvailabilityConflict {
  source: 'LOCAL_STAY' | 'LOCAL_SEGMENT' | 'LOCAL_BLOCK' | 'CHANNEX'
  id: string
  label: string      // human-readable ("Pedro & Carmen Vega", "Mantenimiento", "Booking.com")
  from: Date
  to: Date
}

export interface AvailabilityResult {
  available: boolean
  conflicts: AvailabilityConflict[]
  /** True if Channex was consulted; false if only local DB was checked */
  checkedChannex: boolean
}

export interface ReservationNotification {
  roomId: string
  from: Date
  to: Date
  reason: ChannexInventoryUpdate['reason']
  traceId: string
}

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly channex: ChannexGateway,
  ) {}

  /**
   * Check a room's availability in a date range against local DB and Channex.
   *
   * Half-open interval [from, to): a checkout on `to` does NOT conflict with a
   * check-in on `to`.
   *
   * Local query covers three entities:
   *   - GuestStay        (direct reservations, pre-journey era)
   *   - StaySegment      (per-segment availability: extensions, splits, moves)
   *   - SmartBlock       (maintenance, out-of-service)
   *
   * Channex pull is best-effort: if the gateway is disabled or fails, we fall
   * back to local-only. Never silently pass: if Channex reports conflict, we
   * MUST reject.
   */
  async check(dto: AvailabilityCheckDto): Promise<AvailabilityResult> {
    const conflicts: AvailabilityConflict[] = []

    // ── Local: direct GuestStay rows (excluding no-shows and checked-out) ────
    const excludeStayIds = dto.excludeStayIds ?? []
    const staysOnRoom = await this.prisma.guestStay.findMany({
      where: {
        roomId: dto.roomId,
        id: { notIn: excludeStayIds },
        deletedAt: null,
        actualCheckout: null,
        noShowAt: null,
        checkinAt: { lt: dto.to },
        scheduledCheckout: { gt: dto.from },
      },
      select: { id: true, guestName: true, checkinAt: true, scheduledCheckout: true },
    })
    for (const s of staysOnRoom) {
      conflicts.push({
        source: 'LOCAL_STAY',
        id: s.id,
        label: s.guestName,
        from: s.checkinAt,
        to: s.scheduledCheckout,
      })
    }

    // ── Local: StaySegment (the journey model) ──────────────────────────────
    const excludeSegmentIds = dto.excludeSegmentIds ?? []
    const segmentsOnRoom = await this.prisma.staySegment.findMany({
      where: {
        roomId: dto.roomId,
        id: { notIn: excludeSegmentIds },
        status: { in: ['ACTIVE', 'PENDING'] },
        ...(dto.excludeJourneyId
          ? { journeyId: { not: dto.excludeJourneyId } }
          : {}),
        checkIn: { lt: dto.to },
        checkOut: { gt: dto.from },
      },
      include: { journey: { select: { guestName: true } } },
    })
    for (const seg of segmentsOnRoom) {
      conflicts.push({
        source: 'LOCAL_SEGMENT',
        id: seg.id,
        label: seg.journey.guestName,
        from: seg.checkIn,
        to: seg.checkOut,
      })
    }

    // ── Local: RoomBlock (OOO / OOS / maintenance). endDate=null = indefinite ─
    const blocksOnRoom = await this.prisma.roomBlock.findMany({
      where: {
        roomId: dto.roomId,
        status: { in: ['ACTIVE', 'PENDING_APPROVAL', 'APPROVED'] },
        startDate: { lt: dto.to },
        OR: [{ endDate: null }, { endDate: { gt: dto.from } }],
      },
      select: { id: true, reason: true, startDate: true, endDate: true },
    })
    for (const b of blocksOnRoom) {
      conflicts.push({
        source: 'LOCAL_BLOCK',
        id: b.id,
        label: `Bloqueo: ${b.reason}`,
        from: b.startDate,
        to: b.endDate ?? dto.to,
      })
    }

    // ── Remote: Channex pull ────────────────────────────────────────────────
    // Map internal roomId → Channex roomTypeId. Sprint 8 will add a
    // RoomTypeMapping table; for now we pass roomId as a stand-in.
    let checkedChannex = false
    if (this.channex.enabled) {
      try {
        const pull = await this.channex.pullAvailability({
          roomTypeId: dto.roomId,
          dateFrom: dto.from,
          dateTo: dto.to,
        })
        checkedChannex = pull.fromChannex
        for (const slot of pull.slots) {
          if (slot.available < 1 || slot.stopSell) {
            conflicts.push({
              source: 'CHANNEX',
              id: `channex-${slot.roomTypeId}-${slot.date}`,
              label: slot.stopSell ? 'Channex: stop-sell' : 'Channex: sin allotment',
              from: new Date(slot.date),
              to: new Date(slot.date),
            })
          }
        }
      } catch (err) {
        // Policy: on Channex error we treat it as a soft-fail and continue with
        // local check. Log so ops can spot systemic issues. Sprint 8 may decide
        // to harden this to fail-closed for critical operations.
        this.logger.error(
          `Channex pull failed for room=${dto.roomId}: ${(err as Error).message}`,
        )
      }
    }

    return { available: conflicts.length === 0, conflicts, checkedChannex }
  }

  /**
   * Notify Channex that a room has been reserved locally. Fire-and-forget:
   * failures are logged, never thrown. Callers commit locally first, then call
   * this so a Channex outage cannot block the business operation.
   */
  async notifyReservation(n: ReservationNotification): Promise<void> {
    try {
      await this.channex.pushInventory({
        roomTypeId: n.roomId,
        dateFrom: n.from.toISOString().slice(0, 10),
        dateTo: n.to.toISOString().slice(0, 10),
        delta: -1,
        reason: n.reason,
        traceId: n.traceId,
      })
    } catch (err) {
      this.logger.error(
        `notifyReservation failed trace=${n.traceId}: ${(err as Error).message}`,
      )
    }
  }

  /**
   * Notify Channex that a room is freed (opposite of notifyReservation).
   */
  async notifyRelease(n: ReservationNotification): Promise<void> {
    try {
      await this.channex.pushInventory({
        roomTypeId: n.roomId,
        dateFrom: n.from.toISOString().slice(0, 10),
        dateTo: n.to.toISOString().slice(0, 10),
        delta: +1,
        reason: n.reason,
        traceId: n.traceId,
      })
    } catch (err) {
      this.logger.error(
        `notifyRelease failed trace=${n.traceId}: ${(err as Error).message}`,
      )
    }
  }

  /**
   * Compute absolute availability per date for a dorm room and push to Channex.
   *
   * Designed for hostels where a room_type in Channex = 1 dorm with N beds.
   * Channex expects absolute counts (availability=3 means "3 beds free today"),
   * not deltas. This guarantees idempotency: re-syncing always produces the
   * correct state regardless of prior pushes.
   *
   * Algorithm per date:
   *   available = max(0, totalUnits - activeStays - activeSegments - blockedSlots)
   *   where blockedSlots = totalUnits (room-level block) or 1 (unit-level block)
   *
   * Best-effort (CLAUDE.md §31): never throws, logs on failure.
   */
  async computeAndPushInventory(roomId: string, dates: Date[]): Promise<void> {
    if (!this.channex.enabled) return
    if (dates.length === 0) return

    try {
      const room = await this.prisma.room.findUnique({
        where: { id: roomId },
        select: {
          propertyId: true,
          channexRoomTypeId: true,
          units: { select: { id: true } },
        },
      })
      if (!room?.channexRoomTypeId) return

      const settings = await this.prisma.propertySettings.findUnique({
        where: { propertyId: room.propertyId },
        select: { channexPropertyId: true },
      })
      if (!settings?.channexPropertyId) return

      const channexPropertyId = settings.channexPropertyId
      const channexRoomTypeId  = room.channexRoomTypeId
      const totalUnits         = room.units.length
      if (totalUnits === 0) return

      const firstDate     = dates[0]
      const lastDate      = dates[dates.length - 1]
      const dayAfterLast  = new Date(lastDate)
      dayAfterLast.setUTCDate(dayAfterLast.getUTCDate() + 1)

      // 3 bulk queries for the full range — processed in-memory per date
      const [stays, segments, blocks] = await Promise.all([
        this.prisma.guestStay.findMany({
          where: {
            roomId,
            actualCheckout:    null,
            noShowAt:          null,
            checkinAt:         { lt: dayAfterLast },
            scheduledCheckout: { gt: firstDate },
          },
          select: { checkinAt: true, scheduledCheckout: true },
        }),
        this.prisma.staySegment.findMany({
          where: {
            roomId,
            status:   { in: ['ACTIVE', 'PENDING'] },
            checkIn:  { lt: dayAfterLast },
            checkOut: { gt: firstDate },
          },
          select: { checkIn: true, checkOut: true },
        }),
        // Room-level blocks (roomId set) OR unit-level blocks (unit.roomId matches)
        this.prisma.roomBlock.findMany({
          where: {
            status:    'ACTIVE',
            startDate: { lte: lastDate },
            AND: [
              { OR: [{ endDate: null }, { endDate: { gt: firstDate } }] },
              { OR: [{ roomId }, { unit: { roomId } }] },
            ],
          },
          select: { roomId: true, unitId: true, startDate: true, endDate: true },
        }),
      ])

      const traceId = `abs-sync-${roomId}-${Date.now()}`
      const entries: { date: string; available: number }[] = []

      for (const date of dates) {
        // Exclusive upper bound of the day (next midnight UTC)
        const dEnd = new Date(date)
        dEnd.setUTCDate(dEnd.getUTCDate() + 1)

        const staysOnDay = stays.filter(
          (s) => s.checkinAt < dEnd && s.scheduledCheckout > date,
        ).length

        const segsOnDay = segments.filter(
          (s) => s.checkIn < dEnd && s.checkOut > date,
        ).length

        // Room-level block occupies all N units; unit-level block occupies 1
        let blockedSlots = 0
        for (const b of blocks) {
          const bEnd = b.endDate ?? dayAfterLast
          if (b.startDate <= date && bEnd > date) {
            blockedSlots += b.roomId ? totalUnits : 1
          }
        }

        const available = Math.max(0, totalUnits - staysOnDay - segsOnDay - blockedSlots)
        entries.push({ date: date.toISOString().slice(0, 10), available })
      }

      await this.channex.pushAbsoluteAvailability({
        channexPropertyId,
        roomTypeId: channexRoomTypeId,
        entries,
        traceId,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      this.logger.error(`[computeAndPushInventory] roomId=${roomId}: ${msg}`)
    }
  }
}
