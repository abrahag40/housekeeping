import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { usePropertyStore } from '../store/property'
import { api } from '../api/client'
import type { BedDiscrepancyDto, PropertyDto } from '@housekeeping/shared'
import { DiscrepancyStatus } from '@housekeeping/shared'

type NavItem = { to: string; icon: string; label: string }

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Principal',
    items: [
      { to: '/planning', icon: '📋', label: 'Planificación' },
      { to: '/kanban',   icon: '🗂️', label: 'Tareas' },
    ],
  },
  {
    title: 'Operaciones',
    items: [
      { to: '/checkouts',     icon: '🚪', label: 'Checkouts' },
      { to: '/discrepancies', icon: '⚠️', label: 'Discrepancias' },
      { to: '/reports',       icon: '📊', label: 'Reportes' },
    ],
  },
  {
    title: 'Configuración',
    items: [
      { to: '/settings/rooms',    icon: '🛏️', label: 'Habitaciones' },
      { to: '/settings/staff',    icon: '👥', label: 'Personal' },
      { to: '/settings/property', icon: '⚙️', label: 'Propiedad' },
    ],
  },
]

const ROLE_LABEL: Record<string, string> = {
  SUPERVISOR: 'Supervisor', RECEPTIONIST: 'Recepción', HOUSEKEEPER: 'Housekeeping',
}

// ─── Property Switcher ────────────────────────────────────────────────────────

/**
 * Shows the active property name. If the user has access to more than one
 * property (SUPERVISOR role), clicking opens a dropdown to switch context.
 *
 * On switch: updates usePropertyStore → api/client.ts picks up the new
 * X-Property-Id header → qc.clear() flushes all React Query cache so every
 * page refetches data scoped to the new property.
 */
function PropertySwitcher({ onNavigate }: { onNavigate?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { user } = useAuthStore()
  const { activePropertyId, setActiveProperty } = usePropertyStore()
  const qc = useQueryClient()

  const effectivePropertyId = activePropertyId ?? user?.propertyId

  const { data: properties = [] } = useQuery<PropertyDto[]>({
    queryKey: ['properties-mine'],
    queryFn: () => api.get('/properties/mine'),
    staleTime: 5 * 60 * 1000,
  })

  const activeProperty = properties.find((p) => p.id === effectivePropertyId) ?? properties[0]

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  function handleSwitch(id: string, name: string) {
    setActiveProperty(id, name)
    qc.clear()
    setOpen(false)
    onNavigate?.()
  }

  const multiProperty = properties.length > 1

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => multiProperty && setOpen((o) => !o)}
        className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-colors ${
          multiProperty
            ? 'hover:bg-gray-100 cursor-pointer'
            : 'cursor-default'
        }`}
        title={multiProperty ? 'Cambiar sucursal' : undefined}
      >
        <span className="text-sm shrink-0">🏢</span>
        <span className="flex-1 text-sm font-medium text-gray-800 truncate">
          {activeProperty?.name ?? '—'}
        </span>
        {multiProperty && (
          <svg
            className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
          {properties.map((p) => {
            const isActive = p.id === effectivePropertyId
            return (
              <button
                key={p.id}
                onClick={() => handleSwitch(p.id, p.name)}
                className={`flex items-center gap-2 w-full px-3 py-2.5 text-sm text-left transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className={`w-4 text-center text-indigo-600 ${isActive ? '' : 'invisible'}`}>
                  ✓
                </span>
                <span>{p.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Shared nav content ───────────────────────────────────────────────────────

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const { data: openDiscrepancyCount = 0 } = useQuery<number>({
    queryKey: ['discrepancies-open-count'],
    queryFn: async () => {
      const all = await api.get<BedDiscrepancyDto[]>('/discrepancies')
      return all.filter((d) => d.status === DiscrepancyStatus.OPEN).length
    },
    refetchInterval: 60_000,
  })

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Logo + Property Switcher */}
      <div className="px-4 pt-5 pb-3 border-b border-gray-200 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏠</span>
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">Housekeeping</p>
            <p className="text-xs text-gray-400 leading-tight">Sistema de limpieza</p>
          </div>
        </div>
        <PropertySwitcher onNavigate={onNavigate} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-2 mb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">{group.title}</p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-indigo-50 text-indigo-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`
                  }
                >
                  <span className="text-base leading-none shrink-0">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.to === '/discrepancies' && openDiscrepancyCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
                      {openDiscrepancyCount}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-gray-200">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400">{ROLE_LABEL[user?.role ?? ''] ?? user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-red-500 transition-colors px-1 py-1 rounded shrink-0"
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Desktop sidebar (fixed) ─────────────────────────────────────────────────

export function Sidebar() {
  return (
    <aside className="hidden lg:flex flex-col w-64 min-h-screen bg-white border-r border-gray-200 fixed top-0 left-0 z-20">
      <NavContent />
    </aside>
  )
}

// ─── Mobile top bar + drawer ─────────────────────────────────────────────────

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const { activePropertyName } = usePropertyStore()

  return (
    <>
      {/* Top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏠</span>
          <span className="text-sm font-semibold text-gray-900">
            {activePropertyName ?? 'Housekeeping'}
          </span>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
          aria-label="Abrir menú"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </div>

      {/* Drawer overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          {/* Drawer */}
          <div className="relative w-72 max-w-[85vw] bg-white h-full shadow-xl">
            <NavContent onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
