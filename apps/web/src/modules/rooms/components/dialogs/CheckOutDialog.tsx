import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader,
         DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem,
         SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { LogOut, AlertCircle, CheckCircle, Moon } from 'lucide-react'
import type { GuestStayBlock } from '../../types/timeline.types'

interface CheckOutDialogProps {
  stay: GuestStayBlock | null
  open: boolean
  onClose: () => void
  onConfirm: (stayId: string, paymentData: CheckoutPayment) => void
}

export interface CheckoutPayment {
  amount: number
  method: string
  notes: string
}

export function CheckOutDialog({
  stay, open, onClose, onConfirm
}: CheckOutDialogProps) {
  const [payment, setPayment] = useState({
    amount: 0,
    method: 'cash',
    notes: '',
  })
  const [confirmed, setConfirmed] = useState(false)

  if (!stay) return null

  const balance = stay.totalAmount - stay.amountPaid
  const isFullyPaid = balance <= 0

  function handleConfirm() {
    if (!isFullyPaid && payment.amount < balance) return
    setConfirmed(true)
    setTimeout(() => {
      onConfirm(stay!.id, payment)
      onClose()
      setConfirmed(false)
      setPayment({ amount: 0, method: 'cash', notes: '' })
    }, 800)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px] p-0 overflow-hidden gap-0">

        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b bg-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center
                           justify-center flex-shrink-0">
              <LogOut className="h-4 w-4 text-white" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-white">
                Checkout — {stay.guestName}
              </DialogTitle>
              <div className="text-xs text-slate-300 mt-0.5">
                Salida: {format(new Date(stay.checkOut), "d MMM yyyy", { locale: es })}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 bg-white">

          {/* Resumen del folio */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Folio de estadía
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-600">Habitación</span>
              <span className="text-xs font-semibold text-slate-800">
                Hab. {stay.roomNumber ?? stay.roomId.replace('r-','')} × <Moon className="inline h-3 w-3 opacity-60" /> {stay.nights} noches
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-600">Tarifa</span>
              <span className="text-xs font-mono text-slate-800">
                {stay.currency} {(stay.totalAmount / stay.nights).toFixed(0)}/noche
              </span>
            </div>
            <Separator className="my-1" />
            <div className="flex justify-between items-center">
              <span className="text-xs font-semibold text-slate-700">Total</span>
              <span className="text-sm font-mono font-bold text-slate-800">
                {stay.currency} {stay.totalAmount.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-600">Pagado</span>
              <span className="text-xs font-mono text-emerald-600 font-semibold">
                − {stay.currency} {stay.amountPaid.toLocaleString()}
              </span>
            </div>
            <div className={cn(
              "flex justify-between items-center pt-1",
              "border-t border-slate-200"
            )}>
              <span className="text-sm font-bold text-slate-800">
                Saldo pendiente
              </span>
              <span className={cn(
                "text-base font-mono font-bold",
                isFullyPaid ? "text-emerald-600" : "text-amber-600"
              )}>
                {stay.currency} {balance.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Pago del saldo si hay pendiente */}
          {!isFullyPaid && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-amber-700
                             bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                Hay un saldo pendiente de {stay.currency} {balance.toLocaleString()}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-600">
                    Monto a cobrar
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2
                                   text-xs text-slate-400 font-mono">
                      {stay.currency}
                    </span>
                    <Input
                      type="number"
                      min={0}
                      max={balance}
                      placeholder={String(balance)}
                      value={payment.amount || ''}
                      onChange={e => setPayment(p => ({
                        ...p, amount: parseFloat(e.target.value) || 0
                      }))}
                      className="h-9 text-sm pl-12"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-slate-600">
                    Método de pago
                  </Label>
                  <Select
                    value={payment.method}
                    onValueChange={v => setPayment(p => ({ ...p, method: v }))}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Efectivo</SelectItem>
                      <SelectItem value="card">Tarjeta</SelectItem>
                      <SelectItem value="transfer">Transferencia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {isFullyPaid && (
            <div className="flex items-center gap-2 text-xs text-emerald-700
                           bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" />
              Pago completo — listo para checkout
            </div>
          )}

          {/* Housekeeping notice */}
          <div className="text-[11px] text-slate-400 bg-slate-50
                         rounded-lg px-3 py-2 border border-slate-100">
            Al confirmar el checkout, se generará automáticamente
            una tarea de limpieza para esta habitación.
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50
                       flex justify-between items-center">
          <Button variant="ghost" size="sm" onClick={onClose}
                  className="text-xs">
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!isFullyPaid && payment.amount < balance}
            className={cn(
              "text-xs transition-all",
              confirmed
                ? "bg-emerald-500 hover:bg-emerald-500"
                : "bg-slate-800 hover:bg-slate-700"
            )}
          >
            {confirmed ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 mr-1.5" />
                Checkout completado!
              </>
            ) : (
              <>
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                Confirmar checkout
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
