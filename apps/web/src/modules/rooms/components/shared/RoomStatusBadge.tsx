import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type RoomStatus =
  | 'AVAILABLE'
  | 'OCCUPIED'
  | 'CHECKING_OUT'
  | 'CLEANING'
  | 'INSPECTION'
  | 'MAINTENANCE'
  | 'OUT_OF_SERVICE'

const STATUS_CONFIG: Record<RoomStatus, {
  label: string
  className: string
  dotColor: string
}> = {
  AVAILABLE: {
    label: 'Disponible',
    className: 'bg-room-available-light text-room-available-dark border-room-available/20',
    dotColor: 'bg-room-available',
  },
  OCCUPIED: {
    label: 'Ocupada',
    className: 'bg-room-occupied-light text-room-occupied-dark border-room-occupied/20',
    dotColor: 'bg-room-occupied',
  },
  CHECKING_OUT: {
    label: 'Por salir',
    className: 'bg-room-checking-out-light text-room-checking-out-dark border-room-checking-out/20',
    dotColor: 'bg-room-checking-out',
  },
  CLEANING: {
    label: 'En limpieza',
    className: 'bg-room-cleaning-light text-room-cleaning-dark border-room-cleaning/20',
    dotColor: 'bg-room-cleaning',
  },
  INSPECTION: {
    label: 'Inspección',
    className: 'bg-room-inspection-light text-room-inspection-dark border-room-inspection/20',
    dotColor: 'bg-room-inspection',
  },
  MAINTENANCE: {
    label: 'Mantenimiento',
    className: 'bg-room-maintenance-light text-room-maintenance-dark border-room-maintenance/20',
    dotColor: 'bg-room-maintenance',
  },
  OUT_OF_SERVICE: {
    label: 'Fuera de servicio',
    className: 'bg-room-out-of-service-light text-room-out-of-service-dark border-room-out-of-service/20',
    dotColor: 'bg-room-out-of-service',
  },
}

interface RoomStatusBadgeProps {
  status: RoomStatus
  size?: 'sm' | 'md' | 'lg'
  showDot?: boolean
  className?: string
}

export function RoomStatusBadge({
  status,
  size = 'md',
  showDot = true,
  className
}: RoomStatusBadgeProps) {
  const config = STATUS_CONFIG[status]

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1.5',
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        'font-medium border inline-flex items-center gap-1.5 rounded-badge',
        config.className,
        sizeClasses[size],
        className
      )}
    >
      {showDot && (
        <span className={cn('rounded-full flex-shrink-0', config.dotColor, {
          'w-1.5 h-1.5': size === 'sm',
          'w-2 h-2': size === 'md',
          'w-2.5 h-2.5': size === 'lg',
        })} />
      )}
      {config.label}
    </Badge>
  )
}
