/**
 * RoomsPage.tsx
 *
 * Vista de estado de habitaciones en tiempo real.
 * Muestra una rejilla de camas agrupadas por tipo de habitación (compartida / privada)
 * y permite registrar checkouts individuales tocando cualquier cama.
 *
 * Responsabilidades principales:
 *   1. Cargar el estado completo de habitaciones, tareas activas y personal en paralelo.
 *   2. Enriquecer cada cama con su tarea de limpieza activa y el nombre del housekeeper.
 *   3. Escuchar eventos SSE del servidor para actualizar la UI en tiempo real sin polling.
 *   4. Mostrar un banner de alertas para discrepancias abiertas reportadas por housekeeping.
 *   5. Abrir el modal QuickCheckoutModal al tocar una cama para registrar una salida rápida.
 *
 * Integración SSE:
 *   Los eventos task:* invalidan 'rooms-bed-level' forzando un refetch completo.
 *   El evento discrepancy:reported invalida 'discrepancies-open' y muestra un toast
 *   de aviso al supervisor.
 */

import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useSSE } from '../hooks/useSSE'
import type { BedDiscrepancyDto, BedDto, PropertySettingsDto, RoomDto, SseEvent } from '@housekeeping/shared'
import { BedStatus, CleaningStatus, DiscrepancyStatus, RoomType } from '@housekeeping/shared'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Cama enriquecida con el estado de la tarea de limpieza activa y el housekeeper asignado.
 * Extiende BedDto (datos de configuración de la cama) con campos derivados de la
 * última tarea activa. Estos campos son opcionales porque no toda cama tiene una tarea.
 */
interface BedWithStatus extends BedDto {
  taskStatus?: CleaningStatus | null
  taskId?: string | null
  assignedToName?: string | null
  latestNote?: string | null
}

/**
 * Habitación enriquecida cuyas camas son del tipo BedWithStatus.
 * El servidor devuelve RoomDto con BedDto; la queryFn transforma las camas
 * antes de almacenar en caché.
 */
interface RoomWithBeds extends RoomDto {
  beds: BedWithStatus[]
}

// ─── Visual config ────────────────────────────────────────────────────────────

/**
 * Configuración visual para cada estado de cama (colores, etiqueta y punto de color).
 * Centralizar aquí todos los estilos garantiza coherencia entre BedChip, PrivateCard
 * y la leyenda de la página.
 *
 * Los estados son strings porque se derivan de `visualStatus()`, que puede combinar
 * BedStatus y CleaningStatus en un único valor normalizado.
 */
const BED_CFG: Record<string, { bg: string; border: string; label: string; dot: string }> = {
  AVAILABLE: { bg: 'bg-green-50',  border: 'border-green-300',  label: 'Disponible',  dot: 'bg-green-500' },
  OCCUPIED:  { bg: 'bg-gray-100',  border: 'border-gray-300',   label: 'Ocupada',     dot: 'bg-gray-400' },
  DIRTY:     { bg: 'bg-amber-50',  border: 'border-amber-400',  label: 'Sucia',       dot: 'bg-amber-500' },
  CLEANING:  { bg: 'bg-blue-50',   border: 'border-blue-400',   label: 'Limpiando',   dot: 'bg-blue-500' },
  BLOCKED:   { bg: 'bg-red-50',    border: 'border-red-400',    label: 'Bloqueada',   dot: 'bg-red-500' },
}

/**
 * Mapeo de estados de tarea de limpieza a estados visuales de cama.
 *
 * Justificación de las equivalencias:
 *   READY / UNASSIGNED → DIRTY: la tarea existe pero no se ha empezado; la cama está sucia.
 *   IN_PROGRESS / PAUSED → CLEANING: un housekeeper está limpiando actualmente.
 *   DONE / VERIFIED → AVAILABLE: la cama está lista para el próximo huésped.
 *
 * Los estados de tarea no mapeados aquí (ej. CANCELLED) devuelven el `bed.status`
 * nativo de la cama (ver `visualStatus`).
 */
const TASK_STATUS_MAP: Partial<Record<CleaningStatus, string>> = {
  [CleaningStatus.READY]:       'DIRTY',
  [CleaningStatus.UNASSIGNED]:  'DIRTY',
  [CleaningStatus.IN_PROGRESS]: 'CLEANING',
  [CleaningStatus.PAUSED]:      'CLEANING',
  [CleaningStatus.DONE]:        'AVAILABLE',
  [CleaningStatus.VERIFIED]:    'AVAILABLE',
}

