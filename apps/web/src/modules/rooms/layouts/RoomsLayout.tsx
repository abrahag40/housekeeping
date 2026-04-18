import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/auth'

export function RoomsLayout() {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />

  return (
    <div className="h-screen w-screen overflow-hidden bg-white">
      <Outlet />
    </div>
  )
}
