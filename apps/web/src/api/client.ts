import { usePropertyStore } from '../store/property'

const BASE = import.meta.env.VITE_API_URL ?? ''

function getToken(): string | null {
  return localStorage.getItem('hk_token')
}

function getActivePropertyId(): string | null {
  return usePropertyStore.getState().activePropertyId
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { skipAuth = false, ...init } = options
  const headers = new Headers(init.headers)

  if (!headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  if (!skipAuth) {
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const propertyId = getActivePropertyId()
    if (propertyId) headers.set('X-Property-Id', propertyId)
  }

  const res = await fetch(`${BASE}/api${path}`, { ...init, headers })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new ApiError(res.status, body.message ?? res.statusText)
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
