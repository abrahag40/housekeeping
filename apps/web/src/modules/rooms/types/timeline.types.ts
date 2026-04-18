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
  actualCheckout?: Date
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
  segmentId?: string
  segmentReason?: 'ORIGINAL' | 'EXTENSION_SAME_ROOM' | 'EXTENSION_NEW_ROOM' | 'ROOM_MOVE'
  segmentLocked?: boolean
  isFirstSegment?: boolean
  isLastSegment?: boolean
  hasMultipleSegments?: boolean
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

export type StayStatus = 'ARRIVING' | 'IN_HOUSE' | 'DEPARTING' | 'DEPARTED'

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

export interface VirtualColumn {
  key: string
  index: number
  date: Date
  start: number
  size: number
}
