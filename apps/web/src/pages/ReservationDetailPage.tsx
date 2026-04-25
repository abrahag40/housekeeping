import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, differenceInDays, differenceInHours } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ArrowLeft,
  Moon,
  Users,
  User,
  Phone,
  Mail,
  MapPin,
  FileText,
  LogOut,
  RotateCcw,
  Calendar,
  CreditCard,
  Tag,
  Hash,
  Clock,
  AlertTriangle,
  KeyRound,
  Smartphone,
  StickyNote,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { guestStaysApi } from '../modules/rooms/api/guest-stays.api'
import {
  OTA_ACCENT_COLORS,
  STAY_STATUS_COLORS,
} from '../modules/rooms/utils/timeline.constants'
import { getStayStatus } from '../modules/rooms/utils/timeline.utils'
import { PaymentStatusBadge } from '../modules/rooms/components/shared/PaymentStatusBadge'
import { OTA_OPTIONS } from '../modules/rooms/components/dialogs/CheckInDialog'
import { EarlyCheckoutDialog } from '../modules/rooms/components/dialogs/EarlyCheckoutDialog'
import { useCheckout, useRevertNoShow, useEarlyCheckout } from '../modules/rooms/hooks/useGuestStays'
import { KeyDeliveryType } from '@zenix/shared'
import type { GuestStayDto } from '@zenix/shared'
import type { PaymentStatus } from '../modules/rooms/types/timeline.types'

// ─── Key delivery helpers ─────────────────────────────────────────────────────

const KEY_LABELS: Record<KeyDeliveryType, string> = {
  [KeyDeliveryType.PHYSICAL]: 'Llave física',
  [KeyDeliveryType.CARD]:     'Tarjeta magnética',
  [KeyDeliveryType.CODE]:     'Código PIN',
  [KeyDeliveryType.MOBILE]:   'Acceso móvil',
}