/**
 * Calcula el estado visual de una cama priorizando la tarea de limpieza activa
 * sobre el estado base de la cama.
 *
 * La tarea de limpieza tiene prioridad porque refleja el trabajo en curso del
 * housekeeper, que es más reciente que el estado estático almacenado en la cama.
 * Si no hay tarea activa (o su estado no está en el mapa), se usa `bed.status`.
 */
function visualStatus(bed: BedWithStatus): string {
  if (bed.taskStatus && TASK_STATUS_MAP[bed.taskStatus]) return TASK_STATUS_MAP[bed.taskStatus]!
  return bed.status
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function RoomsPage() {
  const qc = useQueryClient()

  /**
   * Cama y habitación seleccionadas para el checkout rápido.
   * null cuando el modal está cerrado; { bed, room } cuando está abierto.
   * Guardar la habitación junto con la cama evita buscarla en el array al renderizar el modal.
   */
  const [checkoutTarget, setCheckoutTarget] = useState<{ bed: BedWithStatus; room: RoomWithBeds } | null>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────

  /**
   * Carga habitaciones, tareas activas y personal en paralelo con Promise.all
   * para minimizar la latencia de carga inicial.
   *
   * Transformación de datos (N+1 → join en cliente):
   *   El servidor no devuelve las camas con sus tareas unidas, así que la queryFn
   *   construye dos Maps en memoria (tasksByBed, staffById) y los usa para
   *   enriquecer cada cama en O(n) en lugar de O(n²).
   *
   * Filtro de tareas:
   *   Solo se cargan tareas en estados activos (READY, UNASSIGNED, IN_PROGRESS, PAUSED, DONE).
   *   Las tareas CANCELLED se excluyen para mantener el payload pequeño.
   *   DONE se incluye para mostrar la cama como AVAILABLE hasta que el estado de la
   *   cama se actualice en el servidor.
   */
  const { data: rooms = [], isLoading } = useQuery<RoomWithBeds[]>({
    queryKey: ['rooms-bed-level'],
    queryFn: async () => {
      const [roomsData, tasksData, staffData] = await Promise.all([
        api.get<(RoomDto & { beds: BedDto[] })[]>('/rooms'),
        api.get<{ id: string; bedId: string; status: CleaningStatus; assignedToId: string | null }[]>(
          '/tasks?status=READY,UNASSIGNED,IN_PROGRESS,PAUSED,DONE',
        ),
        api.get<{ id: string; name: string }[]>('/staff'),
      ])
      // Indexa tareas por bedId para join O(1)
      const tasksByBed = new Map(tasksData.map((t) => [t.bedId, t]))
      // Indexa personal por id para resolver el nombre del housekeeper asignado
      const staffById = new Map(staffData.map((s) => [s.id, s.name]))

      // Combina habitación + tarea + personal en el tipo RoomWithBeds
      return roomsData.map((room) => ({
        ...room,
        beds: (room.beds ?? []).map((bed) => {
          const task = tasksByBed.get(bed.id)
          return {
            ...bed,
            taskStatus: task?.status ?? null,
            taskId: task?.id ?? null,
            // Resuelve el nombre del housekeeper; null si la tarea no está asignada
            assignedToName: task?.assignedToId ? (staffById.get(task.assignedToId) ?? null) : null,
          }
        }),
      }))
    },
  })

  // ── SSE real-time updates ──────────────────────────────────────────────────

  /**
   * Handler de eventos SSE del servidor.
   *
   * Estrategia de actualización: invalidación de query completa.
   * Ante cualquier cambio de tarea relevante, se invalida 'rooms-bed-level' y
   * React Query refetch automáticamente. Esto garantiza consistencia sin tener
   * que aplicar actualizaciones parciales en el caché manualmente.
   *
   * useCallback con [qc] como dependencia: qc es estable (singleton de React Query),
   * así que el handler no se recrea entre renders. Esto es importante porque
   * useSSE registra el handler como listener del EventSource; si cambiara en cada
   * render, se acumularían listeners duplicados.
   *
   * El toast de task:done se muestra durante 6 segundos (más que el default de 4s)
   * porque la información sobre early check-in es accionable y el supervisor necesita
   * tiempo para leerla.
   *
   * El evento discrepancy:reported invalida la query de discrepancias abiertas y
   * muestra un toast de aviso para que el supervisor sepa que hay una incidencia
   * que atender, aunque no esté mirando el banner en ese momento.
   */
  const handleSSE = useCallback(
    (event: SseEvent) => {
      if (['task:ready', 'task:started', 'task:done', 'task:unassigned', 'task:cancelled'].includes(event.type)) {
        qc.invalidateQueries({ queryKey: ['rooms-bed-level'] })
        if (event.type === 'task:done') {
          const d = event.data as { roomNumber?: string }
          toast.success(`Hab. ${d.roomNumber ?? ''} limpia — disponible para early check-in`, { duration: 6000 })
        }
      }
      if (event.type === 'discrepancy:reported') {
        qc.invalidateQueries({ queryKey: ['discrepancies-open'] })
        toast('Housekeeping reportó una incidencia en una cama', { icon: '⚠️', duration: 7000 })
      }
    },
    [qc],
  )
  useSSE(handleSSE)

  // ── Property settings ──────────────────────────────────────────────────────

  /**
   * Configuración de la propiedad, usada para pasar la hora de checkout por defecto
   * al modal. Se carga de forma independiente para no bloquear la carga de habitaciones.
   */
  const { data: settings } = useQuery<PropertySettingsDto>({
    queryKey: ['property-settings'],
    queryFn: () => api.get('/settings'),
  })

  /**
   * Discrepancias abiertas reportadas por el personal de housekeeping.
   * Se filtran en cliente para mostrar solo las que no han sido resueltas.
   *
   * refetchInterval: 60_000 añade un polling de seguridad de 1 minuto por si el
   * evento SSE discrepancy:reported se pierde por reconexión del canal SSE.
   * No se usa como fuente primaria de actualización (SSE lo hace en tiempo real).
   */
  const { data: openDiscrepancies = [] } = useQuery<BedDiscrepancyDto[]>({
    queryKey: ['discrepancies-open'],
    queryFn: async () => {
      const all = await api.get<BedDiscrepancyDto[]>('/discrepancies')
      return all.filter((d) => d.status === DiscrepancyStatus.OPEN)
    },
    refetchInterval: 60_000,
  })

  /**
   * Marca una discrepancia como "reconocida" (estado intermedio entre OPEN y RESOLVED).
   * El supervisor indica que está al tanto del problema y lo tiene en revisión.
   */
  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/discrepancies/${id}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discrepancies-open'] })
      toast.success('Discrepancia reconocida — en revisión')
    },
    onError: () => toast.error('Error al reconocer'),
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  // Separa las habitaciones en compartidas y privadas para renderizar secciones distintas
  const shared = rooms.filter((r) => r.type === RoomType.SHARED)
  const private_ = rooms.filter((r) => r.type === RoomType.PRIVATE)

  // Lista plana de todas las camas para calcular los totales del encabezado
  const allBeds = rooms.flatMap((r) => r.beds)
  const available = allBeds.filter((b) => visualStatus(b) === 'AVAILABLE').length
  // "Sucias/limpiando" agrupa DIRTY y CLEANING porque ambas requieren atención del housekeeper
  const dirty = allBeds.filter((b) => ['DIRTY', 'CLEANING'].includes(visualStatus(b))).length

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-sm text-gray-400">Cargando habitaciones...</div>
  }

  return (
    <>
      <div className="space-y-6">
        {/* Banner de discrepancias: aparece en la parte superior para máxima visibilidad.
            Se muestra solo cuando hay discrepancias abiertas pendientes de resolución. */}
        {openDiscrepancies.length > 0 && (
          <DiscrepancyBanner
            discrepancies={openDiscrepancies}
            onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
            isAcknowledging={acknowledgeMutation.isPending}
            // acknowledgeMutation.variables contiene el id enviado en la mutación en curso
            acknowledgingId={acknowledgeMutation.isPending ? (acknowledgeMutation.variables as string) : null}
          />
        )}

        {/* Encabezado con totales de disponibilidad */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Estado de habitaciones</h1>
            <p className="text-xs text-gray-400 mt-0.5">Tiempo real · {allBeds.length} camas · Toca una cama para hacer checkout</p>
          </div>
          <div className="flex gap-2 text-xs">
            <StatusPill color="green" dot="bg-green-500" label={`${available} disponibles`} />
            <StatusPill color="amber" dot="bg-amber-500" label={`${dirty} sucias/limpiando`} />
          </div>
        </div>

        {/* Leyenda: itera BED_CFG para mantenerse en sync si se añaden estados nuevos */}
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(BED_CFG).map(([k, v]) => (
            <span key={k} className={`flex items-center gap-1.5 px-2 py-1 rounded border ${v.bg} ${v.border}`}>
              <span className={`w-2 h-2 rounded-full ${v.dot}`} />
              {v.label}
            </span>
          ))}
        </div>

        {/* Dormitorios compartidos: cada uno muestra una fila horizontal de BedChips */}
        {shared.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Dormitorios compartidos</h2>
            <div className="space-y-3">
              {shared.map((room) => (
                <DormCard
                  key={room.id}
                  room={room}
                  onBedClick={(bed) => {
                    const vs = visualStatus(bed)
                    if (vs === 'AVAILABLE' || vs === 'CLEAN') {
                      toast('Esta cama está disponible — no hay huésped para hacer checkout', { icon: 'ℹ️' })
                      return
                    }
                    setCheckoutTarget({ bed, room })
                  }}
                />
              ))}
            </div>
          </section>
        )}

        {/* Habitaciones privadas: rejilla responsive de tarjetas compactas */}
        {private_.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Habitaciones privadas</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {private_.map((room) => (
                <PrivateCard
                  key={room.id}
                  room={room}
                  onBedClick={(bed) => {
                    const vs = visualStatus(bed)
                    if (vs === 'AVAILABLE' || vs === 'CLEAN') {
                      toast('Esta habitación está disponible — no hay huésped para hacer checkout', { icon: 'ℹ️' })
                      return
                    }
                    setCheckoutTarget({ bed, room })
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Modal de checkout rápido — montado fuera del flujo del documento para
          poder usar position:fixed sin interferencia del contenedor padre */}
      {checkoutTarget && (
        <QuickCheckoutModal
          bed={checkoutTarget.bed}
          room={checkoutTarget.room}
          defaultCheckoutTime={settings?.defaultCheckoutTime ?? '11:00'}
          onClose={() => setCheckoutTarget(null)}
          onDone={() => {
            setCheckoutTarget(null)
            // Invalida la query para reflejar el nuevo taskId de la cama en la rejilla
            qc.invalidateQueries({ queryKey: ['rooms-bed-level'] })
          }}
        />
      )}
    </>
  )
}

// ─── Discrepancy alert banner ─────────────────────────────────────────────────

/**
 * Etiquetas legibles para cada tipo de discrepancia reportada por housekeeping.
 * Si el servidor devuelve un tipo no contemplado aquí, se muestra el valor raw
 * como fallback (ver uso en DiscrepancyBanner).
 */
const DISCREPANCY_TYPE_LABEL: Record<string, string> = {
  BED_STATUS_MISMATCH:  'Estado incorrecto',
  GUEST_EXTENSION:      'Huésped extendió',
  UNEXPECTED_OCCUPANCY: 'Ocupación inesperada',
  OTHER:                'Otro',
}

/**
 * Banner colapsable de alertas de discrepancias abiertas.
 *
 * Diseño de interacción:
 *   - Por defecto está colapsado para no distraer si el supervisor está mirando
 *     el estado de las camas. El recuento en el resumen es suficiente para alertar.
 *   - Al expandir, muestra cada discrepancia con su tipo, descripción y quién la reportó.
 *   - "Reconocer" marca la discrepancia como ACKNOWLEDGED (en revisión) sin resolverla.
 *   - "Resolver" lleva a la página de discrepancias para el flujo completo de resolución.
 *
 * isAcknowledging + acknowledgingId: permiten mostrar un spinner solo en el botón
 * de la discrepancia que está siendo procesada, sin bloquear los demás botones.
 */
function DiscrepancyBanner({
  discrepancies,
  onAcknowledge,
  isAcknowledging,
  acknowledgingId,
}: {
  discrepancies: BedDiscrepancyDto[]
  onAcknowledge: (id: string) => void
  isAcknowledging: boolean
  acknowledgingId: string | null
}) {
  /** Controla si el detalle de las discrepancias está visible o colapsado */
  const [expanded, setExpanded] = useState(false)
  const count = discrepancies.length

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl overflow-hidden">
      {/* Fila de resumen: siempre visible, actúa como toggle del contenido expandido */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-amber-100/60 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-amber-600 text-base leading-none">⚠️</span>
          <div>
            <p className="text-sm font-semibold text-amber-800">
              {count} discrepancia{count > 1 ? 's' : ''} abierta{count > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-amber-600">
              Housekeeping reportó incidencias con camas — clic para ver detalles
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* stopPropagation evita que el clic en "Ver todas" también colapce/expanda el banner */}
          <Link
            to="/discrepancies"
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
          >
            Ver todas
          </Link>
          <span className="text-amber-500 text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Lista detallada de discrepancias — solo se monta cuando está expandida */}
      {expanded && (
        <div className="border-t border-amber-200 divide-y divide-amber-100">
          {discrepancies.map((d) => {
            // Fallback a los IDs brutos si los datos relacionales no están disponibles
            const bedLabel   = d.bed?.label        ?? d.bedId
            const roomNumber = d.bed?.room?.number ?? '—'
            const typeLabel  = DISCREPANCY_TYPE_LABEL[d.type] ?? d.type
            // Identifica la discrepancia específica que está siendo reconocida ahora mismo
            const isThisOne  = isAcknowledging && acknowledgingId === d.id

            return (
              <div key={d.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">
                      Hab. {roomNumber} · {bedLabel}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      {typeLabel}
                    </span>
                  </div>
                  {d.description && (
                    <p className="text-xs text-gray-600 mt-0.5 truncate">"{d.description}"</p>
                  )}
                  {d.reportedBy && (
                    <p className="text-xs text-gray-400 mt-0.5">Reportado por {d.reportedBy.name}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => onAcknowledge(d.id)}
                    disabled={isAcknowledging}
                    className="px-3 py-1.5 text-xs font-medium border border-amber-400 text-amber-700 bg-white rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-50"
                  >
                    {/* Muestra "..." solo en el botón de la discrepancia en procesamiento */}
                    {isThisOne ? '...' : 'Reconocer'}
                  </button>
                  <Link
                    to="/discrepancies"
                    className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Resolver
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Dorm card — horizontal row of bed chips ──────────────────────────────────

/**
 * Tarjeta de dormitorio compartido.
 * Muestra el nombre del dormitorio, su planta y un contador de camas sucias/libres
 * en el encabezado, seguido de una fila de BedChips (uno por cama).
 *
 * Los contadores del encabezado permiten al supervisor ver el estado de un dormitorio
 * de un vistazo sin tener que leer el color de cada chip individualmente.
 */
function DormCard({ room, onBedClick }: { room: RoomWithBeds; onBedClick: (b: BedWithStatus) => void }) {
  const dirty = room.beds.filter((b) => ['DIRTY', 'CLEANING'].includes(visualStatus(b))).length
  const available = room.beds.filter((b) => visualStatus(b) === 'AVAILABLE').length

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 text-sm">Dorm {room.number}</span>
          {room.floor != null && <span className="text-xs text-gray-400">Piso {room.floor}</span>}
          <span className="text-xs text-gray-400">{room.beds.length} camas</span>
        </div>
        <div className="flex gap-2 text-xs">
          {dirty > 0 && <span className="text-amber-600 font-medium">{dirty} sucia{dirty > 1 ? 's' : ''}</span>}
          {available > 0 && <span className="text-green-600">{available} libre{available > 1 ? 's' : ''}</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {room.beds.map((bed) => <BedChip key={bed.id} bed={bed} onClick={() => onBedClick(bed)} />)}
      </div>
    </div>
  )
}

// ─── Private room card ────────────────────────────────────────────────────────

/**
 * Tarjeta de habitación privada (una sola cama).
 * Al contrario que DormCard, toda la tarjeta es un botón porque la habitación tiene
 * una única cama y el tap en cualquier punto debe abrir el modal de checkout.
 *
 * El color de fondo y borde de la tarjeta refleja el estado visual de la cama,
 * convirtiendo la rejilla en un mapa de calor instantáneo del estado del hotel.
 *
 * El dot de "CLEANING" usa `animate-pulse` para dar feedback visual de actividad
 * en curso, diferenciando DIRTY (estático) de CLEANING (pulsante).
 */
function PrivateCard({ room, onBedClick }: { room: RoomWithBeds; onBedClick: (b: BedWithStatus) => void }) {
  // La habitación privada siempre tiene una sola cama; usamos room.beds[0]
  const bed = room.beds[0]
  const vs = bed ? visualStatus(bed) : 'AVAILABLE'
  // Fallback a AVAILABLE si el estado visual no está en BED_CFG (estado desconocido)
  const cfg = BED_CFG[vs] ?? BED_CFG.AVAILABLE

  return (
    <button
      onClick={() => bed && onBedClick(bed)}
      className={`border rounded-xl p-3 text-left w-full transition-colors hover:brightness-95 ${cfg.bg} ${cfg.border}`}
    >
      <div className="flex items-start justify-between mb-1">
        <span className="font-semibold text-gray-900 text-sm">{room.number}</span>
        {room.floor != null && <span className="text-xs text-gray-400">P{room.floor}</span>}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        {/* Dot pulsante durante limpieza activa para distinguirlo de "sucia" */}
        <span className={`w-2 h-2 rounded-full ${cfg.dot} ${vs === 'CLEANING' ? 'animate-pulse' : ''}`} />
        <span className="text-xs text-gray-600">{cfg.label}</span>
      </div>
      {bed?.assignedToName && <p className="text-xs text-gray-400 truncate mt-1">{bed.assignedToName}</p>}
      {bed?.latestNote && <p className="text-xs text-gray-500 mt-1 italic truncate">"{bed.latestNote}"</p>}
    </button>
  )
}

// ─── Bed chip ─────────────────────────────────────────────────────────────────

/**
 * Chip individual de cama para dormitorios compartidos.
 * Muestra la etiqueta de la cama (ej. "A", "B"), su estado visual y el housekeeper asignado.
 *
 * min-w-[90px] evita que los chips se compriman en dormitorios con muchas camas,
 * manteniendo la legibilidad del texto en pantallas pequeñas.
 *
 * El tooltip (title) resume toda la información relevante para usuarios con ratón.
 * El icono de nota indica que hay información adicional sin mostrarla completa en el chip.
 */
function BedChip({ bed, onClick }: { bed: BedWithStatus; onClick: () => void }) {
  const vs = visualStatus(bed)
  const cfg = BED_CFG[vs] ?? BED_CFG.AVAILABLE

  return (
    <button
      onClick={onClick}
      className={`border rounded-lg px-3 py-2 text-left transition-all hover:brightness-95 hover:shadow-sm min-w-[90px] ${cfg.bg} ${cfg.border}`}
      title={`${bed.label} — ${cfg.label}${bed.assignedToName ? ` · ${bed.assignedToName}` : ''}`}
    >
      <p className="text-xs font-medium text-gray-700 truncate">{bed.label}</p>
      <div className="flex items-center gap-1 mt-0.5">
        {/* Dot pulsante para distinguir limpieza activa de sucia */}
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${vs === 'CLEANING' ? 'animate-pulse' : ''}`} />
        <span className="text-xs text-gray-500">{cfg.label}</span>
      </div>
      {bed.assignedToName && <p className="text-xs text-gray-400 truncate mt-0.5">{bed.assignedToName}</p>}
      {bed.latestNote && (
        <p className="text-xs text-amber-600 mt-0.5 truncate" title={bed.latestNote}>📝 nota</p>
      )}
    </button>
  )
}

// ─── Quick checkout modal ─────────────────────────────────────────────────────

/**
 * Modal de dos pasos para registrar un checkout desde la vista de habitaciones.
 *
 * Flujo de dos pasos (confirm → details):
 *   Paso 1 (confirm): Confirmación simple — evita checkouts accidentales al tocar
 *     una cama por error. Un solo botón "Sí, checkout" avanza al paso 2.
 *   Paso 2 (details): Opciones adicionales antes de enviar:
 *     - Toggle "urgente": marca hasSameDayCheckIn = true → tarea de limpieza prioritaria.
 *     - Nota opcional para el housekeeper.
 *     - Botón "Atrás" para corregir sin cerrar el modal y sin perder los datos ya introducidos.
 *
 * El modal se cierra al hacer clic en el backdrop (overlay), pero NO con blur del
 * textarea de nota (misma decisión UX que en DailyPlanningPage — ver comentario allí).
 *
 * Props:
 *   defaultCheckoutTime — hora de checkout configurada en la propiedad (ej. "11:00"),
 *   mostrada en el paso 1 para que el supervisor sepa la deadline de limpieza.
 */
function QuickCheckoutModal({
  bed,
  room,
  defaultCheckoutTime,
  onClose,
  onDone,
}: {
  bed: BedWithStatus
  room: RoomWithBeds
  defaultCheckoutTime: string
  onClose: () => void
  onDone: () => void
}) {
  // La fecha de checkout siempre es hoy (checkout rápido desde la vista de habitaciones)
  const today = format(new Date(), 'yyyy-MM-dd')
  const [urgente, setUrgente] = useState(false)
  const [note, setNote] = useState('')
  /** Controla qué paso del wizard está visible: 'confirm' (paso 1) o 'details' (paso 2) */
  const [step, setStep] = useState<'confirm' | 'details'>('confirm')

  /**
   * Envía el checkout de esta cama al endpoint /checkouts/batch.
   * Aunque es una sola cama, se usa el endpoint batch por consistencia con
   * DailyPlanningPage y para no duplicar lógica en el servidor.
   */
  const mutation = useMutation({
    mutationFn: () =>
      api.post('/checkouts/batch', {
        checkoutDate: today,
        items: [{ bedId: bed.id, hasSameDayCheckIn: urgente, notes: note || undefined }],
      }),
    onSuccess: () => {
      toast.success(`✅ Checkout registrado — ${room.number} · ${bed.label}`)
      onDone()
    },
    onError: () => toast.error('Error al registrar checkout'),
  })

  // Estado visual de la cama para colorear el encabezado del modal
  const vs = visualStatus(bed)
  const cfg = BED_CFG[vs] ?? BED_CFG.AVAILABLE

  return (
    // Backdrop: clic en el overlay cierra el modal; stopPropagation en el contenido
    // evita que el clic dentro del modal también lo cierre.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Encabezado del modal: número de habitación, etiqueta de cama y estado actual.
            El fondo usa el color de estado de la cama para contexto visual inmediato. */}
        <div className={`px-5 py-4 border-b border-gray-100 ${cfg.bg}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{room.number} · {bed.label}</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                <span className="text-xs text-gray-600">{cfg.label}</span>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>

        {step === 'confirm' ? (
          /* ── Paso 1: Confirmación de intención ──────────────────────────────
             Barrera anti-accidente: el supervisor confirma que quiere hacer checkout
             antes de ver las opciones. Reduce cancelaciones por toques accidentales. */
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-700">
              ¿Registrar <span className="font-semibold">checkout</span> para esta cama?
            </p>
            <p className="text-xs text-gray-400">
              Se creará una tarea de limpieza con hora de checkout a las {defaultCheckoutTime}.
            </p>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 border border-gray-300 rounded-xl py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => setStep('details')}
                className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Sí, checkout
              </button>
            </div>
          </div>
        ) : (
          /* ── Paso 2: Detalles opcionales + confirmación final ───────────────
             El supervisor puede marcar la urgencia y añadir nota antes de enviar.
             "Atrás" vuelve al paso 1 sin perder urgente ni nota ya introducida. */
          <div className="p-5 space-y-4">
            {/* Toggle de urgencia: botón de área grande para facilitar el tap en móvil.
                Cuando está activo, el borde rojo y el icono 🔴 dan feedback claro. */}
            <button
              onClick={() => setUrgente((v) => !v)}
              className={`w-full flex items-center gap-3 rounded-xl border-2 px-4 py-3 transition-colors ${
                urgente ? 'border-red-400 bg-red-50' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className="text-xl">{urgente ? '🔴' : '⬜'}</span>
              <div className="text-left">
                <p className={`text-sm font-medium ${urgente ? 'text-red-700' : 'text-gray-700'}`}>
                  Check-in hoy — limpiar con urgencia
                </p>
                <p className="text-xs text-gray-400">El próximo huésped llega hoy</p>
              </div>
            </button>

            {/* Nota opcional: no se cierra sola al perder el foco (misma decisión UX
                que en DailyPlanningPage) para evitar pérdida de texto en móvil. */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Nota para housekeeping (opcional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Ej: revisar caja fuerte, objetos olvidados..."
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>

            <div className="flex gap-3">
              {/* "Atrás" vuelve al paso 1 sin perder urgente ni nota */}
              <button
                onClick={() => setStep('confirm')}
                className="border border-gray-300 rounded-xl px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                Atrás
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="flex-1 bg-indigo-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {mutation.isPending ? 'Registrando...' : 'Confirmar checkout'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusPill({ color, dot, label }: { color: string; dot: string; label: string }) {
  const cls: Record<string, string> = {
    green: 'bg-green-50 text-green-700 border-green-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
  }
  return (
    <span className={`flex items-center gap-1.5 border rounded-full px-3 py-1 ${cls[color] ?? ''}`}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  )
}
