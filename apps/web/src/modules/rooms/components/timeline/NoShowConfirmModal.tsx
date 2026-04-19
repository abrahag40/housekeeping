import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertTriangle, UserX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OTA_ACCENT_COLORS, SOURCE_COLORS } from '../../utils/timeline.constants'
import type { SourceKey } from '../../utils/timeline.constants'

interface NoShowConfirmModalProps {
  guestName: string
  roomNumber?: string
  checkIn: Date
  checkOut: Date
  source?: string
  otaName?: string
  onClose: () => void
  onConfirm: () => void
  isPending?: boolean
}

export function NoShowConfirmModal({
  guestName,
  roomNumber,
  checkIn,
  checkOut,
  source,
  otaName,
  onClose,
  onConfirm,
  isPending,
}: NoShowConfirmModalProps) {
  const otaAccent = OTA_ACCENT_COLORS[source ?? ''] ?? OTA_ACCENT_COLORS.other
  const sourceColors = SOURCE_COLORS[(source ?? '') as SourceKey] ?? SOURCE_COLORS.other
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />

      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          {/* Left: icon + title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-orange-100 shrink-0">
              <UserX className="h-5 w-5 text-orange-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">Registrar no-show</h2>
              <p className="text-sm text-slate-500 truncate">{guestName}</p>
            </div>
          </div>
          {/* Right: OTA badge + close — grouped so they sit flush together */}
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shadow-sm"
              style={{ backgroundColor: otaAccent }}
            >
              {otaName ?? sourceColors.label}
            </span>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Guest info */}
        <div className="px-5 pt-4 pb-3">
          <div className="rounded-xl bg-slate-50 px-4 py-3 space-y-2">
            {roomNumber && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Habitación</span>
                <span className="font-medium text-slate-800">{roomNumber}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Check-in programado</span>
              <span className="font-medium text-slate-800">
                {format(checkIn, "d 'de' MMMM, yyyy", { locale: es })}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Check-out</span>
              <span className="font-medium text-slate-800">
                {format(checkOut, "d 'de' MMMM, yyyy", { locale: es })}
              </span>
            </div>
          </div>
        </div>

        {/* Risk warning */}
        <div className="px-5 pb-4">
          <div className="flex gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-800 leading-snug text-justify hyphens-auto">
              Al confirmar, la habitación queda disponible para nueva venta y se genera el
              cargo de no-show según la política de la propiedad.{' '}
              <span className="font-medium">Esta acción puede revertirse dentro de las primeras 48 horas.</span>
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2.5 px-5 pb-5">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            className="flex-1 bg-orange-600 hover:bg-orange-700 text-white gap-2"
            onClick={onConfirm}
            disabled={isPending}
          >
            <UserX className="h-4 w-4" />
            {isPending ? 'Registrando…' : 'Confirmar no-show'}
          </Button>
        </div>
      </div>
    </div>
  )
}
