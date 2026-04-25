import { useEffect, useRef } from 'react'
import type { SseEvent } from '@zenix/shared'
import { useAuthStore } from '../store/auth'

type Handler = (event: SseEvent) => void

export function useSSE(onEvent: Handler) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    const token = localStorage.getItem('hk_token')
    if (!token) return

    const base = import.meta.env.VITE_API_URL ?? ''
    let es: EventSource | null = null
    let cancelled = false

    // Pre-flight: validate token before opening EventSource.
    // EventSource doesn't expose HTTP status codes in its onerror event,
    // so we check with fetch first and redirect to login on 401.
    fetch(`${base}/api/events?token=${encodeURIComponent(token)}`, {
      headers: { Accept: 'text/event-stream' },
    }).then((res) => {
      if (cancelled) return

      if (res.status === 401) {
        useAuthStore.getState().logout()
        window.location.href = '/login'
        return
      }

      const url = `${base}/api/events?token=${encodeURIComponent(token)}`
      es = new EventSource(url)

      const handle = (e: MessageEvent) => {
        try {
          const parsed = JSON.parse(e.data) as SseEvent
          handlerRef.current(parsed)
        } catch {
          // ignore malformed events
        }
      }

      es.addEventListener('message', handle)
      es.addEventListener('ping', () => {})

      es.onerror = () => {
        // On any SSE error after connection, re-validate the token.
        // If expired, logout and redirect.
        fetch(`${base}/api/events?token=${encodeURIComponent(token)}`, {
          headers: { Accept: 'text/event-stream' },
        }).then((r) => {
          if (r.status === 401) {
            useAuthStore.getState().logout()
            window.location.href = '/login'
          }
        }).catch(() => {})
      }
    }).catch(() => {
      // Network error during pre-flight — leave EventSource closed, user sees stale data
    })

    return () => {
      cancelled = true
      es?.close()
    }
  }, [])
}
