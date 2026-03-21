/**
 * ReportsService — Reporting & Analytics Module
 *
 * Proporciona tres vistas analíticas para supervisores y gerentes de la propiedad:
 *
 *  1. getOverview      — KPIs agregados para un rango de fechas (checkouts, tareas, tiempos).
 *  2. getStaffPerformance — Métricas por camarera: tareas completadas, verificadas y tiempo promedio.
 *  3. getDailyTrend    — Serie temporal diaria de tareas completadas vs. checkouts para graficar.
 *
 * Estrategia de rendimiento:
 *  - Todos los métodos evitan queries N+1 ejecutando exactamente dos consultas en paralelo
 *    (Promise.all) y agrupando en memoria con Map<string, number>.
 *  - Las fechas se normalizan a inicio/fin de día (00:00:00.000 / 23:59:59.999) para capturar
 *    todos los registros del día sin depender de zonas horarias en el cliente.
 */
import { Injectable } from '@nestjs/common'
import { CleaningStatus, HousekeepingRole } from '@housekeeping/shared'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * getOverview — KPIs generales de la propiedad para un período.
   *
   * Reglas de negocio:
   *  - Solo se cuentan checkouts NO cancelados (cancelled: false).
   *  - "Completadas" incluye DONE + VERIFIED (ambas son estados finales de limpieza exitosa).
   *  - "Pendientes" incluye READY, IN_PROGRESS y PAUSED (tareas activas que aún no finalizaron).
   *  - El tiempo promedio de limpieza solo se calcula sobre tareas que tienen startedAt Y
   *    finishedAt para evitar sesgos con tareas aún en progreso o no iniciadas.
   *
   * @param propertyId  UUID de la propiedad a consultar
   * @param from        Fecha inicio en formato ISO-8601 (YYYY-MM-DD)
   * @param to          Fecha fin en formato ISO-8601 (YYYY-MM-DD), inclusiva
   * @returns           Objeto con conteos de tareas por estado y tiempo promedio en minutos
   */
  async getOverview(propertyId: string, from: string, to: string) {
    // Normalizar al inicio y fin del día para incluir todos los registros del período
    const fromDate = new Date(from)
    fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date(to)
    toDate.setHours(23, 59, 59, 999)

    // Dos queries en paralelo evitan N+1: una para checkouts (solo count) y otra
    // para tareas (solo campos necesarios para cálculos, sin cargar relaciones completas)
    const [checkouts, tasks] = await Promise.all([
      this.prisma.checkout.count({
        where: {
          room: { propertyId },
          createdAt: { gte: fromDate, lte: toDate },
          cancelled: false, // Excluir checkouts de huéspedes que extendieron estadía
        },
      }),
      this.prisma.cleaningTask.findMany({
        where: {
          bed: { room: { propertyId } },
          createdAt: { gte: fromDate, lte: toDate },
        },
        // Solo se seleccionan los campos estrictamente necesarios (evita traer payloads grandes)
        select: {
          status: true,
          startedAt: true,
          finishedAt: true,
        },
      }),
    ])

    // Clasificar tareas por estado según el flujo de la máquina de estados de limpieza:
    // UNASSIGNED → READY → IN_PROGRESS ↔ PAUSED → DONE → VERIFIED
    const completed = tasks.filter((t) => t.status === CleaningStatus.DONE || t.status === CleaningStatus.VERIFIED)
    const verified = tasks.filter((t) => t.status === CleaningStatus.VERIFIED)
    const pending = tasks.filter((t) =>
      [CleaningStatus.READY, CleaningStatus.IN_PROGRESS, CleaningStatus.PAUSED].includes(t.status as CleaningStatus),
    )
    const unassigned = tasks.filter((t) => t.status === CleaningStatus.UNASSIGNED)

    // Calcular tiempos de limpieza en minutos (diferencia finishedAt - startedAt)
    // Se filtra por tareas con ambas fechas presentes; las tareas sin startedAt/finishedAt
    // se omiten para no distorsionar el promedio con valores nulos
    const completionTimes = completed
      .filter((t) => t.startedAt && t.finishedAt)
      .map((t) => (new Date(t.finishedAt!).getTime() - new Date(t.startedAt!).getTime()) / 60000)

    // Si no hay ninguna tarea con tiempo medible, devolver null (no mostrar 0 minutos)
    const avg = completionTimes.length
      ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
      : null

    return {
      from,
      to,
      totalCheckouts: checkouts,
      tasksCompleted: completed.length,
      tasksVerified: verified.length,
      tasksPending: pending.length,
      tasksUnassigned: unassigned.length,
      avgMinutesToComplete: avg,
    }
  }

  /**
   * getStaffPerformance — Métricas de productividad individuales por camarera.
   *
   * Reglas de negocio:
   *  - Solo se incluye personal con rol HOUSEKEEPER (excluye supervisores y recepcionistas).
   *  - Solo se incluye personal activo (active: true).
   *  - Solo se cuentan tareas en estados terminales (DONE, VERIFIED) para el período dado.
   *  - El tiempo promedio excluye tareas sin startedAt o finishedAt (misma lógica que getOverview).
   *
   * Estrategia N+1:
   *  - Las tareas se cargan en la misma query de personal usando una relación anidada con `where`.
   *    Prisma genera un JOIN eficiente en lugar de ejecutar una query por cada miembro del staff.
   *
   * @param propertyId  UUID de la propiedad
   * @param from        Fecha inicio ISO-8601
   * @param to          Fecha fin ISO-8601
   * @returns           Array de objetos con métricas por camarera
   */
  async getStaffPerformance(propertyId: string, from: string, to: string) {
    // Normalizar fechas al rango completo del día
    const fromDate = new Date(from)
    fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date(to)
    toDate.setHours(23, 59, 59, 999)

    // Una sola query carga todo el personal con sus tareas filtradas por período y estado.
    // Ordenar por createdAt asc es útil para posible análisis cronológico futuro.
    const staff = await this.prisma.housekeepingStaff.findMany({
      where: { propertyId, role: HousekeepingRole.HOUSEKEEPER, active: true },
      select: {
        id: true,
        name: true,
        tasks: {
          where: {
            createdAt: { gte: fromDate, lte: toDate },
            // Solo estados terminales: no contabilizar trabajo en progreso
            status: { in: [CleaningStatus.DONE, CleaningStatus.VERIFIED] },
          },
          select: { status: true, startedAt: true, finishedAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    // Mapear cada miembro del staff a su resumen de rendimiento
    return staff.map((s) => {
      // Calcular tiempos individuales en minutos para las tareas con marcas de tiempo completas
      const completionTimes = s.tasks
        .filter((t) => t.startedAt && t.finishedAt)
        .map((t) => (new Date(t.finishedAt!).getTime() - new Date(t.startedAt!).getTime()) / 60000)

      return {
        staffId: s.id,
        staffName: s.name,
        tasksCompleted: s.tasks.length, // Total DONE + VERIFIED en el período
        tasksVerified: s.tasks.filter((t) => t.status === CleaningStatus.VERIFIED).length,
        // null si la persona no tiene ninguna tarea con tiempos registrados
        avgMinutesToComplete: completionTimes.length
          ? Math.round(completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length)
          : null,
      }
    })
  }

  /**
   * getDailyTrend — Serie temporal diaria para gráficos de tendencia.
   *
   * Retorna un punto por cada día del rango, con el conteo de tareas completadas y
   * checkouts del día. Útil para detectar picos de trabajo y correlacionar carga
   * de limpieza con volumen de salidas de huéspedes.
   *
   * Estrategia anti N+1:
   *  - En lugar de ejecutar una query por día (que sería O(días) queries), se hacen
   *    exactamente 2 queries bulk que traen todos los registros del período y luego
   *    se agrupan en memoria usando Map<dateStr, count>.
   *  - La agrupación usa slice(0, 10) sobre toISOString() para obtener "YYYY-MM-DD"
   *    de forma eficiente sin necesidad de formatters externos.
   *
   * Nota: Las tareas se filtran por `finishedAt` (no createdAt) para reflejar el día
   * en que realmente se completó la limpieza, no cuando se creó la tarea.
   *
   * @param propertyId  UUID de la propiedad
   * @param from        Fecha inicio ISO-8601
   * @param to          Fecha fin ISO-8601
   * @returns           Array de { date, completed, checkouts } con un elemento por día
   */
  async getDailyTrend(propertyId: string, from: string, to: string) {
    const fromDate = new Date(from)
    fromDate.setHours(0, 0, 0, 0)
    const toDate = new Date(to)
    toDate.setHours(23, 59, 59, 999)

    // Two bulk queries instead of 2×N per-day queries
    const [taskRows, checkoutRows] = await Promise.all([
      this.prisma.cleaningTask.findMany({
        where: {
          bed: { room: { propertyId } },
          // Filtrar por finishedAt para agrupar por día de finalización real
          finishedAt: { gte: fromDate, lte: toDate },
          status: { in: [CleaningStatus.DONE, CleaningStatus.VERIFIED] },
        },
        // Traer solo finishedAt para minimizar payload de red
        select: { finishedAt: true },
      }),
      this.prisma.checkout.findMany({
        where: {
          room: { propertyId },
          createdAt: { gte: fromDate, lte: toDate },
          cancelled: false,
        },
        select: { createdAt: true },
      }),
    ])

    // Build date-keyed maps in memory — O(n) where n = total records in period
    const tasksByDay = new Map<string, number>()
    for (const t of taskRows) {
      if (!t.finishedAt) continue
      // toISOString().slice(0,10) → "YYYY-MM-DD" en UTC, consistente con el filtro de fechas
      const d = t.finishedAt.toISOString().slice(0, 10)
      tasksByDay.set(d, (tasksByDay.get(d) ?? 0) + 1)
    }
    const checkoutsByDay = new Map<string, number>()
    for (const c of checkoutRows) {
      const d = c.createdAt.toISOString().slice(0, 10)
      checkoutsByDay.set(d, (checkoutsByDay.get(d) ?? 0) + 1)
    }

    // Generate full date range — ensures days with zero activity appear in the output
    // (el frontend necesita puntos para todos los días del rango para graficar líneas continuas)
    const days: { date: string; completed: number; checkouts: number }[] = []
    for (const d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10)
      days.push({
        date: dateStr,
        completed: tasksByDay.get(dateStr) ?? 0,   // 0 si no hubo tareas ese día
        checkouts: checkoutsByDay.get(dateStr) ?? 0, // 0 si no hubo checkouts ese día
      })
    }
    return days
  }
}
