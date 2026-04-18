/**
 * Sidebar.tsx — navegación global de la aplicación.
 *
 * La navegación lateral fija fue reemplazada por un top bar único con el
 * componente <AppMenu /> (hamburguesa + dropdown). Este archivo conserva
 * sus exports (Sidebar, MobileNav) para no romper imports existentes,
 * pero ambos ahora renderizan la misma barra superior.
 *
 * La barra incluye:
 *   - <AppMenu />  → hamburguesa que abre Dashboard / Calendario / Housekeeping
 *   - logo + nombre "Zenix" clickeable (vuelve al Dashboard)
 *   - usuario activo + botón "Salir"
 *
 * Esa misma UX está también embebida en <TimelineTopBar /> (la barra del
 * endpoint /pms), para que el hamburguesa sea un punto único en todo el PMS.
 */
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { AppMenu } from './AppMenu'

/** Mapea los roles del backend a etiquetas legibles para el usuario */
const ROLE_LABEL: Record<string, string> = {
  SUPERVISOR: 'Supervisor',
  RECEPTIONIST: 'Recepción',
  HOUSEKEEPER: 'Housekeeping',
}

function GlobalTopBar() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 h-14 bg-white border-b border-slate-200">
      <AppMenu />

      <button
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-2 text-slate-800 hover:text-slate-600 transition-colors"
        aria-label="Ir al dashboard"
      >
        <span className="text-lg leading-none">⚡</span>
        <span className="text-sm font-semibold">Zenix</span>
      </button>

      <div className="flex-1" />

      {user && (
        <div className="flex items-center gap-3">
          <div className="text-right min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate max-w-[140px]">
              {user.name}
            </p>
            <p className="text-xs text-slate-400 leading-tight">
              {ROLE_LABEL[user.role ?? ''] ?? user.role}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1 rounded"
            title="Cerrar sesión"
          >
            Salir
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Kept for backwards-compatibility with `ProtectedLayout` which imports
 * both symbols. Both render the same single top bar now.
 */
export function Sidebar() {
  return <GlobalTopBar />
}

export function MobileNav() {
  // MobileNav existed to render the hamburger on mobile while Sidebar ran
  // the desktop fixed column. With the new global top bar everything is
  // unified, so this is now an empty peer — kept only so existing imports
  // don't break.
  return null
}
