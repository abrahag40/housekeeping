/**
 * DiscrepanciesService — Gestión de discrepancias reportadas por el personal de limpieza.
 *
 * Una discrepancia es una anomalía encontrada durante o después de la limpieza de una cama,
 * por ejemplo: sábanas manchadas que no corresponden al estado esperado, objetos olvidados
 * por el huésped, daños en el mobiliario, o diferencias entre el estado físico y el sistema.
 *
 * Flujo de vida de una discrepancia:
 *  1. REPORTED  — La camarera reporta la anomalía desde la app móvil.
 *               → Se notifica por push a supervisores y recepcionistas.
 *               → SSE al dashboard para visibilidad inmediata.
 *  2. ACKNOWLEDGED — El supervisor tomó nota / está en camino.
 *  3. RESOLVED  — El supervisor resuelve y documenta la acción tomada.
 *
 * Las discrepancias son a nivel de BED (no de habitación) porque en un dormitorio
 * compartido cada cama puede tener un estado independiente.
 *
 * Diseño de notificaciones:
 *  - Se notifica a TODOS los supervisores y recepcionistas activos de la propiedad.
 *  - Se usa Promise.all para enviar las notificaciones en paralelo (mejor latencia).
 *  - SSE complementa el push para que el dashboard web se actualice sin polling.
 */
import { Injectable, NotFoundException } from '@nestjs/common'
import { DiscrepancyStatus, HousekeepingRole } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PushService } from '../notifications/push.service'
import { CreateDiscrepancyDto } from './dto/create-discrepancy.dto'

