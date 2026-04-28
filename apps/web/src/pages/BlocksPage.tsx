import { useState, useMemo, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  differenceInCalendarDays,
  formatDistanceToNow,
  parseISO,
  format,
  isToday,
  isYesterday,
  subDays,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  Lock,
  Check,
  X,
  Unlock,
  CalendarPlus,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  MoreHorizontal,
  Search,
  Wrench,
  Sparkles,
  Eye,
  Camera,
  Star,
  Hammer,
  UserCheck,
  HelpCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  BlockSemantic,
  BlockStatus,
  BlockReason,
  HousekeepingRole,
  type RoomBlockDto,
  type CreateBlockDto,
} from '@zenix/shared'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useSSE } from '../hooks/useSSE'
import { BlockModal } from '../components/blocks/BlockModal'

// ─── Labels (exported — consumed by TimelineScheduler) ────────────────────────

export const SEMANTIC_LABELS: Record<BlockSemantic, string> = {
  [BlockSemantic.OUT_OF_SERVICE]:   'Fuera de servicio',
  [BlockSemantic.OUT_OF_ORDER]:     'Fuera de orden',
  [BlockSemantic.OUT_OF_INVENTORY]: 'Fuera de inventario',
  [BlockSemantic.HOUSE_USE]:        'Uso interno',
}

export const REASON_LABELS: Record<BlockReason, string> = {
  [BlockReason.MAINTENANCE]:   'Mantenimiento',
  [BlockReason.DEEP_CLEANING]: 'Limpieza profunda',
  [BlockReason.INSPECTION]:    'Inspección',
  [BlockReason.PHOTOGRAPHY]:   'Fotografía / Marketing',
  [BlockReason.VIP_SETUP]:     'Preparación VIP',
  [BlockReason.PEST_CONTROL]:  'Control de plagas',
  [BlockReason.WATER_DAMAGE]:  'Daño por agua',
  [BlockReason.ELECTRICAL]:    'Eléctrico',
  [BlockReason.PLUMBING]:      'Plomería',
  [BlockReason.STRUCTURAL]:    'Daño estructural',
  [BlockReason.RENOVATION]:    'Remodelación',
  [BlockReason.OWNER_STAY]:    'Estancia del propietario',
  [BlockReason.STAFF_USE]:     'Uso de personal',
  [BlockReason.OTHER]:         'Otro',
}

const ROLE_LABELS: Record<string, string> = {
  [HousekeepingRole.RECEPTIONIST]: 'Recepción',
  [HousekeepingRole.SUPERVISOR]:   'Supervisor',
  [HousekeepingRole.HOUSEKEEPER]:  'Housekeeping',
}

const STATUS_LABELS: Record<BlockStatus, string> = {
  [BlockStatus.PENDING_APPROVAL]: 'Pendiente',
  [BlockStatus.APPROVED]:         'Aprobado',
  [BlockStatus.ACTIVE]:           'Activo',
  [BlockStatus.EXPIRED]:          'Expirado',
  [BlockStatus.CANCELLED]:        'Cancelado',
  [BlockStatus.REJECTED]:         'Rechazado',
}

const LOG_EVENT_LABELS: Record<string, string> = {
  CREATED:       'Creado',
  APPROVED:      'Aprobado',
  REJECTED:      'Rechazado',
  ACTIVATED:     'Activado',
  EXTENDED:      'Extendido',
  EARLY_RELEASE: 'Liberado anticipadamente',
  CANCELLED:     'Cancelado',
  EXPIRED:       'Expirado',
  NOTE_ADDED:    'Nota agregada',
}

// ─── Color tokens ─────────────────────────────────────────────────────────────

const SEMANTIC_COLORS: Record<BlockSemantic, { bar: string; badge: string; badgeText: string; iconBg: string }> = {
  [BlockSemantic.OUT_OF_SERVICE]:   { bar: 'bg-amber-400',  badge: 'bg-amber-50',  badgeText: 'text-amber-800',  iconBg: 'bg-amber-100 text-amber-700'  },
  [BlockSemantic.OUT_OF_ORDER]:     { bar: 'bg-red-500',    badge: 'bg-red-50',    badgeText: 'text-red-800',    iconBg: 'bg-red-100 text-red-700'      },
  [BlockSemantic.OUT_OF_INVENTORY]: { bar: 'bg-blue-500',   badge: 'bg-blue-50',   badgeText: 'text-blue-800',   iconBg: 'bg-blue-100 text-blue-700'    },
  [BlockSemantic.HOUSE_USE]:        { bar: 'bg-violet-400', badge: 'bg-violet-50', badgeText: 'text-violet-800', iconBg: 'bg-violet-100 text-violet-700'},
}

