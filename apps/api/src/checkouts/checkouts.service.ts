/**
 * CheckoutsService — Núcleo del sistema de housekeeping.
 *
 * Este servicio es el punto de entrada unificado para TODOS los checkouts,
 * independientemente de su origen:
 *
 *  1. Manual (recepción en DailyPlanningPage o CheckoutsPage)
 *     → POST /checkouts/batch  (planning matutino — múltiples habitaciones a la vez)
 *     → POST /checkouts        (checkout individual ad-hoc)
 *
 *  2. Automático (webhook CloudBeds PMS)
 *     → POST /webhooks/cloudbeds → CheckoutsService.processCheckout()
 *
 * Flujo de processCheckout():
 *  1. Idempotency check (cloudbedsReservationId) — evita duplicados por retries del webhook.
 *  2. Obtener room + beds + property en una sola query (evita N+1).
 *  3. Determinar prioridad: URGENT si hay check-in el mismo día, MEDIUM en caso contrario.
 *  4. $transaction atómica:
 *     a. Crear registro Checkout.
 *     b. Por cada bed: activar tarea PENDING→READY si había pre-asignación, o crear UNASSIGNED.
 *     c. Actualizar bed.status → DIRTY para reflejar el estado físico real.
 *  5. Post-transaction: push a camareras + SSE al dashboard web.
 *     (Fuera de la transacción para que un fallo de push no revierta el checkout persistido.)
 *
 * Máquina de estados de CleaningTask relevante a este módulo:
 *  PENDING  → READY      (checkout activa pre-asignación cuando el huésped sale)
 *  (nueva)  → UNASSIGNED (checkout crea tarea sin asignar si no hay pre-asignación)
 *  READY / UNASSIGNED / PENDING → CANCELLED (cancelCheckout cuando huésped extiende estadía)
 *
 * Regla de modelo: UN checkout corresponde a UNA habitación, pero genera MÚLTIPLES
 * CleaningTasks (una por cama). Esto es esencial en dormitorios compartidos donde cada
 * cama puede estar asignada a una camarera diferente y limpiarse de forma independiente.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CheckoutSource, CleaningStatus, Priority, TaskLogEvent } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PushService } from '../notifications/push.service'
import { CreateCheckoutDto, BatchCheckoutDto } from './dto/create-checkout.dto'

/**
 * Input normalizado que ambas fuentes (manual + webhook) convierten a este formato
 * antes de llamar a processCheckout()
 */
export interface CheckoutInput {
  roomId: string
  guestName?: string
  actualCheckoutAt: Date
  source: CheckoutSource
  cloudbedsReservationId?: string  // Solo para checkouts de CloudBeds (idempotency key)
  isEarlyCheckout?: boolean
  hasSameDayCheckIn?: boolean      // true → prioridad URGENT en la tarea de limpieza
  notes?: string                   // Notas de recepción visibles al housekeeper
  enteredById?: string             // Staff que registró el checkout (para auditoría)
}

