import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { Toaster as SonnerToaster } from 'sonner'
import { useAuthStore } from './store/auth'
import { Sidebar } from './components/Sidebar'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { RoomsPage } from './pages/RoomsPage'
import { RoomsPage as PmsPage } from './modules/rooms/pages/RoomsPage'
import { DailyPlanningPage } from './pages/DailyPlanningPage'
import { KanbanPage } from './pages/KanbanPage'
import { CheckoutsPage } from './pages/CheckoutsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { DiscrepanciesPage } from './pages/DiscrepanciesPage'
import { BlocksPage } from './pages/BlocksPage'
import { ReservationDetailPage } from './pages/ReservationDetailPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

function getToken(): string | null {
  // Zustand v5 persist hydrates asynchronously — on first render the store
  // state is still the default (null). Fall back to the raw localStorage key
  // that setAuth() writes simultaneously so cold loads don't redirect to login.
  return useAuthStore.getState().token ?? localStorage.getItem('hk_token')
}

function PmsLayout({ children }: { children: React.ReactNode }) {
  useAuthStore((s) => s.token) // subscribe so re-renders happen after hydration
  if (!getToken()) return <Navigate to="/login" replace />
  return (
    <div className="min-h-screen bg-gray-50">
      {children}
    </div>
  )
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  useAuthStore((s) => s.token) // subscribe so re-renders happen after hydration
  if (!getToken()) return <Navigate to="/login" replace />
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Global top bar with hamburger (AppMenu) — same UX everywhere */}
      <Sidebar />
      {/* pt-14 leaves room for the fixed top bar (h-14) */}
      <main className="pt-14 min-h-screen">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 lg:py-6">
          {children}
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard"       element={<ProtectedLayout><DashboardPage /></ProtectedLayout>} />
          <Route path="/planning"        element={<ProtectedLayout><DailyPlanningPage /></ProtectedLayout>} />
          <Route path="/rooms"           element={<ProtectedLayout><RoomsPage /></ProtectedLayout>} />
          <Route path="/pms"             element={<PmsLayout><PmsPage /></PmsLayout>} />
          <Route path="/kanban"          element={<ProtectedLayout><KanbanPage /></ProtectedLayout>} />
          <Route path="/checkouts"       element={<ProtectedLayout><CheckoutsPage /></ProtectedLayout>} />
          <Route path="/discrepancies"   element={<ProtectedLayout><DiscrepanciesPage /></ProtectedLayout>} />
          <Route path="/blocks"          element={<ProtectedLayout><BlocksPage /></ProtectedLayout>} />
          <Route path="/reports"         element={<ProtectedLayout><ReportsPage /></ProtectedLayout>} />
          <Route path="/settings/:section?" element={<ProtectedLayout><SettingsPage /></ProtectedLayout>} />
          <Route path="/reservations/:id"  element={<ProtectedLayout><ReservationDetailPage /></ProtectedLayout>} />
          <Route path="*"                element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" toastOptions={{ className: 'text-sm' }} />
      <SonnerToaster richColors position="bottom-right" />
    </QueryClientProvider>
  )
}
