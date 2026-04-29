export enum UnitStatus {
  AVAILABLE = 'AVAILABLE',
  OCCUPIED = 'OCCUPIED',
  DIRTY = 'DIRTY',
  CLEANING = 'CLEANING',
  BLOCKED = 'BLOCKED',
}

export enum CleaningStatus {
  PENDING = 'PENDING',
  READY = 'READY',
  UNASSIGNED = 'UNASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  PAUSED = 'PAUSED',
  DONE = 'DONE',
  VERIFIED = 'VERIFIED',
  CANCELLED = 'CANCELLED',
}

export enum HousekeepingRole {
  HOUSEKEEPER = 'HOUSEKEEPER',
  SUPERVISOR = 'SUPERVISOR',
  RECEPTIONIST = 'RECEPTIONIST',
}

export enum RoomCategory {
  PRIVATE = 'PRIVATE',
  SHARED = 'SHARED',
}

export enum TaskType {
  CLEANING = 'CLEANING',
  SANITIZATION = 'SANITIZATION',
  MAINTENANCE = 'MAINTENANCE',
  PREPARATION = 'PREPARATION',
}

export enum Capability {
  CLEANING = 'CLEANING',
  SANITIZATION = 'SANITIZATION',
  MAINTENANCE = 'MAINTENANCE',
}

export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TaskLogEvent {
  CREATED = 'CREATED',
  ASSIGNED = 'ASSIGNED',
  READY = 'READY',
  STARTED = 'STARTED',
  PAUSED = 'PAUSED',
  RESUMED = 'RESUMED',
  COMPLETED = 'COMPLETED',
  VERIFIED = 'VERIFIED',
  CANCELLED = 'CANCELLED',
  REOPENED = 'REOPENED',
  NOTE_ADDED = 'NOTE_ADDED',
}


export enum MaintenanceCategory {
  PLUMBING = 'PLUMBING',
  ELECTRICAL = 'ELECTRICAL',
  FURNITURE = 'FURNITURE',
  PEST = 'PEST',
  OTHER = 'OTHER',
}

/** States used on the DailyPlanning grid cell (web UI only, not persisted) */
export enum PlanningCellState {
  EMPTY = 'EMPTY',
  OCCUPIED = 'OCCUPIED',
  CHECKOUT = 'CHECKOUT',
  CHECKOUT_WITH_CHECKIN = 'CHECKOUT_WITH_CHECKIN',
}

export enum DiscrepancyType {
  BED_STATUS_MISMATCH = 'BED_STATUS_MISMATCH',
  GUEST_EXTENSION = 'GUEST_EXTENSION',
  UNEXPECTED_OCCUPANCY = 'UNEXPECTED_OCCUPANCY',
  OTHER = 'OTHER',
}

export enum DiscrepancyStatus {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
}

export enum PmsMode {
  STANDALONE = 'STANDALONE',
  CONNECTED = 'CONNECTED',
}

// ─── No-Show ──────────────────────────────────────────────────────────────────

export enum NoShowChargeStatus {
  NOT_APPLICABLE = 'NOT_APPLICABLE', // tarifa sin cargo (policy = NONE)
  PENDING        = 'PENDING',        // registrado, pendiente de cobro
  CHARGED        = 'CHARGED',        // cobrado exitosamente
  FAILED         = 'FAILED',         // tarjeta rechazada, requiere acción manual
  WAIVED         = 'WAIVED',         // exonerado por supervisor
}

// ─── Stay Journey ─────────────────────────────────────────────────────────────

export enum StayJourneyStatus {
  ACTIVE      = 'ACTIVE',
  CHECKED_OUT = 'CHECKED_OUT',
  CANCELLED   = 'CANCELLED',
  NO_SHOW     = 'NO_SHOW',
}

export enum JourneyEventType {
  JOURNEY_CREATED    = 'JOURNEY_CREATED',
  SEGMENT_ADDED      = 'SEGMENT_ADDED',
  SEGMENT_LOCKED     = 'SEGMENT_LOCKED',
  ROOM_MOVE_EXECUTED = 'ROOM_MOVE_EXECUTED',
  EXTENSION_APPROVED = 'EXTENSION_APPROVED',
  CHECKED_IN         = 'CHECKED_IN',
  CHECKED_OUT        = 'CHECKED_OUT',
  CANCELLED          = 'CANCELLED',
  NO_SHOW_MARKED     = 'NO_SHOW_MARKED',
  NO_SHOW_REVERTED   = 'NO_SHOW_REVERTED',
  JOURNEY_SPLIT      = 'JOURNEY_SPLIT',
}

export enum PaymentMethod {
  CASH          = 'CASH',
  CARD_TERMINAL = 'CARD_TERMINAL',
  BANK_TRANSFER = 'BANK_TRANSFER',
  OTA_PREPAID   = 'OTA_PREPAID',
  COMP          = 'COMP',
}

export enum SegmentReason {
  ORIGINAL            = 'ORIGINAL',
  EXTENSION_SAME_ROOM = 'EXTENSION_SAME_ROOM',
  EXTENSION_NEW_ROOM  = 'EXTENSION_NEW_ROOM',
  ROOM_MOVE           = 'ROOM_MOVE',
  SPLIT               = 'SPLIT',
}