const STATUS_COLORS: Record<BlockStatus, string> = {
  [BlockStatus.PENDING_APPROVAL]: 'text-amber-700 bg-amber-50 ring-amber-200',
  [BlockStatus.APPROVED]:         'text-emerald-700 bg-emerald-50 ring-emerald-200',
  [BlockStatus.ACTIVE]:           'text-emerald-700 bg-emerald-50 ring-emerald-200',
  [BlockStatus.EXPIRED]:          'text-gray-500 bg-gray-50 ring-gray-200',
  [BlockStatus.CANCELLED]:        'text-gray-400 bg-gray-50 ring-gray-200',
  [BlockStatus.REJECTED]:         'text-red-600 bg-red-50 ring-red-200',
}

const REASON_ICONS: Record<BlockReason, React.ReactElement> = {
  [BlockReason.MAINTENANCE]:   <Wrench className="h-3.5 w-3.5" />,
  [BlockReason.DEEP_CLEANING]: <Sparkles className="h-3.5 w-3.5" />,
  [BlockReason.INSPECTION]:    <Eye className="h-3.5 w-3.5" />,
  [BlockReason.PHOTOGRAPHY]:   <Camera className="h-3.5 w-3.5" />,
  [BlockReason.VIP_SETUP]:     <Star className="h-3.5 w-3.5" />,
  [BlockReason.PEST_CONTROL]:  <Wrench className="h-3.5 w-3.5" />,
  [BlockReason.WATER_DAMAGE]:  <Wrench className="h-3.5 w-3.5" />,
  [BlockReason.ELECTRICAL]:    <Wrench className="h-3.5 w-3.5" />,
  [BlockReason.PLUMBING]:      <Wrench className="h-3.5 w-3.5" />,
  [BlockReason.STRUCTURAL]:    <Hammer className="h-3.5 w-3.5" />,
  [BlockReason.RENOVATION]:    <Hammer className="h-3.5 w-3.5" />,
  [BlockReason.OWNER_STAY]:    <UserCheck className="h-3.5 w-3.5" />,
  [BlockReason.STAFF_USE]:     <UserCheck className="h-3.5 w-3.5" />,
  [BlockReason.OTHER]:         <HelpCircle className="h-3.5 w-3.5" />,
}

const STATUS_SORT: Record<BlockStatus, number> = {
  [BlockStatus.PENDING_APPROVAL]: 0,
  [BlockStatus.ACTIVE]:           1,
  [BlockStatus.APPROVED]:         2,
  [BlockStatus.REJECTED]:         3,
  [BlockStatus.EXPIRED]:          4,
  [BlockStatus.CANCELLED]:        5,
}

