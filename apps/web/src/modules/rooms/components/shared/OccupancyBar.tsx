import { cn } from '@/lib/utils'

interface OccupancyBarProps {
  total: number
  occupied: number
  className?: string
  showLabel?: boolean
}

export function OccupancyBar({
  total,
  occupied,
  className,
  showLabel = true
}: OccupancyBarProps) {
  const percentage = total > 0 ? Math.round((occupied / total) * 100) : 0
  const isOverbooked = occupied > total

  const barColor = isOverbooked
    ? 'bg-payment-overdue'
    : percentage >= 90 ? 'bg-room-available'
    : percentage >= 60 ? 'bg-room-checking-out'
    : 'bg-room-cleaning'

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      {showLabel && (
        <span className={cn(
          'text-xs font-mono font-medium tabular-nums flex-shrink-0',
          isOverbooked ? 'text-payment-overdue' : 'text-slate-500'
        )}>
          {isOverbooked ? `⚠ ${occupied}/${total}` : `${percentage}%`}
        </span>
      )}
    </div>
  )
}
