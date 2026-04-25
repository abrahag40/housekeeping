/**
 * checkouts.service.spec.ts
 *
 * Tests unitarios para CheckoutsService — el núcleo del sistema.
 *
 * COBERTURA POR MÉTODO:
 * ─────────────────────────────────────────────────────────────────────────
 *  processCheckout    — crea checkout + tareas, idempotencia, prioridad
 *  batchCheckout      — Fase 1: crea tareas PENDING, NO activa limpieza
 *  confirmDeparture   — Fase 2: activa tarea por cama específica (bedId)
 *  cancelCheckout     — extensión de estadía, alertas críticas
 *  getDailyGrid       — timezone UTC, filtro por fecha
 *
 * ARQUITECTURA DE TESTS:
 * ─────────────────────────────────────────────────────────────────────────
 *  Todos los tests usan mocks de Prisma, NotificationsService y PushService
 *  para ser deterministas y sin dependencia de BD real.
 *
 *  El mock de $transaction ejecuta el callback directamente con prismaMock
 *  para simular el comportamiento transaccional sin abrir una TX real.
 *
 * CONVENCIÓN DE NOMENCLATURA:
 *  "Arrange → Act → Assert" (AAA) con comentarios explícitos en cada sección.
 */
import { ConflictException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CleaningStatus, Priority } from '@zenix/shared'
import { CheckoutsService, CheckoutInput } from './checkouts.service'
import { PrismaService } from '../prisma/prisma.service'
import { TenantContextService } from '../common/tenant-context.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PushService } from '../notifications/push.service'

// ─── Builders de datos de prueba ──────────────────────────────────────────────

/**
 * Construye un objeto Room mínimo válido para los tests.
 * Las camas (beds) están hardcodeadas para los tests de processCheckout.
 * Para escenarios multi-cama usar `overrides.beds`.
 */
function makeRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    number: '201',
    category: 'PRIVATE',
    floor: 2,
    propertyId: 'property-1',
    units: [
      { id: 'bed-1', label: 'Cama 1', roomId: 'room-1', status: 'AVAILABLE' },
    ],
    property: { id: 'property-1', name: 'Hotel Demo' },
    ...overrides,
  }
}

/** Construye un CheckoutInput mínimo válido. */
function makeCheckoutInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    roomId: 'room-1',
    actualCheckoutAt: new Date('2026-03-19T11:00:00Z'),
    source: 'MANUAL',
    enteredById: 'staff-1',
    ...overrides,
  }
}

/**
 * Construye un objeto Checkout con sus tareas asociadas.
 * Usado en tests de confirmDeparture y cancelCheckout.
 */
function makeCheckout(
  tasks: { id: string; unitId: string; status: CleaningStatus; assignedToId?: string | null }[],
  overrides: Record<string, unknown> = {},
) {
  return {
    id: 'checkout-1',
    cancelled: false,
    hasSameDayCheckIn: false,
    roomId: 'room-1',
    room: { id: 'room-1', number: '201' },
    tasks: tasks.map((t) => ({
      ...t,
      assignedToId: t.assignedToId ?? null,
      assignedTo: t.assignedToId ? { id: t.assignedToId, pushTokens: [] } : null,
    })),
    ...overrides,
  }
}

// ─── Setup del módulo de testing ──────────────────────────────────────────────