const INBOX_STATUSES = new Set([
  BlockStatus.PENDING_APPROVAL,
  BlockStatus.APPROVED,
  BlockStatus.ACTIVE,
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blockLocation(b: RoomBlockDto): string {
  if (b.unitId) return `Cama ${(b as any).unit?.label ?? '—'}`
  return `Hab. ${(b as any).room?.number ?? '—'}`
}

function blockNightsShort(b: RoomBlockDto): string {
  if (!b.endDate) return '∞'
  const n = differenceInCalendarDays(parseISO(b.endDate), parseISO(b.startDate))
  return `${n}n`
}

function blockDateRange(b: RoomBlockDto): string {
  const start = format(parseISO(b.startDate), 'd MMM', { locale: es })
  const end = b.endDate ? format(parseISO(b.endDate), 'd MMM', { locale: es }) : '∞'
  return `${start} → ${end}`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (
    parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)
  ).toUpperCase()
}

function translateNote(note: string | null): string | null {
  if (!note) return null
  const map: Record<string, string> = {
    OUT_OF_SERVICE: 'Fuera de servicio', OUT_OF_ORDER: 'Fuera de orden',
    OUT_OF_INVENTORY: 'Fuera de inventario', HOUSE_USE: 'Uso interno',
    MAINTENANCE: 'Mantenimiento', DEEP_CLEANING: 'Limpieza profunda',
    INSPECTION: 'Inspección', PHOTOGRAPHY: 'Fotografía / Marketing',
    VIP_SETUP: 'Preparación VIP', PEST_CONTROL: 'Control de plagas',
    WATER_DAMAGE: 'Daño por agua', ELECTRICAL: 'Eléctrico',
    PLUMBING: 'Plomería', STRUCTURAL: 'Daño estructural',
    RENOVATION: 'Remodelación', OWNER_STAY: 'Estancia del propietario',
    STAFF_USE: 'Uso de personal', OTHER: 'Otro',
    RECEPTIONIST: 'Recepción', SUPERVISOR: 'Supervisor', HOUSEKEEPER: 'Housekeeping',
    PENDING_APPROVAL: 'Pendiente', APPROVED: 'Aprobado', ACTIVE: 'Activo',
    EXPIRED: 'Expirado', CANCELLED: 'Cancelado', REJECTED: 'Rechazado',
  }
  return Object.entries(map).reduce((s, [k, v]) => s.split(k).join(v), note)
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Hoy'
  if (isYesterday(date)) return 'Ayer'
  return format(date, "d 'de' MMMM, yyyy", { locale: es })
}

function matchesSearch(b: RoomBlockDto, q: string): boolean {
  if (!q) return true
  const loc = blockLocation(b).toLowerCase()
  return loc.includes(q.toLowerCase())
}

// ─── KPI Strip ────────────────────────────────────────────────────────────────

function KpiStrip({ blocks }: { blocks: RoomBlockDto[] }) {
  const kpis = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    const activeBlocks = blocks.filter((b) => b.status === BlockStatus.ACTIVE)
    const hasIndefinite = activeBlocks.some((b) => !b.endDate)
    const blockedNights = activeBlocks.reduce((sum, b) => {
      if (!b.endDate) return sum + 30
      return sum + Math.max(0, differenceInCalendarDays(parseISO(b.endDate), new Date()))
    }, 0)
    return {
      pending:        blocks.filter((b) => b.status === BlockStatus.PENDING_APPROVAL).length,
      active:         activeBlocks.length,
      releasingToday: activeBlocks.filter(
        (b) => b.endDate && format(parseISO(b.endDate), 'yyyy-MM-dd') === todayStr,
      ).length,
      blockedNights: hasIndefinite ? `${blockedNights}+` : blockedNights,
    }
  }, [blocks])

  const cards = [
    {
      label: 'PENDIENTES',
      value: kpis.pending,
      sub: 'por aprobar',
      border: 'border-amber-400',
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      pulse: kpis.pending > 0,
    },
    {
      label: 'ACTIVOS HOY',
      value: kpis.active,
      sub: 'bloqueados',
      border: 'border-blue-500',
      bg: 'bg-blue-50',
      text: 'text-blue-700',
    },
    {
      label: 'LIBERAN',
      value: kpis.releasingToday,
      sub: 'hoy',
      border: 'border-emerald-400',
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
    },
    {
      label: 'NOCHES BLOQUEADAS',
      value: kpis.blockedNights,
      sub: 'acumuladas',
      border: 'border-red-400',
      bg: 'bg-red-50',
      text: 'text-red-700',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map(({ label, value, sub, border, bg, text, pulse }) => (
        <div key={label} className={`rounded-lg border-l-4 ${border} ${bg} px-4 py-3`}>
          <p className={`text-[10px] font-bold uppercase tracking-wider ${text} mb-1`}>{label}</p>
          <p className={`text-2xl font-bold tabular-nums ${pulse ? text : 'text-gray-800'} leading-none`}>
            {value}
          </p>
          <p className={`text-[11px] mt-0.5 ${text} opacity-60`}>{sub}</p>
        </div>
      ))}
    </div>
  )
}

// ─── CardSkeleton ─────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 flex animate-pulse">
      <div className="w-1.5 shrink-0 rounded-l-lg bg-gray-200" />
      <div className="flex-1 px-4 py-3.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gray-200 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <div className="h-4 w-14 bg-gray-200 rounded" />
            <div className="h-4 w-28 bg-gray-200 rounded" />
          </div>
          <div className="h-3 w-48 bg-gray-200 rounded" />
          <div className="h-3 w-32 bg-gray-200 rounded" />
        </div>
        <div className="flex gap-2 shrink-0">
          <div className="h-7 w-20 bg-gray-200 rounded-md" />
          <div className="h-7 w-20 bg-gray-200 rounded-md" />
        </div>
      </div>
    </div>
  )
}

// ─── BlockCard ────────────────────────────────────────────────────────────────

type ConfirmOp = 'approve' | 'reject' | 'cancel' | 'release' | 'extend'

