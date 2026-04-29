import { useEffect, useRef } from 'react'
import type { SseEvent, SseEventType } from '@zenix/shared'
import { useAuthStore } from '../store/auth'

type Handler = (event: SseEvent) => void

// The server always emits named events (event: <type>\ndata: {...}\n\n).
// The browser's EventSource only fires 'message' for events WITHOUT an event
// name. We must register a listener for every known type so useSSE callers
// receive all server events regardless of which named type the server uses.
const ALL_SSE_TYPES: SseEventType[] = [
  'task:planned', 'task:ready', 'task:started', 'task:done',
  'task:unassigned', 'task:cancelled',
  'maintenance:reported', 'discrepancy:reported',
  'room:ready', 'checkout:confirmed', 'checkin:completed', 'room:moved',
  'block:created', 'block:approved', 'block:rejected',
  'block:activated', 'block:expired', 'block:cancelled', 'block:extended',
  'checkout:early',
  'stay:no_show', 'stay:no_show_reverted',
  'arrival:at_risk',
  'soft:lock:acquired', 'soft:lock:released',
  'notification:new',
  'checkin:confirmed',
]

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

      // Register on every known named event type — the server always sends
      // 'event: <type>' so the generic 'message' listener alone misses them.
      for (const type of ALL_SSE_TYPES) {
        es.addEventListener(type, handle)
      }
      // Keep 'message' as fallback for any future events without a named type.
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
