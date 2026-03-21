/**
 * SettingsPage — Configuración del hostel
 *
 * Tres secciones accesibles via tabs (URL: /settings/:section):
 *
 *  Habitaciones — CRUD de rooms y beds.
 *  Personal     — CRUD de housekeepers y supervisores.
 *  Propiedad    — Configuración operativa del hostel.
 *
 * Control de acceso: isSupervisor determina si se muestran formularios de edición.
 */
import { useState, useEffect } from 'react'
import { useParams, NavLink } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import type { BedDto, PropertySettingsDto, RoomDto, StaffDto } from '@housekeeping/shared'
import { Capability, HousekeepingRole, RoomType } from '@housekeeping/shared'

type Section = 'rooms' | 'staff' | 'property'

const TABS: { key: Section; label: string; icon: string }[] = [
  { key: 'rooms',    label: 'Habitaciones', icon: '🛏️' },
  { key: 'staff',    label: 'Personal',     icon: '👥' },
  { key: 'property', label: 'Propiedad',    icon: '⚙️' },
]

export function SettingsPage() {
  const { section = 'rooms' } = useParams<{ section?: Section }>()
  const user = useAuthStore((s) => s.user)
  const isSupervisor = user?.role === HousekeepingRole.SUPERVISOR

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Configuración</h1>
        <p className="text-xs text-gray-400 mt-0.5">
          {isSupervisor
            ? 'Gestiona habitaciones, personal y configuración.'
            : 'Vista de solo lectura — solicita cambios al supervisor.'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-0">
        {TABS.map((tab) => (
          <NavLink
            key={tab.key}
            to={`/settings/${tab.key}`}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 transition-colors ${
                isActive || section === tab.key
                  ? 'border-indigo-600 text-indigo-700 font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`
            }
          >
            {tab.icon} {tab.label}
          </NavLink>
        ))}
      </div>

      {section === 'rooms'    && <RoomsSection isSupervisor={isSupervisor} />}
      {section === 'staff'    && <StaffSection isSupervisor={isSupervisor} />}
      {section === 'property' && <PropertySection isSupervisor={isSupervisor} />}
    </div>
  )
}

// ─── Rooms & Beds ─────────────────────────────────────────────────────────────

