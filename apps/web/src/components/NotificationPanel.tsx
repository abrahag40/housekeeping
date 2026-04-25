/**
 * NotificationPanel — sliding panel connected to the bell icon.
 *
 * Design principles (CLAUDE.md §Principio Rector):
 * - Carga cognitiva: 3 categorías visuales (URGENTE / acción / informativo)
 *   — el recepcionista procesa por color + ícono, no leyendo texto.
 * - Ley de Fitts: botones de acción grandes, en la parte inferior del card.
 * - Kahneman Sistema 2: solo ACTION_REQUIRED/APPROVAL_REQUIRED activan
 *   un segundo paso explícito; INFORMATIONAL se descarta con un tap.
 * - Feedback inmediato: mark-as-read en click, badge actualiza al instante.
 */
import { useRef, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Bell, X, Check, CheckCheck, AlertCircle, Info,
  ShieldAlert, LogOut, UserX, RotateCcw, Wrench,
  CreditCard, Calendar, BellOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AppNotification, AppNotificationCategory } from '@/api/notifications.api'

// ─── Category metadata ────────────────────────────────────────────────────────

const CATEGORY_META: Record<
  AppNotificationCategory,
  { icon: React.ElementType; label: string; color: string; bg: string; border: string }
> = {
  CHECKIN_UNCONFIRMED: { icon: Calendar,    label: 'Llegada pendiente',  color: 'text-violet-700',  bg: 'bg-violet-50',  border: 'border-violet-200' },
  EARLY_CHECKOUT:      { icon: LogOut,      label: 'Salida anticipada',  color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200'  },
  NO_SHOW:             { icon: UserX,       label: 'No-show',            color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200'    },
  NO_SHOW_REVERTED:    { icon: RotateCcw,   label: 'No-show revertido',  color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200'},
  ARRIVAL_RISK:        { icon: AlertCircle, label: 'Riesgo de llegada',  color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200' },
  CHECKOUT_COMPLETE:   { icon: Check,       label: 'Checkout completo',  color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200'},
  TASK_COMPLETED:      { icon: CheckCheck,  label: 'Tarea completada',   color: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200'  },
  MAINTENANCE_REPORTED:{ icon: Wrench,      label: 'Mantenimiento',      color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200'   },
  PAYMENT_PENDING:     { icon: CreditCard,  label: 'Pago pendiente',     color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200'  },
  SYSTEM:              { icon: Info,        label: 'Sistema',            color: 'text-slate-500',   bg: 'bg-slate-50',   border: 'border-slate-200'  },
}

const PRIORITY_STRIPE: Record<string, string> = {
  URGENT: 'bg-red-500',
  HIGH:   'bg-orange-400',
  MEDIUM: 'bg-amber-300',
  LOW:    'bg-slate-300',
}

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  INFORMATIONAL:    { label: 'Info',      color: 'bg-slate-100 text-slate-600' },
  ACTION_REQUIRED:  { label: 'Acción',    color: 'bg-amber-100 text-amber-800' },
  APPROVAL_REQUIRED:{ label: 'Aprobación',color: 'bg-red-100 text-red-800'     },
}

// ─── NotificationCard ─────────────────────────────────────────────────────────

interface CardProps {
  notif:       AppNotification
  onRead:      (id: string) => void
  onApprove?:  (id: string) => void
  onReject?:   (id: string) => void
  onNavigate?: (url: string) => void
}

function NotificationCard({ notif, onRead, onApprove, onReject, onNavigate }: CardProps) {
  const meta   = CATEGORY_META[notif.category] ?? CATEGORY_META.SYSTEM
  const Icon   = meta.icon
  const stripe = PRIORITY_STRIPE[notif.priority] ?? PRIORITY_STRIPE.MEDIUM
  const typeBadge = TYPE_LABEL[notif.type]

  const handleClick = () => {
    if (!notif.isRead) onRead(notif.id)
    if (notif.actionUrl) onNavigate?.(notif.actionUrl)
  }

  return (
    <div
      className={cn(
        'relative flex gap-3 px-4 py-3.5 transition-colors cursor-pointer',
        notif.isRead
          ? 'bg-white hover:bg-slate-50'
          : 'bg-blue-50/50 hover:bg-blue-50',
      )}
      onClick={handleClick}
    >
      {/* Priority stripe */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-0.5', stripe)} />

      {/* Category icon */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 border',
        meta.bg, meta.border,
      )}>
        <Icon className={cn('h-4 w-4', meta.color)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn(
            'text-sm leading-snug line-clamp-2',
            notif.isRead ? 'text-slate-600 font-normal' : 'text-slate-900 font-medium',
          )}>
            {notif.title}
          </p>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Unread dot */}
            {!notif.isRead && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1" />
            )}
            <button
              className="p-0.5 text-slate-300 hover:text-slate-500 rounded transition-colors"
              onClick={(e) => { e.stopPropagation(); onRead(notif.id) }}
              aria-label="Marcar como leída"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">
          {notif.body}
        </p>

        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {/* Type badge */}
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', typeBadge.color)}>
            {typeBadge.label}
          </span>

          {/* Category label */}
          <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded border', meta.color, meta.bg, meta.border)}>
            {meta.label}
          </span>

          {/* Timestamp */}
          <span className="text-[10px] text-slate-400 ml-auto">
            {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true, locale: es })}
          </span>
        </div>

        {/* Who triggered it */}
        {notif.triggeredBy && (
          <p className="text-[10px] text-slate-400 mt-0.5">
            Por {notif.triggeredBy}
          </p>
        )}

        {/* Approval actions */}
        {notif.type === 'APPROVAL_REQUIRED' && !notif.approval && (
          <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
            <Button
              size="sm"
              className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => { onApprove?.(notif.id); onRead(notif.id) }}
            >
              <Check className="h-3 w-3 mr-1" />
              Aprobar
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => { onReject?.(notif.id); onRead(notif.id) }}
            >
              <X className="h-3 w-3 mr-1" />
              Rechazar
            </Button>
          </div>
        )}

        {/* Approval result */}
        {notif.approval && (
          <div className={cn(
            'mt-2 text-[10px] font-semibold px-2 py-1 rounded',
            notif.approval.action === 'APPROVED'
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-red-50 text-red-700',
          )}>
            {notif.approval.action === 'APPROVED' ? '✓ Aprobado' : '✗ Rechazado'}
            {notif.approval.reason ? ` — ${notif.approval.reason}` : ''}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── NotificationPanel ────────────────────────────────────────────────────────

interface NotificationPanelProps {
  open:        boolean
  onClose:     () => void
  notifications: AppNotification[]
  unreadCount: number
  onRead:      (id: string) => void
  onMarkAll:   () => void
  onApprove:   (id: string) => void
  onReject:    (id: string) => void
  onNavigate:  (url: string) => void
}

export function NotificationPanel({
  open, onClose, notifications, unreadCount,
  onRead, onMarkAll, onApprove, onReject, onNavigate,
}: NotificationPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  if (!open) return null

  const urgent   = notifications.filter((n) => n.priority === 'URGENT' || n.priority === 'HIGH')
  const actions  = notifications.filter((n) => n.type !== 'INFORMATIONAL' && n.priority !== 'URGENT' && n.priority !== 'HIGH')
  const rest     = notifications.filter((n) => n.type === 'INFORMATIONAL' && n.priority !== 'URGENT' && n.priority !== 'HIGH')

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" aria-hidden="true" />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'fixed top-14 right-2 z-50 w-[380px] max-h-[calc(100vh-5rem)]',
          'flex flex-col bg-white rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.14)]',
          'border border-slate-200 overflow-hidden',
          'animate-in slide-in-from-top-2 duration-200',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-slate-600" />
            <span className="text-sm font-semibold text-slate-800">Notificaciones</span>
            {unreadCount > 0 && (
              <span className="text-[11px] font-bold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={onMarkAll}
                className="text-[11px] text-slate-500 hover:text-emerald-700 transition-colors px-2 py-1 rounded hover:bg-emerald-50"
              >
                Marcar todas leídas
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <BellOff className="h-10 w-10 text-slate-200 mb-3" />
              <p className="text-sm font-medium text-slate-500">Sin notificaciones</p>
              <p className="text-xs text-slate-400 mt-1">Todo al día por aquí.</p>
            </div>
          ) : (
            <>
              {/* Urgent/High priority first */}
              {urgent.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-red-50 border-b border-red-100">
                    <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3" />
                      Urgente / Alta prioridad
                    </span>
                  </div>
                  {urgent.map((n) => (
                    <NotificationCard
                      key={n.id} notif={n}
                      onRead={onRead} onApprove={onApprove} onReject={onReject} onNavigate={onNavigate}
                    />
                  ))}
                </div>
              )}

              {/* Actions required */}
              {actions.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-amber-50 border-b border-amber-100">
                    <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                      Requieren acción
                    </span>
                  </div>
                  {actions.map((n) => (
                    <NotificationCard
                      key={n.id} notif={n}
                      onRead={onRead} onApprove={onApprove} onReject={onReject} onNavigate={onNavigate}
                    />
                  ))}
                </div>
              )}

              {/* Informational */}
              {rest.length > 0 && (
                <div>
                  {(urgent.length > 0 || actions.length > 0) && (
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Informativas
                      </span>
                    </div>
                  )}
                  {rest.map((n) => (
                    <NotificationCard
                      key={n.id} notif={n}
                      onRead={onRead} onApprove={onApprove} onReject={onReject} onNavigate={onNavigate}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