function BlockCard({
  block,
  isSupervisor,
  onApprove,
  onReject,
  onCancel,
  onRelease,
  onExtend,
  working,
  variant,
}: {
  block: RoomBlockDto
  isSupervisor: boolean
  onApprove: (id: string, note?: string) => void
  onReject: (id: string, reason: string) => void
  onCancel: (id: string, reason: string) => void
  onRelease: (id: string) => void
  onExtend: (id: string, endDate: string) => void
  working: boolean
  variant: 'inbox' | 'history'
}) {
  const [showLogs, setShowLogs] = useState(false)
  const [confirmOp, setConfirmOp] = useState<ConfirmOp | null>(null)
  const [confirmNote, setConfirmNote] = useState('')
  const [extendDate, setExtendDate] = useState('')
  const [overflowOpen, setOverflowOpen] = useState(false)

  const sem = SEMANTIC_COLORS[block.semantic]
  const isPending  = block.status === BlockStatus.PENDING_APPROVAL
  const isActive   = block.status === BlockStatus.ACTIVE
  const isApproved = block.status === BlockStatus.APPROVED
  const canAct = isPending || isActive || isApproved

  const requester = (block as any).requestedBy as { id: string; name: string; role: string } | null
  const logs: any[] = (block as any).logs ?? []

  const isAutoApproved =
    block.status === BlockStatus.APPROVED &&
    requester?.role === HousekeepingRole.SUPERVISOR &&
    (!block.approvedById || block.approvedById === block.requestedById)

  const createdAgo = formatDistanceToNow(parseISO(block.createdAt), { addSuffix: true, locale: es })

  const extendMin = block.endDate
    ? format(new Date(parseISO(block.endDate).getTime() + 86_400_000), 'yyyy-MM-dd')
    : format(new Date(Date.now() + 86_400_000), 'yyyy-MM-dd')

  function openConfirm(op: ConfirmOp) {
    setOverflowOpen(false)
    setConfirmOp(op)
    setConfirmNote('')
    setExtendDate('')
  }

  function handleConfirm() {
    if (confirmOp === 'approve')  onApprove(block.id, confirmNote || undefined)
    if (confirmOp === 'reject')   { if (!confirmNote.trim()) return; onReject(block.id, confirmNote) }
    if (confirmOp === 'cancel')   { if (!confirmNote.trim()) return; onCancel(block.id, confirmNote) }
    if (confirmOp === 'release')  onRelease(block.id)
    if (confirmOp === 'extend')   { if (!extendDate) return; onExtend(block.id, extendDate) }
    setConfirmOp(null)
    setConfirmNote('')
    setExtendDate('')
  }

  const needsNote  = confirmOp === 'reject' || confirmOp === 'cancel'
  const canConfirm = confirmOp === 'extend' ? !!extendDate : needsNote ? !!confirmNote.trim() : true

  const cardBase = variant === 'inbox'
    ? 'bg-white border border-gray-200 shadow-sm'
    : 'bg-gray-50/60 border border-gray-100'
  const cardRing = isPending ? ' ring-1 ring-amber-300' : ''

  return (
    <div className={`rounded-lg ${cardBase}${cardRing}`}>
      <div className="flex">
        {/* Accent bar */}
        <div className={`w-1.5 shrink-0 rounded-l-lg ${sem.bar}`} />

        {/* Body */}
        <div className="flex-1 min-w-0 px-4 py-3.5 flex flex-col">

          {/* ── Main row: icon + content + actions ── */}
          <div className="flex items-start gap-3">

            {/* Reason icon with semantic background */}
            <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ${sem.iconBg}`}>
              {REASON_ICONS[block.reason]}
            </div>

            {/* Text content */}
            <div className="flex-1 min-w-0">
              {/* Row 1: location + badges */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-sm text-gray-900">{blockLocation(block)}</span>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${sem.badge} ${sem.badgeText}`}>
                  {SEMANTIC_LABELS[block.semantic]}
                </span>
                {block.status !== BlockStatus.ACTIVE && (
                  <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium ring-1 ${STATUS_COLORS[block.status]}`}>
                    {block.status === BlockStatus.APPROVED && (
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    )}
                    {isAutoApproved && block.status === BlockStatus.APPROVED
                      ? 'Aprobación no requerida'
                      : STATUS_LABELS[block.status]}
                  </span>
                )}
                {isPending && isSupervisor && (
                  <span className="text-[11px] font-semibold text-amber-600 animate-pulse">
                    · Requiere acción
                  </span>
                )}
              </div>

              {/* Row 2: reason · dates · nights */}
              <div className="mt-0.5 flex items-center gap-1.5 text-xs flex-wrap">
                <span className="text-gray-500">{REASON_LABELS[block.reason]}</span>
                <span className="text-gray-300">·</span>
                <span className="font-mono font-semibold text-gray-700">{blockDateRange(block)}</span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-400 font-medium">{blockNightsShort(block)}</span>
              </div>

              {/* Row 3: requester */}
              {requester && (
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-200 text-[9px] font-bold text-gray-600 shrink-0">
                    {initials(requester.name)}
                  </span>
                  <span className="text-[11px] text-gray-600">
                    {requester.name}
                    <span className="text-gray-400"> · {ROLE_LABELS[requester.role] ?? requester.role} · {createdAgo}</span>
                  </span>
                </div>
              )}
            </div>

            {/* ── Right-side actions ── */}
            {!confirmOp && canAct && isSupervisor && (
              <div className="shrink-0 flex items-center gap-2 ml-2 mt-0.5">
                {isPending && (
                  <>
                    <button
                      disabled={working}
                      onClick={() => openConfirm('approve')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-md text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      <Check className="h-3 w-3" strokeWidth={3} /> Aprobar
                    </button>
                    <button
                      disabled={working}
                      onClick={() => openConfirm('reject')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 border border-red-300 text-red-600 rounded-md text-xs font-semibold hover:bg-red-50 disabled:opacity-50 transition-colors bg-white"
                    >
                      <X className="h-3 w-3" strokeWidth={3} /> Rechazar
                    </button>
                  </>
                )}
                {isActive && (
                  <>
                    <button
                      disabled={working}
                      onClick={() => openConfirm('release')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white rounded-md text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                    >
                      <Unlock className="h-3 w-3" /> Liberar
                    </button>
                    <button
                      disabled={working}
                      onClick={() => openConfirm('extend')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-md text-xs font-semibold hover:bg-gray-50 disabled:opacity-50 transition-colors bg-white"
                    >
                      <CalendarPlus className="h-3 w-3" /> Extender
                    </button>
                  </>
                )}
                {/* Overflow menu for Cancel */}
                <div className="relative">
                  <button
                    onClick={() => setOverflowOpen((p) => !p)}
                    className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {overflowOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setOverflowOpen(false)}
                      />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white shadow-lg rounded-lg border border-gray-200 py-1 min-w-[160px]">
                        <button
                          onClick={() => openConfirm('cancel')}
                          className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
                        >
                          Cancelar bloqueo
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          {block.notes && (
            <p className="mt-2 ml-11 text-xs text-gray-600 bg-gray-50 rounded px-2 py-1.5 italic border border-gray-100">
              "{block.notes}"
            </p>
          )}

          {/* Log toggle */}
          {logs.length > 0 && (
            <button
              onClick={() => setShowLogs((p) => !p)}
              className="mt-1.5 ml-11 text-[11px] text-gray-400 hover:text-gray-600 transition-colors self-start"
            >
              {showLogs ? '▾ Ocultar actividad' : `▸ Ver actividad (${logs.length} eventos)`}
            </button>
          )}

          {/* ── Inline confirm panel ── */}
          {confirmOp && (
            <div className="mt-3 ml-11 border-t border-gray-100 pt-3 space-y-2">
              <p className="text-xs font-medium text-gray-700">
                {confirmOp === 'approve'  ? 'Confirmar aprobación' :
                 confirmOp === 'reject'   ? 'Motivo de rechazo *' :
                 confirmOp === 'cancel'   ? 'Motivo de cancelación *' :
                 confirmOp === 'release'  ? 'Liberar habitación' :
                                            'Extender hasta'}
              </p>

              {(confirmOp === 'approve' || confirmOp === 'reject' || confirmOp === 'cancel') && (
                <textarea
                  autoFocus
                  rows={2}
                  value={confirmNote}
                  onChange={(e) => setConfirmNote(e.target.value)}
                  placeholder={
                    confirmOp === 'approve' ? 'Nota de aprobación (opcional)…' :
                    confirmOp === 'reject'  ? 'Explica el motivo del rechazo…' :
                                              'Explica el motivo de cancelación…'
                  }
                  className="w-full text-xs border border-gray-200 rounded px-2.5 py-1.5 resize-none text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              )}
              {confirmOp === 'release' && (
                <p className="text-xs text-gray-500">La habitación volverá a estar disponible inmediatamente.</p>
              )}
              {confirmOp === 'extend' && (
                <input
                  autoFocus
                  type="date"
                  min={extendMin}
                  value={extendDate}
                  onChange={(e) => setExtendDate(e.target.value)}
                  className="text-xs border border-gray-200 rounded px-2.5 py-1.5 text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
              )}

              <div className="flex items-center gap-2">
                <button
                  disabled={working || !canConfirm}
                  onClick={handleConfirm}
                  className={[
                    'px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40',
                    confirmOp === 'reject' ? 'bg-red-600 text-white hover:bg-red-700' :
                    confirmOp === 'cancel' ? 'bg-gray-700 text-white hover:bg-gray-800' :
                    'bg-emerald-600 text-white hover:bg-emerald-700',
                  ].join(' ')}
                >
                  {confirmOp === 'approve'  ? 'Confirmar aprobación' :
                   confirmOp === 'reject'   ? 'Confirmar rechazo' :
                   confirmOp === 'cancel'   ? 'Confirmar cancelación' :
                   confirmOp === 'release'  ? 'Confirmar liberación' :
                                              'Confirmar extensión'}
                </button>
                <button
                  onClick={() => { setConfirmOp(null); setConfirmNote(''); setExtendDate('') }}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Log list */}
          {showLogs && (
            <div className="mt-2 ml-11 border-t border-gray-100 pt-2">
              {(() => {
                let lastDay = ''
                return logs.map((log: any) => {
                  const logDate = parseISO(log.createdAt)
                  const logDay  = format(logDate, 'yyyy-MM-dd')
                  const showSep = logDay !== lastDay
                  lastDay = logDay
                  return (
                    <Fragment key={log.id}>
                      {showSep && (
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mt-2 mb-1 first:mt-0">
                          {dayLabel(logDate)}
                        </p>
                      )}
                      <div className="text-[11px] text-gray-500 flex gap-2 py-0.5">
                        <span className="text-gray-300 whitespace-nowrap font-mono shrink-0">
                          {format(logDate, 'HH:mm')}
                        </span>
                        <span className="font-medium text-gray-600">
                          {LOG_EVENT_LABELS[log.event] ?? log.event}
                        </span>
                        {log.staff && <span className="text-gray-400">por {log.staff.name}</span>}
                        {log.note && (
                          <span className="italic text-gray-400">— {translateNote(log.note)}</span>
                        )}
                      </div>
                    </Fragment>
                  )
                })
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── BlocksPage ───────────────────────────────────────────────────────────────

type PageMode = 'inbox' | 'history'
type DateFilter = 'all' | '7d' | '30d'

export function BlocksPage() {
  const user = useAuthStore((s) => s.user)
  const qc   = useQueryClient()
  const isSupervisor = user?.role === HousekeepingRole.SUPERVISOR

  const [mode, setMode]                     = useState<PageMode>(isSupervisor ? 'inbox' : 'history')
  const [historyFilter, setHistoryFilter]   = useState<BlockStatus | 'all'>('all')
  const [semanticFilter, setSemanticFilter] = useState<BlockSemantic | 'all'>('all')
  const [searchQuery, setSearchQuery]       = useState('')
  const [dateFilter, setDateFilter]         = useState<DateFilter>('all')
  const [isModalOpen, setIsModalOpen]       = useState(false)

  const { data: blocks = [], isLoading, isError, refetch } = useQuery<RoomBlockDto[]>({
    queryKey: ['blocks', 'all'],
    queryFn:  () => api.get<RoomBlockDto[]>('/blocks'),
    staleTime: 30_000,
  })

  useSSE((event) => {
    if (event.type.startsWith('block:')) qc.invalidateQueries({ queryKey: ['blocks'] })
  })

  // ── Mutations ────────────────────────────────────────────────────────────────

  const approveMut = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      api.post(`/blocks/${id}/approve`, { approvalNotes: note }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Bloqueo aprobado') },
    onError: (e: any) => toast.error(e?.message ?? 'Error al aprobar'),
  })
  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/blocks/${id}/reject`, { approvalNotes: reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Bloqueo rechazado') },
    onError: (e: any) => toast.error(e?.message ?? 'Error al rechazar'),
  })
  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/blocks/${id}/cancel`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Bloqueo cancelado') },
    onError: (e: any) => toast.error(e?.message ?? 'Error al cancelar'),
  })
  const releaseMut = useMutation({
    mutationFn: (id: string) => api.post(`/blocks/${id}/release`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Habitación liberada') },
    onError: (e: any) => toast.error(e?.message ?? 'Error al liberar'),
  })
  const extendMut = useMutation({
    mutationFn: ({ id, endDate }: { id: string; endDate: string }) =>
      api.post(`/blocks/${id}/extend`, { endDate }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Bloqueo extendido') },
    onError: (e: any) => toast.error(e?.message ?? 'Error al extender'),
  })
  const createMut = useMutation({
    mutationFn: (dto: CreateBlockDto) => api.post('/blocks', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Bloqueo creado') },
    onError: (e: any) => toast.error(e?.message ?? 'Error al crear bloqueo'),
  })

  const working = approveMut.isPending || rejectMut.isPending || cancelMut.isPending ||
                  releaseMut.isPending || extendMut.isPending

  const handleApprove = (id: string, note?: string) => approveMut.mutate({ id, note })
  const handleReject  = (id: string, reason: string) => rejectMut.mutate({ id, reason })
  const handleCancel  = (id: string, reason: string) => cancelMut.mutate({ id, reason })
  const handleRelease = (id: string) => releaseMut.mutate(id)
  const handleExtend  = (id: string, endDate: string) => extendMut.mutate({ id, endDate })

  // ── Derived data ──────────────────────────────────────────────────────────────

  const counts = useMemo(() => {
    const c: Partial<Record<BlockStatus | 'inbox', number>> = { inbox: 0 }
    for (const b of blocks) {
      c[b.status] = (c[b.status] ?? 0) + 1
      if (INBOX_STATUSES.has(b.status)) c.inbox = (c.inbox ?? 0) + 1
    }
    return c
  }, [blocks])

  const inboxBlocks = useMemo(() =>
    blocks
      .filter((b) => INBOX_STATUSES.has(b.status))
      .filter((b) => semanticFilter === 'all' || b.semantic === semanticFilter)
      .filter((b) => matchesSearch(b, searchQuery))
      .sort(
        (a, b) =>
          STATUS_SORT[a.status] - STATUS_SORT[b.status] ||
          parseISO(b.startDate).getTime() - parseISO(a.startDate).getTime(),
      ),
  [blocks, semanticFilter, searchQuery])

  const historyBlocks = useMemo(() => {
    let result = blocks
    if (historyFilter !== 'all') result = result.filter((b) => b.status === historyFilter)
    if (semanticFilter !== 'all') result = result.filter((b) => b.semantic === semanticFilter)
    if (searchQuery) result = result.filter((b) => matchesSearch(b, searchQuery))
    if (dateFilter === '7d')  result = result.filter((b) => parseISO(b.createdAt) >= subDays(new Date(), 7))
    if (dateFilter === '30d') result = result.filter((b) => parseISO(b.createdAt) >= subDays(new Date(), 30))
    return [...result].sort(
      (a, b) => parseISO(b.createdAt).getTime() - parseISO(a.createdAt).getTime(),
    )
  }, [blocks, historyFilter, semanticFilter, searchQuery, dateFilter])

  const historyWithDays = useMemo(() => {
    type Item =
      | { kind: 'header'; date: Date; key: string }
      | { kind: 'card';   block: RoomBlockDto }
    const result: Item[] = []
    let lastDay = ''
    for (const b of historyBlocks) {
      const date = parseISO(b.createdAt)
      const day  = format(date, 'yyyy-MM-dd')
      if (day !== lastDay) {
        result.push({ kind: 'header', date, key: day })
        lastDay = day
      }
      result.push({ kind: 'card', block: b })
    }
    return result
  }, [historyBlocks])

  const pendingCount = counts[BlockStatus.PENDING_APPROVAL] ?? 0

  const cardProps = {
    isSupervisor,
    onApprove: handleApprove,
    onReject:  handleReject,
    onCancel:  handleCancel,
    onRelease: handleRelease,
    onExtend:  handleExtend,
    working,
  }

  // ─── Filter bar (shared between Inbox and Historial) ─────────────────────────

  const filterBar = (
    <div className="flex items-center gap-3 flex-wrap py-2.5 border-b border-gray-100">
      {/* Room search */}
      <div className="relative shrink-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar habitación…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg w-40 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        />
      </div>

      <div className="h-4 border-l border-gray-200 shrink-0" />

      {/* Semantic type chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(['all', ...Object.values(BlockSemantic)] as const).map((sem) => {
          const active = semanticFilter === sem
          return (
            <button
              key={sem}
              onClick={() => setSemanticFilter(sem)}
              className={[
                'text-xs font-medium transition-colors px-2.5 py-1 rounded-md',
                active
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100',
              ].join(' ')}
            >
              {sem === 'all' ? 'Todos los tipos' : SEMANTIC_LABELS[sem]}
            </button>
          )
        })}
      </div>
    </div>
  )

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[1020px] mx-auto space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <Lock className="h-5 w-5 text-violet-600" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Bloqueos</h1>
            <p className="text-xs text-gray-500 leading-tight">
              Gestión de habitaciones fuera de inventario
            </p>
          </div>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors shadow-sm"
        >
          + Nuevo bloqueo
        </button>
      </div>

      {/* ── KPI strip ── */}
      {!isLoading && !isError && <KpiStrip blocks={blocks} />}

      {/* ── Mode tabs ── */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: 'inbox'   as const, label: 'Inbox',     count: counts.inbox },
          { key: 'history' as const, label: 'Historial', count: blocks.length },
        ]).map(({ key, label, count }) => {
          const isActive     = mode === key
          const isPendingTab = key === 'inbox' && pendingCount > 0
          return (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={[
                'px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'text-blue-700 border-b-2 border-blue-600 -mb-px'
                  : 'text-gray-500 hover:text-gray-700',
              ].join(' ')}
            >
              {label}
              {count !== undefined && count > 0 && (
                <span className={[
                  'ml-2 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold',
                  isPendingTab
                    ? 'bg-amber-500 text-white'
                    : isActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600',
                ].join(' ')}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Loading skeletons ── */}
      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </div>
      )}

      {/* ── Error state ── */}
      {isError && (
        <div className="text-center py-16">
          <AlertCircle className="mx-auto h-10 w-10 text-red-400 mb-3" />
          <p className="text-sm font-medium text-gray-700">No se pudieron cargar los bloqueos</p>
          <button
            onClick={() => refetch()}
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            <RefreshCw className="h-4 w-4" /> Reintentar
          </button>
        </div>
      )}

      {/* ── INBOX ── */}
      {!isLoading && !isError && mode === 'inbox' && (
        <>
          {filterBar}

          {inboxBlocks.length === 0 ? (
            <div className="text-center py-16">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400 mb-3" />
              <p className="font-semibold text-gray-700">Todo al día</p>
              <p className="text-sm text-gray-400 mt-1">
                {searchQuery || semanticFilter !== 'all'
                  ? 'Sin resultados para este filtro'
                  : 'No hay bloqueos que requieran atención'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {inboxBlocks.map((b) => (
                <BlockCard key={b.id} block={b} {...cardProps} variant="inbox" />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── HISTORIAL ── */}
      {!isLoading && !isError && mode === 'history' && (
        <>
          {filterBar}

          {/* Status + Date filter row */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Status chips */}
            <div className="flex gap-2 flex-wrap items-center">
              {([
                { value: 'all'                        as const, label: 'Todos' },
                { value: BlockStatus.PENDING_APPROVAL as const, label: 'Pendiente' },
                { value: BlockStatus.ACTIVE           as const, label: 'Activo' },
                { value: BlockStatus.APPROVED         as const, label: 'Aprobado' },
                { value: BlockStatus.EXPIRED          as const, label: 'Expirado' },
                { value: BlockStatus.CANCELLED        as const, label: 'Cancelado' },
                { value: BlockStatus.REJECTED         as const, label: 'Rechazado' },
              ]).map(({ value, label }) => {
                const cnt    = value === 'all' ? blocks.length : (counts[value as BlockStatus] ?? 0)
                const active = historyFilter === value
                return (
                  <button
                    key={value}
                    onClick={() => setHistoryFilter(value)}
                    className={[
                      'text-xs font-medium transition-colors px-2.5 py-1 rounded-md',
                      active
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-500 hover:text-gray-800',
                    ].join(' ')}
                  >
                    {label}
                    {cnt > 0 && (
                      <span className={`ml-1 ${active ? 'text-blue-500' : 'text-gray-400'}`}>
                        {cnt}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Date range chips */}
            <div className="flex items-center gap-1.5 shrink-0">
              {([
                { value: 'all'  as const, label: 'Todo' },
                { value: '30d'  as const, label: 'Últimos 30 días' },
                { value: '7d'   as const, label: 'Esta semana' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setDateFilter(value)}
                  className={[
                    'text-xs font-medium transition-colors px-2.5 py-1 rounded-md',
                    dateFilter === value
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-500 hover:text-gray-800',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {historyWithDays.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-sm">Sin registros para este filtro</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {historyWithDays.map((item) =>
                item.kind === 'header' ? (
                  <p
                    key={item.key}
                    className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide pt-3 pb-0.5 first:pt-0"
                  >
                    {dayLabel(item.date)}
                  </p>
                ) : (
                  <BlockCard
                    key={item.block.id}
                    block={item.block}
                    {...cardProps}
                    variant="history"
                  />
                )
              )}
            </div>
          )}
        </>
      )}

      {/* ── Modal creación ── */}
      <BlockModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async (dto) => {
          await createMut.mutateAsync(dto)
          setIsModalOpen(false)
        }}
      />
    </div>
  )
}
