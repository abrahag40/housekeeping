import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  User,
  CreditCard,
  MapPin,
  Moon,
  Users,
  Phone,
  Mail,
  FileText,
  LogOut,
  ArrowRightLeft,
} from 'lucide-react'

import { format, differenceInDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { cn } from '@/lib/utils'

import {
  STAY_STATUS_COLORS,
  OTA_ACCENT_COLORS,
} from '../../utils/timeline.constants'

import { getStayStatus } from '../../utils/timeline.utils'
import { PaymentStatusBadge } from '../shared/PaymentStatusBadge'

import type { GuestStayBlock } from '../../types/timeline.types'

interface BookingDetailSheetProps {
  stay: GuestStayBlock | null
  open: boolean
  onClose: () => void
  onCheckout: (stayId: string) => void
  onMoveRoom: (stayId: string) => void
}

export function BookingDetailSheet({
  stay,
  open,
  onClose,
  onCheckout,
  onMoveRoom,
}: BookingDetailSheetProps) {
  if (!stay) return null

  const status = getStayStatus(stay.checkIn, stay.checkOut, stay.actualCheckout)
  const statusColors = STAY_STATUS_COLORS[status]
  const otaColor = OTA_ACCENT_COLORS[stay.source] ?? OTA_ACCENT_COLORS.other

  const nights = differenceInDays(
    new Date(stay.checkOut),
    new Date(stay.checkIn)
  )

  const nightlyRate =
    nights > 0 ? stay.totalAmount / nights : stay.totalAmount

  const paidPercent =
    stay.totalAmount > 0
      ? Math.round((stay.amountPaid / stay.totalAmount) * 100)
      : 0

  const balance = stay.totalAmount - stay.amountPaid

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[420px] sm:w-[420px] sm:max-w-[420px] p-0 flex flex-col overflow-hidden gap-0"
      >
        {/* HEADER */}
        <div
          className="px-5 py-4 flex-shrink-0"
          style={{ backgroundColor: statusColors.bg }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle
                className="text-lg font-bold truncate"
                style={{ color: statusColors.text }}
              >
                {stay.guestName}
              </SheetTitle>

              <div className="flex items-center gap-2 mt-1">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: `${otaColor}20`,
                    color: otaColor,
                    border: `1px solid ${otaColor}40`,
                  }}
                >
                  {status === 'IN_HOUSE'
                    ? 'Alojado'
                    : status === 'ARRIVING'
                    ? 'Por llegar'
                    : status === 'DEPARTING'
                    ? 'Sale hoy'
                    : 'Salió'}
                </span>

                {stay.otaName && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: otaColor }}
                  >
                    {stay.otaName}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* OTA accent */}
        <div
          className="h-[3px] flex-shrink-0"
          style={{ backgroundColor: otaColor }}
        />

        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="stay" className="h-full flex flex-col">
            <TabsList className="w-full rounded-none border-b px-4 bg-white h-10">
              <TabsTrigger value="stay" className="flex-1 text-xs">
                Estadía
              </TabsTrigger>

              <TabsTrigger value="payment" className="flex-1 text-xs">
                Pago
              </TabsTrigger>

              <TabsTrigger value="guest" className="flex-1 text-xs">
                Huésped
              </TabsTrigger>
            </TabsList>

            {/* TAB ESTADÍA */}
            <TabsContent value="stay" className="mt-0 overflow-y-auto">
              <div className="p-4 space-y-3">
                {/* Fechas */}
                <div className="bg-slate-50 rounded-xl p-4">
                  <div className="flex items-stretch gap-3">
                    {/* Checkin */}
                    <div className="flex-1">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Check-in
                      </div>

                      <div className="text-base font-bold text-slate-800 mt-1 leading-tight">
                        {format(new Date(stay.checkIn), 'EEE d MMM', {
                          locale: es,
                        })}
                      </div>

                      <div className="text-sm font-semibold text-slate-700">
                        {format(new Date(stay.checkIn), 'yyyy', {
                          locale: es,
                        })}
                      </div>

                      <div className="text-xs text-slate-400 mt-0.5">
                        15:00
                      </div>
                    </div>

                    {/* Nights */}
                    <div className="flex flex-col items-center justify-center px-2">
                      <Moon className="h-4 w-4 text-slate-300 mb-1" />

                      <div className="text-sm font-bold font-mono text-slate-600">
                        {nights}n
                      </div>

                      <div className="w-8 h-px bg-slate-200 my-1" />
                    </div>

                    {/* Checkout */}
                    <div className="flex-1 text-right">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Check-out
                      </div>

                      <div className="text-base font-bold text-slate-800 mt-1 leading-tight">
                        {format(new Date(stay.checkOut), 'EEE d MMM', {
                          locale: es,
                        })}
                      </div>

                      <div className="text-sm font-semibold text-slate-700">
                        {format(new Date(stay.checkOut), 'yyyy', {
                          locale: es,
                        })}
                      </div>

                      <div className="text-xs text-slate-400 mt-0.5">
                        12:00
                      </div>
                    </div>
                  </div>
                </div>

                {/* Room + pax */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Habitación
                    </div>

                    <div className="text-base font-bold text-slate-800 mt-1">
                      {stay.roomNumber ??
                        stay.roomId.replace('r-', 'Hab. ')}
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Huéspedes
                    </div>

                    <div className="text-base font-bold text-slate-800 mt-1 flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-slate-400" />
                      {stay.paxCount}
                    </div>
                  </div>
                </div>

                {/* IDs */}
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Identificadores
                  </div>

                  <div className="bg-slate-50 rounded-lg overflow-hidden divide-y divide-slate-100">
                    <div className="flex items-center justify-between px-3 py-2.5">
                      <span className="text-xs text-slate-400 font-mono uppercase tracking-wide">
                        PMS ID
                      </span>

                      <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200 select-all cursor-text">
                        {stay.pmsReservationId ?? '—'}
                      </span>
                    </div>

                    {stay.otaReservationId && (
                      <div className="flex items-center justify-between px-3 py-2.5">
                        <span className="text-xs text-slate-400 font-mono uppercase tracking-wide">
                          {stay.otaName} ID
                        </span>

                        <span className="text-xs font-mono font-bold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200 select-all cursor-text">
                          {stay.otaReservationId}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Notes */}
                {stay.notes && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                    <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">
                      Nota
                    </div>

                    <div className="text-xs text-amber-800">
                      {stay.notes}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* TAB PAYMENT */}
            <TabsContent value="payment" className="mt-0 flex-1 overflow-y-auto">
              <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">
                    {nights} noche{nights > 1 ? 's' : ''} × {stay.currency}{' '}
                    {nightlyRate.toFixed(0)}
                  </span>

                  <span className="text-sm font-mono font-bold text-slate-800">
                    {stay.currency}{' '}
                    {stay.totalAmount.toLocaleString()}
                  </span>
                </div>

                <Separator />

                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">
                    Pagado
                  </span>

                  <span className="text-sm font-mono font-semibold text-emerald-600">
                    {stay.currency}{' '}
                    {stay.amountPaid.toLocaleString()}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-700">
                    Saldo pendiente
                  </span>

                  <span
                    className={cn(
                      'text-sm font-mono font-bold',
                      balance > 0
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                    )}
                  >
                    {stay.currency} {balance.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>Progreso de pago</span>
                  <span className="font-mono font-bold">
                    {paidPercent}%
                  </span>
                </div>

                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${paidPercent}%`,
                      backgroundColor:
                        paidPercent >= 100
                          ? '#10B981'
                          : paidPercent >= 50
                          ? '#F59E0B'
                          : '#EF4444',
                    }}
                  />
                </div>

                <PaymentStatusBadge status={stay.paymentStatus} />
              </div>
            </TabsContent>

            {/* TAB GUEST */}
            <TabsContent value="guest" className="mt-0 flex-1 overflow-y-auto">
              <div className="p-4 space-y-2">
                {[
                  { icon: User, label: 'Nombre', value: stay.guestName },
                  { icon: Phone, label: 'WhatsApp', value: stay.guestPhone },
                  { icon: MapPin, label: 'Nacionalidad', value: stay.nationality },
                  {
                    icon: FileText,
                    label: 'Documento',
                    value:
                      stay.documentType && stay.documentNumber
                        ? `${stay.documentType.toUpperCase()} · ${stay.documentNumber}`
                        : null,
                  },
                  { icon: Mail, label: 'Email', value: stay.guestEmail },
                ]
                  .filter((f) => f.value)
                  .map(({ icon: Icon, label, value }) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 rounded-lg"
                    >
                      <div className="w-7 h-7 bg-white rounded-md border border-slate-200 flex items-center justify-center flex-shrink-0">
                        <Icon className="h-3.5 w-3.5 text-slate-400" />
                      </div>

                      <div className="min-w-0">
                        <div className="text-[9px] text-slate-400 uppercase tracking-wider">
                          {label}
                        </div>

                        <div className="text-sm text-slate-700 font-medium truncate">
                          {value}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* FOOTER */}
        <div className="flex-shrink-0 border-t border-slate-200 p-3 bg-white">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-xs"
              onClick={() => onMoveRoom(stay.id)}
            >
              <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
              Mover hab.
            </Button>

            {(status === 'IN_HOUSE' || status === 'DEPARTING') && (
              <Button
                size="sm"
                className={cn(
                  'flex-1 text-xs text-white',
                  status === 'DEPARTING'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-slate-800 hover:bg-slate-700',
                )}
                onClick={() => onCheckout(stay.id)}
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                {status === 'DEPARTING' ? 'Confirmar checkout' : 'Checkout'}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}