// ─── Helper components ────────────────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
  mono = false,
  copyable = false,
}: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  mono?: boolean
  copyable?: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
      <div className="w-8 h-8 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-center flex-shrink-0">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
        <div
          className={cn(
            'text-sm text-slate-800 font-medium mt-0.5',
            mono && 'font-mono',
            copyable && 'select-all cursor-text',
          )}
        >
          {value ?? <span className="text-slate-300">—</span>}
        </div>
      </div>
    </div>
  )
}

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('bg-white rounded-xl border border-slate-200 overflow-hidden', className)}>
      {children}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function ReservationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false)
  const [showEarlyCheckout, setShowEarlyCheckout] = useState(false)

  const { data, isLoading, isError } = useQuery<GuestStayDto>({
    queryKey: ['guest-stay', id],
    queryFn: () => guestStaysApi.get(id!) as unknown as Promise<GuestStayDto>,
    enabled: !!id,
  })

  const checkoutMutation  = useCheckout(data?.propertyId ?? '')
  const revertMutation    = useRevertNoShow(data?.propertyId ?? '')
  const earlyCheckoutMut  = useEarlyCheckout(data?.propertyId ?? '')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        Cargando reserva…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-slate-400">
        <AlertTriangle className="h-8 w-8 text-amber-400" />
        <p className="text-sm">No se encontró la reserva.</p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Volver
        </Button>
      </div>
    )
  }

  const checkIn   = new Date(data.checkinAt)
  const checkOut  = new Date(data.scheduledCheckout)
  const nights    = Math.max(1, differenceInDays(checkOut, checkIn))

  const ratePerNight  = parseFloat(data.ratePerNight)
  const totalAmount   = parseFloat(data.totalAmount)
  const amountPaid    = parseFloat(data.amountPaid)
  const balance       = totalAmount - amountPaid
  const paidPercent   = totalAmount > 0 ? Math.round((amountPaid / totalAmount) * 100) : 0

  const status       = getStayStatus(checkIn, checkOut, data.actualCheckout ? new Date(data.actualCheckout) : undefined)
  const statusColors = STAY_STATUS_COLORS[status]
  const source       = data.source ?? 'other'
  const otaColor     = OTA_ACCENT_COLORS[source] ?? OTA_ACCENT_COLORS.other
  const otaOption    = OTA_OPTIONS.find(o => o.value === source)
  const otaName      = otaOption?.label ?? source

  const isNoShow  = !!data.noShowAt
  const canRevert = isNoShow && differenceInHours(new Date(), new Date(data.noShowAt!)) < 48

  const statusLabel = isNoShow ? 'No-show' : statusColors.label
  const roomNumber  = data.room?.number

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* ── Back ── */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </button>

      {/* ── Hero card ── */}
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: `${otaColor}40` }}
      >
        {/* OTA accent stripe */}
        <div className="h-1" style={{ backgroundColor: otaColor }} />

        {/* Header area */}
        <div className="px-6 py-5" style={{ backgroundColor: statusColors.bg }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span
                  className="text-xs font-bold px-2.5 py-1 rounded-full"
                  style={{
                    backgroundColor: isNoShow ? '#FEE2E2' : `${otaColor}20`,
                    color: isNoShow ? '#B91C1C' : otaColor,
                    border: `1px solid ${isNoShow ? '#FCA5A5' : `${otaColor}40`}`,
                  }}
                >
                  {statusLabel}
                </span>
                <span
                  className="text-xs font-semibold px-2.5 py-1 rounded-full text-white"
                  style={{ backgroundColor: otaColor }}
                >
                  {otaName}
                </span>
              </div>

              <h1 className="text-2xl font-bold truncate" style={{ color: statusColors.text }}>
                {data.guestName}
              </h1>

              {roomNumber && (
                <p className="text-sm mt-1" style={{ color: `${statusColors.text}99` }}>
                  Habitación {roomNumber}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
              {canRevert && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                  disabled={revertMutation.isPending}
                  onClick={() =>
                    revertMutation.mutate(id!, {
                      onSuccess: () =>
                        qc.invalidateQueries({ queryKey: ['guest-stay', id] }),
                    })
                  }
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  {revertMutation.isPending ? 'Revirtiendo…' : 'Revertir no-show'}
                </Button>
              )}

              {/* DEPARTING: checkout en fecha programada con confirmación inline */}
              {!isNoShow && status === 'DEPARTING' && (
                showCheckoutConfirm ? (
                  <div className="flex gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => setShowCheckoutConfirm(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="text-xs text-white bg-amber-600 hover:bg-amber-700"
                      disabled={checkoutMutation.isPending}
                      onClick={() =>
                        checkoutMutation.mutate(id!, {
                          onSuccess: () => {
                            setShowCheckoutConfirm(false)
                            qc.invalidateQueries({ queryKey: ['guest-stay', id] })
                          },
                        })
                      }
                    >
                      <LogOut className="h-3.5 w-3.5 mr-1.5" />
                      {checkoutMutation.isPending ? 'Procesando…' : 'Confirmar checkout'}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    className="text-xs text-white bg-amber-600 hover:bg-amber-700"
                    onClick={() => setShowCheckoutConfirm(true)}
                  >
                    <LogOut className="h-3.5 w-3.5 mr-1.5" />
                    Checkout
                  </Button>
                )
              )}

              {/* IN_HOUSE: salida anticipada (antes de la fecha programada) */}
              {!isNoShow && status === 'IN_HOUSE' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs border-amber-200 text-amber-700 hover:bg-amber-50"
                  onClick={() => setShowEarlyCheckout(true)}
                >
                  <LogOut className="h-3.5 w-3.5 mr-1.5" />
                  Salida anticipada
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Quick-stats bar */}
        <div className="bg-white px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-slate-100">
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Check-in</div>
            <div className="text-sm font-bold text-slate-800">
              {format(checkIn, 'EEE d MMM yyyy', { locale: es })}
            </div>
            <div className="text-xs text-slate-400">15:00</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Check-out</div>
            <div className="text-sm font-bold text-slate-800">
              {format(checkOut, 'EEE d MMM yyyy', { locale: es })}
            </div>
            <div className="text-xs text-slate-400">12:00</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Noches</div>
            <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Moon className="h-3.5 w-3.5 text-slate-300" />
              {nights}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Huéspedes</div>
            <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-slate-300" />
              {data.paxCount}
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="stay">
        <TabsList className="w-full h-10 bg-slate-100 rounded-xl p-1 grid grid-cols-4">
          {(['stay', 'payment', 'guest', 'history'] as const).map((v) => (
            <TabsTrigger
              key={v}
              value={v}
              className={cn(
                'rounded-lg text-xs font-medium transition-all text-slate-500',
                'data-[state=active]:bg-white data-[state=active]:shadow-sm',
                'data-[state=active]:text-slate-900 data-[state=active]:font-semibold',
              )}
            >
              {v === 'stay' ? 'Estadía' : v === 'payment' ? 'Pago' : v === 'guest' ? 'Huésped' : 'Historial'}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── TAB: ESTADÍA ── */}
        <TabsContent value="stay" className="mt-4 space-y-4">
          <SectionCard>
            <InfoRow icon={Calendar} label="Check-in"
              value={format(checkIn, "EEEE d 'de' MMMM yyyy — HH:mm", { locale: es })} />
            <InfoRow icon={Calendar} label="Check-out"
              value={format(checkOut, "EEEE d 'de' MMMM yyyy — HH:mm", { locale: es })} />
            <InfoRow icon={Moon}    label="Noches"    value={`${nights} noche${nights !== 1 ? 's' : ''}`} />
            {roomNumber && (
              <InfoRow icon={MapPin} label="Habitación" value={`Hab. ${roomNumber}`} />
            )}
            <InfoRow icon={Users}  label="Huéspedes" value={`${data.paxCount} pax`} />
            <InfoRow icon={Tag}    label="Canal de venta" value={otaName} />
            {data.actualCheckin && (
              <InfoRow icon={Clock} label="Check-in real"
                value={format(new Date(data.actualCheckin), "dd/MM/yyyy HH:mm", { locale: es })} />
            )}
            {data.keyType && (
              <InfoRow
                icon={data.keyType === KeyDeliveryType.MOBILE ? Smartphone : KeyRound}
                label="Acceso entregado"
                value={KEY_LABELS[data.keyType as KeyDeliveryType]}
              />
            )}
          </SectionCard>

          <SectionCard>
            <InfoRow icon={Hash}  label="ID de reserva" value={data.id} mono copyable />
            <InfoRow icon={Clock} label="Creada"
              value={format(new Date(data.createdAt), "dd/MM/yyyy HH:mm", { locale: es })} />
            <InfoRow icon={Clock} label="Actualizada"
              value={format(new Date(data.updatedAt), "dd/MM/yyyy HH:mm", { locale: es })} />
          </SectionCard>

          {data.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1.5">Solicitudes especiales</div>
              <p className="text-sm text-amber-800">{data.notes}</p>
            </div>
          )}

          {data.arrivalNotes && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                <StickyNote className="h-3 w-3" />
                Notas de llegada
              </div>
              <p className="text-sm text-slate-700">{data.arrivalNotes}</p>
            </div>
          )}

          {isNoShow && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                <span className="text-sm font-semibold text-red-700">Marcado como no-show</span>
              </div>
              <div className="text-xs text-red-600 space-y-1 pl-6">
                <p>Fecha: {format(new Date(data.noShowAt!), "dd/MM/yyyy HH:mm", { locale: es })}</p>
                {data.noShowReason && <p>Razón: {data.noShowReason}</p>}
                {data.noShowChargeStatus && (
                  <p>Estado del cargo: <span className="font-mono font-bold">{data.noShowChargeStatus}</span></p>
                )}
                {data.noShowFeeAmount && data.noShowFeeCurrency && (
                  <p>Fee: <span className="font-mono font-bold">
                    {data.noShowFeeCurrency} {parseFloat(data.noShowFeeAmount).toFixed(2)}
                  </span></p>
                )}
              </div>
              {canRevert && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs border-amber-200 text-amber-700 hover:bg-amber-50 ml-6"
                  onClick={() => navigate('/pms')}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                  Revertir (ventana de 48h)
                </Button>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── TAB: PAGO ── */}
        <TabsContent value="payment" className="mt-4 space-y-4">
          <SectionCard>
            <InfoRow icon={CreditCard} label="Total" value={
              <span className="font-mono font-bold text-slate-800">
                {data.currency} {totalAmount.toLocaleString()}
              </span>
            } />
            <InfoRow icon={CreditCard} label={`Pagado (${paidPercent}%)`} value={
              <span className={cn('font-mono font-bold', amountPaid >= totalAmount ? 'text-emerald-600' : 'text-amber-600')}>
                {data.currency} {amountPaid.toLocaleString()}
              </span>
            } />
            <InfoRow icon={CreditCard} label="Saldo pendiente" value={
              <span className={cn('font-mono font-bold', balance <= 0 ? 'text-emerald-600' : 'text-amber-600')}>
                {data.currency} {Math.max(0, balance).toLocaleString()}
              </span>
            } />
            <InfoRow icon={CreditCard} label="Tarifa / noche" value={
              <span className="font-mono">{data.currency} {ratePerNight.toFixed(2)}</span>
            } />
          </SectionCard>

          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Progreso de pago</span>
              <span className="font-mono font-bold text-slate-700">{paidPercent}%</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(paidPercent, 100)}%`,
                  backgroundColor: paidPercent >= 100 ? '#10B981' : paidPercent >= 50 ? '#F59E0B' : '#EF4444',
                }}
              />
            </div>
            <Separator />
            <PaymentStatusBadge status={data.paymentStatus as PaymentStatus} />
          </div>
        </TabsContent>

        {/* ── TAB: HUÉSPED ── */}
        <TabsContent value="guest" className="mt-4">
          <SectionCard>
            {[
              { icon: User,     label: 'Nombre completo',     value: data.guestName },
              { icon: Phone,    label: 'WhatsApp / Teléfono', value: data.guestPhone },
              { icon: Mail,     label: 'Email',               value: data.guestEmail },
              { icon: MapPin,   label: 'Nacionalidad',        value: data.nationality },
              {
                icon: FileText,
                label: 'Documento',
                value: data.documentType
                  ? `${data.documentType.toUpperCase()}${data.documentNumber ? ` · ···${data.documentNumber.slice(-4)}` : ''}`
                  : null,
              },
            ]
              .filter((f) => f.value)
              .map(({ icon: Icon, label, value }) => (
                <InfoRow key={label} icon={Icon} label={label} value={value} />
              ))}
          </SectionCard>
        </TabsContent>

        {/* ── TAB: HISTORIAL ── */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="relative pl-8">
              {/* Vertical line */}
              <div className="absolute left-[27px] top-0 bottom-0 w-px bg-slate-100" />

              {/* Created */}
              <TimelineEvent
                color="bg-slate-300"
                title="Reserva creada"
                timestamp={data.createdAt}
              />

              {/* No-show */}
              {isNoShow && (
                <TimelineEvent
                  color="bg-red-400"
                  title="Marcado como no-show"
                  subtitle={data.noShowReason ?? undefined}
                  timestamp={data.noShowAt!}
                />
              )}

              {/* No-show reverted */}
              {data.noShowRevertedAt && (
                <TimelineEvent
                  color="bg-amber-400"
                  title="No-show revertido"
                  timestamp={data.noShowRevertedAt}
                />
              )}

              {/* Checkout */}
              {data.actualCheckout && (
                <TimelineEvent
                  color="bg-emerald-400"
                  title="Checkout realizado"
                  timestamp={data.actualCheckout}
                />
              )}

              {/* Last updated (only if different from created) */}
              {data.updatedAt !== data.createdAt && (
                <TimelineEvent
                  color="bg-slate-200"
                  title="Última modificación"
                  timestamp={data.updatedAt}
                />
              )}
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            El historial completo de auditoría estará disponible con el módulo StayJourney.
          </p>
        </TabsContent>
      </Tabs>

      {data && (status === 'IN_HOUSE') && (
        <EarlyCheckoutDialog
          open={showEarlyCheckout}
          onClose={() => setShowEarlyCheckout(false)}
          onConfirm={(notes) => {
            earlyCheckoutMut.mutate(
              { stayId: id!, notes },
              {
                onSuccess: () => {
                  setShowEarlyCheckout(false)
                  qc.invalidateQueries({ queryKey: ['guest-stay', id] })
                },
              },
            )
          }}
          isPending={earlyCheckoutMut.isPending}
          guestName={data.guestName}
          roomLabel={data.room?.number ? `Hab. ${data.room.number}` : 'Habitación'}
          checkinAt={new Date(data.checkinAt)}
          scheduledCheckout={new Date(data.scheduledCheckout)}
        />
      )}
    </div>
  )
}

// ─── Timeline event ───────────────────────────────────────────────────────────

function TimelineEvent({
  color,
  title,
  subtitle,
  timestamp,
}: {
  color: string
  title: string
  subtitle?: string
  timestamp: string
}) {
  return (
    <div className="flex items-start gap-4 px-4 py-3.5 border-b border-slate-100 last:border-0">
      <div className={cn('w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 -ml-5 z-10', color)} />
      <div>
        <div className="text-xs font-semibold text-slate-700">{title}</div>
        {subtitle && <div className="text-[11px] text-slate-500 mt-0.5">{subtitle}</div>}
        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
          {format(new Date(timestamp), 'dd/MM/yyyy HH:mm:ss')}
        </div>
      </div>
    </div>
  )
}
