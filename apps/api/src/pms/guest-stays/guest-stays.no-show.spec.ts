/**
 * guest-stays.no-show.spec.ts
 *
 * Tests unitarios para la funcionalidad de no-show en GuestStaysService.
 *
 * COBERTURA POR MÉTODO:
 * ─────────────────────────────────────────────────────────────────────────
 *  markAsNoShow        — guards, fee, liberación de cuarto, tareas, journey
 *  revertNoShow        — ventana 48h, restauración de cuarto, journey
 *  markAsNoShowSystem  — actor sistema (night audit), idempotencia
 *
 * ARQUITECTURA DE TESTS:
 * ─────────────────────────────────────────────────────────────────────────
 *  Todos los tests usan mocks de Prisma y EventEmitter2 — sin BD real.
 *  $transaction ejecuta el callback directamente con prismaMock para simular
 *  el comportamiento transaccional de forma determinista.
 *
 *  Las funciones toLocalDate/toLocalHour son internas al servicio y se prueban
 *  indirectamente a través de los guards de timezone (checkin futuro vs. pasado).
 *
 * CONVENCIÓN:
 *  "Arrange → Act → Assert" (AAA). Descripciones en español.
 */

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { GuestStaysService } from './guest-stays.service'
import { PrismaService } from '../../prisma/prisma.service'
import { TenantContextService } from '../../common/tenant-context.service'
import { EmailService } from '../../common/email/email.service'

// ─── Constantes de prueba ──────────────────────────────────────────────────────

const ORG_ID      = 'org-test-1'
const PROPERTY_ID = 'property-test-1'
const ROOM_ID     = 'room-test-1'
const STAY_ID     = 'stay-test-1'
const ACTOR_ID    = 'staff-receptionist-1'

const NOW = new Date('2026-04-19T10:00:00.000Z')  // 10 AM UTC
const PAST_CHECKIN  = new Date('2026-04-19T14:00:00.000Z')  // ayer = check-in pasado
const FUTURE_CHECKIN = new Date('2026-04-20T14:00:00.000Z') // mañana = futuro

// ─── Builders de datos de prueba ──────────────────────────────────────────────

function makeStay(overrides: Record<string, unknown> = {}) {
  return {
    id:             STAY_ID,
    organizationId: ORG_ID,
    propertyId:     PROPERTY_ID,
    roomId:         ROOM_ID,
    guestName:      'Ana García',
    guestEmail:     'ana@ejemplo.com',
    currency:       'USD',
    ratePerNight:   120,
    totalAmount:    360,
    amountPaid:     0,
    checkinAt:      PAST_CHECKIN,
    scheduledCheckout: new Date('2026-04-22T12:00:00.000Z'),
    actualCheckout: null,
    noShowAt:       null,
    noShowById:     null,
    noShowReason:   null,
    noShowFeeAmount: null,
    noShowFeeCurrency: null,
    noShowChargeStatus: null,
    noShowRevertedAt:   null,
    noShowRevertedById: null,
    deletedAt:      null,
    stayJourney:    null,
    room: {
      id:       ROOM_ID,
      status:   'OCCUPIED',
      units:    [{ id: 'unit-1' }, { id: 'unit-2' }],
      property: {
        settings: { timezone: 'America/Mexico_City' },
      },
    },
    ...overrides,
  }
}

function makeStayMarkedNoShow(
  hoursAgo = 2,
  chargeStatus: string = 'PENDING',
): Record<string, unknown> {
  const noShowAt = new Date(Date.now() - hoursAgo * 3_600_000)
  return {
    id:             STAY_ID,
    organizationId: ORG_ID,
    propertyId:     PROPERTY_ID,
    roomId:         ROOM_ID,
    guestName:      'Ana García',
    currency:       'USD',
    ratePerNight:   120,
    totalAmount:    360,
    amountPaid:     120,
    checkinAt:      PAST_CHECKIN,
    scheduledCheckout: new Date('2026-04-22T12:00:00.000Z'),
    actualCheckout: null,
    deletedAt:      null,
    noShowAt,
    noShowById:         ACTOR_ID,
    noShowReason:       'No llegó',
    noShowFeeAmount:    120,
    noShowFeeCurrency:  'USD',
    noShowChargeStatus: chargeStatus,
    noShowRevertedAt:   null,
    noShowRevertedById: null,
    stayJourney: null,
    room: {
      id:       ROOM_ID,
      status:   'AVAILABLE',
      units:    [{ id: 'unit-1' }],
      property: { settings: { timezone: 'America/Mexico_City' } },
    },
  }
}

