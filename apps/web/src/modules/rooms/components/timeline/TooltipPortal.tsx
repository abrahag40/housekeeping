import { createPortal } from 'react-dom'
import { format, differenceInHours } from 'date-fns'
import { es } from 'date-fns/locale'
import { Calendar, Moon, Users, UserX, Clock, LogIn, Hash, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PaymentStatusBadge } from '../shared'
import { STAY_STATUS_COLORS, OTA_ACCENT_COLORS, SOURCE_COLORS } from '../../utils/timeline.constants'
import type { StayStatusKey, SourceKey } from '../../utils/timeline.constants'
import { getStayStatus } from '../../utils/timeline.utils'
import type { GuestStayBlock } from '../../types/timeline.types'

interface TooltipPortalProps {
  stay: GuestStayBlock
  position: { x: number; y: number; placement: 'top' | 'bottom' }
  visible: boolean
  registerTooltipRef?: (el: HTMLDivElement | null) => void
  onNoShow?: (stayId: string) => void
  onStartCheckin?: (stayId: string) => void
  onRevertNoShow?: (stayId: string) => void
  isPotentialNoShow?: boolean
}

export function TooltipPortal({
  stay,
  position,
  visible,
  registerTooltipRef,
  onNoShow,
  onStartCheckin,
  onRevertNoShow,
  isPotentialNoShow,
}: TooltipPortalProps) {
  if (!visible) return null

  const isConfirmedNoShow = !!stay.noShowAt
  const canRevert = isConfirmedNoShow && differenceInHours(new Date(), stay.noShowAt!) < 48
  const stayStatus = getStayStatus(stay.checkIn, stay.checkOut, stay.actualCheckout, stay.actualCheckin, stay.noShowAt)
  const isUnconfirmed = stayStatus === 'UNCONFIRMED'
  const colors = STAY_STATUS_COLORS[stayStatus as StayStatusKey] ?? STAY_STATUS_COLORS.IN_HOUSE
  const sourceColors = SOURCE_COLORS[stay.source as SourceKey] ?? SOURCE_COLORS.other
  const otaAccent = OTA_ACCENT_COLORS[stay.source] ?? OTA_ACCENT_COLORS.other

  const checkIn  = format(stay.checkIn, 'd MMM', { locale: es })
  const checkOut = format(stay.checkOut, 'd MMM', { locale: es })

  const style: React.CSSProperties = {
    position:     'fixed',
    left:         position.x,
    top:          position.y,
    zIndex:       9999,
    transform:    position.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    pointerEvents: 'auto',
  }

  const animationClass = position.placement === 'top' ? 'tooltip-top' : 'tooltip-bottom'

  const tooltip = (
    <div ref={registerTooltipRef} style={style}>
      <div
        className={cn(
          'w-96 rounded-xl',
          animationClass,
          'bg-white border border-slate-100',
          'shadow-[0_8px_16px_-4px_rgba(0,0,0,0.12),0_20px_25px_-5px_rgba(0,0,0,0.1)]',
        )}
      >
        {/* Header */}
        <div
          className="px-3.5 py-2.5 rounded-t-xl relative overflow-hidden"
          style={{ backgroundColor: colors.bg }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ backgroundColor: otaAccent }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0">
              <span
                className="font-semibold text-sm leading-tight truncate"
                style={{ color: colors.text }}
              >
                {stay.guestName}
              </span>
              {stayStatus === 'DEPARTING' && (
                <div className="flex items-center gap-1 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-[10px] font-semibold text-amber-700">Sale hoy</span>
                </div>
              )}
              {isUnconfirmed && (
                <div className="flex items-center gap-1 mt-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-[10px] font-semibold text-amber-700">Llegada sin confirmar</span>
                </div>
              )}
              {isPotentialNoShow && (
                <div className="flex items-center gap-1 mt-0.5">
                  <UserX className="h-3 w-3 text-orange-500 shrink-0" />
                  <span className="text-[10px] font-semibold text-orange-700">No se presentó — posible no-show</span>
                </div>
              )}
              {isConfirmedNoShow && (
                <div className="flex items-center gap-1 mt-0.5">
                  <UserX className="h-3 w-3 text-red-500 shrink-0" />
                  <span className="text-[10px] font-semibold text-red-700">
                    No-show · {format(stay.noShowAt!, 'd MMM', { locale: es })}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                style={{ backgroundColor: colors.border, color: colors.text }}
              >
                {colors.label}
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap text-white shadow-sm"
                style={{ backgroundColor: otaAccent }}
              >
                {sourceColors.label}
              </span>
            </div>
          </div>
        </div>

        {/* Gradient separator */}
        <div className="h-px" style={{ background: `linear-gradient(90deg, ${colors.border}40, transparent)` }} />

        {/* Two-column content */}
        <div className="px-3.5 py-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {/* Left column: dates + pax */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
              <span>{checkIn} → {checkOut}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Moon className="h-3 w-3 text-slate-400 shrink-0" />
              <span>{stay.nights} {stay.nights === 1 ? 'noche' : 'noches'}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <Users className="h-3 w-3 text-slate-400 shrink-0" />
              <span>{stay.paxCount} {stay.paxCount === 1 ? 'huésped' : 'huéspedes'}</span>
            </div>
            {stay.pmsReservationId && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Hash className="h-3 w-3 shrink-0" />
                <span className="font-mono text-[10px]">{stay.pmsReservationId}</span>
              </div>
            )}
          </div>

          {/* Right column: room + financials */}
          <div className="space-y-1.5">
            {stay.roomNumber && (
              <div className="text-xs text-slate-600">
                <span className="text-slate-400 text-[10px]">Habitación</span>
                <div className="font-semibold">{stay.roomNumber}</div>
              </div>
            )}
            <div className="text-xs">
              <span className="text-slate-400 text-[10px]">Total</span>
              <div className="font-mono font-bold text-slate-800">
                {stay.currency} {stay.totalAmount.toLocaleString()}
              </div>
            </div>
            <PaymentStatusBadge status={stay.paymentStatus} />
          </div>
        </div>

        {/* UNCONFIRMED — CTA check-in */}
        {isUnconfirmed && onStartCheckin && (
          <div className="px-3.5 pb-3">
            <button
              className={cn(
                'w-full flex items-center justify-center gap-2',
                'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800',
                'text-white text-sm font-semibold rounded-lg',
                'px-3 py-2 transition-colors shadow-sm',
              )}
              onClick={(e) => {
                e.stopPropagation()
                onStartCheckin(stay.id)
              }}
            >
              <LogIn className="h-4 w-4" />
              Iniciar check-in
            </button>
          </div>
        )}

        {/* Confirmed no-show context */}
        {isConfirmedNoShow && (
          <div className="px-3.5 pb-3">
            <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 space-y-1.5">
              <p className="text-[10px] font-bold text-red-800 flex items-center gap-1">
                <UserX className="h-3 w-3 shrink-0" />
                El huésped no se presentó
              </p>
              <p className="text-[10px] text-red-600 leading-snug">
                La habitación fue liberada y está disponible para nueva venta.
              </p>
              {canRevert && (
                <p className="text-[10px] text-red-500 font-medium flex items-center gap-1">
                  <Clock className="h-3 w-3 shrink-0" />
                  Ventana de reversión activa (&lt; 48 h)
                </p>
              )}
            </div>
            {canRevert && onRevertNoShow && (
              <button
                className={cn(
                  'w-full mt-2 flex items-center justify-center gap-1.5',
                  'text-[11px] font-semibold px-2.5 py-1.5 rounded-md',
                  'border border-amber-400 text-amber-700 bg-amber-50',
                  'hover:bg-amber-100 transition-colors',
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onRevertNoShow(stay.id)
                }}
              >
                <RotateCcw className="h-3 w-3" />
                Revertir no-show
              </button>
            )}
          </div>
        )}

        {/* Potential no-show quick action */}
        {isPotentialNoShow && onNoShow && (
          <div className="px-3.5 pb-3">
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-2.5">
              <p className="text-[10px] text-orange-700 leading-snug mb-2">
                No llegó en fecha pactada. Ver detalles al confirmar.
              </p>
              <button
                className={cn(
                  'w-full flex items-center justify-center gap-1.5',
                  'bg-orange-600 hover:bg-orange-700 active:bg-orange-800',
                  'text-white text-[11px] font-bold rounded-md',
                  'px-3 py-1.5 transition-colors shadow-sm',
                )}
                onClick={(e) => {
                  e.stopPropagation()
                  onNoShow(stay.id)
                }}
              >
                <UserX className="h-3 w-3" />
                Marcar no-show
              </button>
            </div>
          </div>
        )}

        {/* Arrow */}
        {position.placement === 'top' && (
          <div className="absolute left-1/2 -translate-x-1/2 top-full">
            <div className="border-[6px] border-transparent border-t-slate-100" />
            <div className="border-[5px] border-transparent border-t-white absolute top-0 left-1/2 -translate-x-1/2 -translate-y-[1px]" />
          </div>
        )}
        {position.placement === 'bottom' && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-full">
            <div className="border-[6px] border-transparent border-b-slate-100" />
            <div className="border-[5px] border-transparent border-b-white absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-[1px]" />
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(tooltip, document.body)
}
