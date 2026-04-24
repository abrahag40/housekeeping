import { ChevronLeft, ChevronRight, EyeOff } from 'lucide-react'
import { format, addDays } from 'date-fns'
import { es } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useTimelineStore } from '../../stores/timeline.store'
import { cn } from '@/lib/utils'
import type { ViewMode } from '../../types/timeline.types'

const VIEW_OPTIONS: { mode: ViewMode; label: string }[] = [
  { mode: 'week', label: 'Semana' },
  { mode: 'month', label: 'Mes' },
]

interface TimelineSubBarProps {
  onNavigate?: (direction: 'prev' | 'next') => void
  onGoToToday?: () => void
  hideNoShows?: boolean
  onToggleHideNoShows?: () => void
}

export function TimelineSubBar({
  onNavigate,
  onGoToToday,
  hideNoShows = false,
  onToggleHideNoShows,
}: TimelineSubBarProps) {
  const { viewStart, viewMode, daysVisible, navigate, goToToday, setViewMode } =
    useTimelineStore()

  const rangeEnd = addDays(viewStart, daysVisible - 1)
  const startLabel = format(viewStart, 'MMM yyyy', { locale: es }).toUpperCase()
  const endLabel = format(rangeEnd, 'MMM yyyy', { locale: es }).toUpperCase()
  const rangeLabel = startLabel === endLabel ? startLabel : `${startLabel} — ${endLabel}`

  const handleNavigate = (dir: 'prev' | 'next') => {
    if (onNavigate) onNavigate(dir)
    else navigate(dir)
  }

  const handleGoToToday = () => {
    if (onGoToToday) onGoToToday()
    else goToToday()
  }

  return (
    <div className="flex items-center gap-2 px-4 h-10 border-b border-slate-200 bg-white shrink-0">
      {/* Navigation */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => handleNavigate('prev')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="h-7 px-3 text-xs font-semibold"
        onClick={handleGoToToday}
      >
        HOY
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => handleNavigate('next')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* View mode toggles */}
      <div className="flex items-center gap-0.5 bg-slate-100 rounded-md p-0.5">
        {VIEW_OPTIONS.map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              'px-3 py-1 text-xs font-medium rounded transition-colors',
              viewMode === mode
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <Separator orientation="vertical" className="h-5 mx-1" />

      {/* Range label */}
      <span className="text-xs font-medium text-slate-500 tracking-wide">
        {rangeLabel}
      </span>

      {/* No-show filter — §34: default visible, toggle to hide */}
      {onToggleHideNoShows && (
        <>
          <Separator orientation="vertical" className="h-5 mx-1 ml-auto" />
          <button
            onClick={onToggleHideNoShows}
            title={hideNoShows ? 'Mostrar no-shows' : 'Ocultar no-shows'}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
              hideNoShows
                ? 'bg-slate-200 text-slate-700'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100',
            )}
          >
            <EyeOff className="h-3.5 w-3.5" />
            {hideNoShows ? 'No-shows ocultos' : 'Ocultar no-shows'}
          </button>
        </>
      )}
    </div>
  )
}
