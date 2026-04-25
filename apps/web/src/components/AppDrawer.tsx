import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Menu, X } from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { api } from '../api/client'
import type { UnitDiscrepancyDto } from '@zenix/shared'
import { DiscrepancyStatus } from '@zenix/shared'

/**
 * AppDrawer — primary module navigation, top-left hamburger.
 *
 * Design decisions (grounded in research):
 *  · Top-left hamburger icon, visible in every top bar (Cloudbeds
 *    myfrontdesk convention). NN/G hamburger-menu guidance favors
 *    persistent sidebars for dense PMS workflows, but we use the drawer
 *    because the spec is explicit and the drawer keeps screen real
 *    estate for the timeline grid. The drawer minimizes the
 *    discoverability cost by (a) large, always-visible trigger, and
 *    (b) a flat module list — no submenu indirection except for the
 *    Housekeeping hub, which is shown already expanded.
 *  · Left-sliding Sheet (w-80) with an explicit close button next to
 *    the active-property header, mirroring the Cloudbeds reference.
 *  · Navigating a menu item auto-closes the drawer (onOpenChange + the
 *    onSelect handlers), so one click gets the user to their page.
 *
 * Sources:
 *   · NN/G "Hamburger Menus Hurt UX Metrics" (2024, updated)
 *   · Clerk multi-tenant header conventions (property switcher sits
 *     beside this drawer trigger, not inside it)
 */

type NavLeaf = { to: string; icon: string; label: string; kind: 'leaf' }
type NavGroup = {
  kind: 'group'
  icon: string
  label: string
  defaultOpen?: boolean
  children: {
    to: string
    icon: string
    label: string
    showDiscrepancyBadge?: boolean
  }[]
}
type NavItem = NavLeaf | NavGroup

const NAV: NavItem[] = [
  { kind: 'leaf', to: '/dashboard', icon: '🏠', label: 'Panel' },
  { kind: 'leaf', to: '/pms',       icon: '📅', label: 'Calendario' },
  {
    kind: 'group',
    icon: '🧹',
    label: 'Housekeeping',
    defaultOpen: true,
    children: [
      { to: '/planning',      icon: '📋', label: 'Planificación' },
      { to: '/kanban',        icon: '🗂️', label: 'Tareas' },
      { to: '/checkouts',     icon: '🚪', label: 'Checkouts' },
      { to: '/discrepancies', icon: '⚠️', label: 'Discrepancias', showDiscrepancyBadge: true },
      { to: '/blocks',        icon: '🔒', label: 'Bloqueos' },
    ],
  },
  { kind: 'leaf', to: '/reports',       icon: '📊', label: 'Reportes' },
  { kind: 'leaf', to: '/settings/rooms', icon: '⚙️', label: 'Configuración' },
]

function NavRow({
  active,
  icon,
  label,
  onClick,
  badgeCount,
  nested = false,
}: {
  active: boolean
  icon: string
  label: string
  onClick: () => void
  badgeCount?: number
  nested?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 w-full rounded-lg text-sm transition-colors text-left',
        nested ? 'px-3 py-2 ml-2' : 'px-3 py-2.5',
        active
          ? 'bg-indigo-50 text-indigo-700 font-medium'
          : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      <span className="text-base leading-none shrink-0 w-5 text-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {badgeCount !== undefined && badgeCount > 0 && (
        <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
          {badgeCount}
        </span>
      )}
    </button>
  )
}

function GroupRow({
  item,
  isAnyChildActive,
  open,
  onToggle,
}: {
  item: NavGroup
  isAnyChildActive: boolean
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm transition-colors text-left',
        isAnyChildActive
          ? 'text-indigo-700'
          : 'text-slate-700 hover:bg-slate-100',
      )}
      aria-expanded={open}
    >
      <span className="text-base leading-none shrink-0 w-5 text-center">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      <ChevronDown
        className={cn(
          'h-4 w-4 text-slate-400 transition-transform',
          open && 'rotate-180',
        )}
      />
    </button>
  )
}

export function AppDrawer() {
  const [open, setOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    Object.fromEntries(
      NAV.flatMap((i) =>
        i.kind === 'group' ? [[i.label, i.defaultOpen ?? true]] : [],
      ),
    ),
  )
  const navigate = useNavigate()
  const location = useLocation()

  const { data: discrepancyCount = 0 } = useQuery<number>({
    queryKey: ['discrepancies-open-count'],
    queryFn: async () => {
      const all = await api.get<UnitDiscrepancyDto[]>('/discrepancies')
      return all.filter((d) => d.status === DiscrepancyStatus.OPEN).length
    },
    refetchInterval: 60_000,
  })

  function isActive(to: string) {
    return location.pathname === to || location.pathname.startsWith(to + '/')
  }

  function go(to: string) {
    navigate(to)
    setOpen(false)
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          aria-label="Abrir menú de navegación"
        >
          <Menu className="h-5 w-5 text-slate-600" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-80 p-0 flex flex-col"
      >
        {/* Header — matches the Cloudbeds reference: close button at the
            top-left where the hamburger was, keeping the same hit-zone. */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-200">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5 text-slate-600" />
          </Button>
          <div className="flex items-center gap-2 ml-1">
            <span className="text-lg leading-none">⚡</span>
            <span className="text-sm font-semibold text-slate-900">Zenix</span>
          </div>
        </div>

        {/* Nav list */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {NAV.map((item) => {
            if (item.kind === 'leaf') {
              return (
                <NavRow
                  key={item.to}
                  active={isActive(item.to)}
                  icon={item.icon}
                  label={item.label}
                  onClick={() => go(item.to)}
                />
              )
            }
            const anyActive = item.children.some((c) => isActive(c.to))
            const isOpen = openGroups[item.label] ?? item.defaultOpen ?? true
            return (
              <div key={item.label}>
                <GroupRow
                  item={item}
                  isAnyChildActive={anyActive}
                  open={isOpen}
                  onToggle={() =>
                    setOpenGroups((g) => ({ ...g, [item.label]: !isOpen }))
                  }
                />
                {isOpen && (
                  <div className="mt-1 pl-2 border-l border-slate-200 ml-5 space-y-0.5">
                    {item.children.map((c) => (
                      <NavRow
                        key={c.to}
                        active={isActive(c.to)}
                        icon={c.icon}
                        label={c.label}
                        onClick={() => go(c.to)}
                        nested
                        badgeCount={
                          c.showDiscrepancyBadge ? discrepancyCount : undefined
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </SheetContent>
    </Sheet>
  )
}
