import {
  BedStatus,
  BlockLogEvent,
  BlockReason,
  BlockSemantic,
  BlockStatus,
  Capability,
  CheckoutSource,
  CleaningStatus,
  DiscrepancyStatus,
  DiscrepancyType,
  HousekeepingRole,
  MaintenanceCategory,
  PmsMode,
  Priority,
  RoomCategory,
  TaskLogEvent,
  TaskType,
} from './enums'

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string
  email: string
  role: HousekeepingRole
  propertyId: string
  organizationId: string
}

export interface AuthResponse {
  accessToken: string
  user: {
    id: string
    name: string
    email: string
    role: HousekeepingRole
    propertyId: string
  }
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export interface StaffDto {
  id: string
  propertyId: string
  name: string
  email: string
  role: HousekeepingRole
  active: boolean
  capabilities: Capability[]
  createdAt: string
}

// ─── Room / Bed ───────────────────────────────────────────────────────────────

export interface RoomDto {
  id: string
  propertyId: string
  number: string
  floor: number | null
  category: RoomCategory
  capacity: number
  cloudbedsRoomId: string | null
  beds?: BedDto[]
}

export interface BedDto {
  id: string
  roomId: string
  label: string
  status: BedStatus
  createdAt: string
  updatedAt: string
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export interface CheckoutDto {
  id: string
  roomId: string
  guestName: string | null
  actualCheckoutAt: string
  source: CheckoutSource
  cloudbedsReservationId: string | null
  isEarlyCheckout: boolean
  hasSameDayCheckIn: boolean
  notes: string | null
  cancelled: boolean
  cancelledAt: string | null
  createdAt: string
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export interface CleaningTaskDto {
  id: string
  bedId: string
  checkoutId: string | null
  assignedToId: string | null
  status: CleaningStatus
  taskType: TaskType
  requiredCapability: Capability
  priority: Priority
  startedAt: string | null
  finishedAt: string | null
  verifiedAt: string | null
  verifiedById: string | null
  createdAt: string
  updatedAt: string
  bed?: BedDto & { room?: RoomDto }
  assignedTo?: StaffDto | null
}

export interface TaskLogDto {
  id: string
  taskId: string
  staffId: string | null   // Nullable: system-generated events have no associated staff
  event: TaskLogEvent
  note: string | null
  createdAt: string
}

export interface CleaningNoteDto {
  id: string
  taskId: string
  staffId: string
  content: string
  createdAt: string
  staff?: Pick<StaffDto, 'id' | 'name'>
}

export interface MaintenanceIssueDto {
  id: string
  taskId: string
  reportedById: string
  category: MaintenanceCategory
  description: string
  photoUrl: string | null
  resolved: boolean
  createdAt: string
}

// ─── Daily Planning ───────────────────────────────────────────────────────────

export interface DailyPlanningCell {
  bedId: string
  bedLabel: string
  roomId: string
  roomNumber: string
  /**
   * Estado físico actual de la cama en la base de datos.
   * CRÍTICO: Usado por inferState() para distinguir camas OCCUPIED (con huésped,
   * elegibles para checkout) de camas AVAILABLE (sin huésped, no deben marcarse
   * para checkout). Sin este campo, todas las camas sin tarea aparecen como EMPTY
   * y el supervisor no puede marcarlas.
   */
  bedStatus: BedStatus
  /** Current task for today (if any) */
  taskId: string | null
  taskStatus: CleaningStatus | null
  assignedToId: string | null
  hasSameDayCheckIn: boolean
  checkoutId: string | null
  cancelled: boolean
}

export interface DailyPlanningRow {
  roomId: string
  roomNumber: string
  roomCategory: RoomCategory
  floor: number | null
  beds: DailyPlanningCell[]
}

export interface DailyPlanningGrid {
  date: string
  sharedRooms: DailyPlanningRow[]
  privateRooms: DailyPlanningRow[]
}

export interface SseEvent<T = unknown> {
  type: SseEventType
  data: T
}

// ─── Property Settings ────────────────────────────────────────────────────────

export interface PropertySettingsDto {
  id: string
  propertyId: string
  defaultCheckoutTime: string  // "HH:mm"
  timezone: string
  pmsMode: PmsMode
  updatedAt: string
}

// ─── Bed Discrepancy ─────────────────────────────────────────────────────────

export interface BedDiscrepancyDto {
  id: string
  bedId: string
  reportedById: string
  resolvedById: string | null
  type: DiscrepancyType
  status: DiscrepancyStatus
  description: string
  resolution: string | null
  createdAt: string
  resolvedAt: string | null
  bed?: BedDto & { room?: { number: string; floor: number | null } }
  reportedBy?: Pick<StaffDto, 'id' | 'name'>
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface ReportOverviewDto {
  date: string
  totalCheckouts: number
  tasksCompleted: number
  tasksVerified: number
  tasksPending: number
  tasksUnassigned: number
  avgMinutesToComplete: number | null
}

export interface StaffPerformanceDto {
  staffId: string
  staffName: string
  tasksCompleted: number
  tasksVerified: number
  avgMinutesToComplete: number | null
}

// ─── SSE Events (extended) ───────────────────────────────────────────────────

export type SseEventType =
  | 'task:planned'
  | 'task:ready'
  | 'task:started'
  | 'task:done'
  | 'task:unassigned'
  | 'task:cancelled'
  | 'maintenance:reported'
  | 'discrepancy:reported'
  | 'room:ready'
  | 'checkout:confirmed'
  | 'checkin:completed'
  | 'room:moved'
  // SmartBlock events
  | 'block:created'
  | 'block:approved'
  | 'block:rejected'
  | 'block:activated'
  | 'block:expired'
  | 'block:cancelled'
  | 'block:extended'

// ─── Offline Sync (Mobile) ────────────────────────────────────────────────────

export type SyncOperationType = 'START_TASK' | 'END_TASK'

export interface SyncOperation {
  id: string
  type: SyncOperationType
  taskId: string
  timestamp: string
  retryCount: number
}

// ─── SmartBlock ───────────────────────────────────────────────────────────────

export interface BlockLogDto {
  id: string
  blockId: string
  staffId: string | null
  event: BlockLogEvent
  note: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
  staff?: Pick<StaffDto, 'id' | 'name'> | null
}

export interface RoomBlockDto {
  id: string
  propertyId: string
  roomId: string | null     // null = bloqueo solo de cama
  bedId: string | null      // null = bloqueo de habitación completa
  semantic: BlockSemantic
  reason: BlockReason
  status: BlockStatus
  notes: string | null
  internalNotes: string | null
  startDate: string         // ISO — cuándo entra en vigor
  endDate: string | null    // ISO — cuándo expira (null = indefinido)
  requestedById: string
  approvedById: string | null
  approvalNotes: string | null
  approvedAt: string | null
  cleaningTaskId: string | null  // tarea MAINTENANCE creada al activar
  createdAt: string
  updatedAt: string
  // Populated relations (endpoints de detalle)
  room?: RoomDto | null
  bed?: BedDto | null
  requestedBy?: Pick<StaffDto, 'id' | 'name'>
  approvedBy?: Pick<StaffDto, 'id' | 'name'> | null
  cleaningTask?: Pick<CleaningTaskDto, 'id' | 'status' | 'assignedToId'> | null
  logs?: BlockLogDto[]
}

// Request payloads
export interface CreateBlockDto {
  roomId?: string        // XOR con bedId — si ninguno → error
  bedId?: string
  semantic: BlockSemantic
  reason: BlockReason
  notes?: string
  internalNotes?: string
  startDate?: string     // ISO, default = now
  endDate?: string       // ISO, null = indefinido
}

export interface ApproveBlockDto {
  approvalNotes?: string
}

export interface RejectBlockDto {
  approvalNotes: string  // obligatorio al rechazar
}

export interface CancelBlockDto {
  reason: string         // obligatorio al cancelar
}

export interface ExtendBlockDto {
  endDate: string        // nueva fecha ISO > endDate actual
}

// ─── Room Availability ────────────────────────────────────────────────────────
//
// Algorithm: half-open interval [checkIn, checkOut)
// Two date ranges overlap iff: existingCheckIn < newCheckOut AND existingCheckOut > newCheckIn
// Same-day turnover (existing.checkOut == new.checkIn) is NOT a conflict.
//
// Sources of conflict (in priority order):
//   GUEST_STAY  — an active GuestStay record overlaps the requested dates (HARD)
//   ROOM_STATUS — room is in MAINTENANCE or OUT_OF_SERVICE (SOFT — future supervisor override)

export type ConflictSource = 'GUEST_STAY' | 'ROOM_STATUS'

/** HARD = blocks booking. SOFT = operational warning (future: supervisor can override). */
export type ConflictSeverity = 'HARD' | 'SOFT'

export interface AvailabilityConflict {
  /** Where the conflict originates */
  source: ConflictSource
  severity: ConflictSeverity
  /** Guest name — only present for GUEST_STAY conflicts */
  guestName?: string
  /** Start of the conflicting existing reservation (ISO string) */
  conflictStart: string
  /** End of the conflicting existing reservation (ISO string) */
  conflictEnd: string
  /** Number of nights where the requested range overlaps the existing one */
  overlapDays: number
}

export interface RoomAvailabilityResult {
  /** True only when there are zero conflicts of any kind */
  available: boolean
  conflicts: AvailabilityConflict[]
}

// Slim Property payload returned by GET /properties. Feeds the
// PropertySwitcher dropdown — needs name for the label, region for
// grouping multiple properties in the same chain (Mews/Opera multi-
// property pattern), and city for disambiguating same-named hotels
// across regions (Slack / Google account-picker pattern).
export interface PropertyDto {
  id: string
  name: string
  organizationId?: string | null
  type?: string
  region?: string | null
  city?: string | null
}
