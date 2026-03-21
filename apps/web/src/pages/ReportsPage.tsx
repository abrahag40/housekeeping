/**
 * ReportsPage — Análisis de rendimiento de housekeeping
 *
 * Permite seleccionar un rango de fechas y muestra:
 *  - KPI cards (checkouts, tareas completadas/verificadas, tiempo promedio, pendientes, sin asignar)
 *  - Gráfico de barras de actividad diaria (checkouts vs. completadas por día)
 *  - Leaderboard del personal ordenado por tareas completadas
 *  - Insight cards con recomendaciones operativas
 *
 * Todas las queries dependen del rango [from, to]. React Query las refetch
 * automáticamente cuando cambia el rango.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { api } from '../api/client'
import type { ReportOverviewDto, StaffPerformanceDto } from '@housekeeping/shared'

// Shape de un punto en el gráfico de tendencia diaria
type TrendDay = { date: string; completed: number; checkouts: number }

/** Formatea una fecha como string ISO (yyyy-MM-dd) para los inputs type=date y la API */
function toYMD(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

export function ReportsPage() {
  // Rango por defecto: últimos 7 días (hoy inclusive)
  const today = toYMD(new Date())
  const [from, setFrom] = useState(toYMD(subDays(new Date(), 6)))
  const [to, setTo] = useState(today)

  // Las tres queries son independientes — React Query las dispara en paralelo
  const { data: overview, isLoading: loadingOverview } = useQuery<ReportOverviewDto>({
    queryKey: ['reports-overview', from, to],
    queryFn: () => api.get(`/reports/overview?from=${from}&to=${to}`),
  })

  const { data: staff = [], isLoading: loadingStaff } = useQuery<StaffPerformanceDto[]>({
    queryKey: ['reports-staff', from, to],
    queryFn: () => api.get(`/reports/staff-performance?from=${from}&to=${to}`),
  })

  const { data: trend = [] } = useQuery<TrendDay[]>({
    queryKey: ['reports-trend', from, to],
    queryFn: () => api.get(`/reports/daily-trend?from=${from}&to=${to}`),
  })

  // Usar reduce en lugar de Math.max(...array) — el spread puede lanzar
  // RangeError si el array tiene más de ~100k elementos (límite del call stack).
  // El valor mínimo 1 evita divisiones por cero en los cálculos de altura.
  const maxTrend = trend.reduce((m, d) => Math.max(m, d.completed, d.checkouts), 1)

  // Tasa de completación = tareas completadas / total checkouts del período
  // Solo se calcula si hay checkouts (evitar división por cero)
  const completionRate =
    overview && overview.totalCheckouts > 0
      ? Math.round((overview.tasksCompleted / overview.totalCheckouts) * 100)
      : null

  // Pre-calcular fuera del JSX para evitar recalcular en cada render del template.
  // NOTA: No usar IIFE dentro de JSX — causa parse error en Babel/Vite.
  const sortedStaff = [...staff].sort((a, b) => b.tasksCompleted - a.tasksCompleted)
  // staffMax es el denominador para el ancho de la barra de progreso del leaderboard
  const staffMax = sortedStaff.reduce((m, x) => Math.max(m, x.tasksCompleted), 1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Reportes</h1>
          <p className="text-xs text-gray-400 mt-0.5">Análisis de rendimiento de housekeeping</p>
          {/* Title Case for headings is already correct here */}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-xs text-gray-500">Desde</label>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
          <label className="text-xs text-gray-500">Hasta</label>
          <input
            type="date"
            value={to}
            min={from}
            max={today}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-300"
          />
        </div>
      </div>

      {/* KPI cards */}
      {loadingOverview ? (
        <div className="text-sm text-gray-400">Cargando métricas...</div>
      ) : overview ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Checkouts"
            value={overview.totalCheckouts}
            sub="en el período"
            color="indigo"
          />
          <KpiCard
            label="Tareas completadas"
            value={overview.tasksCompleted}
            sub={completionRate != null ? `${completionRate}% de checkouts` : undefined}
            color="green"
          />
          <KpiCard
            label="Verificadas"
            value={overview.tasksVerified}
            sub="supervisadas"
            color="teal"
          />
          <KpiCard
            label="Tiempo promedio"
            value={overview.avgMinutesToComplete != null ? `${overview.avgMinutesToComplete} min` : '—'}
            sub="por tarea completada"
            color="amber"
          />
          {overview.tasksPending > 0 && (
            <KpiCard label="Pendientes" value={overview.tasksPending} sub="aún sin completar" color="orange" />
          )}
          {overview.tasksUnassigned > 0 && (
            <KpiCard label="Sin asignar" value={overview.tasksUnassigned} sub="requieren atención" color="red" />
          )}
          {/* Stat labels use sentence case per style guide */}
        </div>
      ) : null}

      {/* Daily trend chart */}
      {trend.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">Actividad Diaria</h2>
          <div className="flex items-end gap-1.5 h-32">
            {trend.map((day) => (
              <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                <div className="w-full flex items-end gap-0.5 h-24">
                  {/* Checkouts bar */}
                  <div
                    className="flex-1 bg-amber-200 rounded-t transition-all"
                    style={{ height: `${(day.checkouts / maxTrend) * 100}%`, minHeight: day.checkouts > 0 ? 4 : 0 }}
                    title={`${day.checkouts} checkouts`}
                  />
                  {/* Completed bar */}
                  <div
                    className="flex-1 bg-indigo-400 rounded-t transition-all"
                    style={{ height: `${(day.completed / maxTrend) * 100}%`, minHeight: day.completed > 0 ? 4 : 0 }}
                    title={`${day.completed} completadas`}
                  />
                </div>
                <span className="text-xs text-gray-400 truncate w-full text-center">
                  {format(new Date(day.date + 'T12:00:00'), 'dd/MM')}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-amber-200 rounded inline-block" /> Checkouts</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-indigo-400 rounded inline-block" /> Tareas completadas</span>
          </div>
        </div>
      )}

      {/* Staff leaderboard */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Rendimiento del Personal</h2>
          <p className="text-xs text-gray-400 mt-0.5">Solo housekeepers activos en el período</p>
        </div>
        {loadingStaff ? (
          <div className="text-sm text-gray-400 py-6 text-center">Cargando...</div>
        ) : staff.length === 0 ? (
          <div className="text-sm text-gray-400 py-8 text-center">Sin datos en el período seleccionado</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Housekeeper</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Completadas</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Verificadas</th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Tiempo prom.</th>
                <th className="px-5 py-3 w-48" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sortedStaff.map((s, i) => (
                <tr key={s.staffId} className="hover:bg-gray-50/50">
                  <td className="px-5 py-3 text-gray-400 text-xs font-medium">{i + 1}</td>
                  <td className="px-5 py-3 font-medium text-gray-900">{s.staffName}</td>
                  <td className="px-5 py-3 text-right text-gray-700">{s.tasksCompleted}</td>
                  <td className="px-5 py-3 text-right text-gray-500 text-xs">{s.tasksVerified}</td>
                  <td className="px-5 py-3 text-right text-gray-500 text-xs">
                    {s.avgMinutesToComplete != null ? `${s.avgMinutesToComplete} min` : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-400 rounded-full"
                        style={{ width: `${(s.tasksCompleted / staffMax) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Insight cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InsightCard
          icon="⚡"
          title="Tiempo de respuesta"
          body="El tiempo promedio entre checkout y tarea completada es tu métrica clave para early check-in. Meta recomendada: menos de 45 minutos."
        />
        <InsightCard
          icon="📉"
          title="Tareas sin asignar"
          body="Las tareas UNASSIGNED indican falta de cobertura. Considera pre-asignar housekeepers por dorm desde Planificación."
        />
        <InsightCard
          icon="✅"
          title="Tasa de verificación"
          body="Las tareas verificadas por supervisor aseguran calidad. Una tasa mayor al 80% es señal de buen proceso de supervisión."
        />
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/** Mapa de color → clases de Tailwind para las KPI cards */
const COLOR_MAP: Record<string, string> = {
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  green:  'bg-green-50 border-green-200 text-green-700',
  teal:   'bg-teal-50 border-teal-200 text-teal-700',
  amber:  'bg-amber-50 border-amber-200 text-amber-700',
  orange: 'bg-orange-50 border-orange-200 text-orange-700',
  red:    'bg-red-50 border-red-200 text-red-700',
}

function KpiCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div className={`border rounded-xl p-4 ${COLOR_MAP[color] ?? COLOR_MAP.indigo}`}>
      <p className="text-xs font-medium opacity-70 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  )
}

function InsightCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">{icon}</span>
        <p className="text-sm font-semibold text-gray-900">{title}</p>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
    </div>
  )
}
