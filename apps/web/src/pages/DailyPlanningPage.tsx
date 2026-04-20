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

import { useState, useMemo, useCallback, type ReactNode } from 'react'
import { BlockModal } from '../components/blocks/BlockModal'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import { useSSE } from '../hooks/useSSE'
import type {
  UnitDiscrepancyDto,
  DailyPlanningGrid,
  DailyPlanningRow,
  PropertySettingsDto,
  SseEvent,
} from '@zenix/shared'
import { CleaningStatus, DiscrepancyStatus, PlanningCellState } from '@zenix/shared'

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

/** Clave compuesta "roomId:unitId" que identifica una celda en la tabla. */
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
function cellKey(roomId: string, unitId: string): CellKey {
  return `${roomId}:${unitId}`
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
function inferState(cell: DailyPlanningGrid['sharedRooms'][0]['units'][0]): PlanningCellState {
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
function inferRealtimeState(bed: DailyPlanningGrid['sharedRooms'][0]['units'][0]): RealtimeState {
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
   * Unidad pendiente de confirmación de salida (modal de Fase 2).
   * Incluye unitId para activar solo esa unidad, no todas las del dorm.
   */
  const [departTarget, setDepartTarget] = useState<{
    checkoutId: string
    unitId: string           // Unidad específica a activar (evita activar todo el dorm)
    unitLabel: string
    roomNumber: string
    isUrgent: boolean
  } | null>(null)

  /**
   * Set de roomIds colapsados. Vacío por default = todas las habitaciones abiertas.
   * Usamos "collapsed" en lugar de "expanded" para evitar pre-popular el Set al cargar.
   */
  const [collapsedRooms, setCollapsedRooms] = useState<Set<string>>(new Set())
  const toggleRoom = useCallback((roomId: string) => {
    setCollapsedRooms((prev) => {
      const next = new Set(prev)
      if (next.has(roomId)) next.delete(roomId)
      else next.add(roomId)
      return next
    })
  }, [])

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

  const { data: openDiscrepancies = [] } = useQuery<UnitDiscrepancyDto[]>({
    queryKey: ['discrepancies-open'],
    queryFn: async () => {
      const all = await api.get<UnitDiscrepancyDto[]>('/discrepancies')
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
    mutationFn: (items: { unitId: string; hasSameDayCheckIn: boolean; notes?: string }[]) =>
      api.post('/checkouts/batch', { checkoutDate: TODAY, items }),
    onSuccess: async () => {
      await qc.refetchQueries({ queryKey: ['daily-grid', TODAY] })
      toast.success('Planificación confirmada — Housekeeping recibió la lista de salidas')
      setActiveTab('realtime')
    },
    onError: () => toast.error('Error al confirmar la planificación'),
  })

  const [cancelTarget, setCancelTarget] = useState<{
    checkoutId: string
    unitId: string
    unitLabel: string
    roomNumber: string
  } | null>(null)

  const [undoTarget, setUndoTarget] = useState<{
    checkoutId: string
    unitId: string
    unitLabel: string
    roomNumber: string
  } | null>(null)

  const cancelMutation = useMutation({
    mutationFn: ({ checkoutId, unitId }: { checkoutId: string; unitId: string }) =>
      api.patch(`/checkouts/${checkoutId}/cancel`, { unitId }),
    onSuccess: () => {
      toast.success('Checkout cancelado — la unidad vuelve a Disponible')
      setCancelTarget(null)
      qc.invalidateQueries({ queryKey: ['daily-grid', TODAY] })
    },
    onError: () => toast.error('Error al cancelar'),
  })

  /**
   * Fase 2 — Confirma la salida física del huésped (activa limpieza).
   *
   * Se envía unitId para activar SOLO la unidad que el recepcionista confirmó.
   * Sin unitId, el backend activaría TODAS las unidades del checkout — en un
   * dorm de 6 camas eso activaría las 6 aunque solo salió un huésped.
   */
  const departMutation = useMutation({
    mutationFn: ({ checkoutId, unitId }: { checkoutId: string; unitId: string }) =>
      api.post(`/checkouts/${checkoutId}/depart`, { unitId }),
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

  /**
   * Revierte la confirmación de salida (Caso 2 — error humano).
   * Solo disponible mientras la tarea esté READY/UNASSIGNED (antes de que
   * housekeeping empiece a limpiar). La tarea vuelve a PENDING_DEPARTURE.
   */
  const undoMutation = useMutation({
    mutationFn: ({ checkoutId, unitId }: { checkoutId: string; unitId: string }) =>
      api.post(`/checkouts/${checkoutId}/undo-depart`, { unitId }),
    onSuccess: () => {
      toast.success('Salida revertida — la unidad vuelve a "Pendiente de salida"')
      setUndoTarget(null)
      qc.invalidateQueries({ queryKey: ['daily-grid', TODAY] })
    },
    onError: () => toast.error('Error al revertir la salida'),
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/discrepancies/${id}/acknowledge`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['discrepancies-open'] })
      toast.success('Discrepancia reconocida — en revisión')
    },
    onError: () => toast.error('Error al reconocer'),
  })

  // ── SmartBlock modal state ────────────────────────────────────────────────

  /**
   * blockTarget: prefill para el modal de bloqueo abierto desde una celda.
   * null = modal cerrado.
   *
   * Se asigna al singleton `_openBlockModal` para que los sub-componentes
   * (BlockTrigger) puedan abrir el modal sin prop drilling.
   */
  const [blockTarget, setBlockTarget] = useState<{ roomId: string; unitId: string } | null>(null)
  _openBlockModal = (roomId, unitId) => setBlockTarget({ roomId, unitId })

  // ── Helpers de planificación ──────────────────────────────────────────────

  /**
   * Retorna el estado efectivo de una celda.
   *
   * Regla de precedencia:
   *   - Si el servidor ya tiene una tarea para esta cama (cell.taskId set), el
   *     servidor es la fuente de verdad — ignorar el override local. Esto evita
   *     que overrides de una sesión de planificación anterior (ya confirmada y
   *     luego cancelada) bloqueen visualmente la re-planificación.
   *   - Si no hay tarea en el servidor (cell.taskId null), el override local es
   *     la única fuente de estado (planificación en curso, aún no confirmada).
   */
  function getState(
    roomId: string,
    unitId: string,
    cell: DailyPlanningGrid['sharedRooms'][0]['units'][0],
  ): PlanningCellState {
    // Server is authoritative when an active (non-cancelled) task exists.
    // Cancelled tasks are treated as if no task exists — the cell is editable
    // and the override (if any) takes precedence.
    if (cell.taskId && !cell.cancelled) return inferState(cell)
    return overrides.get(cellKey(roomId, unitId))?.state ?? inferState(cell)
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
    unitId: string,
    cell: DailyPlanningGrid['sharedRooms'][0]['units'][0],
  ) {
    // Allow cycling if the existing task was cancelled (unit is re-plannable)
    if (planningIsDone || (cell.taskId && !cell.cancelled)) return
    const key     = cellKey(roomId, unitId)
    const current = getState(roomId, unitId, cell)
    const base    = current === PlanningCellState.CHECKOUT_WITH_CHECKIN
      ? PlanningCellState.CHECKOUT
      : current
    const idx  = STATE_CYCLE.indexOf(base)
    const next = idx === -1 ? PlanningCellState.CHECKOUT : STATE_CYCLE[(idx + 1) % STATE_CYCLE.length]
    setOverrides((m) => new Map(m).set(key, { state: next, note: m.get(key)?.note ?? '' }))
  }

  /** Alterna el flag "check-in hoy" de una unidad marcada para checkout. */
  function toggleUrgente(
    roomId: string,
    unitId: string,
    cell: DailyPlanningGrid['sharedRooms'][0]['units'][0],
  ) {
    if (planningIsDone || (cell.taskId && !cell.cancelled)) return
    const key     = cellKey(roomId, unitId)
    const current = getState(roomId, unitId, cell)
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

  /** Lista plana de todas las unidades de la propiedad (shared + private). */
  const allBeds = useMemo(
    () =>
      grid
        ? [...grid.sharedRooms, ...grid.privateRooms].flatMap((r) =>
            r.units.map((b) => ({ ...b, roomId: r.roomId })),
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

  // Resumen de unidades marcadas para el header de planificación
  const stats = useMemo(
    () =>
      allBeds.reduce(
        (acc, b) => {
          const s = getState(b.roomId, b.unitId, b)
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
      const s = getState(b.roomId, b.unitId, b)
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
        unitId:            b.unitId,
        hasSameDayCheckIn: getState(b.roomId, b.unitId, b) === PlanningCellState.CHECKOUT_WITH_CHECKIN,
        notes:             overrides.get(cellKey(b.roomId, b.unitId))?.note || undefined,
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
          {planningIsDone && (
            <div className="flex items-center justify-between gap-3 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
              <span className="text-sm text-green-700 font-medium flex items-center gap-1.5">
                ✅ Planificación confirmada — solo lectura
              </span>
              <button
                onClick={() => setActiveTab('realtime')}
                className="shrink-0 text-xs font-medium text-green-700 bg-green-100 hover:bg-green-200 border border-green-300 rounded-lg px-3 py-1.5 transition-colors"
              >
                Tiempo real →
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

          {/* Resumen compacto del día */}
          {(stats.urgent > 0 || stats.normal > 0) && (
            <div className="flex flex-wrap gap-2">
              {stats.urgent > 0 && (
                <span className="bg-red-50 text-red-700 border border-red-200 rounded-full px-3 py-1 text-xs font-medium">
                  🔴 {stats.urgent} urgente{stats.urgent > 1 ? 's' : ''}
                </span>
              )}
              {stats.normal > 0 && (
                <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-3 py-1 text-xs">
                  🚪 {stats.normal} salida{stats.normal > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}

          {/* Tabla de dormitorios compartidos */}
          {grid.sharedRooms.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Dormitorios Compartidos
              </h2>
              <PlanningTable
                rows={grid.sharedRooms}
                collapsedRooms={collapsedRooms}
                toggleRoom={toggleRoom}
                getState={getState}
                cycleState={cycleState}
                toggleUrgente={toggleUrgente}
                noteTarget={noteTarget}
                setNoteTarget={setNoteTarget}
                overrides={overrides}
                setNote={setNote}
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
                layout="grid"
                collapsedRooms={collapsedRooms}
                toggleRoom={toggleRoom}
                getState={getState}
                cycleState={cycleState}
                toggleUrgente={toggleUrgente}
                noteTarget={noteTarget}
                setNoteTarget={setNoteTarget}
                overrides={overrides}
                setNote={setNote}
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
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-sm text-gray-500 mb-4">
                Confirma la planificación para activar el monitoreo.
              </p>
              <button onClick={() => setActiveTab('planning')} className="btn-primary text-sm">
                Ir a Planificación
              </button>
            </div>
          ) : (
            <RealtimeSection
              grid={grid}
              collapsedRooms={collapsedRooms}
              toggleRoom={toggleRoom}
              onDepartClick={(checkoutId, unitId, unitLabel, roomNumber, isUrgent) =>
                setDepartTarget({ checkoutId, unitId, unitLabel, roomNumber, isUrgent })
              }
              onCancelClick={(checkoutId, unitId, unitLabel, roomNumber) =>
                setCancelTarget({ checkoutId, unitId, unitLabel, roomNumber })
              }
              onUndoClick={(checkoutId, unitId, unitLabel, roomNumber) =>
                setUndoTarget({ checkoutId, unitId, unitLabel, roomNumber })
              }
            />
          )}
        </>
      )}

      {/* Modal de reversión de salida (error humano — tarea aún no iniciada) */}
      {undoTarget && (
        <UndoModal
          unitLabel={undoTarget.unitLabel}
          roomNumber={undoTarget.roomNumber}
          isPending={undoMutation.isPending}
          onConfirm={() =>
            undoMutation.mutate({
              checkoutId: undoTarget.checkoutId,
              unitId:     undoTarget.unitId,
            })
          }
          onClose={() => setUndoTarget(null)}
        />
      )}

      {/* Modal de cancelación de checkout por unidad (huésped extendió estadía) */}
      {cancelTarget && (
        <CancelModal
          unitLabel={cancelTarget.unitLabel}
          roomNumber={cancelTarget.roomNumber}
          isPending={cancelMutation.isPending}
          onConfirm={() =>
            cancelMutation.mutate({
              checkoutId: cancelTarget.checkoutId,
              unitId:     cancelTarget.unitId,
            })
          }
          onClose={() => setCancelTarget(null)}
        />
      )}

      {/* Modal de confirmación de salida física (Fase 2) */}
      {departTarget && (
        <DepartureModal
          unitLabel={departTarget.unitLabel}
          roomNumber={departTarget.roomNumber}
          isUrgent={departTarget.isUrgent}
          isPending={departMutation.isPending}
          onConfirm={() =>
            departMutation.mutate({
              checkoutId: departTarget.checkoutId,
              unitId:     departTarget.unitId,
            })
          }
          onClose={() => setDepartTarget(null)}
        />
      )}

      {/* Modal de bloqueo de cama/habitación (SmartBlock) */}
      <BlockModal
        isOpen={blockTarget !== null}
        onClose={() => setBlockTarget(null)}
        onSubmit={async (dto) => {
          await api.post('/blocks', dto)
          qc.invalidateQueries({ queryKey: ['blocks'] })
          setBlockTarget(null)
          toast.success('Solicitud de bloqueo creada')
        }}
        prefillRoomId={blockTarget?.roomId}
        prefillUnitId={blockTarget?.unitId}
      />
    </div>
  )
}

// ─── SmartBlock trigger (contextual desde planning grid) ─────────────────────

/**
 * Módulo-level state para el modal de bloqueo.
 * Usamos un patrón de "singleton de modal" en vez de Context para mantener
 * el DailyPlanningPage auto-contenido y evitar prop drilling innecesario.
 */
let _openBlockModal: ((roomId: string, unitId: string) => void) | null = null

/**
 * BlockTrigger — botón 🔒 que abre el modal de bloqueo con prefill.
 * Se usa dentro de las tarjetas de planificación sin necesidad de props
 * adicionales gracias al patrón de singleton de handler.
 */
function BlockTrigger({ roomId, unitId, label = '🔒' }: { roomId: string; unitId?: string; label?: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        _openBlockModal?.(roomId, unitId ?? '')
      }}
      title="Bloquear unidad/habitación"
      className="text-xs text-gray-400 hover:text-indigo-600 px-1 py-0.5 rounded hover:bg-indigo-50 transition-colors"
    >
      {label}
    </button>
  )
}

// ─── Tipos compartidos entre sub-componentes de planificación ─────────────────

type CellFns = {
  getState:     (roomId: string, unitId: string, cell: DailyPlanningRow['units'][0]) => PlanningCellState
  cycleState:   (roomId: string, unitId: string, cell: DailyPlanningRow['units'][0]) => void
  toggleUrgente:(roomId: string, unitId: string, cell: DailyPlanningRow['units'][0]) => void
  noteTarget:   string | null
  setNoteTarget:(k: string | null) => void
  overrides:    Map<string, CellOverride>
  setNote:      (key: string, note: string) => void
  confirmed:    boolean
}

// ─── Acordeón de habitación ────────────────────────────────────────────────────

/**
 * Wrapper colapsable para cada habitación/dormitorio.
 * Por defecto todas las habitaciones están abiertas (collapsedRooms vacío).
 * Cumple ARIA APG accordion: aria-expanded, aria-controls, hidden en panel.
 */
function RoomAccordion({
  roomId,
  expanded,
  onToggle,
  header,
  summary,
  children,
}: {
  roomId: string
  expanded: boolean
  onToggle: () => void
  header: ReactNode
  summary: ReactNode
  children: ReactNode
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`room-panel-${roomId}`}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">{header}</div>
        <div className="flex items-center gap-3 shrink-0">
          {!expanded && <div className="text-xs">{summary}</div>}
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      <div
        id={`room-panel-${roomId}`}
        className={`grid transition-[grid-template-rows] duration-[220ms] ease-spring motion-reduce:duration-0 ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}

// ─── Tarjeta de habitación privada (planificación) ────────────────────────────

/**
 * Tarjeta compacta para habitaciones privadas en la vista de planificación.
 * Sin acordeón: la habitación privada siempre tiene 1 cama y se limpia completa.
 * El borde y el header cambian de color según el estado para comunicar visualmente
 * sin necesidad de leer el texto del botón.
 */
function PrivatePlanningCard({
  row,
  getState, cycleState, toggleUrgente,
  noteTarget, setNoteTarget, overrides, setNote,
  confirmed,
}: { row: DailyPlanningRow } & CellFns) {
  const unit = row.units[0]
  if (!unit) return null

  const key           = cellKey(row.roomId, unit.unitId)
  const state         = getState(row.roomId, unit.unitId, unit)
  const isCheckout    = state === PlanningCellState.CHECKOUT || state === PlanningCellState.CHECKOUT_WITH_CHECKIN
  const isUrgente     = state === PlanningCellState.CHECKOUT_WITH_CHECKIN
  const isServerSaved = !!unit.taskId && !unit.cancelled

  const cardBorder = isUrgente ? 'border-red-300'  : isCheckout ? 'border-amber-300'  : 'border-gray-200'
  const headerCls  = isUrgente ? 'bg-red-50 border-b border-red-200' : isCheckout ? 'bg-amber-50 border-b border-amber-200' : 'bg-gray-50 border-b border-gray-100'

  return (
    <div className={`border rounded-xl overflow-hidden bg-white ${cardBorder}`}>

      {/* Header: número de habitación + piso */}
      <div className={`px-3 py-2 flex items-center justify-between ${headerCls}`}>
        <span className="font-semibold text-sm text-gray-900">{row.roomNumber}</span>
        <div className="flex items-center gap-2">
          {row.floor != null && (
            <span className="text-xs text-gray-400">P{row.floor}</span>
          )}
          <BlockTrigger roomId={row.roomId} unitId={unit.unitId} label="🔒" />
        </div>
      </div>

      {/* Cuerpo: estado + acciones */}
      <div className="p-3 flex flex-col gap-1.5">
        <button
          onClick={() => cycleState(row.roomId, unit.unitId, unit)}
          disabled={isServerSaved || confirmed}
          className={`border rounded px-2 py-2 w-full text-center text-xs transition-all select-none
            ${STATE_STYLE[state]}
            ${!isServerSaved && !confirmed ? 'cursor-pointer' : 'cursor-default opacity-75'}`}
          title={
            isServerSaved ? 'Ya confirmado — planificación enviada a housekeeping' :
            confirmed     ? 'Planificación cerrada para hoy' :
            isCheckout    ? 'Clic para cancelar el checkout' :
                            'Clic para marcar con checkout hoy'
          }
        >
          {STATE_LABEL[state]}
        </button>

        {isCheckout && !isServerSaved && (
          <button
            onClick={() => toggleUrgente(row.roomId, unit.unitId, unit)}
            className={`text-xs rounded px-2 py-0.5 w-full text-center border transition-colors ${
              isUrgente
                ? 'bg-red-100 border-red-300 text-red-700 font-medium'
                : 'bg-white border-gray-200 text-gray-400 hover:border-amber-300 hover:text-amber-600'
            }`}
          >
            {isUrgente ? '🔴 Check-in hoy' : '+ Check-in hoy'}
          </button>
        )}

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

      </div>
    </div>
  )
}

// ─── Tabla de planificación ───────────────────────────────────────────────────

/** Lista o grid de tarjetas de planificación para una categoría de rooms. */
function PlanningTable({
  rows,
  collapsedRooms,
  toggleRoom,
  layout = 'list',
  ...fns
}: { rows: DailyPlanningRow[]; collapsedRooms: Set<string>; toggleRoom: (id: string) => void; layout?: 'list' | 'grid' } & CellFns) {
  if (!rows.length) return null

  if (layout === 'grid') {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {rows.map((row) => (
          <PrivatePlanningCard key={row.roomId} row={row} {...fns} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <PlanningRow
          key={row.roomId}
          row={row}
          expanded={!collapsedRooms.has(row.roomId)}
          onToggle={() => toggleRoom(row.roomId)}
          {...fns}
        />
      ))}
    </div>
  )
}

// ─── Fila de planificación ────────────────────────────────────────────────────

function PlanningRow({
  row,
  expanded,
  onToggle,
  getState, cycleState, toggleUrgente,
  noteTarget, setNoteTarget, overrides, setNote,
  confirmed,
}: { row: DailyPlanningRow; expanded: boolean; onToggle: () => void } & CellFns) {
  const checkoutCount = row.units.filter((b) => {
    const s = getState(row.roomId, b.unitId, b)
    return s === PlanningCellState.CHECKOUT || s === PlanningCellState.CHECKOUT_WITH_CHECKIN
  }).length
  const urgentCount = row.units.filter(
    (b) => getState(row.roomId, b.unitId, b) === PlanningCellState.CHECKOUT_WITH_CHECKIN,
  ).length

  return (
    <RoomAccordion
      roomId={row.roomId}
      expanded={expanded}
      onToggle={onToggle}
      header={
        <>
          <span className="font-semibold text-sm text-gray-900">{row.roomNumber}</span>
          {row.floor != null && (
            <span className="text-xs text-gray-400">P{row.floor}</span>
          )}
          <span className="text-gray-200">·</span>
          <span className="text-xs text-gray-400">
            {row.units.length} cama{row.units.length !== 1 ? 's' : ''}
          </span>
        </>
      }
      summary={
        checkoutCount > 0 ? (
          <span className="flex items-center gap-2">
            <span className="text-amber-600 font-medium">
              {checkoutCount} checkout{checkoutCount !== 1 ? 's' : ''}
            </span>
            {urgentCount > 0 && (
              <span className="text-red-600 font-medium">· {urgentCount} 🔴</span>
            )}
          </span>
        ) : (
          <span className="text-gray-400">Sin salidas</span>
        )
      }
    >
      <div className="px-4 pb-4 pt-1">
        <div className="flex flex-wrap gap-3">
          {row.units.map((unit) => {
            const key           = cellKey(row.roomId, unit.unitId)
            const state         = getState(row.roomId, unit.unitId, unit)
            const isCheckout    = state === PlanningCellState.CHECKOUT || state === PlanningCellState.CHECKOUT_WITH_CHECKIN
            const isUrgente     = state === PlanningCellState.CHECKOUT_WITH_CHECKIN
            const isServerSaved = !!unit.taskId && !unit.cancelled

            return (
              <div key={unit.unitId} className="flex flex-col gap-1 min-w-[100px]">

                {/* Label de unidad + trigger de bloqueo */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500 font-medium">{unit.unitLabel}</p>
                  <BlockTrigger roomId={row.roomId} unitId={unit.unitId} />
                </div>

                {/* Botón principal: cicla Disponible ↔ Checkout.
                    Deshabilitado si el servidor ya guardó la tarea (isServerSaved)
                    o si la planificación fue confirmada (confirmed). */}
                <button
                  onClick={() => cycleState(row.roomId, unit.unitId, unit)}
                  disabled={isServerSaved || confirmed}
                  className={`border rounded px-2 py-1.5 w-full text-center text-xs transition-all select-none
                    ${STATE_STYLE[state]}
                    ${!isServerSaved && !confirmed ? 'cursor-pointer' : 'cursor-default opacity-75'}`}
                  title={
                    isServerSaved   ? 'Ya confirmado — planificación enviada a housekeeping' :
                    confirmed       ? 'Planificación cerrada para hoy' :
                    isCheckout      ? 'Clic para cancelar el checkout de esta unidad' :
                                      'Clic para marcar esta unidad con checkout hoy'
                  }
                >
                  {STATE_LABEL[state]}
                </button>

                {/* Botón secundario: activa/desactiva el flag de urgencia */}
                {isCheckout && !isServerSaved && (
                  <button
                    onClick={() => toggleUrgente(row.roomId, unit.unitId, unit)}
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

              </div>
            )
          })}
        </div>
      </div>
    </RoomAccordion>
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
  collapsedRooms,
  toggleRoom,
  onDepartClick,
  onCancelClick,
  onUndoClick,
}: {
  grid: DailyPlanningGrid
  collapsedRooms: Set<string>
  toggleRoom: (id: string) => void
  onDepartClick: (
    checkoutId: string,
    unitId: string,
    unitLabel: string,
    roomNumber: string,
    isUrgent: boolean,
  ) => void
  onCancelClick: (
    checkoutId: string,
    unitId: string,
    unitLabel: string,
    roomNumber: string,
  ) => void
  onUndoClick: (
    checkoutId: string,
    unitId: string,
    unitLabel: string,
    roomNumber: string,
  ) => void
}) {
  // Contadores para el resumen de progreso del día
  const allBedStates = [...grid.sharedRooms, ...grid.privateRooms]
    .flatMap((r) => r.units.map(inferRealtimeState))

  const counts = {
    PENDING_DEPARTURE: allBedStates.filter((s) => s === 'PENDING_DEPARTURE').length,
    READY_TO_CLEAN:    allBedStates.filter((s) => s === 'READY_TO_CLEAN').length,
    CLEANING:          allBedStates.filter((s) => s === 'CLEANING').length,
    CLEAN:             allBedStates.filter((s) => s === 'CLEAN').length,
  }
  const totalActive = Object.values(counts).reduce((a, b) => a + b, 0)

  /** Resumen de estado para el header colapsado de un dorm. */
  function roomStateSummary(units: DailyPlanningGrid['sharedRooms'][0]['units']): ReactNode {
    const activeBeds = units.filter((b) => b.taskId && !b.cancelled)
    if (!activeBeds.length) return <span className="text-gray-400">Sin actividad</span>
    const stateCounts = activeBeds.reduce<Partial<Record<RealtimeState, number>>>((acc, b) => {
      const s = inferRealtimeState(b)
      acc[s] = (acc[s] ?? 0) + 1
      return acc
    }, {})
    const allClean = Object.keys(stateCounts).every((s) => s === 'CLEAN')
    if (allClean) return <span className="text-green-600 font-medium">✅ Lista</span>
    return (
      <span className="flex items-center gap-2">
        {(Object.entries(stateCounts) as [RealtimeState, number][]).map(([state, count]) => {
          const cfg = RT_CFG[state]
          return (
            <span key={state} className={`flex items-center gap-1 ${cfg.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
              {count}
            </span>
          )
        })}
      </span>
    )
  }

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

      {totalActive === 0 && (
        <p className="text-xs text-gray-400 text-center py-4">
          Sin actividad en el plan de hoy
        </p>
      )}
      {totalActive > 0 && counts.PENDING_DEPARTURE === 0 && counts.READY_TO_CLEAN === 0 && counts.CLEANING === 0 && (
        <p className="text-xs text-green-600 text-center py-2">
          ✅ Operación completada
        </p>
      )}

      {/* Dormitorios compartidos */}
      {grid.sharedRooms.some((r) => r.units.some((b) => b.taskId && !b.cancelled)) && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Dormitorios Compartidos
          </h3>
          <div className="space-y-2">
            {grid.sharedRooms.map((room) => {
              const activeBeds = room.units.filter((b) => b.taskId && !b.cancelled)
              if (!activeBeds.length) return null
              return (
                <RoomAccordion
                  key={room.roomId}
                  roomId={room.roomId}
                  expanded={!collapsedRooms.has(room.roomId)}
                  onToggle={() => toggleRoom(room.roomId)}
                  header={
                    <>
                      <span className="font-semibold text-gray-900 text-sm">
                        Dorm {room.roomNumber}
                      </span>
                      {room.floor != null && (
                        <span className="text-xs text-gray-400">Piso {room.floor}</span>
                      )}
                      <span className="text-gray-200">·</span>
                      <span className="text-xs text-gray-400">
                        {activeBeds.length} cama{activeBeds.length !== 1 ? 's' : ''}
                      </span>
                    </>
                  }
                  summary={roomStateSummary(room.units)}
                >
                  <div className="px-4 pb-4 pt-1 flex flex-wrap gap-2">
                    {activeBeds.map((unit) => (
                      <RealtimeBedChip
                        key={unit.unitId}
                        bed={unit}
                        roomNumber={room.roomNumber}
                        onDepartClick={onDepartClick}
                        onCancelClick={onCancelClick}
                        onUndoClick={onUndoClick}
                      />
                    ))}
                  </div>
                </RoomAccordion>
              )
            })}
          </div>
        </section>
      )}

      {/* Habitaciones privadas — grid compacto sin accordion (1 unidad por room) */}
      {grid.privateRooms.some((r) => r.units.some((b) => b.taskId && !b.cancelled)) && (
        <section>
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Habitaciones Privadas
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {grid.privateRooms.map((room) => {
              const unit = room.units.find((b) => b.taskId && !b.cancelled)
              if (!unit) return null
              return (
                <RealtimeBedChip
                  key={room.roomId}
                  bed={unit}
                  roomNumber={room.roomNumber}
                  onDepartClick={onDepartClick}
                  onCancelClick={onCancelClick}
                  onUndoClick={onUndoClick}
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
  onCancelClick,
  onUndoClick,
  asRoomCard = false,
}: {
  bed: DailyPlanningGrid['sharedRooms'][0]['units'][0]
  roomNumber: string
  onDepartClick: (
    checkoutId: string,
    unitId: string,
    unitLabel: string,
    roomNumber: string,
    isUrgent: boolean,
  ) => void
  onCancelClick: (
    checkoutId: string,
    unitId: string,
    unitLabel: string,
    roomNumber: string,
  ) => void
  onUndoClick: (
    checkoutId: string,
    unitId: string,
    unitLabel: string,
    roomNumber: string,
  ) => void
  asRoomCard?: boolean
}) {
  const rtState      = inferRealtimeState(bed)
  const cfg          = RT_CFG[rtState]
  const isPending    = rtState === 'PENDING_DEPARTURE'
  const isReadyClean = rtState === 'READY_TO_CLEAN'

  return (
    <div
      className={`
        border rounded-xl p-3 text-left transition-all
        ${asRoomCard ? '' : 'min-w-[110px]'}
        ${cfg.bg} ${cfg.border} ${cfg.text}
      `}
    >
      {/* Título: número de habitación (card) o label de unidad (chip de dorm) */}
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-bold text-gray-900 leading-tight">
          {asRoomCard ? roomNumber : bed.unitLabel}
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

      {/* Acciones según estado */}
      {isPending && bed.checkoutId && (
        <div className="mt-2 pt-1.5 border-t border-indigo-100 flex flex-col gap-1">
          <button
            onClick={() =>
              onDepartClick(bed.checkoutId!, bed.unitId, bed.unitLabel, roomNumber, bed.hasSameDayCheckIn)
            }
            className="text-[10px] text-indigo-500 font-medium hover:text-indigo-700 text-left"
          >
            Toca cuando salga →
          </button>
          <button
            onClick={() =>
              onCancelClick(bed.checkoutId!, bed.unitId, bed.unitLabel, roomNumber)
            }
            className="text-[10px] text-red-400 hover:text-red-600 text-left"
          >
            Cancelar checkout
          </button>
        </div>
      )}

      {/* Revertir salida — solo mientras la limpieza no haya iniciado (READY/UNASSIGNED) */}
      {isReadyClean && bed.checkoutId && (
        <div className="mt-2 pt-1.5 border-t border-amber-100 flex flex-col gap-1">
          <p className="text-[10px] text-amber-600">Esperando housekeeper</p>
          <button
            onClick={() =>
              onUndoClick(bed.checkoutId!, bed.unitId, bed.unitLabel, roomNumber)
            }
            className="text-[10px] text-amber-500 hover:text-amber-700 text-left"
          >
            ↩ Revertir salida
          </button>
        </div>
      )}
    </div>
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
  unitLabel,
  roomNumber,
  isUrgent,
  isPending,
  onConfirm,
  onClose,
}: {
  unitLabel:  string
  roomNumber: string
  isUrgent:   boolean
  isPending:  boolean
  onConfirm:  () => void
  onClose:    () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm "
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden "
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-5 py-4 border-b border-gray-100 ${isUrgent ? 'bg-red-50' : 'bg-indigo-50'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{roomNumber} · {unitLabel}</p>
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

// ─── Modal de cancelación de checkout por cama ────────────────────────────────

/**
 * Modal de confirmación para cancelar el checkout de una cama específica.
 * Aparece solo para camas en estado PENDING_DEPARTURE (Fase 1 completada, Fase 2 pendiente).
 * Cancelar en este punto NO afecta otras camas del mismo dorm — es per-bed.
 */
function CancelModal({
  unitLabel,
  roomNumber,
  isPending,
  onConfirm,
  onClose,
}: {
  unitLabel:  string
  roomNumber: string
  isPending:  boolean
  onConfirm:  () => void
  onClose:    () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm "
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{roomNumber} · {unitLabel}</p>
              <p className="text-xs text-gray-500 mt-0.5">Cancelar checkout de esta unidad</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
              ×
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-700 space-y-1">
            <p>¿El huésped <span className="font-semibold">extendió su estadía</span>?</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Solo se cancela esta cama. Las demás camas del dormitorio no se ven afectadas.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={onClose} disabled={isPending} className="btn-ghost flex-1">
              Volver
            </button>
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isPending ? 'Cancelando...' : 'Sí, cancelar checkout'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Modal de reversión de salida (undo departure) ────────────────────────────

/**
 * Modal de confirmación para revertir la confirmación de salida.
 * Solo disponible mientras la tarea está READY/UNASSIGNED (antes de que
 * housekeeping inicie la limpieza).
 *
 * UX: lenguaje claro sobre el efecto — la cama vuelve a "Pendiente de salida"
 * y housekeeping es notificada de que aún no debe limpiar.
 */
function UndoModal({
  unitLabel,
  roomNumber,
  isPending,
  onConfirm,
  onClose,
}: {
  unitLabel:  string
  roomNumber: string
  isPending:  boolean
  onConfirm:  () => void
  onClose:    () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm "
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden "
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-gray-100 bg-amber-50">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{roomNumber} · {unitLabel}</p>
              <p className="text-xs text-amber-700 mt-0.5">↩ Revertir confirmación de salida</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">
              ×
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-700 space-y-1">
            <p>¿El huésped <span className="font-semibold">aún no ha salido</span>?</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              La cama volverá a "Pendiente de salida". Si hay housekeeper asignado,
              recibirá una notificación para que espere.
            </p>
            <p className="text-xs text-amber-600 leading-relaxed">
              Solo disponible antes de que inicie la limpieza.
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={onClose} disabled={isPending} className="btn-ghost flex-1">
              Volver
            </button>
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isPending ? 'Revirtiendo...' : 'Sí, revertir salida'}
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
  discrepancies:   UnitDiscrepancyDto[]
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
            const unitLabel  = d.unit?.label       ?? d.unitId
            const roomNumber = d.unit?.room?.number ?? '—'
            const typeLabel  = DISCREPANCY_LABEL[d.type] ?? d.type
            const isThisOne  = isAcknowledging && acknowledgingId === d.id

            return (
              <div key={d.id} className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">
                      Hab. {roomNumber} · {unitLabel}
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