// ─── Setup del módulo ──────────────────────────────────────────────────────────

describe('GuestStaysService — no-show', () => {
  let service: GuestStaysService

  const prismaMock = {
    guestStay: {
      findUnique:  jest.fn(),
      update:      jest.fn(),
      count:       jest.fn(),
    },
    room: {
      findUnique: jest.fn(),
      update:     jest.fn(),
    },
    roomStatusLog:    { create: jest.fn() },
    cleaningTask:     { updateMany: jest.fn() },
    stayJourney:      { update: jest.fn() },
    stayJourneyEvent: { create: jest.fn() },
    propertySettings: { findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn((fn) => fn(prismaMock)),
  }

  const eventsMock  = { emit: jest.fn() }
  const tenantMock  = { getOrganizationId: jest.fn().mockReturnValue(ORG_ID) }
  const emailMock   = { send: jest.fn() }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GuestStaysService,
        { provide: PrismaService,        useValue: prismaMock },
        { provide: TenantContextService, useValue: tenantMock },
        { provide: EventEmitter2,        useValue: eventsMock },
        { provide: EmailService,         useValue: emailMock },
      ],
    }).compile()

    service = module.get<GuestStaysService>(GuestStaysService)
    jest.clearAllMocks()
  })

  // ─── markAsNoShow ───────────────────────────────────────────────────────────

  describe('markAsNoShow', () => {

    describe('guards — precondiciones', () => {
      it('lanza NotFoundException si la estadía no existe', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(null)

        // Act & Assert
        await expect(service.markAsNoShow(STAY_ID, ACTOR_ID))
          .rejects.toThrow(NotFoundException)
      })

      it('lanza ConflictException si el huésped ya realizó checkout', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStay({ actualCheckout: new Date() }),
        )

        // Act & Assert
        await expect(service.markAsNoShow(STAY_ID, ACTOR_ID))
          .rejects.toThrow(new ConflictException('El huésped ya realizó checkout'))
      })

      it('lanza ConflictException si ya estaba marcado como no-show', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStay({ noShowAt: new Date() }),
        )

        // Act & Assert
        await expect(service.markAsNoShow(STAY_ID, ACTOR_ID))
          .rejects.toThrow(new ConflictException('La estadía ya está marcada como no-show'))
      })

      it('lanza ConflictException si el check-in está en el futuro (timezone México)', async () => {
        // Arrange — checkinAt = mañana en UTC/local México
        // Al evaluar toLocalDate(now, 'America/Mexico_City') vs toLocalDate(tomorrow, tz)
        // checkinLocal > todayLocal → no puede marcarse no-show anticipado
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStay({ checkinAt: FUTURE_CHECKIN }),
        )

        // Act & Assert
        await expect(service.markAsNoShow(STAY_ID, ACTOR_ID))
          .rejects.toThrow(new ConflictException('No se puede marcar no-show antes de la fecha de llegada'))
      })
    })

    describe('caso exitoso — cargo normal', () => {
      beforeEach(() => {
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStay())
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)   // sin otros huéspedes activos
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 1 })
      })

      it('actualiza la estadía con los campos de no-show y retorna feeAmount + chargeStatus', async () => {
        // Act
        const result = await service.markAsNoShow(STAY_ID, ACTOR_ID)

        // Assert — retorno
        expect(result.chargeStatus).toBe('PENDING')
        expect(result.feeAmount).toBe('120')    // ratePerNight del makeStay
        expect(result.success).toBe(true)

        // Assert — update de GuestStay
        expect(prismaMock.guestStay.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: STAY_ID },
            data: expect.objectContaining({
              noShowById: ACTOR_ID,
              noShowChargeStatus: 'PENDING',
            }),
          }),
        )
      })

      it('registra la razón del no-show cuando se proporciona', async () => {
        // Act
        await service.markAsNoShow(STAY_ID, ACTOR_ID, { reason: 'Vuelo cancelado' })

        // Assert
        expect(prismaMock.guestStay.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ noShowReason: 'Vuelo cancelado' }),
          }),
        )
      })

      it('emite el evento stay.no_show con los datos correctos', async () => {
        // Act
        await service.markAsNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(eventsMock.emit).toHaveBeenCalledWith(
          'stay.no_show',
          expect.objectContaining({
            stayId:     STAY_ID,
            roomId:     ROOM_ID,
            propertyId: PROPERTY_ID,
            orgId:      ORG_ID,
            guestName:  'Ana García',
          }),
        )
      })
    })

    describe('exoneración de cargo (waiveCharge)', () => {
      beforeEach(() => {
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStay())
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 0 })
      })

      it('asigna chargeStatus=WAIVED y feeAmount=0 cuando waiveCharge=true', async () => {
        // Act
        const result = await service.markAsNoShow(STAY_ID, ACTOR_ID, { waiveCharge: true })

        // Assert
        expect(result.chargeStatus).toBe('WAIVED')
        expect(result.feeAmount).toBe('0')
        expect(prismaMock.guestStay.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              noShowChargeStatus: 'WAIVED',
            }),
          }),
        )
      })
    })

    describe('liberación de habitación', () => {
      it('cambia el cuarto a AVAILABLE cuando es el último huésped activo', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStay())
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)  // sin otros activos
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 0 })

        // Act
        await service.markAsNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(prismaMock.room.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: ROOM_ID },
            data:  { status: 'AVAILABLE' },
          }),
        )
        expect(prismaMock.roomStatusLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              fromStatus: 'OCCUPIED',
              toStatus:   'AVAILABLE',
              reason:     expect.stringContaining('Ana García'),
            }),
          }),
        )
      })

      it('mantiene el cuarto OCCUPIED si hay otros huéspedes activos en la misma habitación', async () => {
        // Arrange — habitación compartida con otro huésped
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStay())
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(1)  // otro huésped activo
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 0 })

        // Act
        await service.markAsNoShow(STAY_ID, ACTOR_ID)

        // Assert — room.update NO se llama
        expect(prismaMock.room.update).not.toHaveBeenCalled()
        expect(prismaMock.roomStatusLog.create).not.toHaveBeenCalled()
      })

      it('no cambia el cuarto si ya no está OCCUPIED (por otra razón)', async () => {
        // Arrange — cuarto en mantenimiento
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStay({
            room: {
              id:       ROOM_ID,
              status:   'MAINTENANCE',  // no es OCCUPIED
              units:    [{ id: 'unit-1' }],
              property: { settings: { timezone: 'UTC' } },
            },
          }),
        )
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 0 })

        // Act
        await service.markAsNoShow(STAY_ID, ACTOR_ID)

        // Assert — room.update NO se llama
        expect(prismaMock.room.update).not.toHaveBeenCalled()
      })
    })

    describe('cancelación de tareas de limpieza', () => {
      it('cancela tareas PENDING/UNASSIGNED/READY de las unidades de la habitación del día actual', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStay())
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 2 })

        // Act
        await service.markAsNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(prismaMock.cleaningTask.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              unitId: { in: ['unit-1', 'unit-2'] },
              status: { in: ['PENDING', 'UNASSIGNED', 'READY'] },
            }),
            data: { status: 'CANCELLED' },
          }),
        )
      })

      it('no llama a updateMany si la habitación no tiene unidades', async () => {
        // Arrange — habitación sin camas asociadas (edge case)
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStay({
            room: {
              id:       ROOM_ID,
              status:   'OCCUPIED',
              units:    [],
              property: { settings: { timezone: 'UTC' } },
            },
          }),
        )
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})

        // Act
        await service.markAsNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(prismaMock.cleaningTask.updateMany).not.toHaveBeenCalled()
      })
    })

    describe('actualización de StayJourney', () => {
      it('actualiza el journey a NO_SHOW y crea un StayJourneyEvent cuando existe', async () => {
        // Arrange
        const stayWithJourney = makeStay({ stayJourney: { id: 'journey-1' } })
        prismaMock.guestStay.findUnique.mockResolvedValue(stayWithJourney)
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 0 })
        prismaMock.stayJourney.update.mockResolvedValue({})
        prismaMock.stayJourneyEvent.create.mockResolvedValue({})

        // Act
        await service.markAsNoShow(STAY_ID, ACTOR_ID, { reason: 'Llegada tardía' })

        // Assert — journey actualizado
        expect(prismaMock.stayJourney.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'journey-1' },
            data:  { status: 'NO_SHOW' },
          }),
        )
        // Assert — evento creado con payload correcto
        expect(prismaMock.stayJourneyEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              journeyId: 'journey-1',
              eventType: 'NO_SHOW_MARKED',
              actorId:   ACTOR_ID,
              payload:   expect.objectContaining({
                reason:      'Llegada tardía',
                chargeStatus: 'PENDING',
              }),
            }),
          }),
        )
      })

      it('no falla si la estadía no tiene StayJourney asociado', async () => {
        // Arrange — sin journey (estadía creada directamente sin PMS)
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStay({ stayJourney: null }))
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 0 })

        // Act & Assert — no lanza excepción
        await expect(service.markAsNoShow(STAY_ID, ACTOR_ID)).resolves.toMatchObject({
          success: true,
        })
        expect(prismaMock.stayJourney.update).not.toHaveBeenCalled()
        expect(prismaMock.stayJourneyEvent.create).not.toHaveBeenCalled()
      })
    })

    describe('combinación waiveCharge + razón + journey', () => {
      it('persiste todo correctamente en un único escenario completo', async () => {
        // Arrange
        const stayWithJourney = makeStay({ stayJourney: { id: 'journey-2' } })
        prismaMock.guestStay.findUnique.mockResolvedValue(stayWithJourney)
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 0 })
        prismaMock.stayJourney.update.mockResolvedValue({})
        prismaMock.stayJourneyEvent.create.mockResolvedValue({})

        // Act
        const result = await service.markAsNoShow(STAY_ID, ACTOR_ID, {
          reason: 'Cancelación de grupo',
          waiveCharge: true,
        })

        // Assert
        expect(result.chargeStatus).toBe('WAIVED')
        expect(result.feeAmount).toBe('0')
        expect(prismaMock.stayJourneyEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              payload: expect.objectContaining({
                reason:      'Cancelación de grupo',
                chargeStatus: 'WAIVED',
              }),
            }),
          }),
        )
      })
    })
  })

  // ─── revertNoShow ───────────────────────────────────────────────────────────

  describe('revertNoShow', () => {

    describe('guards — precondiciones', () => {
      it('lanza NotFoundException si la estadía no existe', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(null)

        // Act & Assert
        await expect(service.revertNoShow(STAY_ID, ACTOR_ID))
          .rejects.toThrow(NotFoundException)
      })

      it('lanza ConflictException si la estadía no está marcada como no-show', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStay({ noShowAt: null }))

        // Act & Assert
        await expect(service.revertNoShow(STAY_ID, ACTOR_ID))
          .rejects.toThrow(new ConflictException('La estadía no está marcada como no-show'))
      })

      it('lanza ForbiddenException si han pasado más de 48 horas desde el no-show', async () => {
        // Arrange — noShowAt hace 49 horas
        const noShowAt49h = new Date(Date.now() - 49 * 3_600_000)
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStay({ noShowAt: noShowAt49h }),
        )

        // Act & Assert
        await expect(service.revertNoShow(STAY_ID, ACTOR_ID))
          .rejects.toThrow(new ForbiddenException('La ventana de reversión de 48 horas ha expirado'))
      })

      it('permite la reversión cuando el no-show fue hace exactamente 47 horas 59 min', async () => {
        // Arrange — dentro de la ventana de 48h
        const noShowAtJustBefore = new Date(Date.now() - (48 * 3_600_000 - 60_000))
        const stayMarked = makeStay({
          noShowAt:           noShowAtJustBefore,
          noShowChargeStatus: 'PENDING',
        })
        prismaMock.guestStay.findUnique.mockResolvedValue(stayMarked)
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'AVAILABLE' })
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})

        // Act & Assert — no lanza excepción
        await expect(service.revertNoShow(STAY_ID, ACTOR_ID)).resolves.toMatchObject({
          success: true,
        })
      })
    })

    describe('caso exitoso — dentro de 48h', () => {
      beforeEach(() => {
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStayMarkedNoShow(2),  // 2 horas atrás
        )
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'AVAILABLE' })
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
      })

      it('limpia todos los campos de no-show en GuestStay', async () => {
        // Act
        await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(prismaMock.guestStay.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: STAY_ID },
            data: expect.objectContaining({
              noShowAt:          null,
              noShowById:        null,
              noShowReason:      null,
              noShowFeeAmount:   null,
              noShowFeeCurrency: null,
              noShowRevertedById: ACTOR_ID,
            }),
          }),
        )
      })

      it('retorna { success: true }', async () => {
        // Act
        const result = await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(result).toEqual({ success: true })
      })

      it('emite el evento stay.no_show_reverted', async () => {
        // Act
        await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(eventsMock.emit).toHaveBeenCalledWith(
          'stay.no_show_reverted',
          expect.objectContaining({ stayId: STAY_ID, roomId: ROOM_ID }),
        )
      })
    })

    describe('restauración de habitación', () => {
      it('restaura la habitación a OCCUPIED si estaba AVAILABLE', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStayMarkedNoShow(1))
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'AVAILABLE' })
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})

        // Act
        await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(prismaMock.room.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: ROOM_ID },
            data:  { status: 'OCCUPIED' },
          }),
        )
        expect(prismaMock.roomStatusLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              fromStatus: 'AVAILABLE',
              toStatus:   'OCCUPIED',
              reason:     expect.stringContaining('revertido'),
            }),
          }),
        )
      })

      it('no modifica la habitación si NO está AVAILABLE (ej: MAINTENANCE)', async () => {
        // Arrange — el cuarto fue puesto en mantenimiento mientras estaba como no-show
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStayMarkedNoShow(1))
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'MAINTENANCE' })

        // Act
        await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert — room NO se toca
        expect(prismaMock.room.update).not.toHaveBeenCalled()
        expect(prismaMock.roomStatusLog.create).not.toHaveBeenCalled()
      })

      it('no modifica la habitación si ya está OCCUPIED (otro huésped check-in entre medio)', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStayMarkedNoShow(1))
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'OCCUPIED' })

        // Act
        await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(prismaMock.room.update).not.toHaveBeenCalled()
      })
    })

    describe('manejo de chargeStatus al revertir', () => {
      it('pone chargeStatus en PENDING si el cargo ya estaba CHARGED (reversión manual necesaria)', async () => {
        // Arrange — cargo ya procesado
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStayMarkedNoShow(1, 'CHARGED'),
        )
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'AVAILABLE' })
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})

        // Act
        await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert — chargeStatus=PENDING (para revisión manual del refund)
        expect(prismaMock.guestStay.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ noShowChargeStatus: 'PENDING' }),
          }),
        )
      })

      it('pone chargeStatus en null si el cargo estaba PENDING (sin cargo real)', async () => {
        // Arrange — cargo aún no procesado
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStayMarkedNoShow(1))
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'AVAILABLE' })
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})

        // Act
        await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert — chargeStatus=null (no hubo cargo real que reversar)
        expect(prismaMock.guestStay.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ noShowChargeStatus: null }),
          }),
        )
      })
    })

    describe('actualización de StayJourney', () => {
      it('revierte el journey a ACTIVE y crea StayJourneyEvent cuando existe', async () => {
        // Arrange
        const stayMarkedWithJourney = {
          ...makeStayMarkedNoShow(1),
          stayJourney: { id: 'journey-3' },
        }
        prismaMock.guestStay.findUnique.mockResolvedValue(stayMarkedWithJourney)
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'AVAILABLE' })
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.stayJourney.update.mockResolvedValue({})
        prismaMock.stayJourneyEvent.create.mockResolvedValue({})

        // Act
        await service.revertNoShow(STAY_ID, ACTOR_ID)

        // Assert
        expect(prismaMock.stayJourney.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'journey-3' },
            data:  { status: 'ACTIVE' },
          }),
        )
        expect(prismaMock.stayJourneyEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              journeyId: 'journey-3',
              eventType: 'NO_SHOW_REVERTED',
              actorId:   ACTOR_ID,
            }),
          }),
        )
      })

      it('no falla si no hay StayJourney asociado', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStayMarkedNoShow(1),  // sin stayJourney
        )
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.room.findUnique.mockResolvedValue({ status: 'AVAILABLE' })
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})

        // Act & Assert
        await expect(service.revertNoShow(STAY_ID, ACTOR_ID)).resolves.toMatchObject({
          success: true,
        })
        expect(prismaMock.stayJourney.update).not.toHaveBeenCalled()
      })
    })
  })

  // ─── markAsNoShowSystem ─────────────────────────────────────────────────────

  describe('markAsNoShowSystem (night audit)', () => {

    describe('idempotencia — salida silenciosa', () => {
      it('no hace nada si la estadía no existe (actorId sistema)', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(null)

        // Act — no debe lanzar excepción
        await expect(
          service.markAsNoShowSystem(STAY_ID, ORG_ID, PROPERTY_ID),
        ).resolves.toBeUndefined()

        // Assert — sin efectos
        expect(prismaMock.guestStay.update).not.toHaveBeenCalled()
      })

      it('no hace nada si el huésped ya realizó checkout', async () => {
        // Arrange
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStay({ actualCheckout: new Date() }),
        )

        // Act
        await service.markAsNoShowSystem(STAY_ID, ORG_ID, PROPERTY_ID)

        // Assert — sin efectos
        expect(prismaMock.guestStay.update).not.toHaveBeenCalled()
      })

      it('no hace nada si ya está marcado como no-show (doble ejecución del cron)', async () => {
        // Arrange — ya procesado en una ejecución anterior del scheduler
        prismaMock.guestStay.findUnique.mockResolvedValue(
          makeStay({ noShowAt: new Date() }),
        )

        // Act
        await service.markAsNoShowSystem(STAY_ID, ORG_ID, PROPERTY_ID)

        // Assert — sin efectos (idempotente)
        expect(prismaMock.guestStay.update).not.toHaveBeenCalled()
      })
    })

    describe('caso exitoso — actor sistema', () => {
      beforeEach(() => {
        prismaMock.guestStay.findUnique.mockResolvedValue(makeStay())
        prismaMock.guestStay.update.mockResolvedValue({})
        prismaMock.guestStay.count.mockResolvedValue(0)
        prismaMock.room.update.mockResolvedValue({})
        prismaMock.roomStatusLog.create.mockResolvedValue({})
        prismaMock.cleaningTask.updateMany.mockResolvedValue({ count: 0 })
      })

      it('marca la estadía con razón de night audit y noShowById=null (actor sistema)', async () => {
        // Act
        await service.markAsNoShowSystem(STAY_ID, ORG_ID, PROPERTY_ID)

        // Assert — GuestStay.update sin actorId (sistema)
        expect(prismaMock.guestStay.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              noShowReason:       'Marcado automáticamente por night audit',
              noShowChargeStatus: 'PENDING',
            }),
          }),
        )
        // noShowById no se establece (campo no presente en data o = null)
        const callData = prismaMock.guestStay.update.mock.calls[0][0].data
        expect(callData.noShowById).toBeUndefined()
      })

      it('siempre usa chargeStatus=PENDING — no permite exonerar desde el sistema', async () => {
        // Act
        await service.markAsNoShowSystem(STAY_ID, ORG_ID, PROPERTY_ID)

        // Assert — siempre PENDING (a diferencia de markAsNoShow que acepta waiveCharge)
        expect(prismaMock.guestStay.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ noShowChargeStatus: 'PENDING' }),
          }),
        )
      })

      it('crea StayJourneyEvent con actorId=null y source=NIGHT_AUDIT cuando existe journey', async () => {
        // Arrange — con journey
        const stayWithJourney = makeStay({ stayJourney: { id: 'journey-system-1' } })
        prismaMock.guestStay.findUnique.mockResolvedValue(stayWithJourney)
        prismaMock.stayJourney.update.mockResolvedValue({})
        prismaMock.stayJourneyEvent.create.mockResolvedValue({})

        // Act
        await service.markAsNoShowSystem(STAY_ID, ORG_ID, PROPERTY_ID)

        // Assert — actorId null = actor sistema
        expect(prismaMock.stayJourneyEvent.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              journeyId: 'journey-system-1',
              eventType: 'NO_SHOW_MARKED',
              actorId:   null,
              payload:   expect.objectContaining({ source: 'NIGHT_AUDIT' }),
            }),
          }),
        )
      })
    })
  })
})

