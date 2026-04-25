/**
 * ConfirmCheckinDialog — Confirma la llegada física de un huésped.
 *
 * Distinto de CheckInDialog (crea reservas walk-in).
 * Este dialog confirma la llegada de una reserva EXISTENTE con status UNCONFIRMED.
 *
 * 4 pasos (AHLEI canónico):
 *  1. Verificación de datos del huésped + notas de llegada
 *  2. Identidad — tipo doc + número + checkbox de verificación física
 *  3. Pago — registrar método + monto + referencia
 *  4. Entrega de acceso (keyType) + resumen + confirmar
 *
 * Fundamento: CLAUDE.md §32 (confirmación explícita), §Psicología cognitiva,
 * J.D. Power (≤4 pasos), ACFE (anti-fraude cash skimming),
 * Visa Core Rules §5.9.2 (documentación de identidad para chargebacks).
 */
import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  LogIn, ChevronRight, ChevronLeft, Check, ShieldCheck,
  CreditCard, Loader2, AlertTriangle, User, Calendar, Moon, Hash,
  KeyRound, Smartphone, CreditCard as CardIcon, StickyNote,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { KeyDeliveryType, PaymentMethod } from '@zenix/shared'
import type { ConfirmCheckinInput, PaymentEntryInput } from '../../api/guest-stays.api'
import type { GuestStayBlock } from '../../types/timeline.types'

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]:          'Efectivo',
  [PaymentMethod.CARD_TERMINAL]: 'Terminal (tarjeta)',
  [PaymentMethod.BANK_TRANSFER]: 'Transferencia bancaria',
  [PaymentMethod.OTA_PREPAID]:   'OTA prepagado',
  [PaymentMethod.COMP]:          'Cortesía (COMP)',
}

const DOCUMENT_TYPES = [
  { value: '', label: 'Seleccionar tipo…' },
  { value: 'PASSPORT', label: 'Pasaporte' },
  { value: 'INE', label: 'INE / Credencial de elector' },
  { value: 'CEDULA', label: 'Cédula de identidad' },
  { value: 'LICENSE', label: 'Licencia de conducir' },
  { value: 'OTHER', label: 'Otro documento oficial' },
]

const KEY_OPTIONS: { type: KeyDeliveryType; label: string; icon: React.ReactNode }[] = [
  { type: KeyDeliveryType.PHYSICAL, label: 'Física',  icon: <KeyRound className="h-4 w-4" /> },
  { type: KeyDeliveryType.CARD,     label: 'Tarjeta', icon: <CardIcon className="h-4 w-4" /> },
  { type: KeyDeliveryType.CODE,     label: 'Código',  icon: <Hash className="h-4 w-4" /> },
  { type: KeyDeliveryType.MOBILE,   label: 'Móvil',   icon: <Smartphone className="h-4 w-4" /> },
]

interface ConfirmCheckinDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (data: ConfirmCheckinInput) => void
  isPending: boolean
  stay: GuestStayBlock
  roomLabel: string
}

type Step = 1 | 2 | 3 | 4

const STEPS = [
  { num: 1 as Step, label: 'Datos' },
  { num: 2 as Step, label: 'Identidad' },
  { num: 3 as Step, label: 'Pago' },
  { num: 4 as Step, label: 'Confirmar' },
]

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-3">
      {STEPS.map((s, i) => (
        <div key={s.num} className="flex items-center gap-1.5">
          <div
            className={cn(
              'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors',
              current === s.num
                ? 'bg-emerald-600 text-white'
                : current > s.num
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-400',
            )}
          >
            {current > s.num ? <Check className="h-3 w-3" /> : s.num}
          </div>
          {i < STEPS.length - 1 && (
            <div className={cn('h-px w-6', current > s.num ? 'bg-emerald-300' : 'bg-slate-200')} />
          )}
        </div>
      ))}
    </div>
  )
}

function emptyPayment(): PaymentEntryInput {
  return { method: PaymentMethod.CASH, amount: 0 }
}

