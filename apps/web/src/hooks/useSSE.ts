import { useEffect, useRef } from 'react'
import type { SseEvent } from '@housekeeping/shared'

type Handler = (event: SseEvent) => void

export function useSSE(onEvent: Handler) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent

  useEffect(() => {
    const token = localStorage.getItem('hk_token')
    if (!token) return

    const base = import.meta.env.VITE_API_URL ?? ''
    const url = `${base}/api/events?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)

    const handle = (e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data) as SseEvent
        handlerRef.current(parsed)
      } catch {
        // ignore malformed events
      }
    }

    es.addEventListener('message', handle)
    es.addEventListener('ping', () => {}) // heartbeat

    return () => {
      es.removeEventListener('message', handle)
      es.close()
    }
  }, [])
}