function RoomsSection({ isSupervisor }: { isSupervisor: boolean }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: rooms = [], isLoading } = useQuery<(RoomDto & { beds: BedDto[] })[]>({
    queryKey: ['rooms-settings'],
    queryFn: () => api.get('/rooms'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/rooms/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms-settings'] })
      toast.success('Habitación eliminada')
    },
    onError: () => toast.error('No se puede eliminar — tiene registros asociados'),
  })

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{rooms.length} habitaciones registradas</p>
        {isSupervisor && (
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            + Agregar Habitación
          </button>
        )}
      </div>

      {showAdd && isSupervisor && (
        <AddRoomForm
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            qc.invalidateQueries({ queryKey: ['rooms-settings'] })
          }}
        />
      )}

      <div className="space-y-2">
        {rooms.map((room) => (
          <div key={room.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <button
                onClick={() => setExpanded(expanded === room.id ? null : room.id)}
                className="flex items-center gap-3 text-left flex-1 min-w-0"
              >
                <span className="text-gray-300 text-xs">{expanded === room.id ? '▼' : '▶'}</span>
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {room.type === RoomType.SHARED ? 'Dorm' : 'Hab.'} {room.number}
                    {room.floor != null && (
                      <span className="text-gray-400 font-normal ml-2 text-xs">Piso {room.floor}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    {room.type === RoomType.SHARED ? 'Compartido' : 'Privado'} ·{' '}
                    {room.beds?.length ?? 0} cama{(room.beds?.length ?? 0) !== 1 ? 's' : ''}
                  </p>
                </div>
              </button>
              {isSupervisor && (
                <button
                  onClick={() => {
                    if (confirm(`¿Eliminar habitación ${room.number}?`)) deleteMutation.mutate(room.id)
                  }}
                  className="text-xs text-red-400 hover:text-red-600 ml-4 shrink-0"
                >
                  Eliminar
                </button>
              )}
            </div>
            {expanded === room.id && (
              <div className="border-t border-gray-100 px-4 py-3 bg-gray-50/60">
                <BedsManager roomId={room.id} beds={room.beds ?? []} isSupervisor={isSupervisor} />
              </div>
            )}
          </div>
        ))}
        {rooms.length === 0 && <EmptyState text="No hay habitaciones. Agrega la primera." />}
      </div>
    </div>
  )
}

function BedsManager({ roomId, beds, isSupervisor }: { roomId: string; beds: BedDto[]; isSupervisor: boolean }) {
  const qc = useQueryClient()
  const [label, setLabel] = useState('')

  const addMutation = useMutation({
    mutationFn: (l: string) => api.post(`/rooms/${roomId}/beds`, { label: l }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms-settings'] })
      setLabel('')
      toast.success('Cama agregada')
    },
    onError: () => toast.error('Error al agregar cama'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/beds/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms-settings'] })
      toast.success('Cama eliminada')
    },
    onError: () => toast.error('No se puede eliminar'),
  })

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Camas</p>
      <div className="flex flex-wrap gap-2">
        {beds.map((bed) => (
          <span
            key={bed.id}
            className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs text-gray-700"
          >
            {bed.label}
            {isSupervisor && (
              <button
                onClick={() => {
                  if (confirm(`¿Eliminar cama "${bed.label}"?`)) deleteMutation.mutate(bed.id)
                }}
                className="text-gray-300 hover:text-red-400 leading-none"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {beds.length === 0 && <span className="text-xs text-gray-400">Sin camas</span>}
      </div>
      {isSupervisor && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (label.trim()) addMutation.mutate(label.trim())
          }}
        >
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ej: Cama 7"
            maxLength={20}
            className="input flex-1 text-xs py-1"
          />
          <button type="submit" disabled={addMutation.isPending} className="btn-secondary text-xs py-1">
            + Cama
          </button>
        </form>
      )}
    </div>
  )
}

function AddRoomForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [number, setNumber]     = useState('')
  const [type, setType]         = useState<RoomType>(RoomType.SHARED)
  const [floor, setFloor]       = useState('')
  const [capacity, setCapacity] = useState('6')

  const mutation = useMutation({
    mutationFn: (body: object) => api.post('/rooms', body),
    onSuccess: onSaved,
    onError: () => toast.error('Error al crear habitación'),
  })

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-gray-900">Nueva habitación</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
      </div>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate({
            number,
            type,
            floor: floor ? parseInt(floor) : null,
            capacity: parseInt(capacity),
          })
        }}
      >
        <div>
          <label className="form-label">Número / nombre *</label>
          <input
            required
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="101 o Dorm-A"
            className="input"
          />
        </div>
        <div>
          <label className="form-label">Tipo *</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as RoomType)}
            className="input"
          >
            <option value={RoomType.SHARED}>Compartido (dorm)</option>
            <option value={RoomType.PRIVATE}>Privado</option>
          </select>
        </div>
        <div>
          <label className="form-label">Piso</label>
          <input
            type="number"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            placeholder="Opcional"
            className="input"
          />
        </div>
        <div>
          <label className="form-label">Capacidad *</label>
          <input
            required
            type="number"
            min="1"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className="input"
          />
        </div>
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Creando...' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Staff ────────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  SUPERVISOR:   'Supervisor',
  RECEPTIONIST: 'Recepción',
  HOUSEKEEPER:  'Housekeeping',
}

const CAPABILITY_LABEL: Record<string, string> = {
  CLEANING:      'Limpieza',
  SANITIZATION:  'Sanitización',
  MAINTENANCE:   'Mantenimiento',
}

