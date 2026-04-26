import { useSoftLock } from '@/hooks/useSoftLock'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState, useEffect } from 'react'
import PhoneInput, { isValidPhoneNumber } from 'react-phone-number-input'
import 'react-phone-number-input/style.css'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel,
         AlertDialogContent, AlertDialogDescription,
         AlertDialogFooter, AlertDialogHeader,
         AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem,
         SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { format, addDays, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { User, CreditCard, CheckCircle,
         ChevronRight, ChevronLeft,
         AlertCircle, Moon, Loader2, Ban } from 'lucide-react'
import { guestStaysApi } from '../../api/guest-stays.api'
import type { AvailabilityConflict } from '@zenix/shared'
         

// ── OTA CONFIG (colores y nombres oficiales) ──────────────────
export const OTA_OPTIONS = [
  { value: 'walk-in',      label: 'Walk-in',       color: '#64748B' },
  { value: 'direct',       label: 'Directo',        color: '#059669' },
  { value: 'booking',      label: 'Booking.com',    color: '#003580' },
  { value: 'expedia',      label: 'Expedia',        color: '#B45309' },
  { value: 'airbnb',       label: 'Airbnb',         color: '#E11D48' },
  { value: 'hotels_com',   label: 'Hotels.com',     color: '#C2001A' },
  { value: 'agoda',        label: 'Agoda',          color: '#5C3B8C' },
  { value: 'tripadvisor',  label: 'Tripadvisor',    color: '#34E0A1' },
  { value: 'hostelworld',  label: 'Hostelworld',    color: '#F97316' },
  { value: 'despegar',     label: 'Despegar',       color: '#0055A5' },
  { value: 'google',       label: 'Google Hotels',  color: '#4285F4' },
  { value: 'other',        label: 'Otro',           color: '#7C3AED' },
] as const

export type OtaSource = typeof OTA_OPTIONS[number]['value']

// ── SCHEMA SIMPLIFICADO — solo campos verdaderamente críticos ──
// Referencia: Mews, Cloudbeds y Opera solo requieren nombre en walk-in rápido

const nameRegex = /^[a-zA-ZÀ-ÿ' -]+$/;

const step1Schema = z.object({
  firstName: z.string()
  .trim()
  .min(2, 'Mínimo 2 caracteres')
  .max(100)
  .regex(nameRegex, 'Nombre inválido'),

  lastName: z.string()
  .trim()
  .min(2, 'Mínimo 2 caracteres')
  .max(100)
  .regex(nameRegex, 'Apellido inválido'),

  guestEmail: z.union([
    z.string().email('Email inválido'),
    z.literal(''),
  ]).optional(),

  guestPhone: z.string().optional(),

  nationality: z.string()
  .trim()
  .min(2, 'Requerido')
  .max(80)
  .regex(nameRegex, 'Solo letras'),

  documentType: z.string().optional(),
  documentPhoto: z.string().optional(),

  adults: z.coerce.number().int().min(1, 'Mínimo 1').max(20, 'Máximo 20'),
  children: z.coerce.number().int().min(0).max(10)
})

const step2Schema = z.object({
  checkIn:       z.date(),
  checkOut:      z.date(),
  ratePerNight:  z.coerce.number().min(1, 'Debe ser mayor a 0'),
  currency:      z.enum(['USD', 'MXN', 'EUR']),
  source:        z.string().min(1, 'Selecciona el canal'),
  otaName:       z.string().optional(),
  amountPaid:    z.coerce.number().min(0),
  paymentMethod: z.enum(['cash', 'card', 'transfer']),
  notes:         z.string().max(500).optional(),
}).refine(d => d.checkOut > d.checkIn, {
  message: 'El checkout debe ser posterior al check-in',
  path: ['checkOut'],
})

// Zod 4 coerce.number() has input=unknown and output=number. For react-hook-form
// + @hookform/resolvers v5 we need the *input* type for the field values generic
// (what the form accepts) and the *output* type for the submit handler (after
// coercion). See `useForm<TInput, TContext, TOutput>` below.
type Step1Input  = z.input<typeof step1Schema>
type Step1Data   = z.output<typeof step1Schema>
type Step2Input  = z.input<typeof step2Schema>
type Step2Data   = z.output<typeof step2Schema>

export interface NewStayData extends Step1Data, Step2Data {
  roomId: string
}

// ── ERROR FIELD ───────────────────────────────────────────────
function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="flex items-center gap-1 mt-1 text-xs text-red-500">
      <AlertCircle className="h-3 w-3 shrink-0" />
      {message}
    </p>
  )
}

