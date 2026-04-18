import { cn } from '@/lib/utils'
import type { RoomStatus } from './RoomStatusBadge'

const DOT_COLORS: Record<RoomStatus, string> = {
  AVAILABLE:      'bg-room-available',
  OCCUPIED:       'bg-room-occupied',
  CHECKING_OUT:   'bg-room-checking-out',
  CLEANING:       'bg-room-cleaning',
  INSPECTION:     'bg-room-inspection',
  MAINTENANCE:    'bg-room-maintenance',
  OUT_OF_SERVICE: 'bg-room-out-of-service',
}

// Estos estados tienen animación de pulso (activos/urgentes)
const PULSE_STATES: RoomStatus[] = ['CHECKING_OUT', 'CLEANING', 'INSPECTION']

interface StatusDotProps {
  status: RoomStatus
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function StatusDot({ status, size = 'md', className }: StatusDotProps) {
  const shouldPulse = PULSE_STATES.includes(status)

  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-2.5 h-2.5',
    lg: 'w-3 h-3',
  }

  return (
    <span className={cn('relative inline-flex', sizeClasses[size], className)}>
      {shouldPulse && (
        <span className={cn(
          'animate-ping absolute inline-flex h-full w-full rounded-full opacity-50',
          DOT_COLORS[status]
        )} />
      )}
      <span className={cn(
        'relative inline-flex rounded-full',
        sizeClasses[size],
        DOT_COLORS[status]
      )} />
    </span>
  )
}
