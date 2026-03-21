/**
 * DailyPlanningPage.tsx
 *
 * Pantalla central de operaciones de recepción. Une dos flujos del mismo ciclo
 * operativo en un solo lugar para que el recepcionista no tenga que navegar:
 *
 *   PESTAÑA 1 — Planificación del Día (hoja de salidas matutina)
 *   ─────────────────────────────────────────────────────────────
 *   Modelo mental: pizarra en blanco. Cada mañana (~7 am) el recepcionista
 *   marca qué camas tienen salida hoy basándose en su lista física.
 *   Al confirmar se crea un batch de CleaningTask(PENDING) — el huésped
 *   AÚN está en la habitación, housekeeping recibe la lista para prepararse
 *   pero NO la señal de limpiar todavía.
 *
 *   PESTAÑA 2 — Estado en Tiempo Real
 *   ─────────────────────────────────────────────────────────────
 *   Cuando el huésped se presenta en recepción para hacer checkout físico,
 *   el recepcionista toca su cama en esta pestaña. Eso dispara la Fase 2:
 *   PENDING → READY/UNASSIGNED, cama → DIRTY, push a housekeeping.
 *   La pestaña se mantiene actualizada vía SSE sin polling agresivo.
 *
 * Flujo de datos:
 *   GET /planning/daily  →  DailyPlanningGrid  →  ambas pestañas
 *   POST /checkouts/batch             →  crea tasks PENDING (Fase 1)
 *   POST /checkouts/:id/depart        →  activa tasks por cama (Fase 2)
 *   PATCH /checkouts/:id/cancel       →  extensión de estadía
 *   GET /events (SSE)                 →  actualizaciones en tiempo real
 */

import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import { useSSE } from '../hooks/useSSE'
import type {
  BedDiscrepancyDto,
  DailyPlanningGrid,
  DailyPlanningRow,
  PropertySettingsDto,
  SseEvent,
} from '@housekeeping/shared'
import { CleaningStatus, DiscrepancyStatus, PlanningCellState } from '@housekeeping/shared'

// ─── Constantes de módulo ─────────────────────────────────────────────────────

/**
 * Fecha del día en curso en formato ISO (YYYY-MM-DD).
 * Calculada una sola vez al montar el módulo — nunca cambia durante la sesión.
 * Usada como:
 *   - Query key de React Query (cambia automáticamente al día siguiente al recargar)
 *   - Parámetro del POST /checkouts/batch
 *   - Clave del localStorage para el flag "sin salidas confirmadas hoy"
 */
const TODAY = format(new Date(), 'yyyy-MM-dd')

/**
 * Etiqueta legible de la fecha para el encabezado ("Sábado 21 de marzo, 2026").
 * Se capitaliza manualmente porque CSS text-transform:capitalize capitalizaría
 * TODAS las palabras ("Sábado 21 De Marzo"), lo que es incorrecto en español.
 */
const _rawLabel = format(new Date(), "EEEE d 'de' MMMM, yyyy", { locale: es })
const TODAY_LABEL = _rawLabel.charAt(0).toUpperCase() + _rawLabel.slice(1)

// ─── Tipos locales ────────────────────────────────────────────────────────────

/**
 * Borrador local de una celda de planificación antes de enviar al servidor.
 * Los overrides son efímeros (viven solo mientras la pestaña de planificación
 * está montada) — una vez confirmados, el servidor es la fuente de verdad.
 */
type CellOverride = { state: PlanningCellState; note: string }

/** Clave compuesta "roomId:bedId" que identifica una celda en la tabla. */
type CellKey = string

// ─── Planning: máquina de estados y estilos ───────────────────────────────────

/**
 * Ciclo de estados al hacer clic en una celda durante la planificación.
 *
 *   EMPTY → CHECKOUT → EMPTY → …
 *
 * El estado CHECKOUT_WITH_CHECKIN (urgente) se activa con el botón secundario
 * "🔴 Check-in hoy" para no forzar 3 clics para llegar a EMPTY.
 *
 * OCCUPIED se eliminó del ciclo: el modelo de pizarra en blanco asume que
 * el recepcionista solo marca lo que SÍ tiene salida. "Disponible" es el
 * estado neutro — no implica que la cama esté físicamente vacía.
 */
const STATE_CYCLE: PlanningCellState[] = [PlanningCellState.EMPTY, PlanningCellState.CHECKOUT]

/** Etiquetas en español de cada estado de planificación. */
const STATE_LABEL: Record<PlanningCellState, string> = {
  [PlanningCellState.EMPTY]:                 'Disponible',
  [PlanningCellState.OCCUPIED]:              'Ocupada',            // legacy — no aparece en ciclo
  [PlanningCellState.CHECKOUT]:              'Checkout hoy',
  [PlanningCellState.CHECKOUT_WITH_CHECKIN]: 'Checkout + Check-in hoy',
}

/** Clases de Tailwind para cada estado de planificación. */
const STATE_STYLE: Record<PlanningCellState, string> = {
  [PlanningCellState.EMPTY]:
    'bg-white border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-500',
  [PlanningCellState.OCCUPIED]:
    'bg-gray-100 border-gray-300 text-gray-600',
  [PlanningCellState.CHECKOUT]:
    'bg-amber-50 border-amber-400 text-amber-700',
  [PlanningCellState.CHECKOUT_WITH_CHECKIN]:
    'bg-red-50 border-red-500 text-red-700 font-semibold',
}

// ─── Real-time: estados derivados del ciclo de dos fases ─────────────────────

