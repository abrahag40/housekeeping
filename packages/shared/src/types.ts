import {
  UnitStatus,
  BlockLogEvent,
  BlockReason,
  BlockSemantic,
  BlockStatus,
  Capability,
  CleaningStatus,
  DiscrepancyStatus,
  DiscrepancyType,
  HousekeepingRole,
  KeyDeliveryType,
  MaintenanceCategory,
  NoShowChargeStatus,
  PaymentMethod,
  PmsMode,
  Priority,
  RoomCategory,
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

// ─── Room / Unit ──────────────────────────────────────────────────────────────

export interface RoomDto {
  id: string
  propertyId: string
  number: string
  floor: number | null
  category: RoomCategory
  capacity: number
  units?: UnitDto[]
}

export interface UnitDto {
  id: string
  roomId: string
  label: string
  status: UnitStatus
  createdAt: string
  updatedAt: string
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export interface CheckoutDto {
  id: string
  roomId: string
  guestName: string | null
  actualCheckoutAt: string
  source: 'MANUAL' | 'SYSTEM'
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
  unitId: string
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
  unit?: UnitDto & { room?: RoomDto }
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
  unitId: string
  unitLabel: string
  roomId: string
  roomNumber: string
  /**
   * Estado físico actual de la unidad en la base de datos.
   * CRÍTICO: Usado por inferState() para distinguir unidades OCCUPIED (con huésped,
   * elegibles para checkout) de unidades AVAILABLE (sin huésped, no deben marcarse
   * para checkout). Sin este campo, todas las unidades sin tarea aparecen como EMPTY
   * y el supervisor no puede marcarlas.
   */
  unitStatus: UnitStatus
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
  units: DailyPlanningCell[]
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

// ─── Guest Stay ───────────────────────────────────────────────────────────────

export interface GuestStayDto {
  id: string
  bookingRef: string | null
  propertyId: string
  roomId: string
  guestName: string
  guestEmail: string | null
  guestPhone: string | null
  nationality: string | null
  documentType: string | null
  documentNumber: string | null
  paxCount: number
  checkinAt: string
  scheduledCheckout: string
  actualCheckout: string | null
  ratePerNight: string        // Decimal serialized as string
  currency: string
  totalAmount: string
  amountPaid: string
  paymentStatus: string
  source: string | null
  notes: string | null
  // No-show fields — all null until markAsNoShow() is called
  noShowAt: string | null
  noShowById: string | null
  noShowReason: string | null
  noShowFeeAmount: string | null
  noShowFeeCurrency: string | null
  noShowChargeStatus: NoShowChargeStatus | null
  noShowRevertedAt: string | null
  noShowRevertedById: string | null
  // Sprint 8 — check-in confirmation
  actualCheckin: string | null
  checkinConfirmedById: string | null
  // Sprint 9 — check-in extended fields
  arrivalNotes: string | null
  keyType: KeyDeliveryType | null
  paymentLogs?: PaymentLogDto[]
  createdAt: string
  updatedAt: string
  room?: RoomDto
}

// ─── Payment ─────────────────────────────────────────────────────────────────

export interface PaymentLogDto {
  id: string
  organizationId: string
  propertyId: string
  stayId: string
  method: PaymentMethod
  amount: string            // Decimal serialized as string
  currency: string
  reference: string | null
  approvedById: string | null
  approvalReason: string | null
  isVoid: boolean
  voidedAt: string | null
  voidedById: string | null
  voidReason: string | null
  voidsLogId: string | null
  shiftDate: string
  collectedById: string
  createdAt: string
}

export interface CashSummaryDto {
  date: string
  propertyId: string
  totalCash: string
  byCollector: {
    collectedById: string
    collectorName: string
    total: string
    count: number
  }[]
}

// ─── Check-in Confirmation ───────────────────────────────────────────────────

export interface PaymentEntryInput {
  method: PaymentMethod
  amount: number
  reference?: string
  approvedById?: string
  approvalReason?: string
}

export interface ConfirmCheckinInput {
  documentVerified: boolean
  documentType?: string
  documentNumber?: string
  arrivalNotes?: string
  keyType?: KeyDeliveryType
  payments: PaymentEntryInput[]
  managerApprovalCode?: string
  managerApprovalReason?: string
}

// ─── Property Settings ────────────────────────────────────────────────────────

export interface PropertySettingsDto {
  id: string
  propertyId: string
  defaultCheckoutTime: string  // "HH:mm"
  timezone: string
  pmsMode: PmsMode
  noShowCutoffHour: number     // hora local (0-23) a partir de la cual se marca no-show
  updatedAt: string
}

// ─── No-Show Report ───────────────────────────────────────────────────────────

export interface NoShowItemDto {
  id: string
  guestName: string
  roomNumber: string | null
  scheduledCheckin: string
  scheduledCheckout: string
  noShowAt: string
  noShowReason: string | null
  feeAmount: string | null
  feeCurrency: string | null
  chargeStatus: NoShowChargeStatus | null
  source: string | null
  markedById: string | null
}

export interface NoShowReportDto {
  from: string
  to: string
  totalNoShows: number
  noShowRate: number | null          // % de no-shows vs total reservas del período
  totalFeeRevenue: string            // suma de feeAmount cobrado (CHARGED)
  totalFeePending: string            // suma de feeAmount en estado PENDING
  bySource: { source: string; count: number }[]
  items: NoShowItemDto[]
}

// ─── Unit Discrepancy ─────────────────────────────────────────────────────────

export interface UnitDiscrepancyDto {
  id: string
  unitId: string
  reportedById: string
  resolvedById: string | null
  type: DiscrepancyType
  status: DiscrepancyStatus
  description: string
  resolution: string | null
  createdAt: string
  resolvedAt: string | null
  unit?: UnitDto & { room?: { number: string; floor: number | null } }
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
  // Checkout events
  | 'checkout:early'
  // No-show events
  | 'stay:no_show'
  | 'stay:no_show_reverted'
  // Pre-arrival warning (potential no-show)
  | 'arrival:at_risk'
  // Soft-lock advisory (intra-Zenix overbooking UX — no hard block)
  | 'soft:lock:acquired'
  | 'soft:lock:released'
  // Notification center — real-time bell push
  | 'notification:new'
  // Check-in confirmation
  | 'checkin:confirmed'

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
  roomId: string | null     // null = bloqueo solo de unidad
  unitId: string | null     // null = bloqueo de habitación completa
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
  unit?: UnitDto | null
  requestedBy?: Pick<StaffDto, 'id' | 'name'>
  approvedBy?: Pick<StaffDto, 'id' | 'name'> | null
  cleaningTask?: Pick<CleaningTaskDto, 'id' | 'status' | 'assignedToId'> | null
  logs?: BlockLogDto[]
}

// Request payloads
export interface CreateBlockDto {
  roomId?: string        // XOR con unitId — si ninguno → error
  unitId?: string
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
