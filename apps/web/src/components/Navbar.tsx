import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { HousekeepingRole } from '@housekeeping/shared'

const links = [
  { to: '/rooms', label: 'Habitaciones', roles: [HousekeepingRole.RECEPTIONIST, HousekeepingRole.SUPERVISOR] },
  { to: '/planning', label: 'Planificación', roles: [HousekeepingRole.RECEPTIONIST, HousekeepingRole.SUPERVISOR] },
  { to: '/kanban', label: 'Kanban', roles: [HousekeepingRole.SUPERVISOR] },
  { to: '/checkouts', label: 'Checkouts', roles: [HousekeepingRole.RECEPTIONIST, HousekeepingRole.SUPERVISOR] },
  { to: '/staff', label: 'Personal', roles: [HousekeepingRole.SUPERVISOR] },
  { to: '/maintenance', label: 'Mantenimiento', roles: [HousekeepingRole.SUPERVISOR] },
]

export function Navbar() {
  const { user, logout } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()

  const visibleLinks = links.filter((l) => user && l.roles.includes(user.role as HousekeepingRole))

  function handleLogout() {
    logout()
    navigate('/login')
  }

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-gray-900 text-sm tracking-wide">Housekeeping</span>
            <div className="flex items-center gap-1">
              {visibleLinks.map((l) => (
                <Link
                  key={l.to}
                  to={l.to}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    location.pathname.startsWith(l.to)
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500">{user?.name}</span>
            <span className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-0.5">{user?.role}</span>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-500 hover:text-gray-900"
            >
              Salir
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