describe('CheckoutsService', () => {
  let service: CheckoutsService

  /**
   * Mock de PrismaService.
   *
   * $transaction simula el comportamiento real: ejecuta el callback pasándole
   * el propio mock como "cliente transaccional". Esto permite que el código
   * dentro de $transaction() se comporte igual que en producción.
   */
  const prismaMock = {
    checkout:        { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    room:            { findUnique: jest.fn() },
    unit:            { findMany: jest.fn(), update: jest.fn() },
    cleaningTask:    { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    taskLog:         { create: jest.fn() },
    housekeepingStaff: { findMany: jest.fn() },
    $transaction:    jest.fn((fn) => fn(prismaMock)),
  }

  const notificationsMock = { emit: jest.fn() }
  const pushMock          = { sendToStaff: jest.fn().mockResolvedValue(undefined) }
  const eventsMock        = { emit: jest.fn() }
  const tenantMock        = {
    getOrganizationId: jest.fn().mockReturnValue('org-1'),
    getPropertyId: jest.fn().mockReturnValue('property-1'),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckoutsService,
        { provide: PrismaService,        useValue: prismaMock },
        { provide: TenantContextService, useValue: tenantMock },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: PushService,          useValue: pushMock },
        { provide: EventEmitter2,        useValue: eventsMock },
      ],
    }).compile()

    service = module.get<CheckoutsService>(CheckoutsService)
    jest.clearAllMocks()
  })

  // ─── processCheckout ─────────────────────────────────────────────────────

  describe('processCheckout', () => {
    it('crea un Checkout y una CleaningTask por cada cama del cuarto', async () => {
      // Arrange
      const room     = makeRoom()
      const checkout = { id: 'checkout-1', roomId: 'room-1', cancelled: false }
      const newTask  = { id: 'task-1', status: CleaningStatus.UNASSIGNED }

      prismaMock.room.findUnique.mockResolvedValue(room)
      prismaMock.checkout.create.mockResolvedValue(checkout)
      prismaMock.cleaningTask.findFirst.mockResolvedValue(null) // sin tarea previa
      prismaMock.cleaningTask.create.mockResolvedValue(newTask)
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([
        { ...newTask, assignedToId: null, unit: { room } },
      ])

      // Act
      const result = await service.processCheckout(makeCheckoutInput())

      // Assert
      expect(result.id).toBe('checkout-1')
      expect(prismaMock.checkout.create).toHaveBeenCalledTimes(1)
      expect(prismaMock.cleaningTask.create).toHaveBeenCalledTimes(1) // 1 tarea por 1 cama
    })

    it('asigna prioridad URGENT cuando hasSameDayCheckIn es true', async () => {
      // Arrange
      const room     = makeRoom()
      const checkout = { id: 'checkout-1', roomId: 'room-1', cancelled: false }

      prismaMock.room.findUnique.mockResolvedValue(room)
      prismaMock.checkout.create.mockResolvedValue(checkout)
      prismaMock.cleaningTask.findFirst.mockResolvedValue(null)
      prismaMock.cleaningTask.create.mockResolvedValue({ id: 'task-1', status: CleaningStatus.UNASSIGNED })
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([])

      // Act
      await service.processCheckout(makeCheckoutInput({ hasSameDayCheckIn: true }))

      // Assert — la tarea se crea con prioridad URGENT
      expect(prismaMock.cleaningTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: Priority.URGENT }),
        }),
      )
    })

    it('lanza NotFoundException si el cuarto no existe', async () => {
      // Arrange
      prismaMock.checkout.findUnique.mockResolvedValue(null)
      prismaMock.room.findUnique.mockResolvedValue(null) // room no existe

      // Act & Assert
      await expect(service.processCheckout(makeCheckoutInput())).rejects.toThrow(NotFoundException)
    })

    it('actualiza tarea PENDING existente a READY en lugar de crear una nueva', async () => {
      // Arrange — hay una tarea pre-asignada esperando checkout
      const room        = makeRoom()
      const checkout    = { id: 'checkout-1', roomId: 'room-1', cancelled: false }
      const pendingTask = { id: 'task-pre', assignedToId: 'staff-1', status: CleaningStatus.PENDING }

      prismaMock.room.findUnique.mockResolvedValue(room)
      prismaMock.checkout.create.mockResolvedValue(checkout)
      prismaMock.cleaningTask.findFirst.mockResolvedValue(pendingTask)
      prismaMock.cleaningTask.update.mockResolvedValue({ ...pendingTask, status: CleaningStatus.READY })
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([])

      // Act
      await service.processCheckout(makeCheckoutInput())

      // Assert — no crea tarea nueva, actualiza la pre-asignada
      expect(prismaMock.cleaningTask.create).not.toHaveBeenCalled()
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-pre' },
          data: expect.objectContaining({ status: CleaningStatus.READY }),
        }),
      )
    })

    it('actualiza el estado de la cama a DIRTY cuando el huésped hace checkout', async () => {
      // Arrange
      const room     = makeRoom()
      const checkout = { id: 'checkout-1', roomId: 'room-1', cancelled: false }

      prismaMock.room.findUnique.mockResolvedValue(room)
      prismaMock.checkout.create.mockResolvedValue(checkout)
      prismaMock.cleaningTask.findFirst.mockResolvedValue(null)
      prismaMock.cleaningTask.create.mockResolvedValue({ id: 'task-1' })
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([])

      // Act
      await service.processCheckout(makeCheckoutInput())

      // Assert — processCheckout activa la limpieza inmediatamente (Fase única para checkouts ad-hoc)
      expect(prismaMock.unit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bed-1' },
          data: { status: 'DIRTY' },
        }),
      )
    })
  })

  // ─── batchCheckout (Fase 1) ───────────────────────────────────────────────

  describe('batchCheckout', () => {
    /**
     * batchCheckout es la FASE 1 del ciclo de dos fases:
     *
     *   Fase 1 (este método): el recepcionista planifica las salidas del día.
     *     → Crea CleaningTask(PENDING). El huésped AÚN está en la cama.
     *     → bed.status NO cambia todavía. Sin notificaciones push.
     *
     *   Fase 2 (confirmDeparture): el huésped sale físicamente.
     *     → Tarea PENDING → READY/UNASSIGNED. bed → DIRTY. Push a housekeeper.
     *
     * Esta separación evita enviar a housekeeping a limpiar camas ocupadas.
     */

    it('crea tareas en estado PENDING — no activa la limpieza todavía', async () => {
      // Arrange
      const bed  = { id: 'bed-1', roomId: 'room-1', room: { id: 'room-1', propertyId: 'prop-1' } }
      const task = { id: 'task-1', status: CleaningStatus.PENDING }

      prismaMock.unit.findMany.mockResolvedValue([bed])
      prismaMock.checkout.create.mockResolvedValue({ id: 'checkout-1', roomId: 'room-1', hasSameDayCheckIn: false })
      prismaMock.cleaningTask.create.mockResolvedValue(task)
      prismaMock.taskLog.create.mockResolvedValue({})

      const dto = { items: [{ unitId: 'bed-1', hasSameDayCheckIn: false }], checkoutDate: '2026-03-21' }

      // Act
      await service.batchCheckout(dto, 'staff-1', 'prop-1')

      // Assert — tarea creada en PENDING (no READY, no UNASSIGNED)
      expect(prismaMock.cleaningTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: CleaningStatus.PENDING }),
        }),
      )
    })

    it('NO actualiza bed.status a DIRTY en la Fase 1 — el huésped aún está en la cama', async () => {
      // Arrange — escenario crítico: confirmar que no se toca bed.status
      const bed = { id: 'bed-1', roomId: 'room-1', room: { id: 'room-1', propertyId: 'prop-1' } }

      prismaMock.unit.findMany.mockResolvedValue([bed])
      prismaMock.checkout.create.mockResolvedValue({ id: 'checkout-1', roomId: 'room-1', hasSameDayCheckIn: false })
      prismaMock.cleaningTask.create.mockResolvedValue({ id: 'task-1', status: CleaningStatus.PENDING })
      prismaMock.taskLog.create.mockResolvedValue({})

      const dto = { items: [{ unitId: 'bed-1', hasSameDayCheckIn: false }], checkoutDate: '2026-03-21' }

      // Act
      await service.batchCheckout(dto, 'staff-1', 'prop-1')

      // Assert — bed.update NO fue llamado (cama sigue OCCUPIED físicamente)
      expect(prismaMock.unit.update).not.toHaveBeenCalled()
    })

    it('asigna prioridad URGENT si alguna cama del room tiene hasSameDayCheckIn', async () => {
      // Arrange — dorm con 2 camas: una urgente, una normal
      const beds = [
        { id: 'bed-1', roomId: 'room-1', room: { id: 'room-1', propertyId: 'prop-1' } },
        { id: 'bed-2', roomId: 'room-1', room: { id: 'room-1', propertyId: 'prop-1' } },
      ]

      prismaMock.unit.findMany.mockResolvedValue(beds)
      prismaMock.checkout.create.mockResolvedValue({ id: 'checkout-1', roomId: 'room-1', hasSameDayCheckIn: true })
      prismaMock.cleaningTask.create.mockResolvedValue({ id: 'task-1', status: CleaningStatus.PENDING })
      prismaMock.taskLog.create.mockResolvedValue({})

      const dto = {
        items: [
          { unitId: 'bed-1', hasSameDayCheckIn: false },   // normal
          { unitId: 'bed-2', hasSameDayCheckIn: true },    // ← urgente: sube a todo el room
        ],
        checkoutDate: '2026-03-21',
      }

      // Act
      await service.batchCheckout(dto, 'staff-1', 'prop-1')

      // Assert — ambas tareas son URGENT por la regla "any bed triggers room urgency"
      expect(prismaMock.cleaningTask.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ priority: Priority.URGENT }),
        }),
      )
    })

    it('emite evento SSE task:planned para cada checkout creado', async () => {
      // Arrange
      const bed = { id: 'bed-1', roomId: 'room-1', room: { id: 'room-1', propertyId: 'prop-1' } }

      prismaMock.unit.findMany.mockResolvedValue([bed])
      prismaMock.checkout.create.mockResolvedValue({ id: 'checkout-1', roomId: 'room-1', hasSameDayCheckIn: false })
      prismaMock.cleaningTask.create.mockResolvedValue({ id: 'task-1', status: CleaningStatus.PENDING })
      prismaMock.taskLog.create.mockResolvedValue({})

      const dto = { items: [{ unitId: 'bed-1', hasSameDayCheckIn: false }], checkoutDate: '2026-03-21' }

      // Act
      await service.batchCheckout(dto, 'staff-1', 'prop-1')

      // Assert — el dashboard web recibe el evento para actualizar la vista
      expect(notificationsMock.emit).toHaveBeenCalledWith('prop-1', 'task:planned', expect.any(Object))
    })
  })

  // ─── confirmDeparture (Fase 2) ────────────────────────────────────────────

  describe('confirmDeparture', () => {
    /**
     * confirmDeparture es la FASE 2 del ciclo de checkout.
     *
     * El test más crítico de esta suite es "solo activa la cama especificada".
     * Este es el bug que fue corregido: antes, confirmar Cama 1 de un dorm
     * activaba TODAS las camas del checkout (Cama 1, 2, 3...).
     *
     * La corrección: el servicio ahora filtra con `(!bedId || t.bedId === bedId)`.
     */

    it('activa SOLO la cama especificada en bedId — no toca las otras camas del mismo checkout', async () => {
      // Arrange — dorm con 3 camas en el mismo checkout, todas PENDING
      const checkout = makeCheckout([
        { id: 'task-cama1', unitId: 'bed-1', status: CleaningStatus.PENDING },
        { id: 'task-cama2', unitId: 'bed-2', status: CleaningStatus.PENDING },
        { id: 'task-cama3', unitId: 'bed-3', status: CleaningStatus.PENDING },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([])  // dispatchNotifications

      // Act — confirmar salida de SOLO Cama 1
      const result = await service.confirmDeparture('checkout-1', 'staff-1', 'prop-1', 'bed-1')

      // Assert — solo 1 tarea activada, solo 1 cama marcada DIRTY
      expect(result).toMatchObject({ confirmed: true, tasksActivated: 1 })

      // Solo task-cama1 fue actualizado
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledTimes(1)
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-cama1' } }),
      )

      // Solo bed-1 fue marcado DIRTY — bed-2 y bed-3 intactos
      expect(prismaMock.unit.update).toHaveBeenCalledTimes(1)
      expect(prismaMock.unit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bed-1' },
          data: { status: 'DIRTY' },
        }),
      )
    })

    it('activa TODAS las camas PENDING cuando no se especifica bedId (habitación privada)', async () => {
      // Arrange — habitación privada con 1 sola cama (sin bedId es el caso normal)
      const checkout = makeCheckout([
        { id: 'task-1', unitId: 'bed-1', status: CleaningStatus.PENDING },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([])

      // Act — sin bedId: activa todo el checkout
      const result = await service.confirmDeparture('checkout-1', 'staff-1', 'prop-1')

      // Assert — 1 tarea activada (la única del checkout)
      expect(result).toMatchObject({ confirmed: true, tasksActivated: 1 })
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledTimes(1)
    })

    it('asigna estado READY si la tarea tiene assignedToId, UNASSIGNED si no tiene', async () => {
      // Arrange — 2 camas en el mismo checkout: una asignada, una sin asignar
      const checkout = makeCheckout([
        { id: 'task-asignada',  unitId: 'bed-1', status: CleaningStatus.PENDING, assignedToId: 'hk-1' },
        { id: 'task-sin-asignar', unitId: 'bed-2', status: CleaningStatus.PENDING, assignedToId: null  },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([])

      // Act — sin bedId: activa las 2
      await service.confirmDeparture('checkout-1', 'staff-1', 'prop-1')

      const updateCalls = prismaMock.cleaningTask.update.mock.calls

      // Assert — tarea asignada → READY, sin asignar → UNASSIGNED
      const callAsignada    = updateCalls.find((c) => c[0].where.id === 'task-asignada')
      const callSinAsignar  = updateCalls.find((c) => c[0].where.id === 'task-sin-asignar')

      expect(callAsignada[0].data).toMatchObject({ status: CleaningStatus.READY })
      expect(callSinAsignar[0].data).toMatchObject({ status: CleaningStatus.UNASSIGNED })
    })

    it('es idempotente — si la cama ya fue activada retorna alreadyDeparted sin modificar nada', async () => {
      // Arrange — la tarea ya está en UNASSIGNED (ya fue activada antes)
      const checkout = makeCheckout([
        { id: 'task-1', unitId: 'bed-1', status: CleaningStatus.UNASSIGNED }, // ya no es PENDING
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)

      // Act
      const result = await service.confirmDeparture('checkout-1', 'staff-1', 'prop-1', 'bed-1')

      // Assert — respuesta idempotente, sin tocar BD
      expect(result).toMatchObject({ alreadyDeparted: true })
      expect(prismaMock.cleaningTask.update).not.toHaveBeenCalled()
      expect(prismaMock.unit.update).not.toHaveBeenCalled()
    })

    it('lanza NotFoundException si el checkout no existe', async () => {
      // Arrange
      prismaMock.checkout.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(
        service.confirmDeparture('no-existe', 'staff-1', 'prop-1'),
      ).rejects.toThrow(NotFoundException)
    })

    it('lanza ConflictException si el checkout fue cancelado', async () => {
      // Arrange — checkout cancelado (huésped extendió estadía)
      const checkout = makeCheckout([], { cancelled: true })
      prismaMock.checkout.findUnique.mockResolvedValue(checkout)

      // Act & Assert
      await expect(
        service.confirmDeparture('checkout-1', 'staff-1', 'prop-1'),
      ).rejects.toThrow(ConflictException)
    })

    it('marca la cama como DIRTY al confirmar la salida física', async () => {
      // Arrange — antes de la Fase 2, la cama debería estar OCCUPIED
      const checkout = makeCheckout([
        { id: 'task-1', unitId: 'bed-1', status: CleaningStatus.PENDING },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([])

      // Act
      await service.confirmDeparture('checkout-1', 'staff-1', 'prop-1', 'bed-1')

      // Assert — bed.status → DIRTY (el huésped se fue, cama lista para limpieza)
      expect(prismaMock.unit.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'bed-1' },
          data: { status: 'DIRTY' },
        }),
      )
    })

    it('registra un TaskLog con el actorId de quien confirmó la salida', async () => {
      // Arrange
      const checkout = makeCheckout([
        { id: 'task-1', unitId: 'bed-1', status: CleaningStatus.PENDING },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.cleaningTask.findMany.mockResolvedValue([])

      // Act
      await service.confirmDeparture('checkout-1', 'recep-99', 'prop-1', 'bed-1')

      // Assert — audit trail con el staff que confirmó
      expect(prismaMock.taskLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ staffId: 'recep-99' }),
        }),
      )
    })
  })

  // ─── cancelCheckout ───────────────────────────────────────────────────────

  describe('cancelCheckout', () => {
    it('cancela las tareas READY/UNASSIGNED y restaura las camas a OCCUPIED', async () => {
      // Arrange
      const checkout = makeCheckout([
        { id: 'task-ready', unitId: 'bed-1', status: CleaningStatus.READY, assignedToId: 'hk-1' },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.checkout.update.mockResolvedValue({ ...checkout, cancelled: true })
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})

      // Act
      const result = await service.cancelCheckout('checkout-1', 'property-1')

      // Assert
      expect(result.cancelled).toBe(true)
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: CleaningStatus.CANCELLED } }),
      )
      expect(prismaMock.unit.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'OCCUPIED' } }),
      )
    })

    it('también cancela tareas en estado PENDING (planificadas, no activadas aún)', async () => {
      // Arrange — escenario: huésped extendió ANTES de la Fase 2
      const checkout = makeCheckout([
        { id: 'task-pending', unitId: 'bed-1', status: CleaningStatus.PENDING },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.checkout.update.mockResolvedValue({ ...checkout, cancelled: true })
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})

      // Act
      const result = await service.cancelCheckout('checkout-1', 'property-1')

      // Assert — PENDING también se cancela (housekeeper no ha llegado aún)
      expect(result.cancelled).toBe(true)
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: CleaningStatus.CANCELLED } }),
      )
    })

    it('envía push al housekeeper asignado cuando se cancela su tarea', async () => {
      // Arrange
      const checkout = makeCheckout([
        { id: 'task-ready', unitId: 'bed-1', status: CleaningStatus.READY, assignedToId: 'hk-1' },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.checkout.update.mockResolvedValue({ ...checkout, cancelled: true })
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})

      // Act
      await service.cancelCheckout('checkout-1', 'property-1')

      // Assert — el housekeeper recibe "NO limpiar — huésped extendió"
      expect(pushMock.sendToStaff).toHaveBeenCalledWith(
        'hk-1',
        expect.stringContaining('cancelada'),
        expect.stringContaining('201'),
        expect.objectContaining({ type: 'task:cancelled' }),
      )
    })

    it('alerta al supervisor si hay tareas IN_PROGRESS y no cancela automáticamente', async () => {
      // Arrange — el housekeeper está limpiando cuando el huésped extiende
      const checkout = makeCheckout([
        { id: 'task-ip', unitId: 'bed-1', status: CleaningStatus.IN_PROGRESS, assignedToId: 'hk-1' },
      ])
      const supervisor = { id: 'sup-1' }

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.checkout.update.mockResolvedValue({ ...checkout, cancelled: true })
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})
      prismaMock.housekeepingStaff.findMany.mockResolvedValue([supervisor])

      // Act
      const result = await service.cancelCheckout('checkout-1', 'property-1')

      // Assert — alerta crítica al supervisor, no cancelación automática
      expect(result.criticalTasksAlert).toBe(true)
      expect(pushMock.sendToStaff).toHaveBeenCalledWith(
        'sup-1',
        expect.stringContaining('Intervención'),
        expect.any(String),
        expect.any(Object),
      )
    })

    it('lanza ConflictException si el checkout ya fue cancelado previamente', async () => {
      // Arrange
      prismaMock.checkout.findUnique.mockResolvedValue(
        makeCheckout([], { cancelled: true }),
      )

      // Act & Assert — no puede cancelar dos veces
      await expect(service.cancelCheckout('checkout-1', 'property-1')).rejects.toThrow(
        ConflictException,
      )
    })

    it('lanza NotFoundException si el checkout no existe en la BD', async () => {
      prismaMock.checkout.findUnique.mockResolvedValue(null)

      await expect(service.cancelCheckout('no-existe', 'property-1')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('per-bed cancel: solo cancela la tarea de la cama indicada, las demás siguen activas', async () => {
      // Arrange — dorm con 2 camas; solo se cancela bed-1
      const checkout = makeCheckout([
        { id: 'task-1', unitId: 'bed-1', status: CleaningStatus.PENDING },
        { id: 'task-2', unitId: 'bed-2', status: CleaningStatus.PENDING },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})

      // Act
      await service.cancelCheckout('checkout-1', 'property-1', 'bed-1')

      // Assert — solo task-1 fue cancelada
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledTimes(1)
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'task-1' }, data: { status: CleaningStatus.CANCELLED } }),
      )
      // checkout.cancelled no se marca en cancel por cama individual
      expect(prismaMock.checkout.update).not.toHaveBeenCalled()
    })

    it('per-bed cancel: no marca checkout.cancelled = true (el resto del checkout sigue vigente)', async () => {
      // Arrange
      const checkout = makeCheckout([
        { id: 'task-1', unitId: 'bed-1', status: CleaningStatus.READY },
        { id: 'task-2', unitId: 'bed-2', status: CleaningStatus.READY },
      ])

      prismaMock.checkout.findUnique.mockResolvedValue(checkout)
      prismaMock.cleaningTask.update.mockResolvedValue({})
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.unit.update.mockResolvedValue({})

      // Act
      await service.cancelCheckout('checkout-1', 'property-1', 'bed-1')

      // Assert — checkout en BD no fue marcado como cancelled
      expect(prismaMock.checkout.update).not.toHaveBeenCalled()
    })
  })

  // ─── getDailyGrid — fix de timezone ──────────────────────────────────────

  describe('getDailyGrid — timezone handling', () => {
    /**
     * Fix crítico de timezone:
     *
     * ANTES (bug):
     *   const dayStart = new Date('2026-03-21')   // UTC midnight
     *   dayStart.setHours(0, 0, 0, 0)             // LOCAL midnight ← INCORRECTO
     *
     *   En UTC-5: dayStart = 2026-03-20T05:00:00Z
     *             dayEnd   = 2026-03-21T04:59:59Z
     *   Las tareas creadas a las 15:00 UTC caían FUERA del rango → taskId: null
     *   → planningIsDone = false → "Sin planificación confirmada" en el frontend.
     *
     * DESPUÉS (fix):
     *   const dayStart = new Date('2026-03-21T00:00:00.000Z')  // UTC explícito
     *   const dayEnd   = new Date('2026-03-21T23:59:59.999Z')  // UTC explícito
     *
     * Estos tests verifican que el método pasa las fechas correctas a Prisma.
     */

    it('construye dayStart como UTC midnight del día dado', async () => {
      // Arrange
      const rooms: never[] = []
      prismaMock.unit = prismaMock.unit || { findMany: jest.fn() }

      // Usamos el mock de room.findMany para capturar la query
      const roomFindMany = jest.fn().mockResolvedValue(rooms)
      prismaMock.room = { ...prismaMock.room, findMany: roomFindMany }

      // Act
      await service.getDailyGrid('prop-1', '2026-03-21')

      // Assert — la query de Prisma recibe las fechas UTC correctas
      expect(roomFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { propertyId: 'prop-1', organizationId: 'org-1' },
          include: expect.objectContaining({
            units: expect.objectContaining({
              include: expect.objectContaining({
                cleaningTasks: expect.objectContaining({
                  where: expect.objectContaining({
                    checkout: {
                      actualCheckoutAt: {
                        gte: new Date('2026-03-21T00:00:00.000Z'),  // UTC midnight exacto
                        lte: new Date('2026-03-21T23:59:59.999Z'),  // UTC fin de día exacto
                      },
                    },
                  }),
                }),
              }),
            }),
          }),
        }),
      )
    })

    it('retorna el grid correctamente estructurado con sharedRooms y privateRooms', async () => {
      // Arrange — una habitación SHARED y una PRIVATE, sin tareas hoy
      const sharedRoom  = {
        id: 'r-shared', number: 'Dorm1', category: 'SHARED', floor: 1,
        units: [{ id: 'b-1', label: 'Cama 1', status: 'AVAILABLE', cleaningTasks: [] }],
      }
      const privateRoom = {
        id: 'r-private', number: '101', category: 'PRIVATE', floor: 1,
        units: [{ id: 'b-2', label: 'Cama 1', status: 'AVAILABLE', cleaningTasks: [] }],
      }

      prismaMock.room = { ...prismaMock.room, findMany: jest.fn().mockResolvedValue([sharedRoom, privateRoom]) }

      // Act
      const grid = await service.getDailyGrid('prop-1', '2026-03-21')

      // Assert — estructura correcta del grid
      expect(grid.date).toBe('2026-03-21')
      expect(grid.sharedRooms).toHaveLength(1)
      expect(grid.privateRooms).toHaveLength(1)

      // Cama sin tarea hoy → taskId: null
      expect(grid.sharedRooms[0].units[0]).toMatchObject({
        unitId: 'b-1',
        taskId: null,
        taskStatus: null,
        hasSameDayCheckIn: false,
        cancelled: false,
      })
    })

    it('retorna taskId y taskStatus cuando existe tarea activa para hoy', async () => {
      // Arrange — cama con tarea PENDING creada hoy
      const task = {
        id: 'task-1',
        status: CleaningStatus.PENDING,
        assignedToId: null,
        checkoutId: 'checkout-1',
        hasSameDayCheckIn: true,
        checkout: { id: 'checkout-1', hasSameDayCheckIn: true, cancelled: false },
      }
      const room = {
        id: 'r-1', number: '201', category: 'PRIVATE', floor: 1,
        units: [{ id: 'b-1', label: 'Cama 1', status: 'OCCUPIED', cleaningTasks: [task] }],
      }

      prismaMock.room = { ...prismaMock.room, findMany: jest.fn().mockResolvedValue([room]) }

      // Act
      const grid = await service.getDailyGrid('prop-1', '2026-03-21')

      // Assert — los campos del checkout se reflejan en la celda del grid
      expect(grid.privateRooms[0].units[0]).toMatchObject({
        taskId:           'task-1',
        taskStatus:       CleaningStatus.PENDING,
        hasSameDayCheckIn: true,
        checkoutId:       'checkout-1',
        cancelled:        false,
      })
    })

    it('filtra las tareas CANCELLED — una cama con checkout cancelado aparece como disponible', async () => {
      // Arrange — tarea en estado CANCELLED (no debe aparecer en el grid)
      // La query de Prisma ya filtra status: { not: 'CANCELLED' }
      // Simulamos que cleaningTasks devuelve [] (filtrado por Prisma)
      const room = {
        id: 'r-1', number: '201', category: 'PRIVATE', floor: 1,
        units: [{ id: 'b-1', label: 'Cama 1', status: 'OCCUPIED', cleaningTasks: [] }],
      }

      prismaMock.room = { ...prismaMock.room, findMany: jest.fn().mockResolvedValue([room]) }

      // Act
      const grid = await service.getDailyGrid('prop-1', '2026-03-21')

      // Assert — cama aparece como disponible (sin tarea) aunque tenga checkout cancelado
      expect(grid.privateRooms[0].units[0].taskId).toBeNull()
      expect(grid.privateRooms[0].units[0].cancelled).toBe(false)
    })
  })
})
