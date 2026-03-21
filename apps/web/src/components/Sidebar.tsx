/**
 * Sidebar.tsx — Navegación principal de la aplicación
 *
 * Exports dos componentes que trabajan juntos para cubrir desktop y móvil:
 *
 *   <Sidebar />   — Sidebar fijo de 256px, visible solo en pantallas lg+.
 *                   Se monta una vez y nunca se desmonta.
 *
 *   <MobileNav /> — Barra superior fija (h-14) visible solo en móvil (<lg).
 *                   Contiene un botón hamburguesa que abre un drawer lateral
 *                   con el mismo NavContent. El drawer se cierra automáticamente
 *                   al navegar (prop onNavigate).
 *
 * Ambos componentes renderizan <NavContent> internamente, que es donde vive
 * toda la lógica de navegación, usuario, logout y badges de alerta.
 *
 * Badge de discrepancias:
 *   NavContent hace polling a GET /discrepancies cada 60 segundos para calcular
 *   cuántas están en estado OPEN. Si hay alguna, aparece un círculo rojo con el
 *   número junto al ítem "Discrepancias" en el menú. Esto alerta al supervisor
 *   sin requerir que abra la página de discrepancias.
 *
 * Grupos de navegación:
 *   Principal    — Operaciones del día a día (Planificación, Tareas)
 *   Operaciones  — Checkouts, Discrepancias, Reportes
 *   Configuración — Gestión del hostel (solo supervisores usarán estas secciones)
 */
import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'
import type { BedDiscrepancyDto } from '@housekeeping/shared'
import { DiscrepancyStatus } from '@housekeeping/shared'

type NavItem = { to: string; icon: string; label: string }

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Principal',
    items: [
      { to: '/planning', icon: '📋', label: 'Planificación' },
      // 'Habitaciones' se eliminó de aquí: su funcionalidad (mapa en tiempo real
      // y checkout manual) fue absorbida por el módulo de Planificación (pestaña
      // "Estado en Tiempo Real"). Mantenerla como ítem separado generaba confusión
      // y duplicación de pantallas. La ruta /rooms sigue existiendo pero no se
      // expone en el menú.
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

/** Mapea los roles del backend a etiquetas legibles para el usuario */
const ROLE_LABEL: Record<string, string> = {
  SUPERVISOR: 'Supervisor', RECEPTIONIST: 'Recepción', HOUSEKEEPER: 'Housekeeping',
}

// ─── Shared nav content ───────────────────────────────────────────────────────

/**
 * NavContent — El contenido del menú compartido entre Sidebar y MobileNav.
 *
 * @param onNavigate  Callback que se invoca al hacer clic en un enlace.
 *                    En MobileNav se usa para cerrar el drawer.
 *                    En Sidebar desktop es undefined (no necesita cerrar nada).
 */
function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  /**
   * Polling ligero: cuenta las discrepancias OPEN para mostrar el badge rojo.
   * Se reusan los datos ya cacheados si otra query también llama a /discrepancies.
   * refetchInterval: 60s — balance entre actualidad y carga al servidor.
   * La página DiscrepanciesPage usa SSE para actualizaciones instantáneas;
   * este badge es solo una "alerta pasiva" mientras el supervisor está en otras pantallas.
   */
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
      {/* Logo */}
      <div className="px-4 py-5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-xl">🏠</span>
          <div>
            <p className="text-sm font-semibold text-gray-900 leading-tight">Housekeeping</p>
            <p className="text-xs text-gray-400 leading-tight">Sistema de limpieza</p>
          </div>
        </div>
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

  return (
    <>
      {/* Top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏠</span>
          <span className="text-sm font-semibold text-gray-900">Housekeeping</span>
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
