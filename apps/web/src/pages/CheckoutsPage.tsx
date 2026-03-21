/**
 * CheckoutsPage — Checkouts individuales ad-hoc
 *
 * Esta pantalla es para casos fuera de la planificación matutina:
 *  - Late checkouts que no se registraron a la mañana
 *  - Salidas anticipadas (early checkout)
 *  - Cualquier caso puntual que recepción necesite registrar manualmente
 *
 * El flujo normal de checkouts masivos se maneja en DailyPlanningPage.
 * Esta página complementa ese flujo para casos excepcionales.
 *
 * La hora de checkout por defecto se obtiene de PropertySettings.defaultCheckoutTime
 * para mantener consistencia con la configuración del hostel.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { CheckoutDto, PropertySettingsDto, RoomDto } from '@housekeeping/shared'
import { RoomType } from '@housekeeping/shared'

export function CheckoutsPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const { data: checkouts = [], isLoading } = useQuery<CheckoutDto[]>({
    queryKey: ['checkouts'],
    queryFn: () => api.get('/checkouts'),
  })

  const { data: rooms = [] } = useQuery<RoomDto[]>({
    queryKey: ['rooms'],
    queryFn: () => api.get('/rooms'),
  })

  const { data: settings } = useQuery<PropertySettingsDto>({
    queryKey: ['property-settings'],
    queryFn: () => api.get('/settings'),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/checkouts/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checkouts'] })
      toast.success('Checkout cancelado')
    },
    onError: () => toast.error('Error al cancelar'),
  })

  if (isLoading) return <div className="text-sm text-gray-400 py-8 text-center">Cargando...</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Checkouts Individuales</h1>
          <p className="text-xs text-gray-400 mt-0.5">Para late checkouts o casos fuera de la planificación matutina</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-indigo-700"
        >
          {showForm ? '✕ Cerrar' : '+ Nuevo Checkout'}
        </button>
      </div>

      {showForm && (
        <QuickCheckoutForm
          rooms={rooms}
          defaultCheckoutTime={settings?.defaultCheckoutTime ?? '11:00'}
          onSaved={() => {
            setShowForm(false)
            qc.invalidateQueries({ queryKey: ['checkouts'] })
            toast.success('Checkout registrado')
          }}
        />
      )}

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Room</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Hora</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Flags</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {checkouts.map((c) => {
              const room = rooms.find((r) => r.id === c.roomId)
              return (
                <tr key={c.id} className={c.cancelled ? 'opacity-40' : ''}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {room?.number ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {format(new Date(c.actualCheckoutAt), 'dd/MM HH:mm')}
                  </td>
                  <td className="px-4 py-3 text-xs space-x-1">
                    {c.isEarlyCheckout && (
                      <span className="bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">early</span>
                    )}
                    {c.hasSameDayCheckIn && (
                      <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded">🔴 Check-in hoy</span>
                    )}
                    {c.source === 'CLOUDBEDS' && (
                      <span className="bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">PMS</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs ${c.cancelled ? 'text-gray-400' : 'text-green-600'}`}>
                      {c.cancelled ? 'Cancelado' : 'Activo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!c.cancelled && (
                      <button
                        onClick={() => cancelMutation.mutate(c.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {checkouts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">
                  Sin checkouts registrados
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Simplified form: Room + urgent flag + optional note ─────────────────────

/**
 * QuickCheckoutForm — Formulario simplificado para checkout individual
 *
 * Diseñado para ser rápido (3 campos esenciales):
 *  1. Habitación (selector)
 *  2. Hora de checkout (pre-llenada con la configuración del hostel)
 *  3. Flag urgente (check-in el mismo día → tarea URGENT)
 *
 * La nota es opcional pero útil para comunicar detalles al housekeeper
 * (ej: "el cliente olvidó algo en el baño").
 */
function QuickCheckoutForm({
  rooms,
  defaultCheckoutTime,
  onSaved,
}: {
  rooms: RoomDto[]
  defaultCheckoutTime: string
  onSaved: () => void
}) {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [roomId, setRoomId] = useState('')
  const [hasSameDayCheckIn, setHasSameDayCheckIn] = useState(false)
  const [notes, setNotes] = useState('')
  // Pre-fill con hoy + hora por defecto de configuración (ej: "2025-03-20T11:00")
  const [checkoutAt, setCheckoutAt] = useState(`${today}T${defaultCheckoutTime}`)

  const mutation = useMutation({
    mutationFn: (body: object) => api.post('/checkouts', body),
    onSuccess: onSaved,
    onError: () => toast.error('Error al registrar checkout'),
  })

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-5">
      <p className="text-sm font-semibold text-gray-900 mb-4">Registrar Checkout</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate({
            roomId,
            actualCheckoutAt: new Date(checkoutAt).toISOString(),
            hasSameDayCheckIn,
            notes: notes || undefined,
          })
        }}
      >
        {/* Room picker */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Habitación *</label>
            <select
              required
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
            >
              <option value="">Seleccionar...</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} — {r.type === RoomType.SHARED ? `Dorm (${r.capacity} camas)` : 'Privada'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Hora de checkout
              <span className="text-gray-400 ml-1 font-normal">(default {defaultCheckoutTime})</span>
            </label>
            <input
              type="datetime-local"
              value={checkoutAt}
              onChange={(e) => setCheckoutAt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          </div>
        </div>

        {/* Urgent flag */}
        <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={hasSameDayCheckIn}
            onChange={(e) => setHasSameDayCheckIn(e.target.checked)}
            className="rounded"
          />
          <span className={hasSameDayCheckIn ? 'text-red-600 font-medium' : 'text-gray-600'}>
            🔴 Check-in hoy — Limpiar con prioridad urgente
          </span>
        </label>

        {/* Optional notes */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Nota para housekeeping (opcional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Ej: cliente dejó objetos olvidados, revisar caja fuerte..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="bg-indigo-600 text-white rounded-lg px-5 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {mutation.isPending ? 'Registrando...' : 'Registrar Checkout'}
          </button>
        </div>
      </form>
    </div>
  )
}
