import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StatusDot } from '../shared/StatusDot'
import { TIMELINE, STATUS_DOT_COLORS } from '../../utils/timeline.constants'
import type { RoomTypeGroup, FlatRow } from '../../types/timeline.types'
import type { RoomStatus } from '../shared/RoomStatusBadge'

interface ReadinessTask {
  roomId: string
  status: string
  itemsDone: number
  itemsTotal: number
}

interface RoomColumnProps {
  flatRows: FlatRow[]
  groups: RoomTypeGroup[]
  onToggleGroup: (groupId: string) => void
  scrollTop?: number
  readinessTasks?: ReadinessTask[]
  /**
   * Map<roomId, lockedByName> — rooms currently soft-locked by another
   * receptionist. Renders a 🔒 badge with the operator's name.
   *
   * UX rationale (CLAUDE.md §Principio Rector):
   * - Principio de escasez visual (Cialdini): el badge ámbar con candado
   *   activa atención prioritaria vía Sistema 1 (Kahneman) sin interrumpir
   *   el flujo del recepcionista — es informativo, no bloqueante.
   * - Gestalt proximidad: el badge se coloca junto al número de habitación
   *   para que el vínculo "cuarto ↔ estado de bloqueo" sea inmediato.
   * - Carga cognitiva (Sweller): nombre truncado a 10 chars + ícono candado
   *   es el mínimo de información necesaria para evitar conflicto.
   */
  lockedRooms?: Map<string, string>
  /** When true: render rows directly (no internal scroll/translate, no header spacer). */
  embedded?: boolean
}

const READINESS_CONFIG: Record<string, { color: string; label: string; title: string }> = {
  PENDING:           { color: '#94A3B8', label: '\u23F3', title: 'Limpieza pendiente' },
  IN_PROGRESS:       { color: '#38BDF8', label: '\uD83E\uDDF9', title: 'Limpieza en progreso' },
  NEEDS_MAINTENANCE: { color: '#FB923C', label: '\uD83D\uDD27', title: 'Requiere mantenimiento' },
  READY:             { color: '#A78BFA', label: '\u2713',  title: 'Lista — pendiente aprobación' },
  APPROVED:          { color: '#10B981', label: '\u2713\u2713', title: 'Aprobada' },
}

export function RoomColumn({ flatRows, groups, onToggleGroup, scrollTop = 0, readinessTasks, lockedRooms, embedded = false }: RoomColumnProps) {
  const groupMap = new Map(groups.map((g) => [g.id, g]))

  const rowsContent = (
    <>
      {flatRows.map((row) => {
            if (row.type === 'group') {
              const group = groupMap.get(row.id)!
              return (
                <button
                  key={`g-${row.id}`}
                  onClick={() => onToggleGroup(row.id)}
                  className="flex items-center gap-2 w-full px-3 border-b border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors"
                  style={{ height: TIMELINE.GROUP_HEADER_HEIGHT }}
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 text-slate-400 transition-transform duration-200',
                      group.collapsed && '-rotate-90',
                    )}
                  />
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide truncate">
                    {group.name}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {group.rooms.length} hab.
                  </span>

                  {/* Mini status indicators */}
                  <div className="flex items-center gap-0.5 ml-auto mr-2">
                    {group.rooms.slice(0, 5).map((room) => (
                      <div
                        key={room.id}
                        className="w-1.5 h-3 rounded-full"
                        style={{
                          backgroundColor:
                            STATUS_DOT_COLORS[room.status] ?? '#94A3B8',
                        }}
                      />
                    ))}
                  </div>

                </button>
              )
            }

            const room = row.room!
            return (
              <div
                key={`r-${row.id}`}
                className={cn(
                  'flex items-center gap-2 px-3 border-b border-slate-200/70',
                  'hover:bg-slate-50/50 transition-colors',
                  'animate-slide-down',
                )}
                style={{ height: TIMELINE.ROW_HEIGHT }}
              >
                <StatusDot status={room.status as RoomStatus} size="sm" />
                <span className="text-sm font-semibold text-slate-800 w-10">
                  {room.number}
                </span>
                {room.floor != null && (
                  <span className="text-[10px] text-slate-400">P{room.floor}</span>
                )}

                {/* Soft-lock badge — visible only when another receptionist
                    has this room open. Amber = advisory (no-bloqueante).
                    Truncado a 10 chars para no saturar la columna estrecha.
                    Tooltip completo vía title para quien necesite el nombre
                    completo (Ley de Fitts: info extra on-demand, no ambient). */}
                {lockedRooms?.has(room.id) && (
                  <span
                    className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 leading-none select-none"
                    title={`En uso por ${lockedRooms.get(room.id)}`}
                  >
                    🔒 <span className="max-w-[56px] truncate">{lockedRooms.get(room.id)}</span>
                  </span>
                )}

                {(() => {
                  const task = readinessTasks?.find((t) => t.roomId === room.id)
                  if (!task) return null
                  const pct =
                    task.itemsTotal > 0
                      ? Math.round((task.itemsDone / task.itemsTotal) * 100)
                      : 0
                  const cfg = READINESS_CONFIG[task.status] ?? {
                    color: '#94A3B8',
                    label: '?',
                    title: task.status,
                  }
                  return (
                    <div
                      className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold cursor-default"
                      style={{
                        backgroundColor: `${cfg.color}18`,
                        color: cfg.color,
                      }}
                      title={
                        task.status === 'IN_PROGRESS' && pct > 0
                          ? `${cfg.title} — ${pct}%`
                          : cfg.title
                      }
                    >
                      <span>{cfg.label}</span>
                      {task.status === 'IN_PROGRESS' && pct > 0 && (
                        <span>{pct}%</span>
                      )}
                    </div>
                  )
                })()}
              </div>
            )
          })}
    </>
  )

  if (embedded) {
    return (
      <div
        className="bg-white pb-4"
        style={{ width: TIMELINE.COLUMN_WIDTH }}
      >
        {rowsContent}
      </div>
    )
  }

  return (
    <div
      className="shrink-0 border-r border-slate-200 bg-white z-30 flex flex-col"
      style={{ width: TIMELINE.COLUMN_WIDTH }}
    >
      {/* Header spacer to align with DateHeader */}
      <div
        className="border-b border-slate-200 flex items-end px-3 pb-2"
        style={{ height: TIMELINE.HEADER_HEIGHT }}
      >
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Habitaciones
        </span>
      </div>

      {/* Scrollable rows — outer clips, inner translates */}
      <div className="flex-1 overflow-hidden">
        <div style={{ transform: `translateY(-${scrollTop}px)` }}>
          {rowsContent}
        </div>
      </div>
    </div>
  )
}
