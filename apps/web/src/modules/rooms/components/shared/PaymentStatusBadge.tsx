import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type PaymentStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'CREDIT' | 'OVERDUE'

const PAYMENT_CONFIG: Record<PaymentStatus, {
  label: string
  icon: string
  className: string
}> = {
  PAID:    { label: 'Pagado',    icon: '✓', className: 'bg-payment-paid-light text-payment-paid border-payment-paid/20' },
  PENDING: { label: 'Pendiente', icon: '○', className: 'bg-payment-pending-light text-payment-pending border-payment-pending/20' },
  PARTIAL: { label: 'Parcial',   icon: '◐', className: 'bg-payment-partial-light text-payment-partial border-payment-partial/20' },
  CREDIT:  { label: 'Crédito',   icon: '◈', className: 'bg-payment-credit-light text-payment-credit border-payment-credit/20' },
  OVERDUE: { label: 'Vencido',   icon: '!', className: 'bg-payment-overdue-light text-payment-overdue border-payment-overdue/20' },
}

interface PaymentStatusBadgeProps {
  status: PaymentStatus
  showIcon?: boolean
  className?: string
}

export function PaymentStatusBadge({
  status,
  showIcon = true,
  className
}: PaymentStatusBadgeProps) {
  const config = PAYMENT_CONFIG[status]

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs font-medium border inline-flex items-center gap-1 rounded-badge px-2 py-0.5',
        config.className,
        className
      )}
    >
      {showIcon && <span className="font-bold">{config.icon}</span>}
      {config.label}
    </Badge>
  )
}
