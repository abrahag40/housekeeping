/**
 * stay-journeys.service.spec.ts
 *
 * Tests unitarios para StayJourneyService.
 * Patrón: mocks de Prisma con jest.fn(), $transaction ejecuta callback con prismaMock.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { StayJourneyService } from './stay-journeys.service'
import { PrismaService } from '../../prisma/prisma.service'

// ─── Builders ────────────────────────────────────────────────────────────────

function makeSegment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'seg-1',
    journeyId: 'journey-1',
    roomId: 'room-1',
    checkIn: new Date('2026-04-01T00:00:00.000Z'),
    checkOut: new Date('2026-04-07T00:00:00.000Z'),
    status: 'ACTIVE',
    locked: false,
    reason: 'ORIGINAL',
    rateSnapshot: 90,
    nights: [],
    room: { id: 'room-1', number: '101' },
    ...overrides,
  }
}

function makeJourney(segments: ReturnType<typeof makeSegment>[] = [makeSegment()]) {
  return {
    id: 'journey-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    guestStayId: 'stay-1',
    guestName: 'Test Guest',
    guestEmail: null,
    status: 'ACTIVE',
    journeyCheckIn: new Date('2026-04-01T00:00:00.000Z'),
    journeyCheckOut: new Date('2026-04-07T00:00:00.000Z'),
    segments,
  }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

describe('StayJourneyService', () => {
  let service: StayJourneyService

  const prismaMock = {
    stayJourney: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    staySegment: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    segmentNight: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    stayJourneyEvent: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn(prismaMock)),
  }

  const eventsMock = { emit: jest.fn() }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StayJourneyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventEmitter2, useValue: eventsMock },
      ],
    }).compile()

    service = module.get<StayJourneyService>(StayJourneyService)
    jest.clearAllMocks()
  })

  // ─── extendSameRoom ─────────────────────────────────────────────────────────

  describe('extendSameRoom', () => {
    it('crea segmento con reason EXTENSION_SAME_ROOM', async () => {
      // Arrange
      const segment = makeSegment()
      const journey = makeJourney([segment])
      const newSegment = makeSegment({
        id: 'seg-2',
        checkIn: new Date('2026-04-07T00:00:00.000Z'),
        checkOut: new Date('2026-04-10T00:00:00.000Z'),
        reason: 'EXTENSION_SAME_ROOM',
      })

      prismaMock.stayJourney.findUnique.mockResolvedValue(journey)
      prismaMock.staySegment.findFirst.mockResolvedValue(null) // no overlap
      prismaMock.staySegment.create.mockResolvedValue(newSegment)
      prismaMock.segmentNight.createMany.mockResolvedValue({ count: 3 })
      prismaMock.stayJourney.update.mockResolvedValue({})
      prismaMock.stayJourneyEvent.create.mockResolvedValue({})

      // Act
      const result = await service.extendSameRoom({
        journeyId: 'journey-1',
        newCheckOut: '2026-04-10',
        actorId: 'actor-1',
      })

      // Assert
      expect(prismaMock.staySegment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ reason: 'EXTENSION_SAME_ROOM' }) }),
      )
      expect(result.id).toBe('seg-2')
    })

    it('lanza BadRequestException si newCheckOut <= checkOut actual', async () => {
      // Arrange
      const segment = makeSegment({ checkOut: new Date('2026-04-07T00:00:00.000Z') })
      prismaMock.stayJourney.findUnique.mockResolvedValue(makeJourney([segment]))

      // Act & Assert — misma fecha que checkOut
      await expect(
        service.extendSameRoom({
          journeyId: 'journey-1',
          newCheckOut: '2026-04-07', // igual al checkOut actual
          actorId: 'actor-1',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('lanza ConflictException si hay solapamiento de habitación', async () => {
      // Arrange
      const segment = makeSegment()
      prismaMock.stayJourney.findUnique.mockResolvedValue(makeJourney([segment]))
      prismaMock.staySegment.findFirst.mockResolvedValue({ id: 'other-seg' }) // solapamiento

      // Act & Assert
      await expect(
        service.extendSameRoom({
          journeyId: 'journey-1',
          newCheckOut: '2026-04-10',
          actorId: 'actor-1',
        }),
      ).rejects.toThrow(ConflictException)
    })
  })

  // ─── extendNewRoom ──────────────────────────────────────────────────────────

  describe('extendNewRoom', () => {
    it('crea segmento con reason EXTENSION_NEW_ROOM en la nueva habitación', async () => {
      // Arrange
      const segment = makeSegment()
      const newSegment = makeSegment({
        id: 'seg-2',
        roomId: 'room-2',
        reason: 'EXTENSION_NEW_ROOM',
      })

      prismaMock.stayJourney.findUnique.mockResolvedValue(makeJourney([segment]))
      prismaMock.staySegment.findFirst.mockResolvedValue(null)
      prismaMock.staySegment.create.mockResolvedValue(newSegment)
      prismaMock.segmentNight.createMany.mockResolvedValue({ count: 3 })
      prismaMock.stayJourney.update.mockResolvedValue({})
      prismaMock.stayJourneyEvent.create.mockResolvedValue({})

      // Act
      const result = await service.extendNewRoom({
        journeyId: 'journey-1',
        newRoomId: 'room-2',
        newCheckOut: '2026-04-10',
        actorId: 'actor-1',
      })

      // Assert
      expect(prismaMock.staySegment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            reason: 'EXTENSION_NEW_ROOM',
            roomId: 'room-2',
          }),
        }),
      )
      expect(result.id).toBe('seg-2')
    })

    it('lanza ConflictException si la nueva habitación no está disponible', async () => {
      // Arrange
      const segment = makeSegment()
      prismaMock.stayJourney.findUnique.mockResolvedValue(makeJourney([segment]))
      prismaMock.staySegment.findFirst.mockResolvedValue({ id: 'blocking-seg' }) // solapamiento

      // Act & Assert
      await expect(
        service.extendNewRoom({
          journeyId: 'journey-1',
          newRoomId: 'room-2',
          newCheckOut: '2026-04-10',
          actorId: 'actor-1',
        }),
      ).rejects.toThrow(ConflictException)
    })
  })

  // ─── executeMidStayRoomMove ─────────────────────────────────────────────────

  describe('executeMidStayRoomMove', () => {
    it('cierra segmento actual con status COMPLETED y locked true', async () => {
      // Arrange
      const segment = makeSegment()
      const newSegment = makeSegment({ id: 'seg-2', roomId: 'room-2', reason: 'ROOM_MOVE' })

      prismaMock.stayJourney.findUnique.mockResolvedValue(makeJourney([segment]))
      prismaMock.staySegment.findFirst.mockResolvedValue(null)
      prismaMock.segmentNight.updateMany.mockResolvedValue({ count: 0 })
      prismaMock.segmentNight.deleteMany.mockResolvedValue({ count: 3 })
      prismaMock.staySegment.update.mockResolvedValue({})
      prismaMock.staySegment.create.mockResolvedValue(newSegment)
      prismaMock.segmentNight.createMany.mockResolvedValue({ count: 3 })
      prismaMock.stayJourneyEvent.create.mockResolvedValue({})

      // Act
      await service.executeMidStayRoomMove({
        journeyId: 'journey-1',
        newRoomId: 'room-2',
        effectiveDate: '2026-04-12', // futuro
        actorId: 'actor-1',
      })

      // Assert
      expect(prismaMock.staySegment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'seg-1' },
          data: expect.objectContaining({ status: 'COMPLETED', locked: true }),
        }),
      )
    })

    it('crea nuevo segmento con reason ROOM_MOVE', async () => {
      // Arrange
      const segment = makeSegment()
      const newSegment = makeSegment({ id: 'seg-2', roomId: 'room-2', reason: 'ROOM_MOVE' })

      prismaMock.stayJourney.findUnique.mockResolvedValue(makeJourney([segment]))
      prismaMock.staySegment.findFirst.mockResolvedValue(null)
      prismaMock.segmentNight.updateMany.mockResolvedValue({ count: 0 })
      prismaMock.segmentNight.deleteMany.mockResolvedValue({ count: 3 })
      prismaMock.staySegment.update.mockResolvedValue({})
      prismaMock.staySegment.create.mockResolvedValue(newSegment)
      prismaMock.segmentNight.createMany.mockResolvedValue({ count: 3 })
      prismaMock.stayJourneyEvent.create.mockResolvedValue({})

      // Act
      const result = await service.executeMidStayRoomMove({
        journeyId: 'journey-1',
        newRoomId: 'room-2',
        effectiveDate: '2026-04-12',
        actorId: 'actor-1',
      })

      // Assert
      expect(prismaMock.staySegment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: 'ROOM_MOVE', roomId: 'room-2' }),
        }),
      )
      expect(result.id).toBe('seg-2')
    })

    it('lanza BadRequestException si effectiveDate es en el pasado', async () => {
      // Arrange
      const segment = makeSegment()
      prismaMock.stayJourney.findUnique.mockResolvedValue(makeJourney([segment]))

      // Act & Assert
      await expect(
        service.executeMidStayRoomMove({
          journeyId: 'journey-1',
          newRoomId: 'room-2',
          effectiveDate: '2026-01-01', // pasado
          actorId: 'actor-1',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('lanza BadRequestException si newRoomId === roomId actual', async () => {
      // Arrange
      const segment = makeSegment({ roomId: 'room-1' })
      prismaMock.stayJourney.findUnique.mockResolvedValue(makeJourney([segment]))

      // Act & Assert
      await expect(
        service.executeMidStayRoomMove({
          journeyId: 'journey-1',
          newRoomId: 'room-1', // misma habitación
          effectiveDate: '2026-04-12',
          actorId: 'actor-1',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })
})