function StaffSection({ isSupervisor }: { isSupervisor: boolean }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  const { data: staff = [], isLoading } = useQuery<StaffDto[]>({
    queryKey: ['staff'],
    queryFn: () => api.get('/staff'),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/staff/${id}`, { active }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] })
      toast.success('Estado actualizado')
    },
    onError: () => toast.error('Error al actualizar'),
  })

  if (isLoading) return <Spinner />

  // Encuentra el miembro que se está editando para pre-poblar el formulario
  const editingStaff = staff.find((s) => s.id === editing) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{staff.length} miembros</p>
        {isSupervisor && (
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            + Agregar Personal
          </button>
        )}
      </div>

      {showAdd && isSupervisor && (
        <AddStaffForm
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            setShowAdd(false)
            qc.invalidateQueries({ queryKey: ['staff'] })
          }}
        />
      )}

      {/* Formulario de edición inline: se muestra debajo de la tabla cuando hay
          un miembro seleccionado para editar. Pre-poblado con todos sus datos actuales. */}
      {editing && editingStaff && isSupervisor && (
        <EditStaffForm
          staff={editingStaff}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: ['staff'] })
          }}
        />
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Nombre</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">Email</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Rol</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Estado</th>
              {isSupervisor && <th className="px-4 py-3 w-16" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {staff.map((s) => (
              <tr key={s.id} className={s.active ? '' : 'opacity-50'}>
                <td className="px-4 py-3 font-medium text-gray-900">{s.name}</td>
                <td className="px-4 py-3 text-gray-400 text-xs hidden sm:table-cell">{s.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      s.role === 'SUPERVISOR'
                        ? 'bg-purple-50 text-purple-700'
                        : s.role === 'RECEPTIONIST'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {ROLE_LABEL[s.role] ?? s.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {isSupervisor ? (
                    <button
                      onClick={() => toggleActive.mutate({ id: s.id, active: !s.active })}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        s.active
                          ? 'bg-green-50 text-green-700 border-green-200'
                          : 'bg-gray-50 text-gray-400 border-gray-200'
                      }`}
                    >
                      {s.active ? 'Activo' : 'Inactivo'}
                    </button>
                  ) : (
                    <span className={`text-xs ${s.active ? 'text-green-600' : 'text-gray-400'}`}>
                      {s.active ? 'Activo' : 'Inactivo'}
                    </span>
                  )}
                </td>
                {isSupervisor && (
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(editing === s.id ? null : s.id)}
                      className="text-xs text-indigo-400 hover:text-indigo-600"
                    >
                      {editing === s.id ? 'Cerrar' : 'Editar'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AddStaffForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole]         = useState<HousekeepingRole>(HousekeepingRole.HOUSEKEEPER)
  const [caps, setCaps]         = useState<Capability[]>([Capability.CLEANING])

  const mutation = useMutation({
    mutationFn: (body: object) => api.post('/staff', body),
    onSuccess: onSaved,
    onError: () => toast.error('Error al crear personal — el email puede estar en uso'),
  })

  function toggleCap(c: Capability) {
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Nuevo miembro</p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
      </div>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate({ name, email, password, role, capabilities: caps })
        }}
      >
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label">Nombre *</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label">Email *</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label">Contraseña * (mín. 6 chars)</label>
          <input
            required
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label">Rol *</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as HousekeepingRole)}
            className="input"
          >
            <option value={HousekeepingRole.HOUSEKEEPER}>Housekeeping</option>
            <option value={HousekeepingRole.SUPERVISOR}>Supervisor</option>
            <option value={HousekeepingRole.RECEPTIONIST}>Recepción</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="form-label">Capacidades</label>
          <div className="flex gap-2 flex-wrap">
            {Object.values(Capability).map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={caps.includes(c)}
                  onChange={() => toggleCap(c)}
                  className="rounded"
                />
                {CAPABILITY_LABEL[c] ?? c}
              </label>
            ))}
          </div>
        </div>
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Creando...' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * EditStaffForm — Formulario de edición inline de un miembro del personal.
 *
 * CORRECCIÓN: Antes el botón "Editar" no pre-poblaba los campos, dejándolos
 * vacíos e imposibles de editar. Ahora se recibe el objeto `staff` completo
 * como prop y se inicializan todos los estados (name, email, role, caps)
 * con sus valores actuales al montar el componente.
 *
 * La contraseña NO se pre-popula (nunca se devuelve desde la API por seguridad).
 * El campo contraseña es opcional en el PATCH: si se deja vacío, no se cambia.
 *
 * Endpoint: PATCH /staff/:id con los campos actualizados.
 */
