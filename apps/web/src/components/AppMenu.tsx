import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Menu } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { api } from '../api/client'
import type { BedDiscrepancyDto } from '@zenix/shared'
import { DiscrepancyStatus } from '@zenix/shared'

/**
 * AppMenu — single entry point for navigating the PMS.
 *
 * Rendered as a hamburger button that opens a dropdown with the three
 * top-level modules: Dashboard, Calendario, Housekeeping. The last one
 * expands into the operational sub-pages (Planificación, Tareas,
 * Checkouts, Discrepancias, Reportes).
 *
 * This component is embedded into every app surface (TimelineTopBar for
 * /pms, plus the ProtectedLayout top bar used by every other route) so
 * the user has a consistent single menu everywhere in the PMS.
 *
 * The Discrepancias entry shows a red count badge when there are open
 * discrepancies (polled every 60s via React Query).
 */

type MenuItem =
  | { kind: 'leaf'; to: string; icon: string; label: string }
  | {
      kind: 'hub'
      icon: string
      label: string
      children: { to: string; icon: string; label: string; showDiscrepancyBadge?: boolean }[]
    }

const MENU: MenuItem[] = [
  { kind: 'leaf', to: '/dashboard', icon: '🏠', label: 'Dashboard' },
  { kind: 'leaf', to: '/pms',       icon: '📅', label: 'Calendario' },
  {
    kind: 'hub',
    icon: '🧹',
    label: 'Housekeeping',
    children: [
      { to: '/planning',      icon: '📋', label: 'Planificación' },
      { to: '/kanban',        icon: '🗂️', label: 'Tareas' },
      { to: '/checkouts',     icon: '🚪', label: 'Checkouts' },
      { to: '/discrepancies', icon: '⚠️', label: 'Discrepancias', showDiscrepancyBadge: true },
      { to: '/reports',       icon: '📊', label: 'Reportes' },
    ],
  },
]

export interface AppMenuProps {
  /**
   * Visual style of the trigger. `ghost` (default) fits the TimelineTopBar
   * and most screens; `solid` gives a subtle gray background for contexts
   * without an obvious hover target.
   */
  variant?: 'ghost' | 'solid'
}

export function AppMenu({ variant = 'ghost' }: AppMenuProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const { data: openDiscrepancyCount = 0 } = useQuery<number>({
    queryKey: ['discrepancies-open-count'],
    queryFn: async () => {
      const all = await api.get<BedDiscrepancyDto[]>('/discrepancies')
      return all.filter((d) => d.status === DiscrepancyStatus.OPEN).length
    },
    refetchInterval: 60_000,
  })

  function isActive(to: string) {
    return location.pathname === to || location.pathname.startsWith(to + '/')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant === 'solid' ? 'secondary' : 'ghost'}
          size="icon"
          className="shrink-0"
          aria-label="Abrir menú de navegación"
        >
          <Menu className="h-5 w-5 text-slate-600" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        {MENU.map((item, idx) => {
          if (item.kind === 'leaf') {
            return (
              <DropdownMenuItem
                key={item.to}
                onSelect={() => navigate(item.to)}
                className={isActive(item.to) ? 'bg-indigo-50 text-indigo-700' : ''}
              >
                <span className="mr-2 text-base leading-none">{item.icon}</span>
                {item.label}
              </DropdownMenuItem>
            )
          }
          // Housekeeping hub → submenu
          const hubActive = item.children.some((c) => isActive(c.to))
          return (
            <div key={item.label}>
              {idx > 0 && <DropdownMenuSeparator />}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  className={hubActive ? 'bg-indigo-50 text-indigo-700' : ''}
                >
                  <span className="mr-2 text-base leading-none">{item.icon}</span>
                  {item.label}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  {item.children.map((c) => (
                    <DropdownMenuItem
                      key={c.to}
                      onSelect={() => navigate(c.to)}
                      className={isActive(c.to) ? 'bg-indigo-50 text-indigo-700' : ''}
                    >
                      <span className="mr-2 text-base leading-none">{c.icon}</span>
                      <span className="flex-1">{c.label}</span>
                      {c.showDiscrepancyBadge && openDiscrepancyCount > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
                          {openDiscrepancyCount}
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </div>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
