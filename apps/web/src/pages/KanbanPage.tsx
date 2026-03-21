import { useCallback } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import { useSSE } from '../hooks/useSSE'
import type { CleaningTaskDto, SseEvent } from '@housekeeping/shared'
import { CleaningStatus, Priority } from '@housekeeping/shared'

const COLUMNS: { status: CleaningStatus; label: string; cls: string }[] = [
  { status: CleaningStatus.READY, label: 'Lista para limpiar', cls: 'border-amber-300' },
  { status: CleaningStatus.UNASSIGNED, label: 'Sin asignar', cls: 'border-red-300' },
  { status: CleaningStatus.IN_PROGRESS, label: 'En progreso', cls: 'border-blue-300' },
  { status: CleaningStatus.DONE, label: 'Hecha', cls: 'border-green-300' },
  { status: CleaningStatus.VERIFIED, label: 'Verificada', cls: 'border-indigo-300' },
]

const PRIORITY_BADGE: Record<Priority, string> = {
  [Priority.LOW]: 'bg-gray-100 text-gray-500',
  [Priority.MEDIUM]: 'bg-blue-50 text-blue-600',
  [Priority.HIGH]: 'bg-orange-50 text-orange-600',
  [Priority.URGENT]: 'bg-red-100 text-red-700 font-semibold',
}

export function KanbanPage() {
  const qc = useQueryClient()

  const { data: tasks = [], isLoading } = useQuery<CleaningTaskDto[]>({
    queryKey: ['kanban-tasks'],
    queryFn: () =>
      api.get('/tasks?status=READY,UNASSIGNED,IN_PROGRESS,DONE,VERIFIED'),
  })

  const verifyMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/tasks/${id}/verify`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kanban-tasks'] })
      toast.success('Tarea verificada')
    },
    onError: () => toast.error('Error al verificar'),
  })

  const handleSSE = useCallback(
    (event: SseEvent) => {
      if (event.type.startsWith('task:')) {
        qc.invalidateQueries({ queryKey: ['kanban-tasks'] })
      }
    },
    [qc],
  )
  useSSE(handleSSE)

  const byStatus = (status: CleaningStatus) => tasks.filter((t) => t.status === status)

  if (isLoading) return <div className="text-sm text-gray-500 py-8 text-center">Cargando...</div>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-gray-900">Kanban de tareas</h1>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const colTasks = byStatus(col.status)
          return (
            <div key={col.status} className={`flex-shrink-0 w-60 border-t-2 ${col.cls} bg-gray-50 rounded-b-lg`}>
              <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{col.label}</span>
                <span className="text-xs text-gray-400 bg-white border rounded-full px-1.5">{colTasks.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[200px]">
                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onVerify={col.status === CleaningStatus.DONE ? () => verifyMutation.mutate(task.id) : undefined}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TaskCard({ task, onVerify }: { task: CleaningTaskDto; onVerify?: () => void }) {
  const room = task.bed?.room
  const timeSince = task.createdAt
    ? Math.round((Date.now() - new Date(task.createdAt).getTime()) / 60_000)
    : null

  return (
    <div className="bg-white rounded border border-gray-200 p-2.5 text-xs space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-900">
          {room?.number ?? '—'}
          {task.bed && <span className="text-gray-400 font-normal ml-1">· {task.bed.label}</span>}
        </span>
        {task.priority && (
          <span className={`px-1.5 py-0.5 rounded text-xs ${PRIORITY_BADGE[task.priority]}`}>
            {task.priority === Priority.URGENT ? '🔴 URGENTE' : task.priority}
          </span>
        )}
      </div>

      {task.assignedTo && (
        <p className="text-gray-500 truncate">{task.assignedTo.name}</p>
      )}

      {timeSince != null && (
        <p className="text-gray-400">Hace {timeSince} min</p>
      )}

      {onVerify && (
        <button
          onClick={onVerify}
          className="w-full text-center bg-indigo-50 text-indigo-700 rounded py-1 hover:bg-indigo-100 font-medium"
        >
          Verificar
        </button>
      )}
    </div>
  )
}