function EditStaffForm({
  staff,
  onClose,
  onSaved,
}: {
  staff: StaffDto
  onClose: () => void
  onSaved: () => void
}) {
  // Pre-poblar TODOS los campos con los valores actuales del staff
  // Esto es el fix principal: antes estos estados se inicializaban en '' vacío
  const [name, setName]     = useState(staff.name)
  const [email, setEmail]   = useState(staff.email)
  const [password, setPassword] = useState('') // vacío por defecto — solo si se quiere cambiar
  const [role, setRole]     = useState<HousekeepingRole>(staff.role as HousekeepingRole)
  const [caps, setCaps]     = useState<Capability[]>(
    // staff.capabilities puede ser undefined si el DTO no lo incluye — fallback a []
    (staff.capabilities as Capability[] | undefined) ?? [],
  )

  const mutation = useMutation({
    mutationFn: (body: object) => api.patch(`/staff/${staff.id}`, body),
    onSuccess: () => {
      toast.success('Personal actualizado')
      onSaved()
    },
    onError: () => toast.error('Error al actualizar personal'),
  })

  function toggleCap(c: Capability) {
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  return (
    <div className="bg-white border border-indigo-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">
          Editar personal — <span className="text-indigo-600">{staff.name}</span>
        </p>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">×</button>
      </div>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          // Solo incluir contraseña en el payload si el supervisor la escribió
          // (no enviar string vacío para no sobreescribir la contraseña actual)
          const body: Record<string, unknown> = { name, email, role, capabilities: caps }
          if (password.length >= 6) body.password = password
          mutation.mutate(body)
        }}
      >
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label">Nombre *</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label">Email *</label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label">
            Nueva contraseña
            <span className="text-gray-400 font-normal ml-1">(dejar vacío para no cambiar)</span>
          </label>
          <input
            type="password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mín. 6 caracteres"
            className="input"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="form-label">Rol *</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as HousekeepingRole)}
            className="input"
          >
            <option value={HousekeepingRole.HOUSEKEEPER}>Housekeeping</option>
            <option value={HousekeepingRole.SUPERVISOR}>Supervisor</option>
            <option value={HousekeepingRole.RECEPTIONIST}>Recepción</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="form-label">Capacidades</label>
          <div className="flex gap-2 flex-wrap">
            {Object.values(Capability).map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={caps.includes(c)}
                  onChange={() => toggleCap(c)}
                  className="rounded"
                />
                {CAPABILITY_LABEL[c] ?? c}
              </label>
            ))}
          </div>
        </div>
        <div className="col-span-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Property ─────────────────────────────────────────────────────────────────

/**
 * PropertySection — Configuración operativa de la propiedad.
 *
 * CAMPOS NUEVOS (v2):
 *   - Hora de check-in por defecto (defaultCheckInTime)
 *   - Nombre de la propiedad (propertyName)
 *   - Estándares de limpieza (cleaningStandard): BASIC/STANDARD/PREMIUM/LUXURY
 *   - Tiempo estimado de limpieza en minutos (estimatedCleaningMinutes)
 *   - Notas para housekeeping (housekeepingNotes)
 *
 * TODO: Los campos nuevos requieren una migración de Prisma.
 * Ver apps/api/prisma/schema.prisma — se añadieron los campos al modelo PropertySettings.
 * Ejecutar: npx prisma migrate dev --name add_property_settings_fields
 *
 * Los campos nuevos se envían al PATCH /settings junto con los existentes.
 * Si el backend aún no tiene la migración, Prisma simplemente ignorará los campos
 * desconocidos (comportamiento seguro).
 */
