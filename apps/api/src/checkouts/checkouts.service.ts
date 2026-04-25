/**
 * CheckoutsService — Núcleo del módulo de Housekeeping.
 *
 * Módulo independiente. Se comunica con otros módulos ÚNICAMENTE vía:
 *  - SSE (NotificationsService.emit) para el dashboard web
 *  - Push notifications (PushService) para la app móvil del housekeeper
 *  - EventEmitter2 para eventos internos (@OnEvent en otros módulos)
 *
 * Fuentes de checkout:
 *  1. Manual — POST /checkouts/batch (planning matutino) o POST /checkouts (ad-hoc)
 *  2. Evento externo — @OnEvent('checkout.requested') para integraciones futuras (sin acoplamiento directo)
 *
 * Flujo de processCheckout():
 *  1. Obtener room + units + property en una sola query (evita N+1).
 *  2. Determinar prioridad: URGENT si hay check-in el mismo día, MEDIUM en caso contrario.
 *  3. $transaction atómica:
 *     a. Crear registro Checkout.
 *     b. Por cada unit: activar tarea PENDING→READY si había pre-asignación, o crear UNASSIGNED.
 *     c. Actualizar unit.status → DIRTY para reflejar el estado físico real.
 *  4. Post-transaction: push a camareras + SSE al dashboard web.
 *
 * Máquina de estados de CleaningTask relevante a este módulo:
 *  PENDING  → READY      (checkout activa pre-asignación cuando el huésped sale)
 *  (nueva)  → UNASSIGNED (checkout crea tarea sin asignar si no hay pre-asignación)
 *  READY / UNASSIGNED / PENDING → CANCELLED (cancelCheckout cuando huésped extiende estadía)
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { CleaningStatus, Priority, TaskLogEvent } from '@zenix/shared'
import { PrismaService } from '../prisma/prisma.service'
import { TenantContextService } from '../common/tenant-context.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PushService } from '../notifications/push.service'
import { CreateCheckoutDto, BatchCheckoutDto } from './dto/create-checkout.dto'

export interface CheckoutInput {
  roomId: string
  guestName?: string
  actualCheckoutAt: Date
  source: 'MANUAL' | 'SYSTEM'
  isEarlyCheckout?: boolean
  hasSameDayCheckIn?: boolean
  notes?: string
  enteredById?: string
}

@Injectable()
export class CheckoutsService {
  private readonly logger = new Logger(CheckoutsService.name)

  constructor(
    private prisma: PrismaService,
    private tenant: TenantContextService,
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
   * Nota sobre el loop por unit dentro de la transacción:
   *  Se ejecuta una query findFirst por unidad para detectar la tarea PENDING pre-asignada.
   *  Esto introduce O(units) queries dentro de la transacción, pero las habitaciones
   *  tienen típicamente 1-12 unidades, por lo que el costo es aceptable y predecible.
   *  Mover esto fuera de la transacción introduciría race conditions con asignaciones concurrentes.
   *
   * @param input  Parámetros normalizados del checkout (ver CheckoutInput)
   * @returns      El Checkout recién creado, o el existente si ya fue procesado (idempotencia)
   * @throws       NotFoundException si el roomId no existe en la base de datos
   */
  async processCheckout(input: CheckoutInput) {
    const orgId = this.tenant.getOrganizationId()

    const room = await this.prisma.room.findUnique({
      where: { id: input.roomId, organizationId: orgId },
      include: { units: true, property: true },
    })
    if (!room) throw new NotFoundException('Room not found')

    const priority: Priority = input.hasSameDayCheckIn ? Priority.URGENT : Priority.MEDIUM

    const checkout = await this.prisma.$transaction(async (tx) => {
      // Create checkout record
      const checkout = await tx.checkout.create({
        data: {
          organizationId: orgId,
          roomId: input.roomId,
          guestName: input.guestName,
          actualCheckoutAt: input.actualCheckoutAt,
          source: input.source,
          isEarlyCheckout: input.isEarlyCheckout ?? false,
          hasSameDayCheckIn: input.hasSameDayCheckIn ?? false,
          notes: input.notes,
          enteredById: input.enteredById,
        },
      })

      // Create one CleaningTask per unit in the room
      for (const unit of room.units) {
        // Find pre-assigned housekeeper for this unit (task in PENDING state)
        const existingPendingTask = await tx.cleaningTask.findFirst({
          where: { unitId: unit.id, status: CleaningStatus.PENDING, organizationId: orgId },
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
              organizationId: orgId,
              unitId: unit.id,
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

        // Update unit status to DIRTY
        await tx.unit.update({ where: { id: unit.id }, data: { status: 'DIRTY' } })
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
   *     El recepcionista marca qué unidades tienen salida hoy.
   *     Se crean: Checkout record + CleaningTask(PENDING) por cada unidad.
   *     La unidad físicamente SIGUE OCUPADA (unit.status NO cambia a DIRTY todavía).
   *     Housekeeping recibe la lista de salidas esperadas para prepararse, pero
   *     NO se les notifica que limpien todavía — el huésped aún está en la unidad.
   *
   *   FASE 2 — Salida física (confirmDeparture):
   *     Cuando el huésped se va físicamente, el recepcionista confirma la salida.
   *     Las tareas pasan de PENDING → READY/UNASSIGNED.
   *     unit.status → DIRTY. Housekeeping recibe la notificación: "ya pueden limpiar".
   *
   * ¿Por qué separar las dos fases?
   *   En hotelería, la planificación matutina se hace a las 7:00 am, pero los
   *   huéspedes no salen hasta las 11:00 am o 12:00 pm. Si notificamos a
   *   housekeeping en el momento de la planificación, llegan a una unidad ocupada.
   *   La separación de fases evita ese error operativo.
   */
  async batchCheckout(dto: BatchCheckoutDto, enteredById: string, propertyId: string) {
    const orgId = this.tenant.getOrganizationId()
    const checkoutDate = dto.checkoutDate ? new Date(dto.checkoutDate) : new Date()

    // 1. Obtener los units con su room en una sola query (evita N+1)
    const unitIds = dto.items.map((i) => i.unitId)
    const units = await this.prisma.unit.findMany({
      where: { id: { in: unitIds }, organizationId: orgId },
      include: { room: true },
    })

    // 2. Mapa de configuración por unitId para acceso O(1) al procesar cada unit
    const itemMap = new Map(dto.items.map((i) => [i.unitId, i]))

    // 3. Agrupar units por roomId para crear un Checkout por habitación
    const byRoom = new Map<string, typeof units>()
    for (const unit of units) {
      const arr = byRoom.get(unit.roomId) ?? []
      arr.push(unit)
      byRoom.set(unit.roomId, arr)
    }

    const results: { checkoutId: string; roomId: string; tasksCreated: number }[] = []

    // 4. Crear un Checkout + tareas PENDING por room (sin activar limpieza aún)
    for (const [roomId, roomUnits] of byRoom.entries()) {
      const hasSameDayCheckIn = roomUnits.some((u) => itemMap.get(u.id)?.hasSameDayCheckIn)
      const notes = roomUnits.map((u) => itemMap.get(u.id)?.notes).filter(Boolean).join('; ')
      const priority: Priority = hasSameDayCheckIn ? Priority.URGENT : Priority.MEDIUM

      const result = await this.prisma.$transaction(async (tx) => {
        // Crear registro de checkout (fase de planificación)
        const checkout = await tx.checkout.create({
          data: {
            organizationId: orgId,
            roomId,
            actualCheckoutAt: checkoutDate,
            source: 'MANUAL',
            hasSameDayCheckIn,
            notes: notes || undefined,
            enteredById,
          },
        })

        let tasksCreated = 0
        for (const unit of roomUnits) {
          // Crear tarea en estado PENDING — el huésped aún no ha salido físicamente.
          // La tarea pasará a READY/UNASSIGNED cuando el recepcionista confirme la salida física.
          const unitHasSameDayCheckIn = itemMap.get(unit.id)?.hasSameDayCheckIn ?? false
          const task = await tx.cleaningTask.create({
            data: {
              organizationId: orgId,
              unitId: unit.id,
              checkoutId: checkout.id,
              status: CleaningStatus.PENDING,
              priority,
              hasSameDayCheckIn: unitHasSameDayCheckIn,
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
        // IMPORTANTE: unit.status NO se cambia aquí. El huésped sigue en la unidad.
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
  /**
   * cancelCheckout — Cancela el checkout (o una unidad específica del mismo).
   *
   * Con unitId: cancela SOLO la tarea de esa unidad. El checkout NO se marca como
   * cancelado — el resto de las unidades del dorm siguen activas.
   *
   * Sin unitId: cancela todas las tareas del checkout y marca el checkout como
   * cancelado (comportamiento original — "huésped extendió toda la habitación").
   */
  async cancelCheckout(checkoutId: string, propertyId: string, unitId?: string) {
    const orgId = this.tenant.getOrganizationId()
    const checkout = await this.prisma.checkout.findUnique({
      where: { id: checkoutId, organizationId: orgId },
      include: {
        tasks: { include: { assignedTo: { include: { pushTokens: true } } } },
        room: true,
      },
    })
    if (!checkout) throw new NotFoundException('Checkout not found')
    if (checkout.cancelled) throw new ConflictException('Checkout already cancelled')

    const isUnitId = !!unitId

    const cancellableTasks = checkout.tasks.filter(
      (t) =>
        [CleaningStatus.READY, CleaningStatus.UNASSIGNED, CleaningStatus.PENDING].includes(
          t.status as CleaningStatus,
        ) && (!isUnitId || t.unitId === unitId),
    )

    const criticalTasks = checkout.tasks.filter(
      (t) =>
        (t.status === CleaningStatus.IN_PROGRESS || t.status === CleaningStatus.PAUSED) &&
        (!isUnitId || t.unitId === unitId),
    )

    await this.prisma.$transaction(async (tx) => {
      // Cancel tasks that haven't started (for the specified unit, or all units)
      for (const task of cancellableTasks) {
        await tx.cleaningTask.update({
          where: { id: task.id },
          data: { status: CleaningStatus.CANCELLED },
        })
        await tx.taskLog.create({
          data: { taskId: task.id, staffId: null, event: TaskLogEvent.CANCELLED },
        })
        // Restore unit to OCCUPIED (huésped extendió, sigue durmiendo)
        await tx.unit.update({ where: { id: task.unitId }, data: { status: 'OCCUPIED' } })
      }

      // Mark full checkout as cancelled only when cancelling the entire room (no unitId)
      if (!isUnitId) {
        await tx.checkout.update({
          where: { id: checkoutId },
          data: { cancelled: true, cancelledAt: new Date() },
        })
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
        where: { propertyId, role: 'SUPERVISOR', active: true, organizationId: orgId },
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
    const orgId = this.tenant.getOrganizationId()
    return this.prisma.checkout.findMany({
      where: { room: { propertyId }, organizationId: orgId },
      include: { room: true, enteredBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' }, // Más reciente primero para la vista de historial
    })
  }

  /**
   * Construye la rejilla de planificación diaria para DailyPlanningPage.
   *
   * Retorna TODOS los rooms de la propiedad (no solo los que tienen checkout),
   * separados en sharedRooms y privateRooms. El frontend usa este grid completo
   * para mostrar todas las unidades y dejar que el supervisor marque cada una.
   *
   * Por cada unit incluye:
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
    const orgId = this.tenant.getOrganizationId()
    // IMPORTANT: Use explicit UTC times to avoid timezone shifting.
    // new Date(date) parses '2026-03-21' as UTC midnight, but setHours() operates in
    // LOCAL time — in UTC-5 that shifts the window to the previous day.
    // Using ISO strings with 'Z' suffix locks the computation to UTC.
    const dayStart = new Date(`${date}T00:00:00.000Z`)
    const dayEnd   = new Date(`${date}T23:59:59.999Z`)

    const rooms = await this.prisma.room.findMany({
      where: { propertyId, organizationId: orgId },
      include: {
        units: {
          orderBy: { label: 'asc' },
          include: {
            cleaningTasks: {
              where: {
                // Filtramos por la fecha del checkout, NO por createdAt de la tarea.
                // Razón: createdAt usa new Date() del servidor. En timezones negativos
                // (ej: UTC-5), después de las 7pm local, el createdAt ya cae en el día
                // siguiente UTC → la tarea no aparece en el grid del día actual.
                // actualCheckoutAt se guarda como la fecha que envía el frontend (ej:
                // "2026-03-22") y es invariante al timezone del servidor.
                checkout: {
                  actualCheckoutAt: { gte: dayStart, lte: dayEnd },
                },
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

    const sharedRooms = rooms.filter((r) => r.category === 'SHARED')
    const privateRooms = rooms.filter((r) => r.category === 'PRIVATE')

    const mapRoom = (room: (typeof rooms)[0]) => ({
      roomId: room.id,
      roomNumber: room.number,
      roomCategory: room.category,
      floor: room.floor,
      units: room.units.map((unit) => {
        const task = unit.cleaningTasks[0] ?? null
        return {
          unitId: unit.id,
          unitLabel: unit.label,
          roomId: room.id,
          roomNumber: room.number,
          // unitStatus permite al frontend distinguir OCCUPIED (con huésped, elegible
          // para checkout) de AVAILABLE (sin huésped, NO debe marcarse para checkout).
          unitStatus: unit.status,
          taskId: task?.id ?? null,
          taskStatus: task?.status ?? null,
          assignedToId: task?.assignedToId ?? null,
          hasSameDayCheckIn: task?.hasSameDayCheckIn ?? false,
          checkoutId: task?.checkoutId ?? null,
          // Cubre per-unit cancel (task.status) y full checkout cancel (checkout.cancelled)
          cancelled: (task?.status === CleaningStatus.CANCELLED || task?.checkout?.cancelled) ?? false,
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
   *   1. La tarea de esa unidad pasa PENDING → READY (asignada) o UNASSIGNED (sin asignar).
   *   2. La unidad pasa a DIRTY — estado físico: el huésped se fue, unidad sucia.
   *   3. Housekeeping recibe la notificación push para esa unidad específica.
   *   4. SSE notifica al dashboard web.
   *
   * GRANULARIDAD POR UNIDAD (parámetro unitId):
   *   En dormitorios compartidos un solo Checkout puede agrupar varias unidades
   *   (e.g. Cama 1 y Cama 3 de Dorm1). Cada huésped sale en momentos distintos.
   *   `unitId` restringe la activación a una sola unidad, evitando que confirmar
   *   la salida de Cama 1 active automáticamente Cama 3.
   *
   *   Si `unitId` es omitido se activan todas las unidades PENDING del checkout
   *   (comportamiento útil para habitaciones privadas con una sola unidad).
   *
   * Idempotencia: si la tarea ya está en READY/UNASSIGNED o más avanzada,
   * se retorna `{ alreadyDeparted: true }` sin modificar nada.
   *
   * @param checkoutId - ID del checkout planificado en la Fase 1
   * @param actorId    - Staff que confirma la salida (para TaskLog)
   * @param propertyId - Para SSE y búsqueda de supervisores
   * @param unitId     - (opcional) Restringe la activación a una unidad específica
   */
  async confirmDeparture(checkoutId: string, actorId: string, propertyId: string, unitId?: string) {
    const orgId = this.tenant.getOrganizationId()
    const checkout = await this.prisma.checkout.findUnique({
      where: { id: checkoutId, organizationId: orgId },
      include: {
        tasks: { include: { assignedTo: { include: { pushTokens: true } } } },
        room: true,
      },
    })
    if (!checkout) throw new NotFoundException('Checkout not found')
    if (checkout.cancelled) throw new ConflictException('Checkout was cancelled')

    // Filtrar solo las tareas PENDING y, si se especificó unitId, solo esa unidad.
    // Esto evita el bug donde confirmar una unidad activaría también otra del mismo dorm.
    const pendingTasks = checkout.tasks.filter(
      (t) => t.status === CleaningStatus.PENDING && (!unitId || t.unitId === unitId),
    )
    if (pendingTasks.length === 0) {
      return { alreadyDeparted: true, message: 'La salida ya fue confirmada anteriormente' }
    }

    // Activar las tareas PENDING → READY/UNASSIGNED + marcar unidades como DIRTY
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

        // Ahora sí: la unidad pasa a DIRTY. El huésped salió, la unidad necesita limpieza.
        await tx.unit.update({
          where: { id: task.unitId },
          data: { status: 'DIRTY' },
        })
      }
    })

    // Notificaciones: push a housekeeping + SSE al dashboard
    await this.dispatchNotifications(checkoutId, propertyId, {
      roomId: checkout.roomId,
      actualCheckoutAt: new Date(),
      source: 'MANUAL',
      hasSameDayCheckIn: checkout.hasSameDayCheckIn,
      enteredById: actorId,
    })

    return { confirmed: true, tasksActivated: pendingTasks.length }
  }

  /**
   * undoDeparture — Revierte la confirmación de salida física (anti-error-humano).
   *
   * Disponible solo mientras la tarea está en estado READY o UNASSIGNED
   * (limpieza aún no iniciada). Una vez que el housekeeper empieza (IN_PROGRESS),
   * ya no es reversible desde recepción — requiere intervención del supervisor.
   *
   * Cuándo usarlo: el recepcionista confirmó la salida de la unidad equivocada,
   * o el huésped cambió de opinión antes de que housekeeping llegara.
   *
   * Efecto:
   *   - READY/UNASSIGNED → PENDING (tarea vuelve a "esperando confirmación física")
   *   - unit.status → OCCUPIED (unidad vuelve a estar ocupada)
   *   - Push al housekeeper asignado: "Salida revertida, el huésped aún está"
   *   - SSE: task:planned (el dashboard refleja el estado PENDING nuevamente)
   *
   * @param checkoutId - ID del checkout
   * @param actorId    - Recepcionista que revierte (para TaskLog)
   * @param propertyId - Para SSE y validación de propiedad
   * @param unitId     - (opcional) Si se omite, revierte TODAS las unidades READY/UNASSIGNED
   */
  async undoDeparture(checkoutId: string, actorId: string, propertyId: string, unitId?: string) {
    const orgId = this.tenant.getOrganizationId()
    const checkout = await this.prisma.checkout.findUnique({
      where: { id: checkoutId, organizationId: orgId },
      include: {
        tasks: { include: { assignedTo: { include: { pushTokens: true } } } },
        room: true,
      },
    })
    if (!checkout) throw new NotFoundException('Checkout not found')
    if (checkout.cancelled) throw new ConflictException('Checkout fue cancelado')
    if (checkout.room.propertyId !== propertyId) throw new NotFoundException('Checkout not found')

    const reversibleTasks = checkout.tasks.filter(
      (t) =>
        [CleaningStatus.READY, CleaningStatus.UNASSIGNED].includes(t.status as CleaningStatus) &&
        (!unitId || t.unitId === unitId),
    )

    if (!reversibleTasks.length) {
      throw new ConflictException(
        'No hay tareas reversibles — la limpieza ya inició o la unidad ya está lista',
      )
    }

    await this.prisma.$transaction(async (tx) => {
      for (const task of reversibleTasks) {
        await tx.cleaningTask.update({
          where: { id: task.id },
          data: { status: CleaningStatus.PENDING },
        })

        await tx.taskLog.create({
          data: { taskId: task.id, staffId: actorId, event: TaskLogEvent.REOPENED },
        })

        await tx.unit.update({
          where: { id: task.unitId },
          data: { status: 'OCCUPIED' },
        })
      }
    })

    // Notificar al housekeeper asignado que ya no debe limpiar aún
    for (const task of reversibleTasks) {
      if (task.assignedToId) {
        await this.push.sendToStaff(
          task.assignedToId,
          '↩️ Salida revertida',
          `Hab. ${checkout.room.number} — El huésped aún no ha salido. No limpiar todavía.`,
          { type: 'task:planned', taskId: task.id },
        )
      }
    }

    this.notifications.emit(propertyId, 'task:planned', { checkoutId, roomId: checkout.roomId })

    return { reverted: true, tasksReverted: reversibleTasks.length }
  }

  /**
   * Envía notificaciones push y SSE después de procesar un checkout.
   * Separado de la $transaction para no bloquear el commit si falla el envío.
   *
   * Lógica de agrupación (anti-spam):
   *   - Agrupa las tareas READY por housekeeper asignado.
   *   - Si un housekeeper tiene N unidades, recibe UNA notificación con la lista completa.
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
    const orgId = this.tenant.getOrganizationId()
    const tasks = await this.prisma.cleaningTask.findMany({
      where: { checkoutId, organizationId: orgId },
      include: {
        assignedTo: true,
        unit: { include: { room: true } },
      },
    })

    const readyTasks = tasks.filter((t) => t.status === CleaningStatus.READY)
    const unassignedTasks = tasks.filter((t) => t.status === CleaningStatus.UNASSIGNED)

    // Group by assignee to avoid spam when multiple units check out at once
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
        where: { assignedToId, status: CleaningStatus.IN_PROGRESS, organizationId: orgId },
        include: { unit: { include: { room: true } } },
      })

      const roomList = staffTasks
        .map((t) => `Hab. ${t.unit.room.number}${t.priority === Priority.URGENT ? ' 🔴' : ''}`)
        .join(', ')

      const title = input.hasSameDayCheckIn ? '🔴 Limpieza urgente' : '🛏️ Lista para limpiar'
      const body = activeTask
        ? `${roomList} — Comienza al terminar Hab. ${activeTask.unit.room.number}`
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
        unitId: task.unitId,
        roomId: task.unit.roomId,
        roomNumber: task.unit.room.number,
        priority: task.priority,
        assignedToId: task.assignedToId,
      })
    }

    for (const task of unassignedTasks) {
      this.notifications.emit(propertyId, 'task:unassigned', {
        taskId: task.id,
        unitId: task.unitId,
        roomNumber: task.unit.room.number,
      })
    }
  }
}
