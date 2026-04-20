/**
 * ReportsPage — Análisis de rendimiento de housekeeping + auditoría de no-shows.
 *
 * Tabs (via URL param ?tab=):
 *  - housekeeping (default): KPIs, gráfico diario, leaderboard del personal
 *  - noshow: lista auditada de no-shows, KPIs de ingresos, distribución por canal
 *
 * Decisión de diseño — tabs en URL (no useState):
 *  Misma razón que DailyPlanningPage: persiste entre navegaciones y permite
 *  compartir el link directo al reporte de no-shows (/reports?tab=noshow).
 *
 * Todas las queries dependen del rango [from, to]. React Query las refetch
 * automáticamente cuando cambia el rango.
 */
import { useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { api } from '../api/client'
import type { NoShowReportDto, ReportOverviewDto, StaffPerformanceDto } from '@zenix/shared'
import { NoShowChargeStatus } from '@zenix/shared'

// Shape de un punto en el gráfico de tendencia diaria
type TrendDay = { date: string; completed: number; checkouts: number }

/** Formatea una fecha como string ISO (yyyy-MM-dd) para los inputs type=date y la API */
function toYMD(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') ?? 'housekeeping') as 'housekeeping' | 'noshow'

  function setTab(tab: 'housekeeping' | 'noshow') {
    setSearchParams({ tab })
  }

  // Rango por defecto: últimos 7 días para housekeeping, 30 días para no-shows
  const today = toYMD(new Date())
  const defaultFrom = activeTab === 'noshow'
    ? toYMD(subDays(new Date(), 29))
    : toYMD(subDays(new Date(), 6))
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(today)

  // Housekeeping queries — solo se ejecutan en el tab de housekeeping
  const { data: overview, isLoading: loadingOverview } = useQuery<ReportOverviewDto>({
    queryKey: ['reports-overview', from, to],
    queryFn: () => api.get(`/reports/overview?from=${from}&to=${to}`),
    enabled: activeTab === 'housekeeping',
  })

  const { data: staff = [], isLoading: loadingStaff } = useQuery<StaffPerformanceDto[]>({
    queryKey: ['reports-staff', from, to],
    queryFn: () => api.get(`/reports/staff-performance?from=${from}&to=${to}`),
    enabled: activeTab === 'housekeeping',
  })

  const { data: trend = [] } = useQuery<TrendDay[]>({
    queryKey: ['reports-trend', from, to],
    queryFn: () => api.get(`/reports/daily-trend?from=${from}&to=${to}`),
    enabled: activeTab === 'housekeeping',
  })

  // No-show query — solo se ejecuta en el tab de no-shows
  const { data: noShowReport, isLoading: loadingNoShow } = useQuery<NoShowReportDto>({
    queryKey: ['reports-noshow', from, to],
    queryFn: () => api.get(`/reports/no-shows?from=${from}&to=${to}`),
    enabled: activeTab === 'noshow',
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
          <p className="text-xs text-gray-400 mt-0.5">
            {activeTab === 'noshow' ? 'Auditoría de no-shows y seguimiento de cargos' : 'Análisis de rendimiento de housekeeping'}
          </p>
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

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-gray-200">
        <TabButton active={activeTab === 'housekeeping'} onClick={() => setTab('housekeeping')}>
          Housekeeping
        </TabButton>
        <TabButton active={activeTab === 'noshow'} onClick={() => setTab('noshow')}>
          No Shows
        </TabButton>
      </div>

      {/* ── Tab: No Shows ─────────────────────────────────────────────────── */}
      {activeTab === 'noshow' && (
        <NoShowTab report={noShowReport} loading={loadingNoShow} />
      )}

      {/* ── Tab: Housekeeping ─────────────────────────────────────────────── */}
      {activeTab === 'housekeeping' && (<>

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

      </>)}
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-indigo-600 text-indigo-700'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  )
}

// ── Charge status badge ─────────────────────────────────────────────────────

const CHARGE_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  CHARGED:        { label: 'Cobrado',    className: 'bg-green-100 text-green-700' },
  PENDING:        { label: 'Pendiente',  className: 'bg-amber-100 text-amber-700' },
  FAILED:         { label: 'Fallido',    className: 'bg-red-100 text-red-700' },
  WAIVED:         { label: 'Exonerado',  className: 'bg-gray-100 text-gray-500' },
  NOT_APPLICABLE: { label: 'Sin cargo',  className: 'bg-gray-100 text-gray-400' },
}

function ChargeStatusBadge({ status }: { status: string | null }) {
  const badge = status ? (CHARGE_BADGE[status] ?? { label: status, className: 'bg-gray-100 text-gray-500' }) : null
  if (!badge) return <span className="text-gray-300">—</span>
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.className}`}>
      {badge.label}
    </span>
  )
}

// ── No-Show Tab ─────────────────────────────────────────────────────────────

function NoShowTab({
  report,
  loading,
}: {
  report: NoShowReportDto | undefined
  loading: boolean
}) {
  if (loading) {
    return <div className="text-sm text-gray-400 py-8 text-center">Cargando reporte...</div>
  }
  if (!report) {
    return <div className="text-sm text-gray-400 py-8 text-center">Sin datos</div>
  }

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="No-shows"
          value={report.totalNoShows}
          sub="en el período"
          color="red"
        />
        <KpiCard
          label="Tasa de no-show"
          value={report.noShowRate != null ? `${report.noShowRate}%` : '—'}
          sub="del total de llegadas"
          color="orange"
        />
        <KpiCard
          label="Cobrado"
          value={report.totalFeeRevenue !== '0' ? `$${Number(report.totalFeeRevenue).toFixed(2)}` : '—'}
          sub="cargos procesados"
          color="green"
        />
        <KpiCard
          label="Pendiente de cobro"
          value={report.totalFeePending !== '0' ? `$${Number(report.totalFeePending).toFixed(2)}` : '—'}
          sub="requieren seguimiento"
          color="amber"
        />
      </div>

      {/* By source breakdown */}
      {report.bySource.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Por canal de reserva</h2>
          <div className="flex flex-wrap gap-2">
            {report.bySource.map((s) => (
              <span
                key={s.source}
                className="inline-flex items-center gap-1.5 text-xs bg-slate-100 text-slate-700 px-3 py-1 rounded-full"
              >
                <span className="font-medium">{s.source}</span>
                <span className="text-slate-400">·</span>
                <span>{s.count} no-show{s.count !== 1 ? 's' : ''}</span>
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Canales con tasa alta pueden requerir depósito obligatorio o política más estricta.
          </p>
        </div>
      )}

      {/* Audit table */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Registro de no-shows</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Registro inmutable — base para conciliación contable y emisión de CFDI/factura de cargo
            </p>
          </div>
          {report.totalNoShows > 0 && (
            <span className="text-xs bg-red-50 text-red-600 font-medium px-2.5 py-1 rounded-full">
              {report.totalNoShows} registro{report.totalNoShows !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {report.items.length === 0 ? (
          <div className="text-sm text-gray-400 py-10 text-center">
            Sin no-shows en el período seleccionado
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Huésped</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Habitación</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Llegada esperada</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Marcado no-show</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Canal</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">Cargo</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Estado</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">Razón</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {report.items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3 font-medium text-gray-900">{item.guestName}</td>
                    <td className="px-5 py-3 text-gray-600">{item.roomNumber ?? '—'}</td>
                    <td className="px-5 py-3 text-gray-600 text-xs">
                      {item.scheduledCheckin ? format(new Date(item.scheduledCheckin), 'dd/MM/yyyy') : '—'}
                    </td>
                    <td className="px-5 py-3 text-gray-600 text-xs">
                      {item.noShowAt ? format(new Date(item.noShowAt), 'dd/MM/yyyy HH:mm') : '—'}
                      {!item.markedById && (
                        <span className="ml-1 text-gray-400">(auto)</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">{item.source ?? 'Directo'}</td>
                    <td className="px-5 py-3 text-right text-gray-700">
                      {item.feeAmount && Number(item.feeAmount) > 0
                        ? `$${Number(item.feeAmount).toFixed(2)} ${item.feeCurrency ?? ''}`
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <ChargeStatusBadge status={item.chargeStatus} />
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs max-w-[160px] truncate" title={item.noShowReason ?? ''}>
                      {item.noShowReason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fiscal note */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800">
        <strong>Nota fiscal:</strong> Los cargos de no-show en estado "Cobrado" requieren comprobante fiscal
        (CFDI de ingreso en México / factura electrónica en LATAM). Coordina con contabilidad antes de
        presentar declaración mensual. Los cargos "Pendientes" deben resolverse o exonerarse en un plazo máximo de 30 días.
      </div>
    </div>
  )
}

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
