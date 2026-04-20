import { useNavigate } from 'react-router-dom'
import { User, Settings, LogOut, Activity } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '../store/auth'

/**
 * UserMenu — utility navigation, top-right avatar.
 *
 * Grounded in Nielsen Norman Group's 2024 "Utility Navigation" guidance:
 *   "Users look in the top-right corner for Account, Log in, and My
 *    Profile — this prominent placement makes utility actions always
 *    visible."
 *
 * Content mirrors the Cloudbeds reference image 2 (profile, settings,
 * system status with version, sign out). Entries that don't back onto
 * real routes yet are marked disabled so we don't lie to the user —
 * they'll turn live as those modules ship.
 *
 * Sources:
 *   · nngroup.com/articles/utility-navigation
 *   · Cloudbeds myfrontdesk account-menu reference
 */

// Surfaced as the "Estado del sistema" version line. Bumped manually
// per release; replace with a build-time constant once we ship a
// CI-driven version file.
const APP_VERSION = '0.2.0-dev'

export function UserMenu() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const initials = (user?.name ?? '??')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?'

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full shrink-0 h-9 w-9 text-slate-600 hover:bg-slate-100"
          aria-label="Abrir menú de usuario"
        >
          <span className="inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-600 h-7 w-7">
            <User className="h-4 w-4" />
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        {/* Header — user identity block */}
        {user && (
          <div className="px-3 py-3 flex items-start gap-3">
            <span className="inline-flex items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold h-10 w-10 shrink-0">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{user.name}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {roleLabel(user.role)}
              </p>
            </div>
          </div>
        )}

        <DropdownMenuSeparator />

        {/* Account */}
        <DropdownMenuItem disabled>
          <User className="mr-2 h-4 w-4" />
          Mi perfil
          <span className="ml-auto text-[10px] text-slate-400">Próximamente</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/settings/rooms')}>
          <Settings className="mr-2 h-4 w-4" />
          Configuración
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* System */}
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
          Sistema
        </DropdownMenuLabel>
        <DropdownMenuItem disabled className="opacity-100 cursor-default">
          <Activity className="mr-2 h-4 w-4 text-emerald-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-700">Estado del sistema</p>
            <p className="text-xs text-slate-400">{APP_VERSION}</p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Session */}
        <DropdownMenuItem
          onSelect={handleLogout}
          className="text-red-600 focus:text-red-700"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Salir de la aplicación
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function roleLabel(role: string | null | undefined) {
  switch (role) {
    case 'SUPERVISOR':   return 'Supervisor'
    case 'RECEPTIONIST': return 'Recepción'
    case 'HOUSEKEEPER':  return 'Housekeeping'
    default:             return role ?? ''
  }
}