@Injectable()
export class DiscrepanciesService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService, // SSE para el dashboard web en tiempo real
    private push: PushService,                   // Push notifications para dispositivos móviles
  ) {}

  /**
   * create — Reporta una nueva discrepancia y notifica al personal responsable.
   *
   * Quién puede reportar:
   *  - Camareras (desde la app móvil durante la limpieza).
   *  - Supervisores (inspección post-limpieza).
   *
   * Quién recibe la notificación:
   *  - Todos los SUPERVISORES y RECEPCIONISTAS activos de la propiedad.
   *  - Recepcionistas son incluidos porque algunas discrepancias (objetos olvidados,
   *    daños facturables) requieren acción de recepción, no solo del supervisor.
   *
   * La discrepancia se crea con status REPORTED por defecto (definido en el schema).
   * No hay validación de estado anterior porque es siempre una creación nueva.
   *
   * @param dto           Datos de la discrepancia (bedId, tipo, descripción)
   * @param reportedById  UUID del staff que reporta (viene del JWT del request)
   * @param propertyId    UUID de la propiedad (para buscar destinatarios de notificaciones)
   * @returns             La discrepancia creada con relaciones bed.room y reportedBy incluidas
   * @throws              NotFoundException si el bedId no existe
   */
  async create(dto: CreateDiscrepancyDto, reportedById: string, propertyId: string) {
    // Validar que la cama existe y cargar el room para mostrar el número en la notificación
    const bed = await this.prisma.bed.findUnique({
      where: { id: dto.bedId },
      include: { room: { include: { property: true } } },
    })
    if (!bed) throw new NotFoundException('Bed not found')

    // Crear la discrepancia con status inicial REPORTED (default del schema)
    const discrepancy = await this.prisma.bedDiscrepancy.create({
      data: {
        bedId: dto.bedId,
        reportedById,
        type: dto.type,
        description: dto.description,
      },
      // Cargar relaciones en la misma query para evitar una query extra post-creación
      include: {
        bed: { include: { room: true } },
        reportedBy: { select: { id: true, name: true } },
      },
    })

    // Notify supervisors and receptionists via push
    // Se cargan todos los destinatarios en una query antes de enviar notificaciones
    const recipients = await this.prisma.housekeepingStaff.findMany({
      where: {
        propertyId,
        // Tanto supervisores como recepcionistas deben saber de la discrepancia
        role: { in: [HousekeepingRole.SUPERVISOR, HousekeepingRole.RECEPTIONIST] },
        active: true, // Excluir personal inactivo (vacaciones, baja, etc.)
      },
      select: { id: true }, // Solo el ID es necesario para sendToStaff
    })

    const roomNum = bed.room.number
    // Promise.all envía todas las notificaciones en paralelo (no secuencial)
    // para minimizar el tiempo total de envío cuando hay múltiples destinatarios
    await Promise.all(
      recipients.map((r) =>
        this.push.sendToStaff(
          r.id,
          '⚠️ Discrepancia reportada',
          `Hab. ${roomNum} — Cama ${bed.label}: ${dto.description}`,
          { type: 'discrepancy:reported', discrepancyId: discrepancy.id },
        ),
      ),
    )

    // SSE for web dashboard — actualiza la lista de discrepancias en tiempo real
    // sin necesidad de recargar la página ni polling
    this.notifications.emit(propertyId, 'discrepancy:reported', {
      discrepancyId: discrepancy.id,
      bedId: dto.bedId,
      type: dto.type,
      roomNumber: roomNum,
    })

    return discrepancy
  }

  /**
   * findByProperty — Lista discrepancias de la propiedad, opcionalmente filtradas por estado.
   *
   * Si no se pasa `status`, devuelve TODAS las discrepancias (todas las fases del ciclo de vida).
   * Si se pasa `status`, filtra solo las de ese estado (útil para vistas "Pendientes").
   *
   * El spread condicional `...(status ? { status } : {})` evita agregar el filtro cuando
   * status es undefined, lo que es más idiomático que un if separado en Prisma.
   *
   * Incluye resolvedBy para mostrar quién resolvió la discrepancia en el historial.
   *
   * @param propertyId  UUID de la propiedad
   * @param status      Opcional — filtrar por DiscrepancyStatus (REPORTED | ACKNOWLEDGED | RESOLVED)
   * @returns           Array de discrepancias ordenadas por fecha de creación (más reciente primero)
   */
  findByProperty(propertyId: string, status?: DiscrepancyStatus) {
    return this.prisma.bedDiscrepancy.findMany({
      where: {
        bed: { room: { propertyId } },
        // Spread condicional: si status es undefined, no se aplica el filtro
        ...(status ? { status } : {}),
      },
      include: {
        bed: { include: { room: { select: { number: true, floor: true } } } },
        reportedBy: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } }, // null si aún no fue resuelta
      },
      orderBy: { createdAt: 'desc' }, // Las más recientes primero para la vista de gestión
    })
  }

  /**
   * resolve — Marca una discrepancia como resuelta con la acción tomada.
   *
   * El campo `resolution` es obligatorio para mantener trazabilidad de qué acción se tomó
   * (ej: "Se cambiaron las sábanas", "Se notificó a mantenimiento", "Cliente fue informado").
   * Esto es importante para el historial y posibles disputas con huéspedes.
   *
   * No verifica que la discrepancia esté en estado REPORTED o ACKNOWLEDGED antes de resolver,
   * por lo que técnicamente se puede resolver desde cualquier estado. Esta flexibilidad
   * es intencional para no bloquear al supervisor en flujos de emergencia.
   *
   * @param id            UUID de la discrepancia a resolver
   * @param resolvedById  UUID del supervisor que resuelve (viene del JWT)
   * @param resolution    Descripción de la acción tomada (texto libre)
   * @returns             La discrepancia actualizada
   * @throws              NotFoundException si el id no existe
   */
  async resolve(id: string, resolvedById: string, resolution: string) {
    // Verificar existencia antes de actualizar para dar un error claro al cliente
    const discrepancy = await this.prisma.bedDiscrepancy.findUnique({ where: { id } })
    if (!discrepancy) throw new NotFoundException('Discrepancy not found')

    return this.prisma.bedDiscrepancy.update({
      where: { id },
      data: {
        status: DiscrepancyStatus.RESOLVED,
        resolvedById,
        resolution,
        resolvedAt: new Date(), // Marca temporal exacta para el historial de auditoría
      },
    })
  }

  /**
   * acknowledge — Marca una discrepancia como "vista" por el supervisor.
   *
   * Estado intermedio entre REPORTED y RESOLVED. Indica que el supervisor está al tanto
   * del problema y lo está gestionando, sin haber completado la resolución todavía.
   * Útil para filtrar en el dashboard: "Reportadas sin confirmar" vs. "En gestión".
   *
   * No registra quién hizo el acknowledge deliberadamente — el flujo actual asume que
   * solo supervisores acceden a esta acción (controlado por guard en el controller).
   *
   * @param id  UUID de la discrepancia a confirmar
   * @returns   La discrepancia actualizada con status ACKNOWLEDGED
   * @throws    NotFoundException si el id no existe
   */
  async acknowledge(id: string) {
    const discrepancy = await this.prisma.bedDiscrepancy.findUnique({ where: { id } })
    if (!discrepancy) throw new NotFoundException('Discrepancy not found')

    return this.prisma.bedDiscrepancy.update({
      where: { id },
      data: { status: DiscrepancyStatus.ACKNOWLEDGED },
    })
  }
}