export function ConfirmCheckinDialog({
  open,
  onClose,
  onConfirm,
  isPending,
  stay,
  roomLabel,
}: ConfirmCheckinDialogProps) {
  const [step, setStep] = useState<Step>(1)

  // Step 1 — datos + notas de llegada
  const [arrivalNotes, setArrivalNotes] = useState('')

  // Step 2 — identidad
  const [documentType, setDocumentType]     = useState(stay.documentType ?? '')
  const [documentNumber, setDocumentNumber] = useState(stay.documentNumber ?? '')
  const [documentVerified, setDocumentVerified] = useState(false)

  // Step 3 — pagos
  const [payments, setPayments] = useState<PaymentEntryInput[]>([emptyPayment()])

  // Step 4 — tipo de acceso (PHYSICAL por defecto — 80% de casos LATAM)
  const [keyType, setKeyType] = useState<KeyDeliveryType>(KeyDeliveryType.PHYSICAL)
  const [keyTouched, setKeyTouched] = useState(false)

  const balance      = stay.totalAmount - stay.amountPaid
  const isAlreadyPaid = balance <= 0

  const resetAndClose = () => {
    setStep(1)
    setArrivalNotes('')
    setDocumentType(stay.documentType ?? '')
    setDocumentNumber(stay.documentNumber ?? '')
    setDocumentVerified(false)
    setPayments([emptyPayment()])
    setKeyType(KeyDeliveryType.PHYSICAL)
    setKeyTouched(false)
    onClose()
  }

  const handleOpenChange = (o: boolean) => {
    if (!o && !isPending) resetAndClose()
  }

  // ── Payment helpers ──────────────────────────────────────────────────────

  const updatePayment = (idx: number, patch: Partial<PaymentEntryInput>) => {
    setPayments((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  }

  const addPayment    = () => setPayments((prev) => [...prev, emptyPayment()])
  const removePayment = (idx: number) => setPayments((prev) => prev.filter((_, i) => i !== idx))

  const paymentSum       = payments.reduce((s, p) => s + (p.amount || 0), 0)
  const projectedBalance = balance - paymentSum

  const paymentErrors = payments.map((p) => {
    if (
      (p.method === PaymentMethod.CARD_TERMINAL || p.method === PaymentMethod.BANK_TRANSFER) &&
      !p.reference?.trim()
    ) return 'Referencia requerida para este método'
    if (
      (p.method === PaymentMethod.COMP || p.amount === 0) &&
      (!p.approvedById?.trim() || !p.approvalReason?.trim())
    ) return 'Código y razón de aprobación requeridos'
    return null
  })

  const hasPaymentErrors = paymentErrors.some(Boolean)
  const step3Valid =
    isAlreadyPaid ||
    payments.some((p) => p.method === PaymentMethod.OTA_PREPAID || p.method === PaymentMethod.COMP) ||
    (projectedBalance <= 0 && !hasPaymentErrors)

  // ── Step advancement ─────────────────────────────────────────────────────

  const canAdvance: Record<Step, boolean> = {
    1: true,
    2: documentVerified,
    3: step3Valid,
    4: true, // keyType siempre tiene valor (default PHYSICAL)
  }

  const advance = () => {
    if (step === 3 && isAlreadyPaid) { setStep(4); return }
    if (step < 4) setStep((s) => (s + 1) as Step)
  }

  const back = () => {
    if (step > 1) setStep((s) => (s - 1) as Step)
  }

  const handleConfirm = () => {
    setKeyTouched(true)
    const data: ConfirmCheckinInput = {
      documentVerified,
      documentType:   documentType   || undefined,
      documentNumber: documentNumber || undefined,
      arrivalNotes:   arrivalNotes   || undefined,
      keyType,
      payments: isAlreadyPaid ? [] : payments,
    }
    onConfirm(data)
  }

  // ── Step renders ─────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <div className="space-y-4">
      {/* Datos de la reserva */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-slate-200">
          <DataField icon={<User className="h-3 w-3" />} label="Huésped" value={stay.guestName} />
          <DataField label="Habitación" value={roomLabel} />
        </div>
        <div className="border-t border-slate-200 grid grid-cols-2 divide-x divide-slate-200">
          <DataField
            icon={<Calendar className="h-3 w-3" />}
            label="Check-in"
            value={format(stay.checkIn, 'EEE d MMM yyyy', { locale: es })}
          />
          <DataField
            label="Check-out"
            value={format(stay.checkOut, 'EEE d MMM yyyy', { locale: es })}
          />
        </div>
        <div className="border-t border-slate-200 grid grid-cols-2 divide-x divide-slate-200">
          <DataField
            icon={<Moon className="h-3 w-3" />}
            label="Noches"
            value={`${stay.nights}`}
          />
          <DataField label="Huéspedes" value={`${stay.paxCount}`} />
        </div>
        {stay.pmsReservationId && (
          <div className="border-t border-slate-200">
            <DataField
              icon={<Hash className="h-3 w-3" />}
              label="ID reserva"
              value={stay.pmsReservationId}
              mono
            />
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-slate-200">
          <DataField label="Total" value={`${stay.currency} ${stay.totalAmount.toLocaleString()}`} />
          <DataField
            label="Saldo pendiente"
            value={balance > 0 ? `${stay.currency} ${balance.toLocaleString()}` : 'Liquidado'}
            highlight={balance > 0}
          />
        </div>
      </div>

      {/* Solicitudes especiales (read-only) */}
      {stay.notes && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">
            Solicitudes especiales
          </p>
          <p className="text-xs text-amber-800 leading-relaxed">{stay.notes}</p>
        </div>
      )}

      {/* Notas de llegada — captura operativa */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
          <StickyNote className="h-3 w-3" />
          Notas de llegada
          <span className="font-normal normal-case text-slate-400 ml-1">(opcional)</span>
        </label>
        <textarea
          value={arrivalNotes}
          onChange={(e) => setArrivalNotes(e.target.value)}
          rows={2}
          placeholder="Llegó tarde, taxi del aeropuerto, equipaje en consigna…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm
                     text-slate-800 placeholder:text-slate-400 resize-none
                     focus:outline-none focus:ring-2 focus:ring-emerald-300"
        />
        <p className="text-[10px] text-slate-400">Visible en el historial de la estadía</p>
      </div>

      {stay.guestEmail && (
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-600">Email:</span> {stay.guestEmail}
        </p>
      )}
      {stay.guestPhone && (
        <p className="text-xs text-slate-500">
          <span className="font-medium text-slate-600">Teléfono:</span> {stay.guestPhone}
        </p>
      )}
    </div>
  )

  const renderStep2 = () => (
    <div className="space-y-4">
      {/* Documento de identidad — tipo + número */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Tipo de documento
          </p>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800
                       focus:outline-none focus:ring-2 focus:ring-emerald-300"
          >
            {DOCUMENT_TYPES.map((dt) => (
              <option key={dt.value} value={dt.value}>{dt.label}</option>
            ))}
          </select>
        </div>
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Número de documento
          </p>
          <input
            type="text"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="AB 123456"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800
                       focus:outline-none focus:ring-2 focus:ring-emerald-300"
          />
        </div>
      </div>

      {/* Forcing function — verificación física */}
      <button
        type="button"
        onClick={() => setDocumentVerified((v) => !v)}
        className={cn(
          'w-full flex items-center gap-4 rounded-xl border-2 p-5 transition-all text-left',
          documentVerified
            ? 'border-emerald-500 bg-emerald-50'
            : 'border-slate-200 bg-white hover:border-slate-300',
        )}
      >
        <div
          className={cn(
            'w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
            documentVerified ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300',
          )}
        >
          {documentVerified && <Check className="h-4 w-4 text-white" />}
        </div>
        <div>
          <div className={cn('font-semibold text-sm', documentVerified ? 'text-emerald-800' : 'text-slate-700')}>
            Documento verificado físicamente
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Pasaporte · INE · Cédula · Licencia de conducir
          </div>
        </div>
      </button>

      {!documentVerified && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3.5 py-3">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 leading-relaxed">
            Debe confirmar la revisión física del documento antes de continuar.
            Requerido para el audit trail y protección ante disputas de chargeback.
          </p>
        </div>
      )}

      <div className="rounded-lg bg-slate-50 border border-slate-200 px-3.5 py-3">
        <div className="flex items-center gap-2 text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-wider">Plan Enterprise</span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Escaneo biométrico y verificación OCR de documento — disponible próximamente
        </p>
      </div>
    </div>
  )

  const renderStep3 = () => {
    if (isAlreadyPaid) {
      return (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
            <Check className="h-6 w-6 text-emerald-600" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-emerald-800">Saldo liquidado</p>
            <p className="text-xs text-slate-500 mt-1">
              El pago de {stay.currency} {stay.totalAmount.toLocaleString()} ya fue registrado.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
          <span className="text-xs font-semibold text-amber-800">
            Saldo pendiente: {stay.currency} {balance.toLocaleString()}
          </span>
        </div>

        {payments.map((p, idx) => (
          <div key={idx} className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">Pago {idx + 1}</span>
              {payments.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePayment(idx)}
                  className="text-xs text-slate-400 hover:text-red-500"
                >
                  Eliminar
                </button>
              )}
            </div>

            {/* Método */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Método</label>
              <select
                value={p.method}
                onChange={(e) => updatePayment(idx, { method: e.target.value as PaymentMethod, reference: '', approvedById: '', approvalReason: '' })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800
                           focus:outline-none focus:ring-2 focus:ring-emerald-300"
              >
                {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            {/* Monto */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Monto ({stay.currency})
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={p.amount || ''}
                onChange={(e) => updatePayment(idx, { amount: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm
                           text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              />
            </div>

            {/* Referencia (CARD_TERMINAL / BANK_TRANSFER) */}
            {(p.method === PaymentMethod.CARD_TERMINAL || p.method === PaymentMethod.BANK_TRANSFER) && (
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Número de referencia *
                </label>
                <input
                  type="text"
                  value={p.reference ?? ''}
                  onChange={(e) => updatePayment(idx, { reference: e.target.value })}
                  placeholder={p.method === PaymentMethod.CARD_TERMINAL ? 'Código de aprobación (6-8 dígitos)' : 'Referencia de transferencia'}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm
                             text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
              </div>
            )}

            {/* Aprobación manager (COMP o monto $0) */}
            {(p.method === PaymentMethod.COMP || p.amount === 0) && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2">
                <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                  Requiere aprobación del manager
                </p>
                <input
                  type="text"
                  value={p.approvedById ?? ''}
                  onChange={(e) => updatePayment(idx, { approvedById: e.target.value })}
                  placeholder="Código de autorización del manager"
                  className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm
                             text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <input
                  type="text"
                  value={p.approvalReason ?? ''}
                  onChange={(e) => updatePayment(idx, { approvalReason: e.target.value })}
                  placeholder="Razón (ej: cortesía VIP, falla del servicio…)"
                  className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm
                             text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
            )}

            {paymentErrors[idx] && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {paymentErrors[idx]}
              </p>
            )}
          </div>
        ))}

        {/* Split payment */}
        <button
          type="button"
          onClick={addPayment}
          className="w-full rounded-xl border border-dashed border-slate-300 py-2.5 text-xs
                     text-slate-400 hover:text-slate-600 hover:border-slate-400 transition-colors"
        >
          + Agregar otro método de pago
        </button>

        {/* Running total */}
        {payments.length > 0 && (
          <div className={cn(
            'rounded-xl border px-3.5 py-2.5 flex items-center justify-between',
            projectedBalance <= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50',
          )}>
            <span className="text-xs text-slate-600">Saldo tras este pago</span>
            <span className={cn(
              'text-sm font-bold',
              projectedBalance <= 0 ? 'text-emerald-700' : 'text-slate-800',
            )}>
              {stay.currency} {Math.max(0, projectedBalance).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    )
  }

  const renderStep4 = () => (
    <div className="space-y-4">
      {/* Tipo de acceso — forcing function */}
      <div>
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
          Tipo de acceso entregado
        </p>
        <div className="grid grid-cols-4 gap-2">
          {KEY_OPTIONS.map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => { setKeyType(opt.type); setKeyTouched(true) }}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-xl border-2 py-3 px-2 transition-all text-center',
                keyType === opt.type
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
              )}
            >
              {opt.icon}
              <span className="text-[10px] font-semibold leading-tight">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Summary card */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-slate-200">
          <div className="px-4 py-3 space-y-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Huésped</p>
            <p className="text-sm font-semibold text-slate-800">{stay.guestName}</p>
            <p className="text-xs text-slate-500">{stay.paxCount} persona{stay.paxCount !== 1 ? 's' : ''}</p>
          </div>
          <div className="px-4 py-3 space-y-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Estadía</p>
            <p className="text-sm font-semibold text-slate-800">{roomLabel}</p>
            <p className="text-xs text-slate-500">
              {stay.nights} noche{stay.nights !== 1 ? 's' : ''} · {format(stay.checkIn, 'd MMM', { locale: es })} → {format(stay.checkOut, 'd MMM', { locale: es })}
            </p>
          </div>
        </div>
        {!isAlreadyPaid && (
          <div className="border-t border-slate-200 px-4 py-3 bg-slate-50">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Pagos a registrar</p>
            {payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-slate-600">
                <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                <span className="font-mono font-medium">{stay.currency} {(p.amount || 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
        {arrivalNotes && (
          <div className="border-t border-slate-200 px-4 py-3 bg-slate-50">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Notas de llegada</p>
            <p className="text-xs text-slate-600 line-clamp-2">{arrivalNotes}</p>
          </div>
        )}
      </div>

      {/* What happens */}
      <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3.5 space-y-2">
        <p className="text-xs font-bold text-emerald-800">Al confirmar:</p>
        <ul className="space-y-1">
          {[
            'El estado de la reserva cambia a "En casa" (IN_HOUSE)',
            'Housekeeping es notificado de la llegada',
            'El folio de la estadía queda registrado en el sistema',
          ].map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-xs text-emerald-700">
              <Check className="h-3 w-3 shrink-0 mt-0.5" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
        {/* Emerald top stripe */}
        <div className="h-1.5 w-full bg-emerald-500" />

        <DialogHeader className="px-6 pt-4 pb-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <LogIn className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">
                Confirmar check-in
              </DialogTitle>
              <p className="text-xs text-slate-500 mt-0.5">
                {stay.guestName} · {roomLabel}
              </p>
            </div>
          </div>
          <StepIndicator current={step} />
        </DialogHeader>

        {/* Step label */}
        <div className="px-6 pb-2">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            Paso {step} — {STEPS.find((s) => s.num === step)?.label}
          </p>
        </div>

        {/* Step content */}
        <div className="px-6 pb-4 max-h-[420px] overflow-y-auto">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 pb-5 border-t border-slate-100 pt-4">
          {step > 1 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={back}
              disabled={isPending}
              className="flex items-center gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Atrás
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={resetAndClose}
              disabled={isPending}
            >
              Cancelar
            </Button>
          )}

          {step < 4 ? (
            <Button
              size="sm"
              onClick={advance}
              disabled={!canAdvance[step]}
              className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Continuar
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleConfirm}
              disabled={isPending}
              className="flex-1 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirmando…
                </>
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  Confirmar check-in
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Helper components ────────────────────────────────────────────────────────

function DataField({
  label,
  value,
  icon,
  highlight,
  mono,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  highlight?: boolean
  mono?: boolean
}) {
  return (
    <div className={cn('px-4 py-3', highlight && 'bg-amber-50')}>
      <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
        {icon && <span className="text-slate-300">{icon}</span>}
        {label}
      </div>
      <div className={cn(
        'text-sm font-semibold',
        highlight ? 'text-amber-700' : 'text-slate-700',
        mono && 'font-mono text-xs',
      )}>
        {value}
      </div>
    </div>
  )
}