// ── STEP INDICATOR ────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Huésped',  icon: User },
  { id: 2, label: 'Estadía',  icon: CreditCard },
  { id: 3, label: 'Confirmar',icon: CheckCircle },
]

// ── PROPS ─────────────────────────────────────────────────────
interface CheckInDialogProps {
  open: boolean
  onClose: () => void
  initialRoomId?: string
  roomNumber?: string
  initialCheckIn?: Date
  onConfirm: (data: NewStayData) => void
  propertyId?: string
}

// ── COMPONENTE ────────────────────────────────────────────────
export function CheckInDialog({
  open, onClose, initialRoomId, roomNumber, initialCheckIn, onConfirm, propertyId
}: CheckInDialogProps) {
  // Advisory soft-lock: acquired while this dialog is open, released on close.
  // Other receptionists viewing the same calendar see a 🔒 badge on this room.
  useSoftLock(open && initialRoomId ? initialRoomId : null, propertyId ?? null)
  const [step, setStep] = useState(1)
  const [showCancelAlert, setShowCancelAlert] = useState(false)

  // ── AVAILABILITY STATE ──
  // 'idle'      — no check run yet (dates not set or just reset)
  // 'checking'  — request in flight (button disabled: don't advance with stale data)
  // 'available' — confirmed available
  // 'conflict'  — hard conflict found (button disabled, shows inline alert)
  // 'error'     — network / server error → fail open, backend is the final guard
  //   Note: 401 (session expired) is handled globally by api/client.ts which
  //   redirects to /login before this catch block can run.
  type AvailStatus = 'idle' | 'checking' | 'available' | 'conflict' | 'error'
  const [availStatus, setAvailStatus] = useState<AvailStatus>('idle')
  const [availConflicts, setAvailConflicts] = useState<AvailabilityConflict[]>([])

  // ── FORM PASO 1 ──
  const f1 = useForm<Step1Input, unknown, Step1Data>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      firstName: '', lastName: '', guestEmail: '',
      guestPhone: '', nationality: '',
      adults: 1, children: 0,
    },
  })

  // ── FORM PASO 2 ──
  const today = new Date()
  today.setHours(0,0,0,0)
  const f2 = useForm<Step2Input, unknown, Step2Data>({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      checkIn:       initialCheckIn ?? today,
      checkOut:      addDays(initialCheckIn ?? today, 1),
      currency:      'USD',
      source:        'walk-in',
      otaName:       'Walk-in',
      amountPaid:    0,
      paymentMethod: 'cash',
      notes:         '',
    },
  })

  // Reset al abrir
  useEffect(() => {
    if (!open) return
    f1.reset({
      firstName: '', lastName: '', guestEmail: '',
      guestPhone: '', nationality: '',
      adults: 1, children: 0,
    })
    f2.reset({
      checkIn:       initialCheckIn ?? today,
      checkOut:      addDays(initialCheckIn ?? today, 1),
      currency:      'USD', source: 'walk-in', otaName: 'Walk-in',
      amountPaid: 0, paymentMethod: 'cash', notes: '',
    })
    setStep(1)
    setAvailStatus('idle')
    setAvailConflicts([])
  }, [open]) // eslint-disable-line

  // Detectar si hay datos para la alerta de cierre
  const firstName = f1.watch('firstName')
  const lastName  = f1.watch('lastName')
  const hasData   = (firstName?.trim().length ?? 0) > 0 ||
                    (lastName?.trim().length ?? 0) > 0

  function handleCloseAttempt() {
    if (hasData) setShowCancelAlert(true)
    else onClose()
  }

  // ── SIGUIENTE PASO CON VALIDACIÓN EXPLÍCITA ──
  async function handleNext() {
    console.log(f1.getValues())
    console.log(f1.formState.errors)
    if (step === 1) {
      // Trigger explícito y verificar errores
      const ok = await f1.trigger(undefined, { shouldFocus: true })
      if (!ok) {
        // Scroll al primer error
        const el = document.querySelector('[data-field-error]')
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      setStep(2)
    } else if (step === 2) {
      const ok = await f2.trigger()
      if (!ok) return
      // Block if check is in flight or a hard conflict was found
      if (availStatus === 'checking') return
      if (availStatus === 'conflict' && availConflicts.some(c => c.severity === 'HARD')) return
      setStep(3)
    }
  }

  function handleConfirm() {
    // getValues() returns the raw (input) form values; coerced fields like
    // `adults` and `ratePerNight` still look `unknown` at the type level.
    // Parse through the schemas once so the outgoing payload matches
    // NewStayData (numbers already coerced from the inputs' string values).
    const step1 = step1Schema.parse(f1.getValues())
    const step2 = step2Schema.parse(f2.getValues())
    onConfirm({
      ...step1,
      ...step2,
      roomId: initialRoomId ?? '',
    })
    onClose()
  }

  // ── CÁMARA ──
  // ── VALORES CALCULADOS ──
  // `ratePerNight` and `amountPaid` go through `z.coerce.number()`, so their
  // input type is `unknown`. Coerce here so the arithmetic below is typed.
  const checkIn       = f2.watch('checkIn')
  const checkOut      = f2.watch('checkOut')
  const rate          = Number(f2.watch('ratePerNight') ?? 0)
  const currency      = f2.watch('currency')
  const amountPaid    = Number(f2.watch('amountPaid') ?? 0)
  const source        = f2.watch('source')

  const nights = (checkIn && checkOut)
    ? Math.max(1, Math.round(
        (new Date(checkOut).getTime() - new Date(checkIn).getTime())
        / 86400000
      ))
    : 1
  const total   = rate * nights
  const balance = total - amountPaid

  const selectedOta = OTA_OPTIONS.find(o => o.value === source)

  // ── AVAILABILITY CHECK — debounced, triggers when dates change on Step 2 ──
  useEffect(() => {
    // Only run when the user is on Step 2 and a roomId is known
    if (step !== 2 || !initialRoomId) return

    const ciDate = checkIn  ? new Date(checkIn)  : null
    const coDate = checkOut ? new Date(checkOut) : null

    // Require both dates to be valid and logically ordered
    if (!ciDate || !coDate || isNaN(ciDate.getTime()) || isNaN(coDate.getTime())) return
    if (coDate <= ciDate) return

    setAvailStatus('checking')
    setAvailConflicts([])

    // 400 ms debounce — avoids hammering the API on each date picker keystroke
    const timer = setTimeout(async () => {
      try {
        const result = await guestStaysApi.checkAvailability(initialRoomId, ciDate, coDate)
        setAvailStatus(result.available ? 'available' : 'conflict')
        setAvailConflicts(result.conflicts)
      } catch {
        // 401 → api/client.ts global handler redirects to /login before we get here.
        // Any other error (network, 500) → fail open; backend create() is the final guard.
        setAvailStatus('error')
        setAvailConflicts([])
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [step, initialRoomId, checkIn, checkOut]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Dialog open={open}
              onOpenChange={o => { if (!o) handleCloseAttempt() }}>
        <DialogContent
          className="sm:max-w-[520px] p-0 gap-0 overflow-hidden
                     shadow-[0_25px_50px_-12px_rgba(0,0,0,0.35)]
                     bg-[#FAFAFA]"
          onInteractOutside={e => { e.preventDefault(); handleCloseAttempt() }}
          onEscapeKeyDown={e => { e.preventDefault(); handleCloseAttempt() }}
        >
          {/* HEADER */}
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-slate-100 bg-white">
            <DialogTitle className="text-base font-bold text-slate-800">
              Nueva Reserva — Hab.&nbsp;
              {roomNumber ?? initialRoomId?.slice(0, 8) ?? '—'}
            </DialogTitle>
            <div className="flex items-center gap-0 mt-4">
              {STEPS.map((s, i) => {
                const Icon = s.icon
                const active = s.id === step
                const done   = s.id < step
                return (
                  <div key={s.id} className="flex items-center">
                    <div className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
                      'text-xs font-semibold transition-all',
                      active && 'bg-slate-800 text-white shadow-sm',
                      done   && 'text-emerald-600 bg-emerald-50',
                      !active && !done && 'text-slate-400',
                    )}>
                      <Icon className="h-3 w-3" />{s.label}
                    </div>
                    {i < 2 && (
                      <div className={cn('w-8 h-0.5 mx-1 rounded-full',
                        done ? 'bg-emerald-300' : 'bg-slate-200')} />
                    )}
                  </div>
                )
              })}
            </div>
          </DialogHeader>

          {/* CONTENT */}
          <div className="px-6 py-5 overflow-y-auto max-h-[65vh] space-y-4">

            {/* ══ STEP 1 ══════════════════════════════════════════════ */}
            {step === 1 && (
              <>
                {/* Nombre / Apellido */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-600">
                      Nombre(s) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      {...f1.register('firstName', {
                        setValueAs: v => v.trimStart()
                      })}
                      placeholder="Sarah"
                      autoFocus
                      className={cn('h-9 text-sm bg-white',
                        f1.formState.errors.firstName && 'border-red-400')}
                    />
                    {f1.formState.errors.firstName && (
                      <div data-field-error>
                        <FieldError message={f1.formState.errors.firstName.message} />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-600">
                      Apellido(s) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      {...f1.register('lastName')}
                      placeholder="Johnson"
                      className={cn('h-9 text-sm bg-white',
                        f1.formState.errors.lastName && 'border-red-400')}
                    />
                    {f1.formState.errors.lastName && (
                      <div data-field-error>
                        <FieldError message={f1.formState.errors.lastName.message} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Email / Teléfono */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-600">Email</Label>
                    <Input
                      {...f1.register('guestEmail')}
                      type="email" placeholder="email@ejemplo.com"
                      className={cn('h-9 text-sm bg-white',
                        f1.formState.errors.guestEmail && 'border-red-400')}
                    />
                    <FieldError message={f1.formState.errors.guestEmail?.message} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-600">
                      WhatsApp / Teléfono
                    </Label>
                    <Controller
                      name="guestPhone" control={f1.control}
                      render={({ field }) => (
                        <PhoneInput
                          {...field}
                          defaultCountry="MX"
                          placeholder="+52 999 000 0000"
                          className={cn(
                            'flex h-9 w-full rounded-md border border-input',
                            'bg-white px-3 py-1 text-sm',
                            '[&_.PhoneInputInput]:bg-transparent',
                            '[&_.PhoneInputInput]:outline-none',
                            '[&_.PhoneInputInput]:text-sm [&_.PhoneInputInput]:flex-1',
                          )}
                        />
                      )}
                    />
                  </div>
                </div>

                {/* Nacionalidad / Huéspedes */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-600">
                      Nacionalidad <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      {...f1.register('nationality')}
                      placeholder="Ej. México"
                      className={cn('h-9 text-sm bg-white',
                        f1.formState.errors.nationality && 'border-red-400')}
                    />
                    {f1.formState.errors.nationality && (
                      <div data-field-error>
                        <FieldError message={f1.formState.errors.nationality.message} />
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-600">
                      Huéspedes <span className="text-red-500">*</span>
                    </Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <Input
                          type="number" min={1} max={20}
                          {...f1.register('adults', { valueAsNumber: true })}
                          className={cn('h-9 text-sm bg-white text-center',
                            f1.formState.errors.adults && 'border-red-400')}
                        />
                        <p className="text-[9px] text-center text-slate-400 mt-0.5">
                          Adultos
                        </p>
                      </div>
                      <div>
                        <Input
                          type="number" min={0} max={10}
                          {...f1.register('children', { valueAsNumber: true })}
                          className="h-9 text-sm bg-white text-center"
                        />
                        <p className="text-[9px] text-center text-slate-400 mt-0.5">
                          Niños
                        </p>
                      </div>
                    </div>
                    {f1.formState.errors.adults && (
                      <div data-field-error>
                        <FieldError message={f1.formState.errors.adults.message} />
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* ══ STEP 2 ══════════════════════════════════════════════ */}
            {step === 2 && (
              <>
                {/* Fechas */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-600">
                      Check-in <span className="text-red-500">*</span>
                    </Label>
                    <Controller name="checkIn" control={f2.control}
                      render={({ field }) => (
                        <Input type="date"
                          min={format(today, 'yyyy-MM-dd')}
                          value={field.value ? format(new Date(field.value),'yyyy-MM-dd') : ''}
                          onChange={e => {
                            const d = new Date(e.target.value + 'T12:00:00')
                            field.onChange(d)
                            const co = f2.getValues('checkOut')
                            if (co && d >= new Date(co))
                              f2.setValue('checkOut', addDays(d,1))
                          }}
                          className="h-9 text-sm bg-white"
                        />
                      )}
                    />
                    <FieldError message={f2.formState.errors.checkIn?.message} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-600">
                      Check-out <span className="text-red-500">*</span>
                    </Label>
                    <Controller name="checkOut" control={f2.control}
                      render={({ field }) => (
                        <Input type="date"
                          min={checkIn
                            ? format(addDays(new Date(checkIn),1),'yyyy-MM-dd')
                            : format(addDays(today,1),'yyyy-MM-dd')}
                          value={field.value ? format(new Date(field.value),'yyyy-MM-dd') : ''}
                          onChange={e => field.onChange(new Date(e.target.value + 'T12:00:00'))}
                          className="h-9 text-sm bg-white"
                        />
                      )}
                    />
                    <FieldError message={f2.formState.errors.checkOut?.message} />
                  </div>
                </div>

                {/* Noches */}
                <div className="flex justify-center">
                  <div className="inline-flex items-center gap-2 bg-slate-100
                                  rounded-lg px-4 py-2">
                    <Moon className="h-4 w-4 text-slate-400" />
                    <span className="text-xl font-bold font-mono text-slate-700">
                      {nights}
                    </span>
                    <span className="text-xs text-slate-500">
                      noche{nights !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>

                {/* ── DISPONIBILIDAD ── */}
                {availStatus === 'checking' && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg
                                  bg-slate-50 border border-slate-200">
                    <Loader2 className="h-3.5 w-3.5 text-slate-400 animate-spin shrink-0" />
                    <span className="text-xs text-slate-500">
                      Verificando disponibilidad…
                    </span>
                  </div>
                )}

                {availStatus === 'available' && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg
                                  bg-emerald-50 border border-emerald-200">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span className="text-xs font-medium text-emerald-700">
                      Habitación disponible para esas fechas
                    </span>
                  </div>
                )}

                {availStatus === 'error' && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg
                                  bg-slate-50 border border-slate-200">
                    <AlertCircle className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-500">
                      No se pudo verificar disponibilidad — el servidor validará al confirmar.
                    </span>
                  </div>
                )}

                {availStatus === 'conflict' && availConflicts.length > 0 && (
                  <div className="rounded-xl border border-red-200 bg-red-50 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2 bg-red-100/70
                                    border-b border-red-200">
                      <Ban className="h-3.5 w-3.5 text-red-600 shrink-0" />
                      <p className="text-xs font-bold text-red-700">
                        Habitación no disponible
                      </p>
                    </div>
                    <div className="p-3 space-y-2">
                      {availConflicts.map((c, i) => (
                        <div key={i} className="text-xs text-red-700 space-y-0.5">
                          {c.source === 'GUEST_STAY' && c.guestName && (
                            <p>
                              <span className="font-semibold">{c.guestName}</span>
                              {' '}tiene una reserva del{' '}
                              <span className="font-semibold">
                                {format(new Date(c.conflictStart), 'd MMM', { locale: es })}
                              </span>
                              {' '}al{' '}
                              <span className="font-semibold">
                                {format(new Date(c.conflictEnd), 'd MMM yyyy', { locale: es })}
                              </span>
                              {c.overlapDays > 0 && (
                                <span className="text-red-500">
                                  {' '}— {c.overlapDays} noche{c.overlapDays !== 1 ? 's' : ''} en conflicto
                                </span>
                              )}
                            </p>
                          )}
                          {c.source === 'ROOM_STATUS' && (
                            <p>La habitación está fuera de servicio para ese período.</p>
                          )}
                        </div>
                      ))}
                      <p className="text-[10px] text-red-500 pt-0.5">
                        Modifica las fechas o elige otra habitación para continuar.
                      </p>
                    </div>
                  </div>
                )}

                {/* OTA / Canal */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-600">
                      Canal / OTA <span className="text-red-500">*</span>
                    </Label>
                    <span className="text-[10px] text-slate-400">
                      Automático con Channel Manager activo
                    </span>
                  </div>
                  <Controller name="source" control={f2.control}
                    render={({ field }) => (
                      <Select modal={false} value={field.value} onValueChange={v => {
                        field.onChange(v)
                        const opt = OTA_OPTIONS.find(o => o.value === v)
                        f2.setValue('otaName', opt?.label ?? v)
                      }}>
                        <SelectTrigger className="h-9 text-sm bg-white">
                          <SelectValue>
                            {selectedOta && (
                              <span className="flex items-center gap-2">
                                <span className="inline-block w-2.5 h-2.5 rounded-full"
                                      style={{ backgroundColor: selectedOta.color }} />
                                {selectedOta.label}
                              </span>
                            )}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper" avoidCollisions={false} className="z-[99999]">
                          {OTA_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value}>
                              <span className="flex items-center gap-2">
                                <span className="inline-block w-2.5 h-2.5 rounded-full"
                                      style={{ backgroundColor: o.color }} />
                                {o.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                {/* Tarifa */}
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-600">
                    Tarifa por noche <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex gap-2">
                    <Controller name="currency" control={f2.control}
                      render={({ field }) => (
                        <Select modal={false} value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="h-9 w-20 text-sm bg-white shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" avoidCollisions={false} className="z-[99999]">
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="MXN">MXN</SelectItem>
                            <SelectItem value="EUR">EUR</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    <Input
                      {...f2.register('ratePerNight', { valueAsNumber: true })}
                      type="number" min={1} placeholder="180"
                      className={cn('h-9 text-sm bg-white flex-1',
                        f2.formState.errors.ratePerNight && 'border-red-400')}
                    />
                  </div>
                  <FieldError message={f2.formState.errors.ratePerNight?.message} />
                </div>

                {/* Pago inicial */}
                {(rate ?? 0) > 0 && (
                  <div className="bg-emerald-50/60 border border-emerald-100
                                  rounded-xl p-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs font-bold text-slate-700">Total</span>
                      <span className="text-sm font-mono font-bold text-slate-800">
                        {currency} {total.toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold text-slate-600">
                          Anticipo
                        </Label>
                        <Input
                          {...f2.register('amountPaid', { valueAsNumber: true })}
                          type="number" min={0} max={total} placeholder="0"
                          className="h-9 text-sm bg-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-semibold text-slate-600">
                          Método
                        </Label>
                        <Controller name="paymentMethod" control={f2.control}
                          render={({ field }) => (
                            <Select modal={false} value={field.value} onValueChange={field.onChange}>
                              <SelectTrigger className="h-9 text-sm bg-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent position="popper" avoidCollisions={false} className="z-[99999]">
                                <SelectItem value="cash">Efectivo</SelectItem>
                                <SelectItem value="card">Tarjeta</SelectItem>
                                <SelectItem value="transfer">Transferencia</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-600">
                    Notas internas
                  </Label>
                  <Input {...f2.register('notes')}
                    placeholder="Preferencias, solicitudes..."
                    className="h-9 text-sm bg-white" />
                </div>
              </>
            )}

            {/* ══ STEP 3 ══════════════════════════════════════════════ */}
            {step === 3 && (() => {
              const g = f1.getValues()
              const s = f2.getValues()
              const ota = OTA_OPTIONS.find(o => o.value === s.source)
              return (
                <div className="space-y-4">
                  <div className="bg-white border border-slate-100 rounded-xl
                                  shadow-sm overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-800 text-xs font-bold
                                    text-white uppercase tracking-wider">
                      Resumen del check-in
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-slate-100">
                      <div className="p-4 space-y-2.5">
                        <p className="text-[10px] font-bold text-slate-400
                                      uppercase tracking-wider">Huésped</p>
                        {[
                          ['Nombre', `${g.firstName} ${g.lastName}`],
                          ['Email', g.guestEmail],
                          ['Teléfono', g.guestPhone],
                          ['Nacionalidad', g.nationality],
                          ['Adultos', String(g.adults)],
                          ['Niños', String(g.children ?? 0)],
                        ].filter(([,v]) => v).map(([l,v]) => (
                          <div key={l}>
                            <p className="text-[9px] text-slate-400 uppercase">{l}</p>
                            <p className="text-xs font-semibold text-slate-700 truncate">{v}</p>
                          </div>
                        ))}
                      </div>
                      <div className="p-4 space-y-2.5">
                        <p className="text-[10px] font-bold text-slate-400
                                      uppercase tracking-wider">Estadía</p>
                        {[
                          ['Habitación', `Hab. ${roomNumber ?? initialRoomId?.slice(0, 8) ?? '—'}`],
                          ['Check-in', s.checkIn ? format(new Date(s.checkIn),'d MMM yyyy',{locale:es}) : ''],
                          ['Check-out', s.checkOut ? format(new Date(s.checkOut),'d MMM yyyy',{locale:es}) : ''],
                          ['Noches', `${nights}`],
                          ['Tarifa', `${s.currency} ${s.ratePerNight}/noche`],
                          ['Total', `${s.currency} ${total.toLocaleString()}`],
                          ['Anticipo', `${s.currency} ${(s.amountPaid ?? 0).toLocaleString()}`],
                          ['Canal', ota?.label ?? s.source],
                        ].filter(([,v]) => v).map(([l,v]) => (
                          <div key={l}>
                            <p className="text-[9px] text-slate-400 uppercase">{l}</p>
                            <div className="flex items-center gap-1">
                              {l === 'Canal' && ota && (
                                <span className="inline-block w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: ota.color }} />
                              )}
                              <p className="text-xs font-semibold text-slate-700">{v}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 bg-blue-50 border border-blue-100
                                  rounded-xl p-3.5">
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center
                                    justify-center shrink-0">
                      <CheckCircle className="h-4 w-4 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-blue-800">Al confirmar:</p>
                      <ul className="text-xs text-blue-600 mt-0.5 space-y-0.5">
                        {s.checkIn && isSameDay(new Date(s.checkIn), new Date())
                          ? <li>• La habitación cambiará a <strong>Ocupada</strong></li>
                          : <li>• La reserva quedará registrada para el <strong>{s.checkIn ? format(new Date(s.checkIn), "d 'de' MMMM", { locale: es }) : ''}</strong></li>
                        }
                        <li>• Se generará el folio del huésped</li>
                        {g.guestEmail && (
                          <li>• Se enviará confirmación a <strong>{g.guestEmail}</strong></li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* FOOTER */}
          <div className="px-6 py-3.5 border-t border-slate-100 bg-white
                          flex items-center justify-between">
            <Button variant="ghost" size="sm"
                    onClick={() => step > 1 ? setStep(s => s-1) : handleCloseAttempt()}
                    className="text-xs text-slate-500">
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              {step > 1 ? 'Anterior' : 'Cancelar'}
            </Button>
            <div className="flex gap-1.5 items-center">
              {STEPS.map(s => (
                <div key={s.id} className={cn(
                  'h-1.5 rounded-full transition-all',
                  s.id === step ? 'bg-slate-800 w-5' : 'bg-slate-200 w-1.5'
                )} />
              ))}
            </div>
            {step < 3 ? (
              <Button size="sm" onClick={handleNext}
                      disabled={step === 2 && (
                        availStatus === 'checking' ||
                        (availStatus === 'conflict' && availConflicts.some(c => c.severity === 'HARD'))
                      )}
                      className="text-xs bg-slate-800 hover:bg-slate-700 text-white
                                 disabled:opacity-40 disabled:cursor-not-allowed">
                Siguiente <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            ) : (
              <Button size="sm" onClick={handleConfirm}
                      className="text-xs bg-emerald-600 hover:bg-emerald-700">
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                Confirmar check-in
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ALERTA DE CANCELACIÓN */}
      <AlertDialog open={showCancelAlert} onOpenChange={setShowCancelAlert}>
        <AlertDialogContent className="max-w-sm shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">
              ¿Cancelar el check-in?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-500">
              Los datos ingresados se perderán.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Continuar editando</AlertDialogCancel>
            <AlertDialogAction className="text-xs bg-red-600 hover:bg-red-700"
              onClick={() => { setShowCancelAlert(false); onClose() }}>
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
