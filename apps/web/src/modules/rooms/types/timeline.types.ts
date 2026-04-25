export interface RoomTypeGroup {
  id: string
  name: string
  code: string
  baseRate: number
  currency: string
  rooms: RoomRow[]
  collapsed: boolean
}

export interface RoomRow {
  id: string
  number: string
  floor: number | null
  status: RoomStatus
  roomTypeId: string
}

export interface GuestStayBlock {
  id: string
  roomId: string
  guestName: string
  checkIn: Date
  checkOut: Date
  nights: number
  ratePerNight: number
  paymentStatus: PaymentStatus
  source: string
  totalAmount: number
  amountPaid: number
  currency: string
  paxCount: number
  notes?: string
  isLocked?: boolean
  actualCheckin?: Date
  actualCheckout?: Date
  noShowAt?: Date
  noShowFeeAmount?: number
  noShowFeeCurrency?: string
  noShowChargeStatus?: 'NOT_APPLICABLE' | 'PENDING' | 'CHARGED' | 'FAILED' | 'WAIVED'
  stripePaymentMethodId?: string
  otaName?: string
  otaReservationId?: string
  pmsReservationId?: string
  guestEmail?: string
  guestPhone?: string
  documentType?: string
  documentNumber?: string
  nationality?: string
  roomNumber?: string
  journeyId?: string
  guestStayId?: string      // GuestStay ID for journey blocks (id = segment ID)
  segmentId?: string
  segmentReason?: 'ORIGINAL' | 'EXTENSION_SAME_ROOM' | 'EXTENSION_NEW_ROOM' | 'ROOM_MOVE' | 'SPLIT'
  segmentLocked?: boolean
  isFirstSegment?: boolean
  isLastSegment?: boolean
  hasMultipleSegments?: boolean
  originalRoomNumber?: string  // room the journey started in (for EXT_NEW_ROOM / ROOM_MOVE)
}

export interface DayMetrics {
  date: Date
  occupiedCount: number
  totalRooms: number
  revenue: number
  currency: string
}

export type RoomStatus =
  | 'AVAILABLE' | 'OCCUPIED' | 'CHECKING_OUT'
  | 'CLEANING' | 'INSPECTION' | 'MAINTENANCE' | 'OUT_OF_SERVICE'

export type PaymentStatus =
  | 'PENDING' | 'PARTIAL' | 'PAID' | 'CREDIT' | 'OVERDUE'

export type StayStatus = 'ARRIVING' | 'UNCONFIRMED' | 'IN_HOUSE' | 'DEPARTING' | 'DEPARTED' | 'NO_SHOW'

export type ViewMode = 'week' | 'month' | 'quarter'

export interface FlatRow {
  type: 'group' | 'room'
  id: string
  groupId?: string
  room?: RoomRow
  group?: RoomTypeGroup
}

export interface DragState {
  stayId: string
  originalRoomId: string
  originalCheckIn: Date
  originalCheckOut: Date
  nights: number
  currentRoomId: string
  currentCheckIn: Date
  currentCheckOut: Date
  isValid: boolean
  conflictReason?: string
}

export interface DropResult {
  stayId: string
  newRoomId: string
  newCheckIn: Date
  newCheckOut: Date
}

export interface ExtendState {
  stayId: string
  journeyId?: string
  roomId: string
  rowIndex: number
  groupHeaderOffsetY: number
  originalCheckOut: Date
  previewCheckOut: Date
  startClientX: number
}

export interface VirtualColumn {
  key: string
  index: number
  date: Date
  start: number
  size: number
}
