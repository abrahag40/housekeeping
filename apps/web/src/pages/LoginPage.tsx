import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../store/auth'
import type { AuthResponse } from '@housekeeping/shared'

export function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const setAuth  = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const reason   = searchParams.get('reason')
  // Where to send the user after a successful login.
  // Defaults to the PMS timeline, the main working screen for receptionists.
  const returnTo = searchParams.get('returnTo') ?? '/pms'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.post<AuthResponse>(
        '/auth/login',
        { email, password },
        { skipAuth: true },
      )
      setAuth(data)
      // Return to the exact page the user was on before the session expired
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 w-full max-w-sm space-y-5">

        <div>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Housekeeping</h1>
          <p className="text-sm text-gray-500">Ingresa con tu cuenta</p>
        </div>

        {/* ── Sesión expirada ─────────────────────────────────────────────────
            Shown when the global 401 interceptor in api/client.ts redirected
            here automatically after the JWT expired mid-session.              */}
        {reason === 'session_expired' && (
          <div className="flex gap-3 bg-amber-50 border border-amber-200
                          rounded-lg px-3.5 py-3">
            <span className="text-base leading-none mt-0.5" aria-hidden>⏱</span>
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Sesión expirada
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Tu sesión de 12 horas venció. Inicia sesión nuevamente
                para continuar donde lo dejaste.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full border border-gray-300 rounded-lg px-3 py-2
                         text-sm focus:outline-none focus:ring-2
                         focus:ring-indigo-500"
              placeholder="usuario@hotel.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contraseña
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2
                         text-sm focus:outline-none focus:ring-2
                         focus:ring-indigo-500"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm
                       font-medium hover:bg-indigo-700 disabled:opacity-50
                       transition-colors"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  )
}
