/**
 * Tests unitarios para TasksService
 *
 * No tocamos la base de datos real. Usamos "mocks" — objetos falsos que
 * simulan PrismaService, NotificationsService y PushService.
 *
 * Cada test sigue el patrón:
 *   Arrange → preparar mocks y datos
 *   Act     → llamar el método
 *   Assert  → verificar resultado con expect()
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { CleaningStatus, HousekeepingRole, TaskLogEvent } from '@housekeeping/shared'
import { TasksService } from './tasks.service'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PushService } from '../notifications/push.service'

// ─── Helpers para construir datos de prueba ───────────────────────────────────

function makeActor(overrides: Partial<{ sub: string; role: HousekeepingRole; propertyId: string }> = {}) {
  return {
    sub: 'staff-1',
    email: 'hk@test.com',
    role: HousekeepingRole.HOUSEKEEPER,
    propertyId: 'property-1',
    ...overrides,
  }
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    bedId: 'bed-1',
    checkoutId: null,
    assignedToId: 'staff-1',
    status: CleaningStatus.READY,
    priority: 'MEDIUM',
    taskType: 'CLEANING',
    requiredCapability: 'CLEANING',
    startedAt: null,
    finishedAt: null,
    verifiedAt: null,
    verifiedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    bed: {
      id: 'bed-1',
      roomId: 'room-1',
      label: 'Cama 1',
      status: 'DIRTY',
      room: {
        id: 'room-1',
        number: '201',
        type: 'PRIVATE',
        floor: 2,
        property: { id: 'property-1', name: 'Hotel Demo' },
      },
    },
    notes: [],
    ...overrides,
  }
}

// ─── Setup del módulo de testing ─────────────────────────────────────────────

describe('TasksService', () => {
  let service: TasksService

  // Mocks — objetos que reemplazan las dependencias reales
  const prismaMock = {
    cleaningTask: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    bed: { update: jest.fn() },
    housekeepingStaff: { findUnique: jest.fn() },
    taskLog: { create: jest.fn() },
    // $transaction ejecuta la función callback inmediatamente (sin transacción real)
    $transaction: jest.fn((fn) => fn(prismaMock)),
  }

  const notificationsMock = { emit: jest.fn() }
  const pushMock = { sendToStaff: jest.fn() }

  beforeEach(async () => {
    // Construir el módulo con las dependencias reemplazadas por mocks
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: NotificationsService, useValue: notificationsMock },
        { provide: PushService, useValue: pushMock },
      ],
    }).compile()

    service = module.get<TasksService>(TasksService)

    // Limpiar llamadas anteriores entre tests
    jest.clearAllMocks()
  })

  // ─── startTask ─────────────────────────────────────────────────────────────

  describe('startTask', () => {
    it('cambia el estado a IN_PROGRESS cuando la tarea está READY', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.READY })
      const updatedTask = { ...task, status: CleaningStatus.IN_PROGRESS, startedAt: new Date() }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.findFirst.mockResolvedValue(null) // sin tarea activa
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.bed.update.mockResolvedValue({})

      // Act
      const result = await service.startTask('task-1', makeActor())

      // Assert
      expect(result.status).toBe(CleaningStatus.IN_PROGRESS)
      expect(prismaMock.cleaningTask.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'task-1' },
          data: expect.objectContaining({ status: CleaningStatus.IN_PROGRESS }),
        }),
      )
    })

    it('lanza NotFoundException si la tarea no existe', async () => {
      // Arrange
      prismaMock.cleaningTask.findUnique.mockResolvedValue(null)

      // Act & Assert
      await expect(service.startTask('no-existe', makeActor())).rejects.toThrow(NotFoundException)
    })

    it('lanza ConflictException si la tarea no está en estado READY o PENDING', async () => {
      // Arrange — tarea ya está en progreso
      const task = makeTask({ status: CleaningStatus.IN_PROGRESS })
      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)

      // Act & Assert
      await expect(service.startTask('task-1', makeActor())).rejects.toThrow(ConflictException)
    })

    it('lanza ForbiddenException si el housekeeper intenta iniciar una tarea ajena', async () => {
      // Arrange — la tarea está asignada a otro housekeeper
      const task = makeTask({ assignedToId: 'otro-housekeeper' })
      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)

      // Act & Assert — actor es housekeeper distinto al asignado
      await expect(service.startTask('task-1', makeActor({ sub: 'staff-mio' }))).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('lanza ConflictException si el housekeeper ya tiene una tarea IN_PROGRESS', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.READY })
      const otraTaskActiva = makeTask({ id: 'task-otra', status: CleaningStatus.IN_PROGRESS })

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.findFirst.mockResolvedValue(otraTaskActiva) // ya tiene una activa

      // Act & Assert
      await expect(service.startTask('task-1', makeActor())).rejects.toThrow(ConflictException)
    })

    it('un SUPERVISOR puede iniciar cualquier tarea sin verificar asignación', async () => {
      // Arrange — tarea asignada a otro, pero el actor es supervisor
      const task = makeTask({ assignedToId: 'otro-staff', status: CleaningStatus.READY })
      const updatedTask = { ...task, status: CleaningStatus.IN_PROGRESS }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.bed.update.mockResolvedValue({})

      // Act
      const result = await service.startTask('task-1', makeActor({ role: HousekeepingRole.SUPERVISOR }))

      // Assert — llegó hasta aquí sin lanzar error
      expect(result.status).toBe(CleaningStatus.IN_PROGRESS)
    })

    it('registra un TaskLog con evento STARTED', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.READY })
      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.findFirst.mockResolvedValue(null)
      prismaMock.cleaningTask.update.mockResolvedValue({ ...task, status: CleaningStatus.IN_PROGRESS })
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.bed.update.mockResolvedValue({})

      // Act
      await service.startTask('task-1', makeActor())

      // Assert — el log fue creado con el evento correcto
      expect(prismaMock.taskLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ event: TaskLogEvent.STARTED }),
        }),
      )
    })
  })

  // ─── endTask ───────────────────────────────────────────────────────────────

  describe('endTask', () => {
    it('cambia el estado a DONE cuando la tarea está IN_PROGRESS', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.IN_PROGRESS })
      const updatedTask = { ...task, status: CleaningStatus.DONE, finishedAt: new Date() }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.bed.update.mockResolvedValue({})

      // Act
      const result = await service.endTask('task-1', makeActor())

      // Assert
      expect(result.status).toBe(CleaningStatus.DONE)
      expect(prismaMock.bed.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'AVAILABLE' },
        }),
      )
    })

    it('también puede finalizar una tarea PAUSED', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.PAUSED })
      const updatedTask = { ...task, status: CleaningStatus.DONE }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.bed.update.mockResolvedValue({})

      // Act
      const result = await service.endTask('task-1', makeActor())

      // Assert
      expect(result.status).toBe(CleaningStatus.DONE)
    })

    it('lanza ConflictException si la tarea no está IN_PROGRESS ni PAUSED', async () => {
      // Arrange — la tarea ya fue marcada como DONE
      const task = makeTask({ status: CleaningStatus.DONE })
      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)

      // Act & Assert
      await expect(service.endTask('task-1', makeActor())).rejects.toThrow(ConflictException)
    })

    it('emite evento SSE task:done al finalizar', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.IN_PROGRESS })
      const updatedTask = { ...task, status: CleaningStatus.DONE }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})
      prismaMock.bed.update.mockResolvedValue({})

      // Act
      await service.endTask('task-1', makeActor())

      // Assert — se emitió el evento SSE para el dashboard web
      expect(notificationsMock.emit).toHaveBeenCalledWith(
        'property-1',
        'task:done',
        expect.objectContaining({ taskId: 'task-1' }),
      )
    })
  })

  // ─── verifyTask ────────────────────────────────────────────────────────────

  describe('verifyTask', () => {
    it('cambia el estado a VERIFIED cuando la tarea está DONE', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.DONE })
      const updatedTask = { ...task, status: CleaningStatus.VERIFIED }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})

      // Act
      const result = await service.verifyTask('task-1', makeActor({ role: HousekeepingRole.SUPERVISOR }))

      // Assert
      expect(result.status).toBe(CleaningStatus.VERIFIED)
    })

    it('lanza ConflictException si se intenta verificar antes de que esté DONE', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.IN_PROGRESS })
      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)

      // Act & Assert
      await expect(
        service.verifyTask('task-1', makeActor({ role: HousekeepingRole.SUPERVISOR })),
      ).rejects.toThrow(ConflictException)
    })
  })

  // ─── assignTask ────────────────────────────────────────────────────────────

  describe('assignTask', () => {
    it('cambia el estado de UNASSIGNED a READY al asignar un housekeeper', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.UNASSIGNED, assignedToId: null })
      const staff = { id: 'staff-2', name: 'Ana', active: true, capabilities: ['CLEANING'] }
      const updatedTask = { ...task, status: CleaningStatus.READY, assignedToId: 'staff-2' }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.housekeepingStaff.findUnique.mockResolvedValue(staff)
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})
      pushMock.sendToStaff.mockResolvedValue(undefined)

      // Act
      const result = await service.assignTask(
        'task-1',
        { assignedToId: 'staff-2' },
        makeActor({ role: HousekeepingRole.SUPERVISOR }),
      )

      // Assert
      expect(result.status).toBe(CleaningStatus.READY)
      expect(pushMock.sendToStaff).toHaveBeenCalledWith(
        'staff-2',
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ type: 'task:ready' }),
      )
    })

    it('lanza NotFoundException si el staff asignado no existe', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.UNASSIGNED })
      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.housekeepingStaff.findUnique.mockResolvedValue(null) // no existe

      // Act & Assert
      await expect(
        service.assignTask('task-1', { assignedToId: 'fantasma' }, makeActor({ role: HousekeepingRole.SUPERVISOR })),
      ).rejects.toThrow(NotFoundException)
    })

    it('lanza ConflictException al intentar asignar una tarea ya DONE', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.DONE })
      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)

      // Act & Assert
      await expect(
        service.assignTask('task-1', { assignedToId: 'staff-2' }, makeActor({ role: HousekeepingRole.SUPERVISOR })),
      ).rejects.toThrow(ConflictException)
    })
  })

  // ─── pauseTask / resumeTask ────────────────────────────────────────────────

  describe('pauseTask', () => {
    it('cambia el estado a PAUSED desde IN_PROGRESS', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.IN_PROGRESS })
      const updatedTask = { ...task, status: CleaningStatus.PAUSED }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})

      // Act
      const result = await service.pauseTask('task-1', makeActor())

      // Assert
      expect(result.status).toBe(CleaningStatus.PAUSED)
    })

    it('lanza ConflictException si la tarea no está IN_PROGRESS', async () => {
      const task = makeTask({ status: CleaningStatus.READY })
      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)

      await expect(service.pauseTask('task-1', makeActor())).rejects.toThrow(ConflictException)
    })
  })

  describe('resumeTask', () => {
    it('cambia el estado a IN_PROGRESS desde PAUSED', async () => {
      // Arrange
      const task = makeTask({ status: CleaningStatus.PAUSED })
      const updatedTask = { ...task, status: CleaningStatus.IN_PROGRESS }

      prismaMock.cleaningTask.findUnique.mockResolvedValue(task)
      prismaMock.cleaningTask.update.mockResolvedValue(updatedTask)
      prismaMock.taskLog.create.mockResolvedValue({})

      // Act
      const result = await service.resumeTask('task-1', makeActor())

      // Assert
      expect(result.status).toBe(CleaningStatus.IN_PROGRESS)
    })
  })
})
