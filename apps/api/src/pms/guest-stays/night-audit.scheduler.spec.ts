/**
 * night-audit.scheduler.spec.ts
 *
 * Tests unitarios para NightAuditScheduler.
 *
 * COBERTURA:
 * ─────────────────────────────────────────────────────────────────────────
 *  processNoShows  — guards de skip, cutoff hour, idempotencia por fecha,
 *                    procesamiento multi-propiedad, manejo de errores parciales
 *
 * ARQUITECTURA:
 * ─────────────────────────────────────────────────────────────────────────
 *  Usamos jest.useFakeTimers() + jest.setSystemTime() para controlar "ahora"
 *  sin romper Date.now ni métodos estáticos de Date.
 *
 *  El scheduler evalúa la hora local de cada propiedad via Intl.DateTimeFormat.
 *  Fijamos el tiempo a las 10:00 UTC. Con timezone=UTC eso son las 10:00 local
 *  (>= cutoffHour=2), por lo que la mayoría de los tests espera procesamiento.
 *
 *  Convención: tests en español, patrón AAA.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { NightAuditScheduler } from './night-audit.scheduler'
import { PrismaService } from '../../prisma/prisma.service'
import { GuestStaysService } from './guest-stays.service'

// ─── Hora fija para todos los tests ───────────────────────────────────────────
// 2026-04-19T10:00:00Z = 10 AM UTC = 10 AM en timezone UTC (> cutoff default 2h)
const FAKE_NOW = new Date('2026-04-19T10:00:00.000Z')

// ─── Builders ─────────────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<{
  propertyId:          string
  timezone:            string
  noShowCutoffHour:    number
  noShowProcessedDate: Date | null
  isActive:            boolean
  organizationId:      string
}> = {}) {
  return {
    propertyId:          overrides.propertyId          ?? 'property-1',
    timezone:            overrides.timezone             ?? 'UTC',
    noShowCutoffHour:    overrides.noShowCutoffHour     ?? 2,
    noShowProcessedDate: overrides.noShowProcessedDate  ?? null,
    property: {
      organizationId: overrides.organizationId ?? 'org-1',
      isActive:       overrides.isActive       ?? true,
    },
  }
}

function makeOverdueStay(id = 'stay-1') {
  return { id, guestName: 'Huésped Prueba' }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('NightAuditScheduler', () => {
  let scheduler: NightAuditScheduler

  const prismaMock = {
    propertySettings: { findMany: jest.fn(), update: jest.fn() },
    guestStay:        { findMany: jest.fn() },
  }

  const guestStaysServiceMock = {
    markAsNoShowSystem: jest.fn(),
  }

  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(FAKE_NOW)
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NightAuditScheduler,
        { provide: PrismaService,     useValue: prismaMock },
        { provide: GuestStaysService, useValue: guestStaysServiceMock },
      ],
    }).compile()

    scheduler = module.get<NightAuditScheduler>(NightAuditScheduler)
    jest.clearAllMocks()
  })

  // ─── Condiciones de skip ───────────────────────────────────────────────────

  describe('condiciones de skip (sin procesar)', () => {
    it('salta una propiedad inactiva', async () => {
      // Arrange
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ isActive: false }),
      ])

      // Act
      await scheduler.processNoShows()

      // Assert
      expect(guestStaysServiceMock.markAsNoShowSystem).not.toHaveBeenCalled()
      expect(prismaMock.propertySettings.update).not.toHaveBeenCalled()
    })

    it('salta cuando la hora local aún no alcanzó el cutoff (noShowCutoffHour=12, now=10AM UTC)', async () => {
      // Arrange — cutoff a las 12h, son las 10h → todavía no
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'UTC', noShowCutoffHour: 12 }),
      ])

      // Act
      await scheduler.processNoShows()

      // Assert — no busca stays
      expect(prismaMock.guestStay.findMany).not.toHaveBeenCalled()
      expect(guestStaysServiceMock.markAsNoShowSystem).not.toHaveBeenCalled()
    })

    it('salta si la propiedad ya fue procesada hoy (noShowProcessedDate = 2026-04-19 en UTC)', async () => {
      // Arrange — processed = hoy (localDate en UTC = 2026-04-19)
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({
          timezone:            'UTC',
          noShowCutoffHour:    2,
          noShowProcessedDate: new Date('2026-04-19T00:00:00.000Z'),
        }),
      ])

      // Act
      await scheduler.processNoShows()

      // Assert — no busca stays (idempotencia)
      expect(prismaMock.guestStay.findMany).not.toHaveBeenCalled()
    })

    it('procesa cuando noShowProcessedDate es de ayer (2026-04-18)', async () => {
      // Arrange — ayer procesado, hoy pendiente
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({
          timezone:            'UTC',
          noShowCutoffHour:    2,
          noShowProcessedDate: new Date('2026-04-18T00:00:00.000Z'),
        }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([makeOverdueStay()])
      guestStaysServiceMock.markAsNoShowSystem.mockResolvedValue(undefined)
      prismaMock.propertySettings.update.mockResolvedValue({})

      // Act
      await scheduler.processNoShows()

      // Assert — procesa el stay
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledTimes(1)
    })

    it('procesa cuando noShowProcessedDate es null (propiedad nueva, nunca procesada)', async () => {
      // Arrange
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'UTC', noShowCutoffHour: 2, noShowProcessedDate: null }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([makeOverdueStay()])
      guestStaysServiceMock.markAsNoShowSystem.mockResolvedValue(undefined)
      prismaMock.propertySettings.update.mockResolvedValue({})

      // Act
      await scheduler.processNoShows()

      // Assert
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledTimes(1)
    })
  })

  // ─── Procesamiento normal ──────────────────────────────────────────────────

  describe('procesamiento exitoso', () => {
    beforeEach(() => {
      prismaMock.propertySettings.update.mockResolvedValue({})
    })

    it('llama a markAsNoShowSystem por cada stay vencido encontrado', async () => {
      // Arrange
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'UTC', noShowCutoffHour: 2, propertyId: 'p-1', organizationId: 'org-1' }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([
        makeOverdueStay('stay-A'),
        makeOverdueStay('stay-B'),
        makeOverdueStay('stay-C'),
      ])
      guestStaysServiceMock.markAsNoShowSystem.mockResolvedValue(undefined)

      // Act
      await scheduler.processNoShows()

      // Assert — 3 llamadas, una por stay
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledTimes(3)
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledWith('stay-A', 'org-1', 'p-1')
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledWith('stay-B', 'org-1', 'p-1')
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledWith('stay-C', 'org-1', 'p-1')
    })

    it('actualiza noShowProcessedDate después de procesar stays', async () => {
      // Arrange
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'UTC', noShowCutoffHour: 2, propertyId: 'p-1' }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([makeOverdueStay()])
      guestStaysServiceMock.markAsNoShowSystem.mockResolvedValue(undefined)

      // Act
      await scheduler.processNoShows()

      // Assert — sella la fecha de procesamiento
      expect(prismaMock.propertySettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { propertyId: 'p-1' },
          data:  { noShowProcessedDate: new Date('2026-04-19T00:00:00.000Z') },
        }),
      )
    })

    it('actualiza noShowProcessedDate aunque NO haya stays vencidos (previene re-run)', async () => {
      // Arrange — propiedad activa, sin stays vencidos hoy
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'UTC', noShowCutoffHour: 2 }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([])

      // Act
      await scheduler.processNoShows()

      // Assert — igual marca como procesado para no re-ejecutar
      expect(prismaMock.propertySettings.update).toHaveBeenCalled()
      expect(guestStaysServiceMock.markAsNoShowSystem).not.toHaveBeenCalled()
    })

    it('procesa múltiples propiedades independientemente en el mismo ciclo', async () => {
      // Arrange — 2 propiedades en distintos timezone, ambas con stays vencidos
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ propertyId: 'p-mx', timezone: 'America/Mexico_City', organizationId: 'org-mx' }),
        makeSettings({ propertyId: 'p-es', timezone: 'Europe/Madrid',        organizationId: 'org-es' }),
      ])
      prismaMock.guestStay.findMany
        .mockResolvedValueOnce([makeOverdueStay('stay-mx')])
        .mockResolvedValueOnce([makeOverdueStay('stay-es')])
      guestStaysServiceMock.markAsNoShowSystem.mockResolvedValue(undefined)

      // Act
      await scheduler.processNoShows()

      // Assert — ambas propiedades procesadas independientemente
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledTimes(2)
      expect(prismaMock.propertySettings.update).toHaveBeenCalledTimes(2)
    })

    it('busca stays con checkinAt en el día local de la propiedad', async () => {
      // Arrange — timezone UTC, localDate = 2026-04-19
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'UTC', noShowCutoffHour: 2 }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([])

      // Act
      await scheduler.processNoShows()

      // Assert — rango correcto para el día local
      const callArgs = prismaMock.guestStay.findMany.mock.calls[0][0]
      expect(callArgs.where.checkinAt).toEqual({
        gte: new Date('2026-04-19T00:00:00.000Z'),
        lte: new Date('2026-04-19T23:59:59.999Z'),
      })
    })

    it('excluye stays que ya tienen actualCheckout o noShowAt del query', async () => {
      // Arrange
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'UTC', noShowCutoffHour: 2 }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([])

      // Act
      await scheduler.processNoShows()

      // Assert — el where incluye los filtros de exclusión
      const callArgs = prismaMock.guestStay.findMany.mock.calls[0][0]
      expect(callArgs.where.actualCheckout).toBeNull()
      expect(callArgs.where.noShowAt).toBeNull()
      expect(callArgs.where.deletedAt).toBeNull()
    })
  })

  // ─── Manejo de errores parciales ──────────────────────────────────────────

  describe('manejo de errores parciales', () => {
    it('continúa con stays siguientes si uno falla (sin romper el ciclo)', async () => {
      // Arrange — 3 stays, el segundo lanza error
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'UTC', noShowCutoffHour: 2 }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([
        makeOverdueStay('stay-1'),
        makeOverdueStay('stay-2'),
        makeOverdueStay('stay-3'),
      ])
      guestStaysServiceMock.markAsNoShowSystem
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('DB timeout'))
        .mockResolvedValueOnce(undefined)
      prismaMock.propertySettings.update.mockResolvedValue({})

      // Act — no debe lanzar excepción
      await expect(scheduler.processNoShows()).resolves.toBeUndefined()

      // Assert — los 3 intentaron procesarse a pesar del error intermedio
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledTimes(3)
      // y la propiedad sigue marcándose como procesada
      expect(prismaMock.propertySettings.update).toHaveBeenCalled()
    })
  })

  // ─── Casos edge de timezone ───────────────────────────────────────────────

  describe('casos edge de timezone', () => {
    it('una propiedad en UTC+12 que tiene hora local > cutoff es procesada', async () => {
      // Arrange — 10:00 UTC = 22:00 en UTC+12 → hora local(22) > cutoff(2) → procesa
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'Pacific/Auckland', noShowCutoffHour: 2, propertyId: 'p-nz' }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([])
      prismaMock.propertySettings.update.mockResolvedValue({})

      // Act
      await scheduler.processNoShows()

      // Assert — busca stays (aunque la lista esté vacía) → sí pasó el cutoff
      expect(prismaMock.guestStay.findMany).toHaveBeenCalled()
    })

    it('una propiedad en UTC-5 donde son las 05:00 local (> cutoff=2) es procesada', async () => {
      // Arrange — 10:00 UTC = 05:00 en America/New_York (UTC-5) → 05 >= 02 → procesa
      prismaMock.propertySettings.findMany.mockResolvedValue([
        makeSettings({ timezone: 'America/New_York', noShowCutoffHour: 2, propertyId: 'p-ny' }),
      ])
      prismaMock.guestStay.findMany.mockResolvedValue([makeOverdueStay()])
      guestStaysServiceMock.markAsNoShowSystem.mockResolvedValue(undefined)
      prismaMock.propertySettings.update.mockResolvedValue({})

      // Act
      await scheduler.processNoShows()

      // Assert — procesa
      expect(guestStaysServiceMock.markAsNoShowSystem).toHaveBeenCalledTimes(1)
    })
  })
})