@Injectable()
export class CheckoutsService {
  private readonly logger = new Logger(CheckoutsService.name)

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private push: PushService,
    private events: EventEmitter2,
  ) {}

  /**
   * processCheckout — Procesador unificado de checkouts.
   *
   * Punto de entrada único para ambas fuentes (manual + webhook). Mantener una sola
   * implementación garantiza que las reglas de negocio sean idénticas sin importar
   * quién dispara el checkout.
   *
   * Nota sobre el loop por bed dentro de la transacción:
   *  Se ejecuta una query findFirst por cama para detectar la tarea PENDING pre-asignada.
   *  Esto introduce O(beds) queries dentro de la transacción, pero las habitaciones
   *  tienen típicamente 1-12 camas, por lo que el costo es aceptable y predecible.
   *  Mover esto fuera de la transacción introduciría race conditions con asignaciones concurrentes.
   *
   * @param input  Parámetros normalizados del checkout (ver CheckoutInput)
   * @returns      El Checkout recién creado, o el existente si ya fue procesado (idempotencia)
   * @throws       NotFoundException si el roomId no existe en la base de datos
   */
  async processCheckout(input: CheckoutInput) {
    // Idempotency: skip if already processed (CloudBeds webhook retry)
    if (input.cloudbedsReservationId) {
      const existing = await this.prisma.checkout.findUnique({
        where: { cloudbedsReservationId: input.cloudbedsReservationId },
      })
      if (existing) {
        this.logger.debug(`Checkout already processed: ${input.cloudbedsReservationId}`)
        return existing
      }
    }

    const room = await this.prisma.room.findUnique({
      where: { id: input.roomId },
      include: { beds: true, property: true },
    })
    if (!room) throw new NotFoundException('Room not found')

    const priority: Priority = input.hasSameDayCheckIn ? Priority.URGENT : Priority.MEDIUM

    const checkout = await this.prisma.$transaction(async (tx) => {
      // Create checkout record
      const checkout = await tx.checkout.create({
        data: {
          roomId: input.roomId,
          guestName: input.guestName,
          actualCheckoutAt: input.actualCheckoutAt,
          source: input.source,
          cloudbedsReservationId: input.cloudbedsReservationId,
          isEarlyCheckout: input.isEarlyCheckout ?? false,
          hasSameDayCheckIn: input.hasSameDayCheckIn ?? false,
          notes: input.notes,
          enteredById: input.enteredById,
        },
      })

      // Create one CleaningTask per bed in the room
      for (const bed of room.beds) {
        // Find pre-assigned housekeeper for this bed (task in PENDING state)
        const existingPendingTask = await tx.cleaningTask.findFirst({
          where: { bedId: bed.id, status: CleaningStatus.PENDING },
          select: { id: true, assignedToId: true },
        })

        let taskStatus: CleaningStatus
        let assignedToId: string | null = null

        if (existingPendingTask) {
          // Upgrade existing pending task to READY
          taskStatus = CleaningStatus.READY
          assignedToId = existingPendingTask.assignedToId

          await tx.cleaningTask.update({
            where: { id: existingPendingTask.id },
            data: {
              status: CleaningStatus.READY,
              checkoutId: checkout.id,
              priority,
              updatedAt: new Date(),
            },
          })

          await tx.taskLog.create({
            data: {
              taskId: existingPendingTask.id,
              staffId: input.enteredById ?? existingPendingTask.assignedToId ?? null,
              event: TaskLogEvent.READY,
            },
          })
        } else {
          // Create new task
          taskStatus = CleaningStatus.UNASSIGNED

          const newTask = await tx.cleaningTask.create({
            data: {
              bedId: bed.id,
              checkoutId: checkout.id,
              status: taskStatus,
              priority,
              requiredCapability: 'CLEANING',
            },
          })

          await tx.taskLog.create({
            data: {
              taskId: newTask.id,
              staffId: input.enteredById ?? null,
              event: TaskLogEvent.CREATED,
            },
          })
        }

        // Update bed status to DIRTY
        await tx.bed.update({ where: { id: bed.id }, data: { status: 'DIRTY' } })
      }

      return checkout
    })

    // Post-transaction: fire push notifications and SSE
    await this.dispatchNotifications(checkout.id, room.property.id, input)

    return checkout
  }

  /**
   * Procesa el batch de la planificación matutina (DailyPlanningPage) — FASE 1.
   *
   * Esta es la primera de dos fases del ciclo de checkout:
   *
   *   FASE 1 — Planificación (este método):
   *     El recepcionista marca qué camas tienen salida hoy.
   *     Se crean: Checkout record + CleaningTask(PENDING) por cada cama.
   *     La cama físicamente SIGUE OCUPADA (bed.status NO cambia a DIRTY todavía).
   *     Housekeeping recibe la lista de salidas esperadas para prepararse, pero
   *     NO se les notifica que limpien todavía — el huésped aún está en la cama.
   *
   *   FASE 2 — Salida física (confirmDeparture):
   *     Cuando el huésped se va físicamente, el recepcionista confirma la salida.
   *     Las tareas pasan de PENDING → READY/UNASSIGNED.
   *     bed.status → DIRTY. Housekeeping recibe la notificación: "ya pueden limpiar".
   *
   * ¿Por qué separar las dos fases?
   *   En hotelería, la planificación matutina se hace a las 7:00 am, pero los
   *   huéspedes no salen hasta las 11:00 am o 12:00 pm. Si notificamos a
   *   housekeeping en el momento de la planificación, llegan a una cama ocupada.
   *   La separación de fases evita ese error operativo.
   */
  async batchCheckout(dto: BatchCheckoutDto, enteredById: string, propertyId: string) {
    const checkoutDate = dto.checkoutDate ? new Date(dto.checkoutDate) : new Date()

    // 1. Obtener los beds con su room en una sola query (evita N+1)
    const bedIds = dto.items.map((i) => i.bedId)
    const beds = await this.prisma.bed.findMany({
      where: { id: { in: bedIds } },
      include: { room: true },
    })

    // 2. Mapa de configuración por bedId para acceso O(1) al procesar cada bed
    const itemMap = new Map(dto.items.map((i) => [i.bedId, i]))

    // 3. Agrupar beds por roomId para crear un Checkout por habitación
    const byRoom = new Map<string, typeof beds>()
    for (const bed of beds) {
      const arr = byRoom.get(bed.roomId) ?? []
      arr.push(bed)
      byRoom.set(bed.roomId, arr)
    }

    const results: { checkoutId: string; roomId: string; tasksCreated: number }[] = []

    // 4. Crear un Checkout + tareas PENDING por room (sin activar limpieza aún)
    for (const [roomId, roomBeds] of byRoom.entries()) {
      const hasSameDayCheckIn = roomBeds.some((b) => itemMap.get(b.id)?.hasSameDayCheckIn)
      const notes = roomBeds.map((b) => itemMap.get(b.id)?.notes).filter(Boolean).join('; ')
      const priority: Priority = hasSameDayCheckIn ? Priority.URGENT : Priority.MEDIUM

      const result = await this.prisma.$transaction(async (tx) => {
        // Crear registro de checkout (fase de planificación)
        const checkout = await tx.checkout.create({
          data: {
            roomId,
            actualCheckoutAt: checkoutDate,
            source: CheckoutSource.MANUAL,
            hasSameDayCheckIn,
            notes: notes || undefined,
            enteredById,
          },
        })

        let tasksCreated = 0
        for (const bed of roomBeds) {
          // Crear tarea en estado PENDING — el huésped aún no ha salido físicamente.
          // La tarea pasará a READY/UNASSIGNED cuando el recepcionista confirme la salida física.
          const task = await tx.cleaningTask.create({
            data: {
              bedId: bed.id,
              checkoutId: checkout.id,
              status: CleaningStatus.PENDING,
              priority,
              requiredCapability: 'CLEANING',
            },
          })

          await tx.taskLog.create({
            data: {
              taskId: task.id,
              staffId: enteredById,
              event: TaskLogEvent.CREATED,
            },
          })
          tasksCreated++
        }
        // IMPORTANTE: bed.status NO se cambia aquí. El huésped sigue en la cama.
        // Solo cambia a DIRTY en confirmDeparture() cuando sale físicamente.

        return { checkoutId: checkout.id, roomId, tasksCreated }
      })

      results.push(result)
    }

    // Emitir SSE para que el dashboard se actualice (muestra las salidas planificadas)
    for (const result of results) {
      this.notifications.emit(propertyId, 'task:planned', {
        checkoutId: result.checkoutId,
        roomId: result.roomId,
      })
    }

    this.logger.log(`Batch planning: ${results.length} rooms, ${results.reduce((a, r) => a + r.tasksCreated, 0)} tasks created as PENDING`)
    return results
  }

  /**
   * Cancela un checkout cuando el huésped extiende su estadía.
   *
   * Este es el caso más crítico del sistema porque puede interrumpir una limpieza
   * en curso. El comportamiento varía según el estado de la tarea:
   *
   *   READY / UNASSIGNED / PENDING → Cancelación automática + push al housekeeper asignado:
   *     "No limpiar — huésped extendió estadía"
   *
   *   IN_PROGRESS / PAUSED → NO se cancela automáticamente. Se envía alerta al supervisor:
   *     "Housekeeper en progreso — requiere intervención manual"
   *     El supervisor decide si interrumpir al housekeeper o coordinar la reubicación.
   *
   *   DONE → El checkout se cancela pero la limpieza ya ocurrió. El supervisor
   *     coordina fuera del sistema (no hay acción automática del backend).
   *
   * El Checkout nunca se elimina — se marca como `cancelled: true` para mantener
   * el audit trail completo. Esto es importante para reportes históricos.
   *
   * @param checkoutId - ID del checkout a cancelar
   * @param propertyId - ID de la propiedad (para buscar supervisores)
   */
  async cancelCheckout(checkoutId: string, propertyId: string) {
    const checkout = await this.prisma.checkout.findUnique({
      where: { id: checkoutId },
      include: {
        tasks: { include: { assignedTo: { include: { pushTokens: true } } } },
        room: true,
      },
    })
    if (!checkout) throw new NotFoundException('Checkout not found')
    if (checkout.cancelled) throw new ConflictException('Checkout already cancelled')

    const criticalTasks = checkout.tasks.filter(
      (t) => t.status === CleaningStatus.IN_PROGRESS || t.status === CleaningStatus.PAUSED,
    )

    const cancellableTasks = checkout.tasks.filter((t) =>
      [CleaningStatus.READY, CleaningStatus.UNASSIGNED, CleaningStatus.PENDING].includes(
        t.status as CleaningStatus,
      ),
    )

    await this.prisma.$transaction(async (tx) => {
      // Mark checkout as cancelled
      await tx.checkout.update({
        where: { id: checkoutId },
        data: { cancelled: true, cancelledAt: new Date() },
      })

      // Cancel tasks that haven't started
      for (const task of cancellableTasks) {
        await tx.cleaningTask.update({
          where: { id: task.id },
          data: { status: CleaningStatus.CANCELLED },
        })
        await tx.taskLog.create({
          data: { taskId: task.id, staffId: null, event: TaskLogEvent.CANCELLED },
        })
        // Restore bed to OCCUPIED
        await tx.bed.update({ where: { id: task.bedId }, data: { status: 'OCCUPIED' } })
      }
    })

    // Push notifications for cancelled tasks
    for (const task of cancellableTasks) {
      if (task.assignedToId) {
        await this.push.sendToStaff(
          task.assignedToId,
          '⚠️ Limpieza cancelada',
          `Hab. ${checkout.room.number} — El huésped extendió su estadía. No limpiar.`,
          { type: 'task:cancelled', taskId: task.id },
        )
      }
    }

    // Alert supervisors for critical in-progress tasks
    if (criticalTasks.length > 0) {
      const supervisors = await this.prisma.housekeepingStaff.findMany({
        where: { propertyId, role: 'SUPERVISOR', active: true },
        select: { id: true },
      })
      for (const sup of supervisors) {
        await this.push.sendToStaff(
          sup.id,
          '🚨 Intervención requerida',
          `Hab. ${checkout.room.number} — Hay limpieza en progreso pero el huésped extendió estadía.`,
          { type: 'task:cancelled', checkoutId },
        )
      }
    }

    // SSE for web dashboard
    this.notifications.emit(propertyId, 'task:cancelled', { checkoutId, roomId: checkout.roomId })

    return { cancelled: true, criticalTasksAlert: criticalTasks.length > 0 }
  }

  /**
   * findByProperty — Historial de checkouts de la propiedad.
   *
   * Lista todos los checkouts (incluidos cancelados) para la vista de historial
   * en la UI. Incluye el número de habitación y el nombre del staff que registró
   * el checkout para facilitar la auditoría.
   *
   * @param propertyId  UUID de la propiedad
   */
  findByProperty(propertyId: string) {
    return this.prisma.checkout.findMany({
      where: { room: { propertyId } },
      include: { room: true, enteredBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }, // Más reciente primero para la vista de historial
    })
  }

  /**
   * Construye la rejilla de planificación diaria para DailyPlanningPage.
   *
   * Retorna TODOS los rooms de la propiedad (no solo los que tienen checkout),
   * separados en sharedRooms y privateRooms. El frontend usa este grid completo
   * para mostrar todas las camas y dejar que el supervisor marque cada una.
   *
   * Por cada bed incluye:
   *   - taskId/taskStatus: null si no hay tarea ese día, o el estado actual si existe.
   *   - assignedToId: para colorear celdas pre-asignadas vs. sin asignar.
   *   - hasSameDayCheckIn: flag urgente del checkout asociado.
   *   - checkoutId: necesario para el botón "Cancelar" post-confirmación.
   *   - cancelled: true si el checkout fue cancelado (la celda vuelve a EMPTY visualmente).
   *
   * La query usa `take: 1` ordenada por createdAt desc para obtener la tarea más
   * reciente del día en caso de que haya varias (ej: checkout cancelado + nuevo checkout).
   */
  async getDailyGrid(propertyId: string, date: string) {
    // IMPORTANT: Use explicit UTC times to avoid timezone shifting.
    // new Date(date) parses '2026-03-21' as UTC midnight, but setHours() operates in
    // LOCAL time — in UTC-5 that shifts the window to the previous day.
    // Using ISO strings with 'Z' suffix locks the computation to UTC.
    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd   = new Date(`${date}T23:59:59.999Z`)

    const rooms = await this.prisma.room.findMany({
      where: { propertyId },
      include: {
        beds: {
          orderBy: { label: 'asc' },
          include: {
            cleaningTasks: {
              where: {
                createdAt: { gte: dayStart, lte: dayEnd },
                status: { not: CleaningStatus.CANCELLED },
              },
              include: { checkout: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: [{ floor: 'asc' }, { number: 'asc' }],
    })

    const sharedRooms = rooms.filter((r) => r.type === 'SHARED')
    const privateRooms = rooms.filter((r) => r.type === 'PRIVATE')

    const mapRoom = (room: (typeof rooms)[0]) => ({
      roomId: room.id,
      roomNumber: room.number,
      roomType: room.type,
      floor: room.floor,
      beds: room.beds.map((bed) => {
        const task = bed.cleaningTasks[0] ?? null
        return {
          bedId: bed.id,
          bedLabel: bed.label,
          roomId: room.id,
          roomNumber: room.number,
          // bedStatus permite al frontend distinguir OCCUPIED (con huésped, elegible
          // para checkout) de AVAILABLE (sin huésped, NO debe marcarse para checkout).
          bedStatus: bed.status,
          taskId: task?.id ?? null,
          taskStatus: task?.status ?? null,
          assignedToId: task?.assignedToId ?? null,
          hasSameDayCheckIn: task?.checkout?.hasSameDayCheckIn ?? false,
          checkoutId: task?.checkoutId ?? null,
          cancelled: task?.checkout?.cancelled ?? false,
        }
      }),
    })

    return {
      date,
      sharedRooms: sharedRooms.map(mapRoom),
      privateRooms: privateRooms.map(mapRoom),
    }
  }

  /**
   * confirmDeparture — FASE 2 del ciclo de checkout.
   *
   * Activa la limpieza cuando el huésped sale físicamente:
   *   1. La tarea de esa cama pasa PENDING → READY (asignada) o UNASSIGNED (sin asignar).
   *   2. La cama pasa a DIRTY — estado físico: el huésped se fue, cama sucia.
   *   3. Housekeeping recibe la notificación push para esa cama específica.
   *   4. SSE notifica al dashboard web.
   *
   * GRANULARIDAD POR CAMA (parámetro bedId):
   *   En dormitorios compartidos un solo Checkout puede agrupar varias camas
   *   (e.g. Cama 1 y Cama 3 de Dorm1). Cada huésped sale en momentos distintos.
   *   `bedId` restringe la activación a una sola cama, evitando que confirmar
   *   la salida de Cama 1 active automáticamente Cama 3.
   *
   *   Si `bedId` es omitido se activan todas las camas PENDING del checkout
   *   (comportamiento útil para habitaciones privadas con una sola cama).
   *
   * Idempotencia: si la tarea ya está en READY/UNASSIGNED o más avanzada,
   * se retorna `{ alreadyDeparted: true }` sin modificar nada.
   *
   * @param checkoutId - ID del checkout planificado en la Fase 1
   * @param actorId    - Staff que confirma la salida (para TaskLog)
   * @param propertyId - Para SSE y búsqueda de supervisores
   * @param bedId      - (opcional) Restringe la activación a una cama específica
   */
  async confirmDeparture(checkoutId: string, actorId: string, propertyId: string, bedId?: string) {
    const checkout = await this.prisma.checkout.findUnique({
      where: { id: checkoutId },
      include: {
        tasks: { include: { assignedTo: { include: { pushTokens: true } } } },
        room: true,
      },
    })
    if (!checkout) throw new NotFoundException('Checkout not found')
    if (checkout.cancelled) throw new ConflictException('Checkout was cancelled')

    // Filtrar solo las tareas PENDING y, si se especificó bedId, solo esa cama.
    // Esto evita el bug donde confirmar Cama 1 activaría también Cama 3 del mismo dorm.
    const pendingTasks = checkout.tasks.filter(
      (t) => t.status === CleaningStatus.PENDING && (!bedId || t.bedId === bedId),
    )
    if (pendingTasks.length === 0) {
      return { alreadyDeparted: true, message: 'La salida ya fue confirmada anteriormente' }
    }

    // Activar las tareas PENDING → READY/UNASSIGNED + marcar camas como DIRTY
    await this.prisma.$transaction(async (tx) => {
      for (const task of pendingTasks) {
        const newStatus = task.assignedToId ? CleaningStatus.READY : CleaningStatus.UNASSIGNED

        await tx.cleaningTask.update({
          where: { id: task.id },
          data: { status: newStatus, updatedAt: new Date() },
        })

        await tx.taskLog.create({
          data: {
            taskId: task.id,
            staffId: actorId,
            event: TaskLogEvent.READY,
          },
        })

        // Ahora sí: la cama pasa a DIRTY. El huésped salió, la cama necesita limpieza.
        await tx.bed.update({
          where: { id: task.bedId },
          data: { status: 'DIRTY' },
        })
      }
    })

    // Notificaciones: push a housekeeping + SSE al dashboard
    await this.dispatchNotifications(checkoutId, propertyId, {
      roomId: checkout.roomId,
      actualCheckoutAt: new Date(),
      source: CheckoutSource.MANUAL,
      hasSameDayCheckIn: checkout.hasSameDayCheckIn,
      enteredById: actorId,
    })

    return { confirmed: true, tasksActivated: pendingTasks.length }
  }

  /**
   * Envía notificaciones push y SSE después de procesar un checkout.
   * Separado de la $transaction para no bloquear el commit si falla el envío.
   *
   * Lógica de agrupación (anti-spam):
   *   - Agrupa las tareas READY por housekeeper asignado.
   *   - Si un housekeeper tiene N camas, recibe UNA notificación con la lista completa.
   *   - Si el housekeeper está en medio de otra limpieza, la notificación lo menciona
   *     explícitamente: "Comienza al terminar Hab. X".
   *
   * Las tareas UNASSIGNED emiten un evento SSE `task:unassigned` para que el supervisor
   * vea la alerta en el dashboard web y asigne manualmente.
   */
  private async dispatchNotifications(
    checkoutId: string,
    propertyId: string,
    input: CheckoutInput,
  ) {
    const tasks = await this.prisma.cleaningTask.findMany({
      where: { checkoutId },
      include: {
        assignedTo: true,
        bed: { include: { room: true } },
      },
    })

    const readyTasks = tasks.filter((t) => t.status === CleaningStatus.READY)
    const unassignedTasks = tasks.filter((t) => t.status === CleaningStatus.UNASSIGNED)

    // Group by assignee to avoid spam when multiple beds check out at once
    const byAssignee = new Map<string, typeof readyTasks>()
    for (const task of readyTasks) {
      if (!task.assignedToId) continue
      const arr = byAssignee.get(task.assignedToId) ?? []
      arr.push(task)
      byAssignee.set(task.assignedToId, arr)
    }

    for (const [assignedToId, staffTasks] of byAssignee.entries()) {
      // Check if staff is currently cleaning something else
      const activeTask = await this.prisma.cleaningTask.findFirst({
        where: { assignedToId, status: CleaningStatus.IN_PROGRESS },
        include: { bed: { include: { room: true } } },
      })

      const roomList = staffTasks
        .map((t) => `Hab. ${t.bed.room.number}${t.priority === Priority.URGENT ? ' 🔴' : ''}`)
        .join(', ')

      const title = input.hasSameDayCheckIn ? '🔴 Limpieza urgente' : '🛏️ Lista para limpiar'
      const body = activeTask
        ? `${roomList} — Comienza al terminar Hab. ${activeTask.bed.room.number}`
        : `${roomList} — Lista para limpiar`

      await this.push.sendToStaff(assignedToId, title, body, {
        type: 'task:ready',
        taskIds: staffTasks.map((t) => t.id),
      })
    }

    // SSE events for web dashboard
    for (const task of readyTasks) {
      this.notifications.emit(propertyId, 'task:ready', {
        taskId: task.id,
        bedId: task.bedId,
        roomId: task.bed.roomId,
        roomNumber: task.bed.room.number,
        priority: task.priority,
        assignedToId: task.assignedToId,
      })
    }

    for (const task of unassignedTasks) {
      this.notifications.emit(propertyId, 'task:unassigned', {
        taskId: task.id,
        bedId: task.bedId,
        roomNumber: task.bed.room.number,
      })
    }
  }
}
