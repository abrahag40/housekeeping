/**
 * EarlyCheckoutDialog — Confirmación de salida anticipada.
 *
 * Muestra: guest name, habitación, delta de noches liberadas, y campo de notas.
 * Fundamento: CLAUDE.md §32 — toda mutación destructiva requiere confirmación explícita.
 * Psicología cognitiva: el modal activa Sistema 2 (deliberado) — el recepcionista ve
 * el impacto exacto antes de confirmar (Kahneman 2011).
 */
import { useState } from 'react'
import { format, differenceInDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { LogOut, Moon, Calendar, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface EarlyCheckoutDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (notes?: string) => void
  isPending: boolean
  guestName: string
  roomLabel: string
  checkinAt: Date
  scheduledCheckout: Date
}

export function EarlyCheckoutDialog({
  open,
  onClose,
  onConfirm,
  isPending,
  guestName,
  roomLabel,
  checkinAt,
  scheduledCheckout,
}: EarlyCheckoutDialogProps) {
  const [notes, setNotes] = useState('')

  const now = new Date()
  const nightsOriginal = Math.max(1, differenceInDays(scheduledCheckout, checkinAt))
  const nightsActual   = Math.max(1, differenceInDays(now, checkinAt))
  const nightsFreed    = Math.max(0, nightsOriginal - nightsActual)

  const handleConfirm = () => {
    onConfirm(notes.trim() || undefined)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open && !isPending) {
      setNotes('')
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden gap-0">
        {/* Header stripe — amber: advertencia no-bloqueante (CLAUDE.md psicología del color) */}
        <div className="h-1.5 w-full bg-amber-400" />

        <DialogHeader className="px-6 pt-5 pb-0">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center flex-shrink-0">
              <LogOut className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-slate-900">
                Salida anticipada
              </DialogTitle>
              <p className="text-xs text-slate-500 mt-0.5">{guestName} · {roomLabel}</p>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {/* Delta de fechas */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-2 divide-x divide-slate-200">
              <div className="px-4 py-3">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Salida programada
                </div>
                <div className="text-sm font-semibold text-slate-700">
                  {format(scheduledCheckout, 'EEE d MMM', { locale: es })}
                </div>
              </div>
              <div className="px-4 py-3 bg-amber-50">
                <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-1">
                  Salida ahora
                </div>
                <div className="text-sm font-semibold text-amber-700">
                  {format(now, 'EEE d MMM', { locale: es })}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 px-4 py-3 bg-slate-50 flex items-center gap-2">
              <Moon className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-600">
                <span className="font-semibold">{nightsActual}</span> de {nightsOriginal} noches facturadas
              </span>
              {nightsFreed > 0 && (
                <span className="ml-auto text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  +{nightsFreed} noche{nightsFreed !== 1 ? 's' : ''} liberada{nightsFreed !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* Info de housekeeping */}
          <div className={cn(
            'flex items-start gap-2.5 rounded-lg px-3.5 py-3',
            'bg-slate-50 border border-slate-200',
          )}>
            <Wrench className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-slate-500 leading-relaxed">
              Se creará una tarea de limpieza automáticamente. Si es después de las 20:00,
              quedará programada para mañana en el planning de housekeeping.
            </p>
          </div>

          {/* Notas opcionales */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
              <Calendar className="h-3 w-3 text-slate-400" />
              Notas para housekeeping (opcional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej: huésped dejó equipaje, revisar minibar…"
              rows={2}
              className={cn(
                'w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2',
                'text-sm text-slate-800 placeholder:text-slate-300',
                'focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400',
                'transition-colors',
              )}
            />
          </div>

          {/* Pago — nota informativa */}
          <p className="text-[11px] text-slate-400 leading-relaxed">
            El pago queda en revisión — el recepcionista gestiona el ajuste o reembolso
            correspondiente a las noches no utilizadas.
          </p>
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 pb-5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-sm"
            onClick={onClose}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button
            size="sm"
            className="flex-1 text-sm bg-amber-600 hover:bg-amber-700 text-white"
            onClick={handleConfirm}
            disabled={isPending}
          >
            {isPending ? 'Registrando…' : 'Confirmar salida anticipada'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