function PropertySection({ isSupervisor }: { isSupervisor: boolean }) {
  const qc = useQueryClient()
  const { data: settings, isLoading } = useQuery<PropertySettingsDto>({
    queryKey: ['property-settings'],
    queryFn: () => api.get('/settings'),
  })

  // Campos existentes
  const [checkoutTime, setCheckoutTime] = useState('')

  // Campos nuevos — con defaults razonables para hostels/hoteles
  const [checkInTime, setCheckInTime]                 = useState('15:00')
  const [propertyName, setPropertyName]               = useState('')
  const [cleaningStandard, setCleaningStandard]       = useState('STANDARD')
  const [estimatedMinutes, setEstimatedMinutes]       = useState(45)
  const [housekeepingNotes, setHousekeepingNotes]     = useState('')

  // Pre-poblar todos los campos cuando llegan los datos del servidor
  useEffect(() => {
    if (settings) {
      setCheckoutTime(settings.defaultCheckoutTime)
      // Campos nuevos — usar el valor del servidor si existe, o el default si no (compatibilidad)
      setCheckInTime((settings as unknown as Record<string, string>).defaultCheckInTime ?? '15:00')
      setPropertyName((settings as unknown as Record<string, string>).propertyName ?? '')
      setCleaningStandard((settings as unknown as Record<string, string>).cleaningStandard ?? 'STANDARD')
      setEstimatedMinutes((settings as unknown as Record<string, number>).estimatedCleaningMinutes ?? 45)
      setHousekeepingNotes((settings as unknown as Record<string, string>).housekeepingNotes ?? '')
    }
  }, [settings])

  const mutation = useMutation({
    mutationFn: (body: object) => api.patch('/settings', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['property-settings'] })
      toast.success('Configuración guardada')
    },
    onError: () => toast.error('Error al guardar'),
  })

  if (isLoading) return <Spinner />

  function handleSave() {
    mutation.mutate({
      defaultCheckoutTime: checkoutTime,
      // Campos nuevos incluidos en el payload
      // TODO: Requieren migración de Prisma antes de ser persistidos
      defaultCheckInTime:        checkInTime,
      propertyName:              propertyName || undefined,
      cleaningStandard,
      estimatedCleaningMinutes:  estimatedMinutes,
      housekeepingNotes:         housekeepingNotes || undefined,
    })
  }

  return (
    <div className="max-w-lg space-y-5">
      {/* Horarios */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Horarios</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">
              Hora de checkout por defecto
              <span className="text-gray-400 font-normal ml-1">(pre-llena nuevos checkouts)</span>
            </label>
            <input
              type="time"
              value={checkoutTime}
              onChange={(e) => setCheckoutTime(e.target.value)}
              disabled={!isSupervisor}
              className="input disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label className="form-label">
              Hora de check-in por defecto
              <span className="text-gray-400 font-normal ml-1">(planificación)</span>
            </label>
            <input
              type="time"
              value={checkInTime}
              onChange={(e) => setCheckInTime(e.target.value)}
              disabled={!isSupervisor}
              className="input disabled:opacity-60 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Datos de la propiedad */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Datos de la Propiedad</h3>

        <div>
          <label className="form-label">Nombre de la propiedad</label>
          <input
            type="text"
            value={propertyName}
            onChange={(e) => setPropertyName(e.target.value)}
            disabled={!isSupervisor}
            placeholder="Ej: Hostel Xochimilco, Hotel Casa Azul..."
            className="input disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      {/* Estándares de limpieza */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-900">Estándares de Limpieza</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">
              Nivel de limpieza
              <span className="text-gray-400 font-normal ml-1">(afecta checklists)</span>
            </label>
            <select
              value={cleaningStandard}
              onChange={(e) => setCleaningStandard(e.target.value)}
              disabled={!isSupervisor}
              className="input disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <option value="BASIC">Básico — limpieza esencial</option>
              <option value="STANDARD">Estándar — protocolo completo</option>
              <option value="PREMIUM">Premium — revisión detallada</option>
              <option value="LUXURY">Lujo — inspección de 5 estrellas</option>
            </select>
          </div>

          <div>
            <label className="form-label">
              Tiempo estimado por cama
              <span className="text-gray-400 font-normal ml-1">(min)</span>
            </label>
            <input
              type="number"
              min={5}
              max={180}
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(parseInt(e.target.value) || 45)}
              disabled={!isSupervisor}
              className="input disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">
              Se muestra al housekeeper como tiempo guía por tarea.
            </p>
          </div>
        </div>

        <div>
          <label className="form-label">
            Notas para housekeeping
            <span className="text-gray-400 font-normal ml-1">(instrucciones generales)</span>
          </label>
          <textarea
            value={housekeepingNotes}
            onChange={(e) => setHousekeepingNotes(e.target.value)}
            disabled={!isSupervisor}
            rows={3}
            placeholder="Ej: Usar productos ecológicos. Cliente VIP en habitación 201 esta semana. Revisar minibar en habitaciones privadas."
            className="input resize-none disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-gray-400 mt-1">
            Estas notas se mostrarán al personal de housekeeping en su app.
          </p>
        </div>
      </div>

      {/* Botón guardar */}
      {isSupervisor && (
        <button
          onClick={handleSave}
          disabled={mutation.isPending}
          className="btn-primary disabled:opacity-50"
        >
          {mutation.isPending ? 'Guardando...' : 'Guardar Configuración'}
        </button>
      )}

      {/* Modo PMS */}
      <div
        className={`rounded-xl border p-4 text-xs space-y-1 ${
          settings?.pmsMode === 'CONNECTED'
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-blue-50 border-blue-200 text-blue-700'
        }`}
      >
        <p className="font-semibold">
          {settings?.pmsMode === 'CONNECTED' ? '🔗 Modo PMS conectado' : '🏠 Modo standalone'}
        </p>
        <p>
          {settings?.pmsMode === 'CONNECTED'
            ? 'Checkouts recibidos automáticamente desde el PMS.'
            : 'Checkouts registrados manualmente desde Planificación o Habitaciones.'}
        </p>
      </div>
    </div>
  )
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function Spinner() {
  return <div className="text-sm text-gray-400 py-8 text-center">Cargando...</div>
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-center py-10 text-gray-400 text-sm">{text}</div>
}