export enum KeyDeliveryType {
  PHYSICAL = 'PHYSICAL', // llave física tradicional
  CARD     = 'CARD',     // tarjeta magnética / RFID
  CODE     = 'CODE',     // PIN / código numérico
  MOBILE   = 'MOBILE',   // link o app móvil
}

// ─── SmartBlock ───────────────────────────────────────────────────────────────

/**
 * BlockSemantic — qué tan grave es el bloqueo y cómo afecta el inventario.
 *
 * OUT_OF_SERVICE  → problema menor, cama técnicamente en inventario.
 *                   No impacta RevPAR. Se puede vender en emergencia.
 *                   Auto-aprobado si el actor es SUPERVISOR.
 *
 * OUT_OF_ORDER    → cama inhabilitada. Removida de disponibilidad en todos
 *                   los canales. Sí impacta RevPAR. SIEMPRE requiere
 *                   aprobación de SUPERVISOR.
 *
 * OUT_OF_INVENTORY → largo plazo (renovación, remodelación). Excluida del
 *                    inventario operativo indefinidamente. Solo SUPERVISOR
 *                    puede crear este tipo.
 *
 * HOUSE_USE       → uso interno (fotos, capacitación, staff). No impacta
 *                   ADR ni ocupación. Auto-aprobado para SUPERVISOR.
 */
export enum BlockSemantic {
  OUT_OF_SERVICE   = 'OUT_OF_SERVICE',
  OUT_OF_ORDER     = 'OUT_OF_ORDER',
  OUT_OF_INVENTORY = 'OUT_OF_INVENTORY',
  HOUSE_USE        = 'HOUSE_USE',
}

/**
 * BlockReason — motivo categorizado del bloqueo.
 * Cada motivo tiene una semántica recomendada (ver validaciones en BlocksService).
 * Motivos CRÍTICOS (PEST_CONTROL, WATER_DAMAGE, ELECTRICAL, STRUCTURAL)
 * fuerzan semántica OUT_OF_ORDER automáticamente.
 */
export enum BlockReason {
  // OOS típicos
  MAINTENANCE     = 'MAINTENANCE',       // reparación general
  DEEP_CLEANING   = 'DEEP_CLEANING',     // limpieza profunda programada
  INSPECTION      = 'INSPECTION',        // inspección de calidad
  PHOTOGRAPHY     = 'PHOTOGRAPHY',       // sesión de fotos/marketing
  VIP_SETUP       = 'VIP_SETUP',         // preparación cuarto VIP
  // OOO críticos (fuerzan OUT_OF_ORDER)
  PEST_CONTROL    = 'PEST_CONTROL',      // control de plagas — siempre OOO
  WATER_DAMAGE    = 'WATER_DAMAGE',      // daño por agua
  ELECTRICAL      = 'ELECTRICAL',        // problema eléctrico
  PLUMBING        = 'PLUMBING',          // plomería
  STRUCTURAL      = 'STRUCTURAL',        // estructural
  // OOI típicos
  RENOVATION      = 'RENOVATION',        // remodelación — siempre OOI
  // House Use
  OWNER_STAY      = 'OWNER_STAY',        // estancia del propietario
  STAFF_USE       = 'STAFF_USE',         // uso de personal interno
  // Genérico
  OTHER           = 'OTHER',             // requiere nota obligatoria
}

/**
 * BlockStatus — ciclo de vida del bloqueo.
 * PENDING_APPROVAL → APPROVED → ACTIVE → EXPIRED | CANCELLED
 *                              ↘ REJECTED (desde PENDING)
 */
export enum BlockStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // solicitado, esperando supervisor
  APPROVED         = 'APPROVED',         // aprobado, startDate en el futuro
  ACTIVE           = 'ACTIVE',           // en curso (startDate ≤ now ≤ endDate)
  EXPIRED          = 'EXPIRED',          // endDate pasó, liberado automáticamente
  CANCELLED        = 'CANCELLED',        // cancelado manualmente antes/durante
  REJECTED         = 'REJECTED',         // rechazado por supervisor
}

export enum PropertyType {
  HOTEL           = 'HOTEL',
  HOSTAL          = 'HOSTAL',
  BOUTIQUE        = 'BOUTIQUE',
  GLAMPING        = 'GLAMPING',
  ECO_LODGE       = 'ECO_LODGE',
  VACATION_RENTAL = 'VACATION_RENTAL',
}

/**
 * BlockLogEvent — eventos auditables del ciclo de vida.
 * staffId es null para eventos del sistema (cron, auto-activación).
 */
export enum BlockLogEvent {
  CREATED       = 'CREATED',
  APPROVED      = 'APPROVED',
  REJECTED      = 'REJECTED',
  ACTIVATED     = 'ACTIVATED',    // startDate llegó, tarea MAINTENANCE creada
  EXTENDED      = 'EXTENDED',     // endDate extendida por supervisor
  EARLY_RELEASE = 'EARLY_RELEASE',// liberado antes de endDate
  CANCELLED     = 'CANCELLED',
  EXPIRED       = 'EXPIRED',      // cron: endDate pasó
  NOTE_ADDED    = 'NOTE_ADDED',
}
