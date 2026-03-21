import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { StaffDto } from '@housekeeping/shared'
import { HousekeepingRole, Capability } from '@housekeeping/shared'

const ROLE_LABELS: Record<HousekeepingRole, string> = {
  [HousekeepingRole.HOUSEKEEPER]: 'Housekeeper',
  [HousekeepingRole.SUPERVISOR]: 'Supervisor',
  [HousekeepingRole.RECEPTIONIST]: 'Recepción',
}

export function StaffPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<StaffDto | null>(null)

  const { data: staff = [], isLoading } = useQuery<StaffDto[]>({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/staff/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      toast.success('Personal desactivado')
    },
    onError: () => toast.error('Error al desactivar'),
  })

  if (isLoading) return <div className="text-sm text-gray-500 py-8 text-center">Cargando...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Personal</h1>
        <button
          onClick={() => { setEditing(null); setShowForm(true) }}
          className="bg-indigo-600 text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-indigo-700"
        >
          + Agregar
        </button>
      </div>

      {showForm && (
        <StaffForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null) }}
          onSaved={() => {
            setShowForm(false)
            setEditing(null)
            qc.invalidateQueries({ queryKey: ['staff'] })
          }}
        />
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Nombre</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Rol</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Capacidades</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Estado</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {staff.map((s) => (
              <tr key={s.id} className={!s.active ? 'opacity-50' : ''}>
                <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                <td className="px-4 py-3 text-gray-600">{s.email}</td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">
                    {ROLE_LABELS[s.role as HousekeepingRole]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {s.capabilities.map((c) => (
                      <span key={c} className="text-xs bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">{c}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {s.active ? (
                    <span className="text-xs text-green-600">Activo</span>
                  ) : (
                    <span className="text-xs text-gray-400">Inactivo</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => { setEditing(s); setShowForm(true) }}
                      className="text-xs text-indigo-600 hover:text-indigo-800"
                    >
                      Editar
                    </button>
                    {s.active && (
                      <button
                        onClick={() => deleteMutation.mutate(s.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Desactivar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {staff.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400 text-sm">
                  No hay personal registrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StaffForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: StaffDto | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<HousekeepingRole>(initial?.role as HousekeepingRole ?? HousekeepingRole.HOUSEKEEPER)
  const [capabilities, setCapabilities] = useState<Capability[]>(
    (initial?.capabilities as Capability[]) ?? [Capability.CLEANING],
  )

  const mutation = useMutation({
    mutationFn: (body: object) =>
      initial ? api.patch(`/staff/${initial.id}`, body) : api.post('/staff', body),
    onSuccess: onSaved,
    onError: () => toast.error('Error al guardar'),
  })

  function toggleCap(cap: Capability) {
    setCapabilities((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap],
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const body: Record<string, unknown> = { name, email, role, capabilities }
    if (password) body.password = password
    mutation.mutate(body)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-gray-900">{initial ? 'Editar' : 'Nuevo'} personal</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
      </div>
      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Nombre *</label>
          <input required value={name} onChange={(e) => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Contraseña {initial ? '(dejar vacío para no cambiar)' : '*'}
          </label>
          <input type="password" required={!initial} value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Rol *</label>
          <select value={role} onChange={(e) => setRole(e.target.value as HousekeepingRole)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
            {Object.values(HousekeepingRole).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-2">Capacidades</label>
          <div className="flex gap-3">
            {Object.values(Capability).map((cap) => (
              <label key={cap} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={capabilities.includes(cap)} onChange={() => toggleCap(cap)} className="rounded" />
                {cap}
              </label>
            ))}
          </div>
        </div>
        <div className="col-span-2 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600">Cancelar</button>
          <button type="submit" disabled={mutation.isPending}
            className="bg-indigo-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {mutation.isPending ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  )
}
