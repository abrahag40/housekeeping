import { useAuthStore } from '../store/auth'

const BASE =
  import.meta.env.VITE_API_URL && import.meta.env.VITE_API_URL !== '/'
    ? import.meta.env.VITE_API_URL.replace(/\/$/, '')
    : ''

function getToken(): string | null {
  return localStorage.getItem('hk_token')
}

// ── Global 401 guard ──────────────────────────────────────────────────────────
//
// When any request returns 401 (expired or invalid JWT), we immediately:
//   1. Call logout() to clear the token and Zustand state
//   2. Redirect to /login with:
//      - reason=session_expired  → login page shows an informative amber banner
//      - returnTo=<currentPath>  → after re-auth the user lands back where they were
//
// A module-level flag prevents a burst of simultaneous 401s from triggering
// multiple redirects (e.g. SSE + REST requests all failing at once).

let redirectingToLogin = false

function handleUnauthorized(): void {
  if (redirectingToLogin) return
  redirectingToLogin = true

  // Clear auth state — works outside React because Zustand exposes .getState()
  useAuthStore.getState().logout()

  const returnTo = encodeURIComponent(
    window.location.pathname + window.location.search,
  )
  // Full navigation (not React Router) so stale component state is flushed
  window.location.href = `/login?reason=session_expired&returnTo=${returnTo}`
}

// ─────────────────────────────────────────────────────────────────────────────

interface RequestOptions extends RequestInit {
  skipAuth?: boolean
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { skipAuth = false, ...init } = options
  const headers = new Headers(init.headers)

  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  if (!skipAuth) {
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
  }

  const url = `${BASE}/api${path}`

  let res: Response
  try {
    res = await fetch(url, { ...init, headers })
  } catch (networkError) {
    // ERR_CONNECTION_REFUSED, network offline, CORS preflight fail
    const msg = 'No se pudo conectar con el servidor. Verifica que la API esté corriendo.'
    console.error(`[API] Network error → ${url}`, networkError)
    throw new ApiError(0, msg)
  }

  if (res.status === 401 && !options.skipAuth) {
    // Session expired or token invalid — redirect to login automatically
    handleUnauthorized()
    // Throw so any awaiting caller (mutation, query) receives a clean error
    // rather than trying to parse a 401 JSON body as valid data.
    throw new ApiError(401, 'Sesión expirada')
  }

  if (!res.ok) {
    let message = res.statusText
    try {
      const body = await res.json()
      message = body.message ?? body.error ?? res.statusText
    } catch {
      // respuesta no-JSON — mantener statusText
    }
    console.error(`[API] ${res.status} ${res.url} — ${message}`)
    throw new ApiError(res.status, message)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { method: 'GET', ...opts }),

  post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), ...opts }),

  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body), ...opts }),

  delete: <T>(path: string, opts?: RequestOptions) =>
    request<T>(path, { method: 'DELETE', ...opts }),
}
