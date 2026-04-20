/**
 * Sidebar.tsx — global top bar for routes outside the PMS timeline.
 *
 * Layout (mirrors TimelineTopBar minus the PMS-only action icons):
 *
 *   [☰ AppDrawer] [PropertySwitcher?]                    [👤 UserMenu]
 *
 * Property switcher is shown contextually — routes whose data does not
 * depend on the active property hide it so the user isn't misled into
 * thinking they can "switch" a non-scoped page. The active scope for
 * those pages is communicated *inside* the page itself (see
 * SettingsPage's ScopeBanner). This pattern follows NN/G's guidance on
 * mode indication: "make the scope of an action unambiguous at the
 * point of action" (Modes in User Interfaces, nngroup.com/articles/modes).
 *
 * Routes that HIDE the switcher in the top bar:
 *   · /settings/*   — configuration is either global (org-scoped) or
 *                     per-property but with its own scope selector
 *                     embedded at the top of the page.
 *
 * Routes that SHOW the switcher:
 *   · /dashboard, /planning, /kanban, /checkouts, /discrepancies,
 *     /reports  — each renders property-scoped data, so the top-bar
 *     switcher IS the way to change context.
 */
import { useLocation } from 'react-router-dom'
import { Plus, Calendar, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AppDrawer } from './AppDrawer'
import { PropertySwitcher } from './PropertySwitcher'
import { UserMenu } from './UserMenu'

// Route prefixes that DO NOT render the top-bar property switcher.
// Expand this list conservatively — every entry added here is a scope
// the user must be able to reach via some in-page control instead.
const ROUTES_WITHOUT_SWITCHER = ['/settings']

function shouldShowSwitcher(pathname: string): boolean {
  return !ROUTES_WITHOUT_SWITCHER.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function NotificationBell({ count = 0 }: { count?: number }) {
  const hasNew = count > 0
  return (
    <button
      className={cn(
        'relative flex items-center justify-center',
        'w-9 h-9 rounded-lg text-slate-500 hover:text-slate-700',
        'hover:bg-slate-100 transition-colors duration-150',
      )}
      aria-label="Notificaciones"
    >
      <Bell className="h-5 w-5" strokeWidth={1.75} />
      {hasNew && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="absolute w-9 h-9 rounded-lg bg-red-400/20" style={{ animation: 'radar1 2.5s ease-out infinite' }} />
          <span className="absolute w-9 h-9 rounded-lg bg-red-400/15" style={{ animation: 'radar2 2.5s ease-out 0.6s infinite' }} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" />
        </span>
      )}
    </button>
  )
}

function GlobalTopBar() {
  const { pathname } = useLocation()
  const showSwitcher = shouldShowSwitcher(pathname)

  return (
    <div className="fixed top-0 left-0 right-0 z-30 flex items-center gap-3 px-4 h-14 bg-white border-b border-slate-200">
      <AppDrawer />
      {showSwitcher && <PropertySwitcher />}
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          className="h-8 w-8 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
          aria-label="Nueva reserva"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-600" aria-label="Ir a fecha">
          <Calendar className="h-4 w-4" />
        </Button>
        <NotificationBell count={0} />
        <UserMenu />
      </div>
    </div>
  )
}

export function Sidebar() {
  return <GlobalTopBar />
}

export function MobileNav() {
  // Compatibility shim — unified under GlobalTopBar + AppDrawer.
  return null
}
