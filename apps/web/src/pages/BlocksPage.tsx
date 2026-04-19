/**
 * BlocksPage — Gestión centralizada de bloqueos de camas/habitaciones.
 *
 * Decisiones de UX:
 * - Lista en dos secciones: PENDIENTES (requieren acción) arriba, el resto abajo.
 * - Color-coding semántico: OOS=amber, OOO=red, OOI=blue, HOUSE_USE=purple.
 * - Filas expandibles: click para ver logs + acciones inline.
 * - SSE: block:* events invalidan la query automáticamente.
 * - Botón "+ Nuevo bloqueo" siempre visible → abre BlockModal.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  BlockSemantic,
  BlockStatus,
  BlockReason,
  type RoomBlockDto,
  type CreateBlockDto,
  HousekeepingRole,
} from '@zenix/shared'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useSSE } from '../hooks/useSSE'
import { BlockModal } from '../components/blocks/BlockModal'

// ─── Labels de display ────────────────────────────────────────────────────────

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
  [BlockReason.PHOTOGRAPHY]:   'Fotografía/Marketing',
  [BlockReason.VIP_SETUP]:     'Preparación VIP',
  [BlockReason.PEST_CONTROL]:  'Control de plagas',
  [BlockReason.WATER_DAMAGE]:  'Daño por agua',
  [BlockReason.ELECTRICAL]:    'Problema eléctrico',
  [BlockReason.PLUMBING]:      'Plomería',
  [BlockReason.STRUCTURAL]:    'Daño estructural',
  [BlockReason.RENOVATION]:    'Remodelación',
  [BlockReason.OWNER_STAY]:    'Estancia del propietario',
  [BlockReason.STAFF_USE]:     'Uso de personal',
  [BlockReason.OTHER]:         'Otro',
}

const STATUS_LABELS: Record<BlockStatus, string> = {
  [BlockStatus.PENDING_APPROVAL]: 'Pendiente aprobación',
  [BlockStatus.APPROVED]:         'Aprobado',
  [BlockStatus.ACTIVE]:           'Activo',
  [BlockStatus.EXPIRED]:          'Expirado',
  [BlockStatus.CANCELLED]:        'Cancelado',
  [BlockStatus.REJECTED]:         'Rechazado',
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function semanticBorder(s: BlockSemantic) {
  return {
    [BlockSemantic.OUT_OF_SERVICE]:   'border-l-amber-400',
    [BlockSemantic.OUT_OF_ORDER]:     'border-l-red-500',
    [BlockSemantic.OUT_OF_INVENTORY]: 'border-l-blue-500',
    [BlockSemantic.HOUSE_USE]:        'border-l-purple-400',
  }[s]
}

function semanticBadge(s: BlockSemantic) {
  return {
    [BlockSemantic.OUT_OF_SERVICE]:   'bg-amber-100 text-amber-800',
    [BlockSemantic.OUT_OF_ORDER]:     'bg-red-100 text-red-800',
    [BlockSemantic.OUT_OF_INVENTORY]: 'bg-blue-100 text-blue-800',
    [BlockSemantic.HOUSE_USE]:        'bg-purple-100 text-purple-800',
  }[s]
}

function statusBadge(st: BlockStatus) {
  return {
    [BlockStatus.PENDING_APPROVAL]: 'bg-yellow-100 text-yellow-800',
    [BlockStatus.APPROVED]:         'bg-green-100 text-green-700',
    [BlockStatus.ACTIVE]:           'bg-emerald-100 text-emerald-800',
    [BlockStatus.EXPIRED]:          'bg-gray-100 text-gray-600',
    [BlockStatus.CANCELLED]:        'bg-gray-100 text-gray-500',
    [BlockStatus.REJECTED]:         'bg-red-100 text-red-700',
  }[st]
}

// ─── BlockRow ─────────────────────────────────────────────────────────────────

function BlockRow({
  block,
  isSupervisor,
  onApprove,
  onReject,
  onCancel,
  onRelease,
}: {
  block: RoomBlockDto
  isSupervisor: boolean
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onCancel: (id: string) => void
  onRelease: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const location = block.bedId
    ? `Cama ${(block as any).bed?.label ?? block.bedId.slice(0, 6)}`
    : `Hab. ${(block as any).room?.number ?? block.roomId?.slice(0, 6)}`

  return (
    <div
      className={`border-l-4 ${semanticBorder(block.semantic)} bg-white rounded-r-lg shadow-sm overflow-hidden`}
    >
      {/* Header — siempre visible */}
      <button
        className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((p) => !p)}
      >
        <span className="text-base">{expanded ? '▾' : '▸'}</span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900">{location}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${semanticBadge(block.semantic)}`}>
              {SEMANTIC_LABELS[block.semantic]}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusBadge(block.status)}`}>
              {STATUS_LABELS[block.status]}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {REASON_LABELS[block.reason]}
            {' · '}
            Solicitado por {(block as any).requestedBy?.name ?? '—'}
            {block.endDate && ` · Expira ${new Date(block.endDate).toLocaleDateString('es-MX')}`}
          </div>
        </div>

        {/* Indicador de urgencia para OOO pendiente */}
        {block.semantic === BlockSemantic.OUT_OF_ORDER &&
          block.status === BlockStatus.PENDING_APPROVAL && (
            <span className="text-red-500 text-xs font-bold animate-pulse">⚠ Requiere aprobación</span>
          )}
      </button>

      {/* Detalle expandible */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 space-y-3 pt-3">
          {/* Fechas */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 text-xs uppercase tracking-wide">Inicio</span>
              <p className="text-gray-900">{new Date(block.startDate).toLocaleDateString('es-MX')}</p>
            </div>
            <div>
              <span className="text-gray-500 text-xs uppercase tracking-wide">Fin</span>
              <p className="text-gray-900">{block.endDate ? new Date(block.endDate).toLocaleDateString('es-MX') : 'Indefinido'}</p>
            </div>
          </div>

          {/* Notas */}
          {block.notes && (
            <div>
              <span className="text-gray-500 text-xs uppercase tracking-wide">Notas para housekeeping</span>
              <p className="text-gray-800 text-sm mt-0.5">{block.notes}</p>
            </div>
          )}
          {isSupervisor && block.internalNotes && (
            <div>
              <span className="text-gray-500 text-xs uppercase tracking-wide">Notas internas (supervisor)</span>
              <p className="text-gray-800 text-sm mt-0.5 italic">{block.internalNotes}</p>
            </div>
          )}

          {/* Tarea de mantenimiento vinculada */}
          {block.cleaningTaskId && (
            <div className="bg-blue-50 rounded p-2 text-xs text-blue-700">
              🔧 Tarea de mantenimiento creada · Estado: {(block as any).cleaningTask?.status ?? '—'}
            </div>
          )}

          {/* Historial */}
          {(block as any).logs?.length > 0 && (
            <div>
              <span className="text-gray-500 text-xs uppercase tracking-wide">Historial</span>
              <ul className="mt-1 space-y-1">
                {(block as any).logs.map((log: any) => (
                  <li key={log.id} className="text-xs text-gray-600 flex gap-2">
                    <span className="text-gray-400 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                    <span className="font-medium">{log.event}</span>
                    {log.staff && <span className="text-gray-500">por {log.staff.name}</span>}
                    {log.note && <span className="text-gray-500">— {log.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Acciones — solo supervisores */}
          {isSupervisor && (
            <div className="flex gap-2 flex-wrap pt-1">
              {block.status === BlockStatus.PENDING_APPROVAL && (
                <>
                  <button
                    onClick={() => onApprove(block.id)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-700 transition-colors"
                  >
                    ✓ Aprobar
                  </button>
                  <button
                    onClick={() => onReject(block.id)}
                    className="px-3 py-1.5 bg-white border border-red-300 text-red-600 rounded text-sm font-medium hover:bg-red-50 transition-colors"
                  >
                    ✗ Rechazar
                  </button>
                </>
              )}
              {block.status === BlockStatus.ACTIVE && (
                <button
                  onClick={() => onRelease(block.id)}
                  className="px-3 py-1.5 bg-white border border-amber-400 text-amber-700 rounded text-sm font-medium hover:bg-amber-50 transition-colors"
                >
                  🔓 Liberar anticipado
                </button>
              )}
              {[BlockStatus.PENDING_APPROVAL, BlockStatus.APPROVED, BlockStatus.ACTIVE].includes(block.status) && (
                <button
                  onClick={() => onCancel(block.id)}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-600 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── BlocksPage ───────────────────────────────────────────────────────────────

export function BlocksPage() {
  const user = useAuthStore((s) => s.user)
  const qc = useQueryClient()
  const isSupervisor = user?.role === HousekeepingRole.SUPERVISOR
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<BlockStatus | ''>('')

  const { data: blocks = [], isLoading } = useQuery<RoomBlockDto[]>({
    queryKey: ['blocks', statusFilter],
    queryFn: () =>
      api.get<RoomBlockDto[]>(`/blocks${statusFilter ? `?status=${statusFilter}` : ''}`),
    staleTime: 30_000,
  })

  // SSE: invalidar cuando llega cualquier evento de bloqueo
  useSSE((event) => {
    if (event.type.startsWith('block:')) {
      qc.invalidateQueries({ queryKey: ['blocks'] })
    }
  })

  const createMutation = useMutation({
    mutationFn: (dto: CreateBlockDto) => api.post('/blocks', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blocks'] })
      toast.success('Solicitud de bloqueo creada')
    },
    onError: (e: any) => toast.error(e?.message ?? 'Error al crear bloqueo'),
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/blocks/${id}/approve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Bloqueo aprobado') },
    onError: (e: any) => toast.error(e?.message ?? 'Error'),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/blocks/${id}/reject`, { approvalNotes: reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Bloqueo rechazado') },
    onError: (e: any) => toast.error(e?.message ?? 'Error'),
  })

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/blocks/${id}/cancel`, { reason }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Bloqueo cancelado') },
    onError: (e: any) => toast.error(e?.message ?? 'Error'),
  })

  const releaseMutation = useMutation({
    mutationFn: (id: string) => api.post(`/blocks/${id}/release`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['blocks'] }); toast.success('Cama liberada') },
    onError: (e: any) => toast.error(e?.message ?? 'Error'),
  })

  const handleApprove = (id: string) => {
    if (!confirm('¿Aprobar este bloqueo? Se creará una tarea de mantenimiento automáticamente.')) return
    approveMutation.mutate(id)
  }

  const handleReject = (id: string) => {
    const reason = prompt('Motivo de rechazo (obligatorio):')
    if (!reason?.trim()) return
    rejectMutation.mutate({ id, reason })
  }

  const handleCancel = (id: string) => {
    const reason = prompt('Motivo de cancelación:')
    if (!reason?.trim()) return
    cancelMutation.mutate({ id, reason })
  }

  const handleRelease = (id: string) => {
    if (!confirm('¿Liberar anticipadamente? La cama volverá a estar disponible.')) return
    releaseMutation.mutate(id)
  }

  // Separar pendientes del resto
  const pending = blocks.filter((b) => b.status === BlockStatus.PENDING_APPROVAL)
  const rest = blocks.filter((b) => b.status !== BlockStatus.PENDING_APPROVAL)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">🔒 Bloqueos</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Gestión de camas y habitaciones bloqueadas
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
        >
          + Nuevo bloqueo
        </button>
      </div>

      {/* Filtro de estado */}
      <div className="flex gap-2 flex-wrap">
        {(['', ...Object.values(BlockStatus)] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s as BlockStatus | '')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              statusFilter === s
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
            }`}
          >
            {s === '' ? 'Todos' : STATUS_LABELS[s as BlockStatus]}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="text-center text-gray-400 py-12">Cargando bloqueos…</div>
      )}

      {/* Pendientes de aprobación — destacados */}
      {!isLoading && pending.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-yellow-700 uppercase tracking-wide mb-3 flex items-center gap-2">
            <span className="animate-pulse">⚠</span>
            Pendientes de aprobación ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                isSupervisor={isSupervisor}
                onApprove={handleApprove}
                onReject={handleReject}
                onCancel={handleCancel}
                onRelease={handleRelease}
              />
            ))}
          </div>
        </section>
      )}

      {/* Resto de bloqueos */}
      {!isLoading && rest.length > 0 && (
        <section>
          {pending.length > 0 && (
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Otros bloqueos
            </h2>
          )}
          <div className="space-y-2">
            {rest.map((b) => (
              <BlockRow
                key={b.id}
                block={b}
                isSupervisor={isSupervisor}
                onApprove={handleApprove}
                onReject={handleReject}
                onCancel={handleCancel}
                onRelease={handleRelease}
              />
            ))}
          </div>
        </section>
      )}

      {!isLoading && blocks.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <div className="text-4xl mb-3">🔓</div>
          <p className="font-medium text-gray-500">Sin bloqueos activos</p>
          <p className="text-sm">Todas las camas están disponibles</p>
        </div>
      )}

      {/* Modal de creación */}
      <BlockModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={async (dto) => {
          await createMutation.mutateAsync(dto)
          setIsModalOpen(false)
        }}
      />
    </div>
  )
}
