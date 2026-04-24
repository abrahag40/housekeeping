import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SseEvent, SseEventType } from '@zenix/shared'

const ROOM_EVENT_TYPES: SseEventType[] = [
  'room:ready',
  'room:moved',
  'checkin:completed',
  'checkout:confirmed',
  // No-show and potential no-show events — cause block visuals to update
  'stay:no_show',
  'stay:no_show_reverted',
  'arrival:at_risk',
]

/**
 * Subscribes to the existing SSE stream and invalidates room/timeline queries
 * when room-related events arrive. Reuses the same /api/events endpoint
 * as the housekeeping dashboard (one connection serves all event types).
 */
export function useRoomSSE(propertyId: string) {
  const queryClient = useQueryClient()
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout>>()
  const retryCount = useRef(0)

  useEffect(() => {
    if (!propertyId) return

    function connect() {
      const token = localStorage.getItem('hk_token') ?? ''
      const base = import.meta.env.VITE_API_URL ?? ''
      const url = `${base}/api/events?token=${encodeURIComponent(token)}`
      const es = new EventSource(url)
      esRef.current = es

      const handler = (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data) as SseEvent
          if (!ROOM_EVENT_TYPES.includes(event.type)) return

          retryCount.current = 0

          // Invalidate relevant queries — TanStack refetches active ones
          queryClient.invalidateQueries({
            queryKey: ['guest-stays'],
            refetchType: 'active',
          })
          queryClient.invalidateQueries({
            queryKey: ['rooms'],
            refetchType: 'active',
          })
          queryClient.invalidateQueries({
            queryKey: ['room-readiness'],
            refetchType: 'active',
          })
        } catch {
          // ignore parse errors
        }
      }

      // The existing SSE emits named events (event: type\ndata: ...\n\n)
      // Listen to all room event types
      for (const eventType of ROOM_EVENT_TYPES) {
        es.addEventListener(eventType, handler)
      }
      // Also listen on generic 'message' in case events come without named type
      es.addEventListener('message', handler)

      es.onerror = () => {
        es.close()
        const delay = Math.min(2000 * Math.pow(2, retryCount.current), 30_000)
        retryCount.current++
        retryRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      clearTimeout(retryRef.current)
      esRef.current?.close()
    }
  }, [propertyId, queryClient])
}
