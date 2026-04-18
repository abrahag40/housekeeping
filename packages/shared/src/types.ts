import {
  BedStatus,
  Capability,
  CheckoutSource,
  CleaningStatus,
  DiscrepancyStatus,
  DiscrepancyType,
  HousekeepingRole,
  MaintenanceCategory,
  PmsMode,
  Priority,
  RoomType,
  TaskLogEvent,
  TaskType,
} from './enums'

// ─── Property ────────────────────────────────────────────────────────────────

export interface PropertyDto {
  id: string
  name: string
  createdAt: string
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string
  email: string
  role: HousekeepingRole
  propertyId: string
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
  type: RoomType
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
  roomType: RoomType
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

// ─── Offline Sync (Mobile) ────────────────────────────────────────────────────

export type SyncOperationType = 'START_TASK' | 'END_TASK'

export interface SyncOperation {
  id: string
  type: SyncOperationType
  taskId: string
  timestamp: string
  retryCount: number
}
