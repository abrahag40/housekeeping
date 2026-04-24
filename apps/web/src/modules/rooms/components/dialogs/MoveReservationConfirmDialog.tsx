import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowRight, Moon, MoveRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MoveReservationConfirmDialogProps {
  guestName: string
  fromRoomNumber?: string
  toRoomNumber: string
  nights: number
  checkIn: Date
  checkOut: Date
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
}

export function MoveReservationConfirmDialog({
  guestName,
  fromRoomNumber,
  toRoomNumber,
  nights,
  checkIn,
  checkOut,
  isPending,
  onClose,
  onConfirm,
}: MoveReservationConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      <div className="relative z-10 w-full max-w-sm mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="h-1.5 bg-emerald-500" />

        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-full bg-emerald-50 text-emerald-600">
              <MoveRight size={20} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-gray-900 leading-snug">
                Mover reserva a Hab.&nbsp;{toRoomNumber}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {guestName}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Estadía</span>
              <span className="flex items-center gap-1.5 font-medium text-gray-800 tabular-nums">
                {format(checkIn, 'd MMM', { locale: es })}
                <ArrowRight size={12} className="text-gray-400" />
                {format(checkOut, 'd MMM', { locale: es })}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Noches</span>
              <span className="flex items-center gap-1 font-semibold text-emerald-700">
                <Moon size={13} />
                {nights}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Cambio de habitación</span>
              <span className="font-semibold text-gray-900 tabular-nums">
                {fromRoomNumber ? `${fromRoomNumber} → ${toRoomNumber}` : `Hab. ${toRoomNumber}`}
              </span>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Moviendo…' : 'Confirmar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
