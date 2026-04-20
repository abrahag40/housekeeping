import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Calendar, Moon, Users, UserX } from 'lucide-react'
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
  isPotentialNoShow?: boolean
}

export function TooltipPortal({ stay, position, visible, registerTooltipRef, onNoShow, isPotentialNoShow }: TooltipPortalProps) {
  if (!visible) return null

  const stayStatus = getStayStatus(stay.checkIn, stay.checkOut, stay.actualCheckout)
  const colors = STAY_STATUS_COLORS[stayStatus as StayStatusKey]
  const sourceColors = SOURCE_COLORS[stay.source as SourceKey] ?? SOURCE_COLORS.other
  const otaAccent = OTA_ACCENT_COLORS[stay.source] ?? OTA_ACCENT_COLORS.other

  const checkIn = format(stay.checkIn, 'd MMM', { locale: es })
  const checkOut = format(stay.checkOut, 'd MMM', { locale: es })

  const style: React.CSSProperties = {
    position: 'fixed',
    left: position.x,
    top: position.y,
    zIndex: 9999,
    // top → BOTTOM of tooltip aligns with `top` (tooltip appears above block).
    // bottom → TOP of tooltip aligns with `top` (tooltip appears below block).
    transform: position.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    // Allow pointer events when tooltip has an interactive no-show action.
    pointerEvents: isPotentialNoShow && onNoShow ? 'auto' : 'none',
  }

  const animationClass =
    position.placement === 'top' ? 'tooltip-top' : 'tooltip-bottom'

  const tooltip = (
    <div ref={registerTooltipRef} style={style}>
      <div
        className={cn(
          'w-64 rounded-xl',
          animationClass,
          'bg-white border border-slate-100',
          'shadow-[0_8px_16px_-4px_rgba(0,0,0,0.12),0_20px_25px_-5px_rgba(0,0,0,0.1)]',
        )}
      >
        {/* Header with status color + OTA accent */}
        <div
          className="px-3.5 py-2.5 rounded-t-xl relative overflow-hidden"
          style={{ backgroundColor: colors.bg }}
        >
          {/* OTA accent stripe */}
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
                <div className="flex items-center gap-1 mt-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-[10px] font-semibold text-amber-700">
                    Sale hoy — checkout pendiente
                  </span>
                </div>
              )}
              {isPotentialNoShow && (
                <div className="flex items-center gap-1 mt-1">
                  <UserX className="h-3 w-3 text-orange-500 shrink-0" />
                  <span className="text-[10px] font-semibold text-orange-700">
                    No se presentó — posible no-show
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
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap
                           text-white shadow-sm"
                style={{ backgroundColor: otaAccent }}
              >
                {sourceColors.label}
              </span>
            </div>
          </div>
        </div>

        {/* Gradient separator */}
        <div
          className="h-px"
          style={{
            background: `linear-gradient(90deg, ${colors.border}40, transparent)`,
          }}
        />

        {/* Content */}
        <div className="px-3.5 py-2.5 space-y-2">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Calendar className="h-3 w-3 text-slate-400 shrink-0" />
            <span>
              {checkIn} → {checkOut}
            </span>
            <span className="text-slate-300">·</span>
            <span className="inline-flex items-center gap-0.5 font-medium">
              <Moon className="h-3 w-3 opacity-60" />
              {stay.nights}n
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Users className="h-3 w-3 text-slate-400 shrink-0" />
            <span>{stay.paxCount} huéspedes</span>
          </div>
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-50">
            <span className="text-sm font-mono font-bold text-slate-800">
              {stay.currency} {stay.totalAmount.toLocaleString()}
            </span>
            <PaymentStatusBadge status={stay.paymentStatus} />
          </div>

          {/* Reservation IDs */}
          {(stay.pmsReservationId || stay.otaReservationId) && (
            <div className="pt-1.5 border-t border-slate-50 space-y-1">
              {stay.pmsReservationId && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wide">
                    PMS ID
                  </span>
                  <span className="text-[10px] font-mono text-slate-600
                                  bg-slate-50 px-1.5 py-0.5 rounded">
                    {stay.pmsReservationId}
                  </span>
                </div>
              )}
              {stay.otaReservationId && (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-mono uppercase tracking-wide">
                    {stay.otaName ?? 'OTA'} ID
                  </span>
                  <span className="text-[10px] font-mono text-slate-600
                                  bg-slate-50 px-1.5 py-0.5 rounded">
                    {stay.otaReservationId}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* No-show quick action */}
        {isPotentialNoShow && onNoShow && (
          <div className="px-3.5 pb-2.5">
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
