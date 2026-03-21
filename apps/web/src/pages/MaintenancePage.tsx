import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { api } from '../api/client'
import type { MaintenanceIssueDto } from '@housekeeping/shared'
import { MaintenanceCategory } from '@housekeeping/shared'

const CATEGORY_LABEL: Record<MaintenanceCategory, string> = {
  [MaintenanceCategory.PLUMBING]: 'Plomería',
  [MaintenanceCategory.ELECTRICAL]: 'Eléctrico',
  [MaintenanceCategory.FURNITURE]: 'Mobiliario',
  [MaintenanceCategory.PEST]: 'Plagas',
  [MaintenanceCategory.OTHER]: 'Otro',
}

const CATEGORY_STYLE: Record<MaintenanceCategory, string> = {
  [MaintenanceCategory.PLUMBING]: 'bg-blue-50 text-blue-700',
  [MaintenanceCategory.ELECTRICAL]: 'bg-yellow-50 text-yellow-700',
  [MaintenanceCategory.FURNITURE]: 'bg-orange-50 text-orange-700',
  [MaintenanceCategory.PEST]: 'bg-red-50 text-red-700',
  [MaintenanceCategory.OTHER]: 'bg-gray-100 text-gray-600',
}

interface IssueWithContext extends MaintenanceIssueDto {
  roomNumber?: string
  bedLabel?: string
  reporterName?: string
}

export function MaintenancePage() {
  const qc = useQueryClient()
  const [showResolved, setShowResolved] = useState(false)

  const { data: issues = [], isLoading } = useQuery<IssueWithContext[]>({
    queryKey: ['maintenance-issues', showResolved],
    queryFn: () =>
      api.get(showResolved ? '/maintenance' : '/maintenance?resolved=false'),
  })

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/maintenance/${id}/resolve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-issues'] })
      toast.success('Issue marcado como resuelto')
    },
    onError: () => toast.error('Error al resolver'),
  })

  if (isLoading) return <div className="text-sm text-gray-500 py-8 text-center">Cargando...</div>

  const open = issues.filter((i) => !i.resolved)
  const resolved = issues.filter((i) => i.resolved)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Mantenimiento</h1>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded"
          />
          Ver resueltos
        </label>
      </div>

      {open.length === 0 && !showResolved && (
        <div className="text-center py-12 text-gray-400 text-sm">
          No hay incidencias abiertas
        </div>
      )}

      {open.length > 0 && (
        <IssueList title="Abiertas" issues={open} onResolve={(id) => resolveMutation.mutate(id)} />
      )}

      {showResolved && resolved.length > 0 && (
        <IssueList title="Resueltas" issues={resolved} />
      )}
    </div>
  )
}

function IssueList({
  title,
  issues,
  onResolve,
}: {
  title: string
  issues: IssueWithContext[]
  onResolve?: (id: string) => void
}) {
  return (
    <section>
      <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">{title}</h2>
      <div className="space-y-3">
        {issues.map((issue) => (
          <div key={issue.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${CATEGORY_STYLE[issue.category as MaintenanceCategory]}`}>
                    {CATEGORY_LABEL[issue.category as MaintenanceCategory]}
                  </span>
                  {issue.roomNumber && (
                    <span className="text-xs text-gray-500">Room {issue.roomNumber}</span>
                  )}
                  {issue.bedLabel && (
                    <span className="text-xs text-gray-400">· {issue.bedLabel}</span>
                  )}
                  <span className="text-xs text-gray-400 ml-auto">
                    {format(new Date(issue.createdAt), 'dd/MM HH:mm')}
                  </span>
                </div>
                <p className="text-sm text-gray-800">{issue.description}</p>
                {issue.reporterName && (
                  <p className="text-xs text-gray-400">Reportado por {issue.reporterName}</p>
                )}
                {issue.photoUrl && (
                  <a href={issue.photoUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:underline">
                    Ver foto
                  </a>
                )}
              </div>
              {onResolve && !issue.resolved && (
                <button
                  onClick={() => onResolve(issue.id)}
                  className="text-xs bg-green-50 text-green-700 rounded-lg px-3 py-1.5 hover:bg-green-100 font-medium whitespace-nowrap"
                >
                  Marcar resuelto
                </button>
              )}
              {issue.resolved && (
                <span className="text-xs text-green-600 font-medium whitespace-nowrap">Resuelto</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