/**
 * Estados de tiempo real derivados del ciclo de checkout (no persistidos en BD).
 *
 *   AVAILABLE         — Sin tarea activa para hoy.
 *   PENDING_DEPARTURE — Checkout planificado (Fase 1). El huésped aún está
 *                       en la habitación. El recepcionista confirma la salida
 *                       aquí cuando el huésped aparece en el lobby.
 *   READY_TO_CLEAN    — Huésped salió (Fase 2 completada). Housekeeping notificada.
 *   CLEANING          — Housekeeper limpiando activamente.
 *   CLEAN             — Limpieza completada. Lista para el próximo huésped.
 */
type RealtimeState = 'AVAILABLE' | 'PENDING_DEPARTURE' | 'READY_TO_CLEAN' | 'CLEANING' | 'CLEAN'

/**
 * Configuración visual para cada estado de tiempo real.
 *
 * `actionable: true` marca los estados donde el recepcionista puede hacer clic.
 * Solo PENDING_DEPARTURE es accionable — los demás son informativos.
 */
const RT_CFG: Record<
  RealtimeState,
  { bg: string; border: string; text: string; dot: string; label: string; actionable: boolean }
> = {
  AVAILABLE:         { bg: 'bg-gray-50',   border: 'border-gray-200',   text: 'text-gray-400',   dot: 'bg-gray-300',   label: 'Disponible',          actionable: false },
  PENDING_DEPARTURE: { bg: 'bg-indigo-50', border: 'border-indigo-300', text: 'text-indigo-700', dot: 'bg-indigo-500', label: 'Pendiente de salida',  actionable: true  },
  READY_TO_CLEAN:    { bg: 'bg-amber-50',  border: 'border-amber-400',  text: 'text-amber-700',  dot: 'bg-amber-500',  label: 'Lista para limpiar',  actionable: false },
  CLEANING:          { bg: 'bg-blue-50',   border: 'border-blue-400',   text: 'text-blue-700',   dot: 'bg-blue-500',   label: 'Limpiando...',         actionable: false },
  CLEAN:             { bg: 'bg-green-50',  border: 'border-green-400',  text: 'text-green-700',  dot: 'bg-green-500',  label: '✓ Limpia',            actionable: false },
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Construye la clave de mapa para una celda de planificación. */
function cellKey(roomId: string, bedId: string): CellKey {
  return `${roomId}:${bedId}`
}

/**
 * Deduce el estado INICIAL de una celda de planificación a partir de los datos
 * del servidor. Se llama una vez por celda al cargar la grilla.
 *
 * Regla: todas las camas parten como EMPTY (pizarra en blanco).
 * Solo si el servidor ya tiene una tarea activa para hoy (taskId presente y
 * checkout no cancelado) se recupera el estado guardado — esto garantiza
 * idempotencia al recargar la página después de confirmar la planificación.
 */
function inferState(cell: DailyPlanningGrid['sharedRooms'][0]['beds'][0]): PlanningCellState {
  if (cell.taskId && !cell.cancelled) {
    if (cell.taskStatus === CleaningStatus.CANCELLED) return PlanningCellState.EMPTY
    if (cell.hasSameDayCheckIn) return PlanningCellState.CHECKOUT_WITH_CHECKIN
    return PlanningCellState.CHECKOUT
  }
  return PlanningCellState.EMPTY
}

/**
 * Mapea el estado de la tarea de limpieza al estado de tiempo real de la cama.
 * No usa bed.status directamente — la tarea es la fuente de verdad del ciclo.
 */
function inferRealtimeState(bed: DailyPlanningGrid['sharedRooms'][0]['beds'][0]): RealtimeState {
  if (!bed.taskId || bed.cancelled) return 'AVAILABLE'
  switch (bed.taskStatus) {
    case CleaningStatus.PENDING:
      return 'PENDING_DEPARTURE'        // Fase 1: huésped aún no salió
    case CleaningStatus.READY:
    case CleaningStatus.UNASSIGNED:
      return 'READY_TO_CLEAN'           // Fase 2: salida confirmada, en cola
    case CleaningStatus.IN_PROGRESS:
    case CleaningStatus.PAUSED:
      return 'CLEANING'                 // Housekeeping limpiando
    case CleaningStatus.DONE:
    case CleaningStatus.VERIFIED:
      return 'CLEAN'                    // Limpia, lista para check-in
    default:
      return 'AVAILABLE'
  }
}

/** Labels para discrepancias reportadas por housekeeping. */
const DISCREPANCY_LABEL: Record<string, string> = {
  BED_STATUS_MISMATCH:  'Estado incorrecto',
  GUEST_EXTENSION:      'Huésped extendió',
  UNEXPECTED_OCCUPANCY: 'Ocupación inesperada',
  OTHER:                'Otro',
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function DailyPlanningPage() {

  // ── Estado local ──────────────────────────────────────────────────────────

  /**
   * Borradores de celdas antes de confirmar.
   *
   * Son EFÍMEROS por diseño: si el usuario navega sin confirmar, se pierden.
   * Esto es correcto — el servidor no conoce esos borradores y mostrarlos
   * como "guardados" sería engañoso. Una vez confirmados, el servidor
   * (vía React Query) es la única fuente de verdad.
   */
  const [overrides, setOverrides] = useState<Map<CellKey, CellOverride>>(new Map())
  const [noteTarget, setNoteTarget]   = useState<CellKey | null>(null)

  /**
   * Cama pendiente de confirmación de salida (modal de Fase 2).
   * Incluye bedId para activar solo esa cama, no todas las del dorm.
   */
  const [departTarget, setDepartTarget] = useState<{
    checkoutId: string
    bedId: string           // Cama específica a activar (evita activar todo el dorm)
    bedLabel: string
    roomNumber: string
    isUrgent: boolean
  } | null>(null)

  /**
   * Tab activo almacenado en URL, no en useState.
   *
   * Por qué URL y no useState/Redux:
   *   - useState muere al desmontar (navegar a Tareas y volver = tab reseteado)
   *   - URL params sobreviven la navegación dentro del SPA
   *   - El botón "atrás" del navegador funciona correctamente
   *   - La URL es compartible: /planning?tab=realtime lleva directo al tiempo real
   */
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') as 'planning' | 'realtime') ?? 'planning'
  const setActiveTab = useCallback(
    (tab: 'planning' | 'realtime') => setSearchParams({ tab }, { replace: true }),
    [setSearchParams],
  )

  const qc = useQueryClient()

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Grid de planificación diaria — única fuente de datos para ambas pestañas.
   *
   * gcTime: 10 min → datos disponibles en caché al volver de otra sección.
   * staleTime: 2 min → sin refetch innecesario si el usuario vuelve en < 2 min.
   * refetchInterval: 30 s → fallback para tiempo real (SSE es el canal principal).
   */
  const { data: grid, isLoading: loadingGrid } = useQuery<DailyPlanningGrid>({
    queryKey: ['daily-grid', TODAY],
    queryFn: () => api.get(`/planning/daily?date=${TODAY}`),
    staleTime:        2 * 60 * 1000,
    gcTime:          10 * 60 * 1000,
    refetchInterval:  30 * 1000,
  })

  const { data: settings } = useQuery<PropertySettingsDto>({
    queryKey: ['property-settings'],
    queryFn: () => api.get('/settings'),
  })
  // `settings` expuesto para uso futuro (timezone, defaultCheckoutTime)
  void settings

  const { data: openDiscrepancies = [] } = useQuery<BedDiscrepancyDto[]>({
    queryKey: ['discrepancies-open'],
    queryFn: async () => {
      const all = await api.get<BedDiscrepancyDto[]>('/discrepancies')
      return all.filter((d) => d.status === DiscrepancyStatus.OPEN)
    },
    refetchInterval: 60_000,
  })

  // ── SSE ───────────────────────────────────────────────────────────────────

  /**
   * Handler SSE unificado para ambas pestañas.
   * Un solo listener evita registrar el mismo evento dos veces.
   */
  const handleSSE = useCallback(
    (event: SseEvent) => {
      const taskEvents = ['task:planned', 'task:ready', 'task:started', 'task:done', 'task:unassigned', 'task:cancelled']
      if (taskEvents.includes(event.type)) {
        qc.invalidateQueries({ queryKey: ['daily-grid', TODAY] })
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

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Fase 1 — Confirma la planificación del día (batch de salidas).
   *
   * CRÍTICO — await refetchQueries antes de cambiar pestaña:
   *   invalidateQueries() es fire-and-forget (retorna void). Si cambiamos tab
   *   inmediatamente después, la pestaña realtime renderiza con datos stale
   *   (sin taskIds) → planningIsDone=false → "Sin planificación confirmada".
   *
   *   refetchQueries() retorna una Promise que se resuelve cuando los datos
   *   frescos llegan del servidor. El await garantiza que planningIsDone=true
   *   antes de que se muestre la pestaña de tiempo real.
   */
  const batchMutation = useMutation({
    mutationFn: (items: { bedId: string; hasSameDayCheckIn: boolean; notes?: string }[]) =>
      api.post('/checkouts/batch', { checkoutDate: TODAY, items }),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ['daily-grid', TODAY] })
      toast.success('Planificación confirmada — Housekeeping recibió la lista de salidas')
      setActiveTab('realtime')
    },
    onError: () => toast.error('Error al confirmar la planificación'),
  })

  const cancelMutation = useMutation({
    mutationFn: (checkoutId: string) => api.patch(`/checkouts/${checkoutId}/cancel`),
    onSuccess: () => {
      toast.success('Checkout cancelado — la cama vuelve a Disponible')
      qc.invalidateQueries({ queryKey: ['daily-grid', TODAY] })
    },
    onError: () => toast.error('Error al cancelar'),
  })

  /**
   * Fase 2 — Confirma la salida física del huésped (activa limpieza).
   *
   * Se envía bedId para activar SOLO la cama que el recepcionista confirmó.
   * Sin bedId, el backend activaría TODAS las camas del checkout — en un
   * dorm de 6 camas eso activaría las 6 aunque solo salió un huésped.
   */
  const departMutation = useMutation({
    mutationFn: ({ checkoutId, bedId }: { checkoutId: string; bedId: string }) =>
      api.post(`/checkouts/${checkoutId}/depart`, { bedId }),
    onSuccess: () => {
      toast.success('Salida confirmada — Housekeeping notificada para limpiar')
      setDepartTarget(null)
      qc.invalidateQueries({ queryKey: ['daily-grid', TODAY] })
    },
    onError: () => {
      toast.error('Error al confirmar salida')
      setDepartTarget(null)
    },
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/discrepancies/${id}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discrepancies-open'] })
      toast.success('Discrepancia reconocida — en revisión')
    },
    onError: () => toast.error('Error al reconocer'),
  })

  // ── Helpers de planificación ──────────────────────────────────────────────

  /** Retorna el estado efectivo de una celda: override local o estado del servidor. */
  function getState(
    roomId: string,
    bedId: string,
    cell: DailyPlanningGrid['sharedRooms'][0]['beds'][0],
  ): PlanningCellState {
    return overrides.get(cellKey(roomId, bedId))?.state ?? inferState(cell)
  }

  /**
   * Cicla el estado de una celda: EMPTY ↔ CHECKOUT.
   *
   * Bloquea si:
   *   a) La planificación ya fue confirmada (`planningIsDone`)
   *   b) El servidor ya tiene una tarea activa para esta cama (`cell.taskId`)
   *
   * CHECKOUT_WITH_CHECKIN se trata como CHECKOUT en el ciclo para preservar
   * la marca de urgente al hacer clic — sin este guard el usuario perdería
   * el flag si hace clic accidentalmente.
   */
  function cycleState(
    roomId: string,
    bedId: string,
    cell: DailyPlanningGrid['sharedRooms'][0]['beds'][0],
  ) {
    if (planningIsDone || cell.taskId) return
    const key     = cellKey(roomId, bedId)
    const current = getState(roomId, bedId, cell)
    const base    = current === PlanningCellState.CHECKOUT_WITH_CHECKIN
      ? PlanningCellState.CHECKOUT
      : current
    const idx  = STATE_CYCLE.indexOf(base)
    const next = idx === -1 ? PlanningCellState.CHECKOUT : STATE_CYCLE[(idx + 1) % STATE_CYCLE.length]
    setOverrides((m) => new Map(m).set(key, { state: next, note: m.get(key)?.note ?? '' }))
  }

  /** Alterna el flag "check-in hoy" de una cama marcada para checkout. */
  function toggleUrgente(
    roomId: string,
    bedId: string,
    cell: DailyPlanningGrid['sharedRooms'][0]['beds'][0],
  ) {
    if (planningIsDone || cell.taskId) return
    const key     = cellKey(roomId, bedId)
    const current = getState(roomId, bedId, cell)
    if (
      current !== PlanningCellState.CHECKOUT &&
      current !== PlanningCellState.CHECKOUT_WITH_CHECKIN
    ) return
    const next = current === PlanningCellState.CHECKOUT
      ? PlanningCellState.CHECKOUT_WITH_CHECKIN
      : PlanningCellState.CHECKOUT
    setOverrides((m) => new Map(m).set(key, { state: next, note: m.get(key)?.note ?? '' }))
  }

  function setNote(key: CellKey, note: string) {
    setOverrides((m) => {
      const clone = new Map(m)
      const ex    = clone.get(key) ?? { state: PlanningCellState.EMPTY, note: '' }
      clone.set(key, { ...ex, note })
      return clone
    })
  }

  // ── Datos derivados ───────────────────────────────────────────────────────

  /** Lista plana de todas las camas de la propiedad (shared + private). */
  const allBeds = useMemo(
    () =>
      grid
        ? [...grid.sharedRooms, ...grid.privateRooms].flatMap((r) =>
            r.beds.map((b) => ({ ...b, roomId: r.roomId })),
          )
        : [],
    [grid],
  )

  /**
   * La planificación se considera "hecha" cuando el servidor ya tiene tareas
   * para hoy O cuando el recepcionista confirmó "sin salidas" (localStorage).
   *
   * Por qué NO usar useState(confirmed):
   *   useState muere al desmontar el componente (navegar y volver = flag perdido).
   *   El servidor ya tiene la información — duplicarla en el cliente es innecesario.
   *   localStorage solo se usa para el caso edge "sin salidas hoy" (no hay taskId
   *   que actúe como evidencia en el servidor).
   */
  const planningIsDone =
    allBeds.some((b) => !!b.taskId && !b.cancelled) ||
    localStorage.getItem('planning-no-checkout-confirmed') === TODAY

  // Resumen de camas marcadas para el header de planificación
  const stats = useMemo(
    () =>
      allBeds.reduce(
        (acc, b) => {
          const s = getState(b.roomId, b.bedId, b)
          if (s === PlanningCellState.CHECKOUT_WITH_CHECKIN) acc.urgent++
          else if (s === PlanningCellState.CHECKOUT)         acc.normal++
          return acc
        },
        { urgent: 0, normal: 0 },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allBeds, overrides],
  )

  // Contador para el badge de actividad en la pestaña de tiempo real
  const activeCleaning = allBeds.filter((b) => {
    const s = inferRealtimeState(b)
    return s === 'READY_TO_CLEAN' || s === 'CLEANING'
  }).length

  // ── Confirm handler ───────────────────────────────────────────────────────

  function handleConfirm() {
    const checkouts = allBeds.filter((b) => {
      const s = getState(b.roomId, b.bedId, b)
      return s === PlanningCellState.CHECKOUT || s === PlanningCellState.CHECKOUT_WITH_CHECKIN
    })

    if (checkouts.length === 0) {
      // Día sin salidas: el servidor no tendrá taskIds como evidencia.
      // localStorage (síncrono) persiste entre navegaciones y expira solo
      // al día siguiente cuando TODAY cambia de valor.
      localStorage.setItem('planning-no-checkout-confirmed', TODAY)
      toast.success('Planificación confirmada — sin salidas programadas para hoy')
      setActiveTab('realtime')
      return
    }

    batchMutation.mutate(
      checkouts.map((b) => ({
        bedId:             b.bedId,
        hasSameDayCheckIn: getState(b.roomId, b.bedId, b) === PlanningCellState.CHECKOUT_WITH_CHECKIN,
        notes:             overrides.get(cellKey(b.roomId, b.bedId))?.note || undefined,
      })),
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadingGrid) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        Cargando planificación...
      </div>
    )
  }
  if (!grid) return null

  return (
    <div className="space-y-6">

      {/* ── Encabezado: título + selector de pestañas ─────────────────────── */}

      <div>
        <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Planificación</h1>
            <p className="text-xs text-gray-400 mt-0.5">{TODAY_LABEL}</p>
          </div>

          {/* Botón contextual — solo visible en planificación */}
          {activeTab === 'planning' && (
            <div className="flex items-center gap-3">
              {planningIsDone ? (
                <span className="text-sm text-green-600 font-medium flex items-center gap-1">
                  <span>✓</span> Planificación confirmada
                </span>
              ) : (
                <button
                  onClick={handleConfirm}
                  disabled={batchMutation.isPending}
                  className="btn-primary disabled:opacity-50"
                >
                  {batchMutation.isPending ? 'Confirmando...' : 'Confirmar Planificación'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Selector de pestañas estilo píldora */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('planning')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'planning'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            📋 Planificación del Día
          </button>
          <button
            onClick={() => planningIsDone && setActiveTab('realtime')}
            disabled={!planningIsDone}
            title={!planningIsDone ? 'Confirma la planificación del día primero' : undefined}
            className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'realtime'
                ? 'bg-white text-gray-900 shadow-sm'
                : planningIsDone
                  ? 'text-gray-500 hover:text-gray-700'
                  : 'text-gray-300 cursor-not-allowed'
            }`}
          >
            🔴 Estado en Tiempo Real
            {/* Punto ámbar: indica limpieza en progreso cuando el tab no está activo */}
            {activeCleaning > 0 && activeTab !== 'realtime' && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
            )}
          </button>
        </div>
      </div>

      {/* ══ PESTAÑA 1: PLANIFICACIÓN DEL DÍA ══════════════════════════════════ */}

      {activeTab === 'planning' && (
        <>
          {/* Banner de solo lectura — aparece cuando el usuario vuelve al tab
              después de confirmar. Explica por qué las celdas están bloqueadas
              y ofrece acceso rápido al tiempo real. */}
          {planningIsDone && (
            <div className="flex items-center justify-between gap-4 p-3 bg-green-50 border border-green-200 rounded-xl">
              <div className="flex items-center gap-2">
                <span className="text-green-600 text-lg">✅</span>
                <div>
                  <p className="text-sm font-semibold text-green-800">
                    Planificación del día confirmada
                  </p>
                  <p className="text-xs text-green-600">
                    Housekeeping recibió la lista. Vista de solo lectura — usa
                    "Cancelar" en camas individuales para ajustes.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveTab('realtime')}
                className="shrink-0 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 border border-green-300 rounded-lg px-3 py-1.5 transition-colors"
              >
                Ver tiempo real →
              </button>
            </div>
          )}

          {/* Alerta de discrepancias — alta visibilidad durante planificación matutina */}
          {openDiscrepancies.length > 0 && (
            <DiscrepancyBanner
              discrepancies={openDiscrepancies}
              onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
              isAcknowledging={acknowledgeMutation.isPending}
              acknowledgingId={
                acknowledgeMutation.isPending
                  ? (acknowledgeMutation.variables as string)
                  : null
              }
            />
          )}

          {/* Pastillas de resumen del día */}
          {(stats.urgent > 0 || stats.normal > 0) && (
            <div className="flex flex-wrap gap-2">
              {stats.urgent > 0 && (
                <span className="bg-red-50 text-red-700 border border-red-200 rounded-full px-3 py-1 text-xs font-medium">
                  🔴 {stats.urgent} Urgente{stats.urgent > 1 ? 's' : ''} — Check-in hoy
                </span>
              )}
              {stats.normal > 0 && (
                <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1 text-xs">
                  🚪 {stats.normal} Salida{stats.normal > 1 ? 's' : ''} normal{stats.normal > 1 ? 'es' : ''}
                </span>
              )}
            </div>
          )}

          {/* Leyenda interactiva — replica el ciclo real para onboarding */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-500">
            <span className={`px-2 py-1 rounded border ${STATE_STYLE[PlanningCellState.EMPTY]}`}>Disponible</span>
            <span className="text-gray-400">→ clic →</span>
            <span className={`px-2 py-1 rounded border ${STATE_STYLE[PlanningCellState.CHECKOUT]}`}>Checkout hoy</span>
            <span className="text-gray-400">→ clic →</span>
            <span className={`px-2 py-1 rounded border ${STATE_STYLE[PlanningCellState.EMPTY]}`}>Disponible</span>
            <span className="text-gray-300 mx-1">|</span>
            <span className={`px-2 py-1 rounded border ${STATE_STYLE[PlanningCellState.CHECKOUT_WITH_CHECKIN]}`}>Checkout + Check-in hoy</span>
            <span className="text-gray-400">← botón 🔴 en camas con checkout</span>
          </div>

          {/* Tabla de dormitorios compartidos */}
          {grid.sharedRooms.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Dormitorios Compartidos
              </h2>
              <PlanningTable
                rows={grid.sharedRooms}
                getState={getState}
                cycleState={cycleState}
                toggleUrgente={toggleUrgente}
                noteTarget={noteTarget}
                setNoteTarget={setNoteTarget}
                overrides={overrides}
                setNote={setNote}
                cancelMutation={cancelMutation}
                confirmed={planningIsDone}
              />
            </section>
          )}

          {/* Tabla de habitaciones privadas */}
          {grid.privateRooms.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Habitaciones Privadas
              </h2>
              <PlanningTable
                rows={grid.privateRooms}
                getState={getState}
                cycleState={cycleState}
                toggleUrgente={toggleUrgente}
                noteTarget={noteTarget}
                setNoteTarget={setNoteTarget}
                overrides={overrides}
                setNote={setNote}
                cancelMutation={cancelMutation}
                confirmed={planningIsDone}
              />
            </section>
          )}
        </>
      )}

      {/* ══ PESTAÑA 2: ESTADO EN TIEMPO REAL ══════════════════════════════════ */}

      {activeTab === 'realtime' && (
        <>
          {!planningIsDone ? (
            /* Estado vacío: sin planificación confirmada no hay nada que monitorear */
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="text-5xl mb-4">📋</div>
              <p className="text-base font-semibold text-gray-700 mb-1">
                Sin planificación confirmada
              </p>
              <p className="text-sm text-gray-400 max-w-xs leading-relaxed">
                Confirma la planificación del día en la pestaña anterior para activar
                el monitoreo en tiempo real de habitaciones.
              </p>
              <button onClick={() => setActiveTab('planning')} className="mt-6 btn-primary">
                Ir a Planificación del Día
              </button>
            </div>
          ) : (
            <RealtimeSection
              grid={grid}
              onDepartClick={(checkoutId, bedId, bedLabel, roomNumber, isUrgent) =>
                setDepartTarget({ checkoutId, bedId, bedLabel, roomNumber, isUrgent })
              }
            />
          )}
        </>
      )}

      {/* Modal de confirmación de salida física (Fase 2) */}
      {departTarget && (
        <DepartureModal
          bedLabel={departTarget.bedLabel}
          roomNumber={departTarget.roomNumber}
          isUrgent={departTarget.isUrgent}
          isPending={departMutation.isPending}
          onConfirm={() =>
            departMutation.mutate({
              checkoutId: departTarget.checkoutId,
              bedId:      departTarget.bedId,
            })
          }
          onClose={() => setDepartTarget(null)}
        />
      )}
    </div>
  )
}

// ─── Tipos compartidos entre sub-componentes de planificación ─────────────────

type CellFns = {
  getState:     (roomId: string, bedId: string, cell: DailyPlanningRow['beds'][0]) => PlanningCellState
  cycleState:   (roomId: string, bedId: string, cell: DailyPlanningRow['beds'][0]) => void
  toggleUrgente:(roomId: string, bedId: string, cell: DailyPlanningRow['beds'][0]) => void
  noteTarget:   string | null
  setNoteTarget:(k: string | null) => void
  overrides:    Map<string, CellOverride>
  setNote:      (key: string, note: string) => void
  cancelMutation: { mutate: (id: string) => void; isPending?: boolean }
  confirmed:    boolean
}

// ─── Tabla de planificación ───────────────────────────────────────────────────

/** Tabla de filas de planificación para una categoría de rooms (shared o private). */
function PlanningTable({ rows, ...fns }: { rows: DailyPlanningRow[] } & CellFns) {
  if (!rows.length) return null
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="text-sm border-collapse min-w-full">
        <thead>
          <tr>
            <th className="text-left text-xs text-gray-400 font-medium pr-3 pb-2 pl-1 whitespace-nowrap">
              Habitación
            </th>
            {rows[0].beds.map((b) => (
              <th key={b.bedId} className="text-xs text-gray-400 font-medium px-1 pb-2 whitespace-nowrap">
                {b.bedLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PlanningRow key={row.roomId} row={row} {...fns} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Fila de planificación ────────────────────────────────────────────────────

function PlanningRow({
  row,
  getState, cycleState, toggleUrgente,
  noteTarget, setNoteTarget, overrides, setNote,
  cancelMutation, confirmed,
}: { row: DailyPlanningRow } & CellFns) {
  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="pr-3 py-2 pl-1 text-xs font-medium text-gray-700 whitespace-nowrap">
        {row.roomNumber}
        {row.floor != null && <span className="text-gray-400 ml-1">P{row.floor}</span>}
      </td>
      {row.beds.map((bed) => {
        const key             = cellKey(row.roomId, bed.bedId)
        const state           = getState(row.roomId, bed.bedId, bed)
        const isCheckout      = state === PlanningCellState.CHECKOUT || state === PlanningCellState.CHECKOUT_WITH_CHECKIN
        const isUrgente       = state === PlanningCellState.CHECKOUT_WITH_CHECKIN
        const isServerSaved   = !!bed.taskId && !bed.cancelled   // tarea ya en servidor

        return (
          <td key={bed.bedId} className="px-1 py-1.5 align-top">
            <div className="flex flex-col gap-1 min-w-[96px]">

              {/* Botón principal: cicla Disponible ↔ Checkout.
                  Deshabilitado si el servidor ya guardó la tarea (isServerSaved)
                  o si la planificación fue confirmada (confirmed). */}
              <button
                onClick={() => cycleState(row.roomId, bed.bedId, bed)}
                disabled={isServerSaved || confirmed}
                className={`border rounded px-2 py-1.5 w-full text-center text-xs transition-all select-none
                  ${STATE_STYLE[state]}
                  ${!isServerSaved && !confirmed ? 'cursor-pointer' : 'cursor-default opacity-75'}`}
                title={
                  isServerSaved   ? 'Ya confirmado — planificación enviada a housekeeping' :
                  confirmed       ? 'Planificación cerrada para hoy' :
                  isCheckout      ? 'Clic para cancelar el checkout de esta cama' :
                                    'Clic para marcar esta cama con checkout hoy'
                }
              >
                {STATE_LABEL[state]}
              </button>

              {/* Botón secundario: activa/desactiva el flag de urgencia.
                  Solo visible en celdas con checkout que aún no están en servidor. */}
              {isCheckout && !isServerSaved && (
                <button
                  onClick={() => toggleUrgente(row.roomId, bed.bedId, bed)}
                  className={`text-xs rounded px-2 py-0.5 w-full text-center border transition-colors ${
                    isUrgente
                      ? 'bg-red-100 border-red-300 text-red-700 font-medium'
                      : 'bg-white border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-600'
                  }`}
                >
                  {isUrgente ? '🔴 Check-in hoy' : '+ Check-in hoy'}
                </button>
              )}

              {/* Campo de nota: expandible al hacer clic */}
              {isCheckout && noteTarget !== key && (
                <button
                  onClick={() => setNoteTarget(key)}
                  className="text-xs text-indigo-400 hover:text-indigo-600 text-center"
                >
                  {overrides.get(key)?.note ? '📝 Nota' : '+ Nota'}
                </button>
              )}
              {noteTarget === key && (
                <div className="flex flex-col gap-1">
                  <textarea
                    className="text-xs border border-indigo-200 rounded px-1.5 py-1 w-full resize-none focus:outline-none focus:ring-1 focus:ring-indigo-300"
                    rows={2}
                    placeholder="Nota para housekeeper..."
                    value={overrides.get(key)?.note ?? ''}
                    onChange={(e) => setNote(key, e.target.value)}
                    autoFocus
                  />
                  <button
                    onClick={() => setNoteTarget(null)}
                    className="text-xs text-indigo-600 font-medium hover:text-indigo-800 text-center"
                  >
                    Listo
                  </button>
                </div>
              )}

              {/* Cancelar checkout: solo cuando ya fue confirmado en servidor */}
              {isServerSaved && bed.checkoutId && confirmed && (
                <button
                  onClick={() => cancelMutation.mutate(bed.checkoutId!)}
                  className="text-xs text-red-400 hover:text-red-600 text-center"
                >
                  Cancelar
                </button>
              )}
            </div>
          </td>
        )
      })}
    </tr>
  )
}

// ─── Sección de tiempo real ───────────────────────────────────────────────────

/**
 * Vista de tiempo real del ciclo de checkout.
 *
 * Solo muestra las camas que están en el plan de hoy (taskId presente).
 * Las camas "Disponible" se omiten para mantener el foco operativo.
 *
 * Solo las camas PENDING_DEPARTURE son interactivas: el recepcionista
 * toca la cama cuando el huésped se presenta en el lobby para hacer
 * checkout, lo que activa la limpieza en housekeeping.
 *
 * El parámetro bedId en onDepartClick es crítico: evita que confirmar
 * la salida de una cama active todas las camas del mismo dorm.
 */
function RealtimeSection({
  grid,
  onDepartClick,
}: {
  grid: DailyPlanningGrid
  onDepartClick: (
    checkoutId: string,
    bedId: string,
    bedLabel: string,
    roomNumber: string,
    isUrgent: boolean,
  ) => void
}) {
  // Contadores para el resumen de progreso del día
  const allBedStates = [...grid.sharedRooms, ...grid.privateRooms]
    .flatMap((r) => r.beds.map(inferRealtimeState))

  const counts = {
    PENDING_DEPARTURE: allBedStates.filter((s) => s === 'PENDING_DEPARTURE').length,
    READY_TO_CLEAN:    allBedStates.filter((s) => s === 'READY_TO_CLEAN').length,
    CLEANING:          allBedStates.filter((s) => s === 'CLEANING').length,
    CLEAN:             allBedStates.filter((s) => s === 'CLEAN').length,
  }
  const totalActive = Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-4">

      {/* Resumen de progreso del día */}
      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.entries(RT_CFG) as [RealtimeState, typeof RT_CFG[RealtimeState]][])
          .filter(([state]) => state !== 'AVAILABLE')
          .map(([state, cfg]) => {
            const count = counts[state as keyof typeof counts] ?? 0
            if (count === 0) return null
            return (
              <span
                key={state}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border ${cfg.bg} ${cfg.border} ${cfg.text}`}
              >
                <span className={`w-2 h-2 rounded-full ${cfg.dot} ${state === 'CLEANING' ? 'animate-pulse' : ''}`} />
                {cfg.label} · {count}
              </span>
            )
          })}
      </div>

      {/* Hint contextual según el estado del día */}
      {counts.PENDING_DEPARTURE > 0 && (
        <p className="text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2">
          💡 Toca una cama <strong>"Pendiente de salida"</strong> cuando el huésped se presente en recepción para hacer checkout.
        </p>
      )}
      {totalActive === 0 && (
        <p className="text-xs text-gray-400 text-center py-4">
          Sin camas pendientes en el plan de hoy
        </p>
      )}
      {totalActive > 0 && counts.PENDING_DEPARTURE === 0 && counts.READY_TO_CLEAN === 0 && counts.CLEANING === 0 && (
        <p className="text-xs text-green-600 text-center py-2">
          ✅ Todas las camas del plan están limpias — operación completada
        </p>
      )}

      {/* Dormitorios compartidos */}
      {grid.sharedRooms.some((r) => r.beds.some((b) => b.taskId && !b.cancelled)) && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Dormitorios Compartidos
          </h3>
          <div className="space-y-3">
            {grid.sharedRooms.map((room) => {
              const activeBeds = room.beds.filter((b) => b.taskId && !b.cancelled)
              if (!activeBeds.length) return null

              return (
                <div key={room.roomId} className="bg-white border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-semibold text-gray-900 text-sm">
                      Dorm {room.roomNumber}
                    </span>
                    {room.floor != null && (
                      <span className="text-xs text-gray-400">Piso {room.floor}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeBeds.map((bed) => (
                      <RealtimeBedChip
                        key={bed.bedId}
                        bed={bed}
                        roomNumber={room.roomNumber}
                        onDepartClick={onDepartClick}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Habitaciones privadas */}
      {grid.privateRooms.some((r) => r.beds.some((b) => b.taskId && !b.cancelled)) && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Habitaciones Privadas
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {grid.privateRooms.map((room) => {
              const bed = room.beds.find((b) => b.taskId && !b.cancelled)
              if (!bed) return null
              return (
                <RealtimeBedChip
                  key={room.roomId}
                  bed={bed}
                  roomNumber={room.roomNumber}
                  onDepartClick={onDepartClick}
                  asRoomCard
                />
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Chip de cama en tiempo real ──────────────────────────────────────────────

/**
 * Chip interactivo de cama para la vista de tiempo real.
 *
 * `asRoomCard`: modo habitación privada — muestra el número de habitación
 * como título principal (más relevante que el label de cama).
 *
 * Estados:
 *   PENDING_DEPARTURE → accionable, ring de foco, hint "Toca para confirmar"
 *   Resto             → solo lectura, cursor-default
 *
 * Diseño UX basado en estándar de PMS (Mews, Opera, Cloudbeds):
 *   - "Pendiente de salida" en lugar de "Huésped en habitación" — lenguaje
 *     orientado a la acción pendiente, no al estado estático
 *   - Badge compacto "🔴 Hoy entra" — ocupa menos espacio que una línea completa
 *   - "Toca cuando salga →" separado visualmente — distingue el hint de la acción
 *     del estado descriptivo, evitando ambigüedad sobre cuándo tocar
 */
function RealtimeBedChip({
  bed,
  roomNumber,
  onDepartClick,
  asRoomCard = false,
}: {
  bed: DailyPlanningGrid['sharedRooms'][0]['beds'][0]
  roomNumber: string
  onDepartClick: (
    checkoutId: string,
    bedId: string,
    bedLabel: string,
    roomNumber: string,
    isUrgent: boolean,
  ) => void
  asRoomCard?: boolean
}) {
  const rtState  = inferRealtimeState(bed)
  const cfg      = RT_CFG[rtState]
  const isPending = rtState === 'PENDING_DEPARTURE'

  return (
    <button
      onClick={() => {
        if (isPending && bed.checkoutId) {
          onDepartClick(bed.checkoutId, bed.bedId, bed.bedLabel, roomNumber, bed.hasSameDayCheckIn)
        }
      }}
      disabled={!isPending}
      className={`
        border rounded-xl p-3 text-left transition-all
        ${asRoomCard ? 'w-full' : 'min-w-[110px]'}
        ${cfg.bg} ${cfg.border} ${cfg.text}
        ${isPending
          ? 'cursor-pointer hover:brightness-95 hover:shadow-sm ring-1 ring-indigo-200'
          : 'cursor-default'}
      `}
      title={isPending ? 'Toca cuando el huésped salga' : cfg.label}
    >
      {/* Título: número de habitación (card) o label de cama (chip de dorm) */}
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-bold text-gray-900 leading-tight">
          {asRoomCard ? roomNumber : bed.bedLabel}
        </p>
        {/* Badge urgente — compacto, solo cuando hay check-in el mismo día */}
        {bed.hasSameDayCheckIn && rtState !== 'CLEAN' && (
          <span className="shrink-0 text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 rounded px-1 py-0.5 leading-none">
            🔴 Hoy entra
          </span>
        )}
      </div>

      {/* Estado con indicador visual */}
      <div className="flex items-center gap-1 mt-1">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot} ${
            isPending ? 'animate-pulse' : ''
          }`}
        />
        <span className="text-xs">{cfg.label}</span>
      </div>

      {/* Hint de acción — solo en estado accionable, separado del estado */}
      {isPending && (
        <p className="text-[10px] text-indigo-500 font-medium mt-2 pt-1.5 border-t border-indigo-100">
          Toca cuando salga →
        </p>
      )}
    </button>
  )
}

// ─── Modal de confirmación de salida (Fase 2) ─────────────────────────────────

/**
 * Modal de confirmación de salida física del huésped.
 *
 * Aparece cuando el recepcionista toca una cama PENDING_DEPARTURE.
 * Un solo clic confirma que el huésped salió y activa la limpieza.
 *
 * UX: cabecera en rojo si urgente (check-in hoy), índigo si checkout normal.
 * El CTA principal es siempre el botón "Sí, el huésped salió" para que el
 * recepcionista pueda completar la acción con un solo gesto.
 */
function DepartureModal({
  bedLabel,
  roomNumber,
  isUrgent,
  isPending,
  onConfirm,
  onClose,
}: {
  bedLabel:   string
  roomNumber: string
  isUrgent:   boolean
  isPending:  boolean
  onConfirm:  () => void
  onClose:    () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-5 py-4 border-b border-gray-100 ${isUrgent ? 'bg-red-50' : 'bg-indigo-50'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{roomNumber} · {bedLabel}</p>
              <p className={`text-xs mt-0.5 ${isUrgent ? 'text-red-700 font-medium' : 'text-indigo-700'}`}>
                {isUrgent ? '🔴 Checkout urgente — Check-in hoy' : '🚪 Checkout programado para hoy'}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
              ×
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-700 space-y-1">
            <p>
              ¿El huésped ya <span className="font-semibold">entregó la llave y salió</span> de la habitación?
            </p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Al confirmar, Housekeeping recibirá la notificación inmediatamente.
              {isUrgent && ' Esta cama tiene prioridad máxima — check-in el mismo día.'}
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={onClose} disabled={isPending} className="btn-ghost flex-1">
              Cancelar
            </button>
            <button
              onClick={onConfirm}
              disabled={isPending}
              className={`flex-1 disabled:opacity-50 ${
                isUrgent
                  ? 'bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors'
                  : 'btn-primary'
              }`}
            >
              {isPending ? 'Confirmando...' : 'Sí, el huésped salió'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Banner de discrepancias ──────────────────────────────────────────────────

/**
 * Alerta colapsable de discrepancias abiertas reportadas por housekeeping.
 * Aparece en la pestaña de planificación para máxima visibilidad matutina.
 * Permite reconocer y navegar a la pantalla de resolución sin salir de la página.
 */
function DiscrepancyBanner({
  discrepancies,
  onAcknowledge,
  isAcknowledging,
  acknowledgingId,
}: {
  discrepancies:   BedDiscrepancyDto[]
  onAcknowledge:   (id: string) => void
  isAcknowledging: boolean
  acknowledgingId: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const count = discrepancies.length

  return (
    <div className="bg-amber-50 border border-amber-300 rounded-xl overflow-hidden">
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

      {expanded && (
        <div className="border-t border-amber-200 divide-y divide-amber-100">
          {discrepancies.map((d) => {
            const bedLabel   = d.bed?.label        ?? d.bedId
            const roomNumber = d.bed?.room?.number ?? '—'
            const typeLabel  = DISCREPANCY_LABEL[d.type] ?? d.type
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
