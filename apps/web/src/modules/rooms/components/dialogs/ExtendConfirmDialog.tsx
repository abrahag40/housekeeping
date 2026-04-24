// TODO(sprint8-pricing): cuando se implemente Sprint 8, reemplazar ratePerNight con
// el rate plan activo y permitir override con razón auditada. Ver CLAUDE.md §Sprint 8.
import { useState } from 'react'
import { format, differenceInCalendarDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarPlus, Moon, AlertTriangle, Check, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface RoomOption {
  id: string
  number: string
  type: string
}

interface ExtendConfirmDialogProps {
  guestName: string
  roomNumber?: string
  originalCheckOut: Date
  newCheckOut: Date
  ratePerNight: number
  /** Total amount already charged/billed for the original booking */
  originalTotal?: number
  currency: string
  /** OTA source — if set, show advisory about OTA rate vs local rate */
  source?: string
  otaName?: string
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
  /** Set when the original room has a booking conflict for the extension dates */
  roomConflict?: boolean
  /** Alternative rooms available for the extension period */
  availableRooms?: RoomOption[]
  /** Called when user picks a different room for the extension */
  onConfirmNewRoom?: (newRoomId: string) => void
}

export function ExtendConfirmDialog({
  guestName,
  roomNumber,
  originalCheckOut,
  newCheckOut,
  ratePerNight,
  originalTotal,
  currency,
  source,
  otaName,
  isPending,
  onClose,
  onConfirm,
  roomConflict = false,
  availableRooms = [],
  onConfirmNewRoom,
}: ExtendConfirmDialogProps) {
  const [selectedRoomId, setSelectedRoomId] = useState<string>('')

  const daysAdded = differenceInCalendarDays(newCheckOut, originalCheckOut)
  const extensionTotal = ratePerNight * daysAdded
  const accumulatedTotal = originalTotal != null ? originalTotal + extensionTotal : null
  const isOta = source && source !== 'direct' && source !== 'walk-in'

  if (daysAdded <= 0) return null

  const canConfirmNewRoom = roomConflict && !!selectedRoomId && !!onConfirmNewRoom

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* Dialog */}
      <div
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden"
        style={{ animation: 'var(--animate-spring-in)' }}
      >
        {/* Header — amber when conflict, emerald when clear */}
        <div className={cn('px-5 pt-5 pb-4', roomConflict ? 'bg-amber-50' : 'bg-emerald-50')}>
          <div className="flex items-start gap-3">
            <div className={cn(
              'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
              roomConflict ? 'bg-amber-100' : 'bg-emerald-100',
            )}>
              {roomConflict
                ? <AlertTriangle className="h-5 w-5 text-amber-600" />
                : <CalendarPlus className="h-5 w-5 text-emerald-700" />
              }
            </div>
            <div>
              <p className="font-bold text-slate-900 text-base leading-tight">
                {roomConflict ? 'Habitación no disponible' : 'Extender estadía'}
              </p>
              <p className="text-sm text-slate-500 mt-0.5">
                {guestName}{roomNumber && ` · Hab. ${roomNumber}`}
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Conflict notice + room selector */}
          {roomConflict && (
            <div className="space-y-2">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-800">
                  Hab. {roomNumber} ya tiene una reserva para esas fechas
                </p>
                <p className="text-[11px] text-amber-700 mt-0.5 leading-snug">
                  Elige otra habitación disponible para alojar al huésped durante la extensión.
                </p>
              </div>

              {availableRooms.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-0.5">
                    Habitaciones disponibles
                  </p>
                  {availableRooms.map((room) => (
                    <button
                      key={room.id}
                      onClick={() => setSelectedRoomId(room.id)}
                      className={cn(
                        'w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl border text-left transition-all',
                        selectedRoomId === room.id
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300',
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={cn(
                          'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                          selectedRoomId === room.id ? 'border-emerald-500' : 'border-slate-300',
                        )}>
                          {selectedRoomId === room.id && (
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          )}
                        </div>
                        <span className="font-semibold text-sm">Hab. {room.number}</span>
                        <span className="text-xs text-slate-400">{room.type}</span>
                      </div>
                      {selectedRoomId === room.id && (
                        <Check className="h-4 w-4 text-emerald-600" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-red-800">Sin habitaciones disponibles</p>
                  <p className="text-[11px] text-red-700 mt-0.5">
                    No hay habitaciones del mismo tipo libres para esas fechas. Considera ajustar el nuevo checkout.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Dates summary — always visible */}
          <div className="bg-slate-50 rounded-xl p-3.5 flex items-center justify-between">
            <div className="text-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Checkout actual
              </p>
              <p className="text-sm font-bold text-slate-700 mt-1">
                {format(originalCheckOut, 'EEE d MMM', { locale: es })}
              </p>
            </div>

            <div className="flex flex-col items-center gap-1">
              <div className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full',
                roomConflict && selectedRoomId
                  ? 'bg-emerald-100'
                  : roomConflict
                  ? 'bg-amber-100'
                  : 'bg-emerald-100',
              )}>
                {roomConflict && selectedRoomId
                  ? <ArrowRight className="h-3 w-3 text-emerald-700" />
                  : <Moon className="h-3 w-3 text-emerald-700" />
                }
                <span className={cn(
                  'text-xs font-bold',
                  roomConflict && !selectedRoomId ? 'text-amber-700' : 'text-emerald-700',
                )}>+{daysAdded}</span>
              </div>
              <div className="w-12 h-px bg-slate-200" />
            </div>

            <div className="text-center">
              <p className={cn(
                'text-[10px] font-bold uppercase tracking-wider',
                roomConflict && selectedRoomId ? 'text-emerald-600' : roomConflict ? 'text-amber-600' : 'text-emerald-600',
              )}>
                {roomConflict && selectedRoomId
                  ? `Hab. ${availableRooms.find(r => r.id === selectedRoomId)?.number}`
                  : 'Nuevo checkout'
                }
              </p>
              <p className={cn(
                'text-sm font-bold mt-1',
                roomConflict && selectedRoomId ? 'text-emerald-700' : roomConflict ? 'text-amber-700' : 'text-emerald-700',
              )}>
                {format(newCheckOut, 'EEE d MMM', { locale: es })}
              </p>
            </div>
          </div>

          {/* Additive pricing */}
          <div className="bg-slate-50 rounded-xl p-3.5 space-y-2 text-sm">
            {originalTotal != null && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-emerald-500" />
                  Reserva original
                </span>
                <span className="font-mono text-slate-400 line-through decoration-slate-300">
                  {currency} {originalTotal.toLocaleString()}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center">
              <span className="text-slate-700 font-medium">
                + {daysAdded} noche{daysAdded > 1 ? 's' : ''} × {currency} {ratePerNight.toLocaleString()}
              </span>
              <span className="font-bold font-mono text-emerald-700">
                {currency} {extensionTotal.toLocaleString()}
              </span>
            </div>

            {accumulatedTotal != null && (
              <div className="border-t border-slate-200 pt-2 flex justify-between items-center">
                <span className="text-slate-500 text-xs font-medium uppercase tracking-wide">
                  Total acumulado
                </span>
                <span className="font-bold font-mono text-slate-800">
                  {currency} {accumulatedTotal.toLocaleString()}
                </span>
              </div>
            )}

            <p className="text-[10px] text-slate-400 pt-0.5">
              Precio informativo del sistema. Sprint 8 habilitará tarifas por plan y channel manager.
            </p>
          </div>

          {/* OTA advisory */}
          {isOta && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-800">
                  Reserva vía {otaName ?? source}
                </p>
                <p className="text-[11px] text-amber-700 mt-0.5 leading-snug">
                  Próximamente el PMS sincronizará automáticamente con todas las OTAs vía
                  Channel Manager. Por ahora, refleja el cambio en la extranet de {otaName ?? source}.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-2.5">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={isPending}
          >
            Cancelar
          </Button>

          {roomConflict ? (
            <Button
              className={cn(
                'flex-1 text-white shadow-sm',
                canConfirmNewRoom
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                  : 'bg-slate-300 cursor-not-allowed',
              )}
              onClick={() => canConfirmNewRoom && onConfirmNewRoom!(selectedRoomId)}
              disabled={isPending || !canConfirmNewRoom}
            >
              {isPending
                ? 'Extendiendo...'
                : canConfirmNewRoom
                ? `Mover a Hab. ${availableRooms.find(r => r.id === selectedRoomId)?.number}`
                : 'Elige habitación'
              }
            </Button>
          ) : (
            <Button
              className={cn(
                'flex-1 bg-emerald-600 hover:bg-emerald-700 text-white',
                'shadow-sm shadow-emerald-200',
              )}
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Extendiendo...' : `Extender +${daysAdded}n`}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
