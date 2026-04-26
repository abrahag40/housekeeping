import { createPortal } from 'react-dom'
import { format, differenceInHours, startOfDay } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Moon, Users, UserX, Clock, LogIn,
  RotateCcw,
} from 'lucide-react'
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
  /** Room was rebooked after the NS — revert would cause overbooking */
  roomIsRebooked?: boolean
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
  roomIsRebooked = false,
}: TooltipPortalProps) {
  if (!visible) return null

  const isConfirmedNoShow = !!stay.noShowAt
  const canRevert = isConfirmedNoShow && differenceInHours(new Date(), stay.noShowAt!) < 48
  const stayStatus = getStayStatus(stay.checkIn, stay.checkOut, stay.actualCheckout, stay.actualCheckin, stay.noShowAt)
  const isUnconfirmed = stayStatus === 'UNCONFIRMED'
  const colors = STAY_STATUS_COLORS[stayStatus as StayStatusKey] ?? STAY_STATUS_COLORS.IN_HOUSE
  const sourceColors = SOURCE_COLORS[stay.source as SourceKey] ?? SOURCE_COLORS.other
  const otaAccent = OTA_ACCENT_COLORS[stay.source] ?? OTA_ACCENT_COLORS.other

  const checkIn  = format(stay.checkIn,  'd MMM', { locale: es })
  const checkOut = format(stay.checkOut, 'd MMM', { locale: es })

  const bookingRef = stay.bookingRef ?? stay.pmsReservationId

  // isArrivalDay guards are the source of truth — robust against date-string UTC vs local drift
  const isArrivalDay = startOfDay(stay.checkIn).getTime() === startOfDay(new Date()).getTime()
  const canConfirmCheckin = !stay.actualCheckin && !isConfirmedNoShow && isArrivalDay

  const hasCheckin = canConfirmCheckin && !!onStartCheckin
  const hasNoShow  = !stay.actualCheckin && (isPotentialNoShow || isUnconfirmed || isArrivalDay) && !isConfirmedNoShow && !!onNoShow
  const hasRevert  = canRevert && !!onRevertNoShow

  const style: React.CSSProperties = {
    position:      'fixed',
    left:          position.x,
    top:           position.y,
    zIndex:        9999,
    transform:     position.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
    pointerEvents: 'auto',
  }

  const animationClass = position.placement === 'top' ? 'tooltip-top' : 'tooltip-bottom'

  const tooltip = (
    <div ref={registerTooltipRef} style={style}>
      <div
        className={cn(
          'w-[320px] rounded-xl',
          animationClass,
          'bg-white border border-slate-100',
          'shadow-[0_8px_24px_-4px_rgba(0,0,0,0.14),0_4px_8px_-2px_rgba(0,0,0,0.08)]',
        )}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div
          className="px-3.5 pt-3 pb-2.5 rounded-t-xl relative overflow-hidden"
          style={{ backgroundColor: colors.bg }}
        >
          {/* OTA accent stripe */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ backgroundColor: otaAccent }}
          />

          {/* Name row: name left, chips right — same baseline */}
          <div className="flex items-start justify-between gap-2 pl-1.5">
            <div className="min-w-0 flex-1">
              {/* Guest name */}
              <p
                className="font-semibold text-[13px] leading-tight truncate"
                style={{ color: colors.text }}
              >
                {stay.guestName}
              </p>

              {/* Booking ref — below name, mono muted */}
              {bookingRef && (
                <p
                  className="font-mono text-[10px] mt-0.5 truncate tracking-wide"
                  style={{ color: `${colors.text}80` }}
                >
                  {bookingRef}
                </p>
              )}

              {/* Sub-status chip */}
              {stayStatus === 'DEPARTING' && (
                <p className="flex items-center gap-1 mt-1 text-[10px] font-semibold text-amber-700">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Sale hoy
                </p>
              )}
              {isUnconfirmed && !isPotentialNoShow && (
                <p className="flex items-center gap-1 mt-1 text-[10px] font-semibold text-amber-700">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Sin confirmar llegada
                </p>
              )}
              {isPotentialNoShow && !isConfirmedNoShow && (
                <p className="flex items-center gap-1 mt-1 text-[10px] font-semibold text-orange-700">
                  <UserX className="h-3 w-3 shrink-0" />
                  Posible no-show
                </p>
              )}
              {isConfirmedNoShow && (
                <p className="flex items-center gap-1 mt-1 text-[10px] font-semibold text-red-700">
                  <UserX className="h-3 w-3 shrink-0" />
                  No-show · {format(stay.noShowAt!, 'd MMM', { locale: es })}
                </p>
              )}
            </div>

            {/* Status + OTA badges — right side, aligned with name */}
            <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap leading-tight"
                style={{ backgroundColor: colors.border, color: colors.text }}
              >
                {colors.label}
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap leading-tight text-white shadow-sm"
                style={{ backgroundColor: otaAccent }}
              >
                {sourceColors.label}
              </span>
            </div>
          </div>
        </div>

        {/* Gradient separator */}
        <div className="h-px" style={{ background: `linear-gradient(90deg, ${colors.border}60, transparent)` }} />

        {/* ── Body — 2 rows, each with justify-between ─────────────── */}
        {/*
          Pixel-perfect alignment: each row is its own flex justify-between.
          Row 1: [fechas + noches] ←→ [moneda + monto]  — items-baseline
          Row 2: [huéspedes]       ←→ [PaymentBadge]    — items-center
          NNGroup (2022): izquierda = contexto temporal, derecha = valor financiero.
          Butterick: 22px bold para cifra primaria (2× ratio vs 11px label).
        */}
        <div className="px-3.5 py-3 space-y-1.5">

          {/* Row 1: fechas + noches ←→ monto */}
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1 min-w-0">
              <span className="text-[13px] font-semibold text-slate-800 shrink-0">{checkIn}</span>
              <span className="text-slate-300 text-[10px] shrink-0">→</span>
              <span className="text-[13px] font-semibold text-slate-800 shrink-0">{checkOut}</span>
              <span className="flex items-center gap-0.5 text-[11px] text-slate-500 shrink-0 ml-0.5">
                <Moon className="h-[10px] w-[10px] text-slate-400" />
                {stay.nights}n
              </span>
            </div>
            <div className="flex items-baseline gap-1 shrink-0">
              <span className="text-[11px] font-medium text-slate-400 tabular-nums leading-none">
                {stay.currency}
              </span>
              <span className="text-[22px] font-bold text-slate-800 tabular-nums leading-none">
                {stay.totalAmount.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Row 2: huéspedes ←→ payment badge */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-[11px] text-slate-500">
              <Users className="h-[11px] w-[11px] text-slate-400 shrink-0" />
              <span>{stay.paxCount} {stay.paxCount === 1 ? 'huésped' : 'huéspedes'}</span>
            </div>
            <PaymentStatusBadge status={stay.paymentStatus} />
          </div>

          {/* No-show compact alert (full width, solo si aplica) */}
          {isConfirmedNoShow && (
            <div className="flex items-center gap-1 rounded bg-red-50 border border-red-100 px-1.5 py-1">
              <UserX className="h-2.5 w-2.5 text-red-500 shrink-0" />
              <span className="text-[9px] font-semibold text-red-700 leading-tight">
                {canRevert ? 'Reversión activa' : 'Hab. liberada'}
              </span>
              {canRevert && <Clock className="h-2.5 w-2.5 text-red-400 shrink-0 ml-auto" />}
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────── */}
        {/*
          Detalle always present (rightmost slot) — ensures the footer is never empty.
          Operational actions auto-split the remaining width (flex-1 each).
          Elegant thin divider: border-t border-slate-100 at 1px — Stripe/Linear
          pattern for separating informational body from action zone without visual weight.
        */}
        <div className="border-t border-slate-100 flex rounded-b-xl overflow-hidden divide-x divide-slate-100">

          {/* Primary: Iniciar check-in */}
          {hasCheckin && (
            <button
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 transition-colors motion-reduce:transition-none"
              onClick={(e) => { e.stopPropagation(); onStartCheckin!(stay.id) }}
            >
              <LogIn className="h-3.5 w-3.5 shrink-0" />
              Check-in
            </button>
          )}

          {/* Warning: Marcar no-show */}
          {hasNoShow && (
            <button
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold text-white bg-orange-600 hover:bg-orange-700 active:bg-orange-800 transition-colors motion-reduce:transition-none"
              onClick={(e) => { e.stopPropagation(); onNoShow!(stay.id) }}
            >
              <UserX className="h-3.5 w-3.5 shrink-0" />
              No-show
            </button>
          )}

          {/* Recovery: Revertir no-show */}
          {hasRevert && (
            <button
              disabled={roomIsRebooked}
              title={roomIsRebooked ? 'Cuarto reasignado — mueve al nuevo huésped primero' : undefined}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold transition-colors motion-reduce:transition-none disabled:opacity-40 disabled:cursor-not-allowed text-amber-700 bg-amber-50 hover:bg-amber-100 active:bg-amber-200 disabled:hover:bg-amber-50"
              onClick={(e) => { e.stopPropagation(); if (!roomIsRebooked) onRevertNoShow!(stay.id) }}
            >
              <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              Revertir
            </button>
          )}

        </div>

        {/* ── Arrow ──────────────────────────────────────────────── */}
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
