import { useEffect, useRef, useCallback } from 'react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/auth'
import type { SseEvent } from '@zenix/shared'

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Advisory soft-lock for a room. Acquired on mount, released on unmount.
 * Prevents overbooking confusion when two receptionists open the same
 * room dialog simultaneously (CLAUDE.md §Sprint 7C).
 *
 * UX rationale (CLAUDE.md §Principio Rector):
 * - Principio de visibilidad del sistema (Nielsen #1): otros recepcionistas
 *   deben saber en tiempo real qué habitación está siendo gestionada.
 * - Modelo de procesamiento dual (Kahneman): el badge 🔒 activa Sistema 1
 *   (reconocimiento instantáneo por símbolo) sin requerir lectura de texto.
 * - Carga cognitiva (Sweller): un badge unívoco reduce la ambigüedad a cero,
 *   evitando que el recepcionista B tenga que "adivinar" si alguien más trabaja
 *   en esa habitación.
 *
 * NOT a security barrier — the hard block in checkAvailability is the real
 * protection. This is purely UX: inform before the error happens.
 */
export function useSoftLock(roomId: string | null, propertyId: string | null) {
  const user = useAuthStore((s) => s.user)
  const lockedRoomRef = useRef<string | null>(null)

  const release = useCallback((id: string) => {
    // Fire-and-forget — do not await in cleanup (synchronous unmount path)
    api.delete(`/v1/rooms/${id}/soft-lock`).catch(() => {/* best-effort */})
    lockedRoomRef.current = null
  }, [])

  useEffect(() => {
    if (!roomId || !propertyId || !user) return

    const userName = user.name || user.email || 'Recepcionista'

    api.post(`/v1/rooms/${roomId}/soft-lock/acquire`, { propertyId, userName })
      .then(() => { lockedRoomRef.current = roomId })
      .catch(() => {/* advisory — ignore network errors */})

    const heartbeat = setInterval(() => {
      api.patch(`/v1/rooms/${roomId}/soft-lock/heartbeat`).catch(() => {/* best-effort */})
    }, HEARTBEAT_INTERVAL_MS)

    return () => {
      clearInterval(heartbeat)
      if (lockedRoomRef.current) release(lockedRoomRef.current)
    }
  }, [roomId, propertyId, user, release])
}

/**
 * Subscribes to soft-lock SSE events and maintains a Map<roomId, lockedByName>
 * of currently locked rooms. Used by TimelineScheduler to pass lock state
 * down to RoomColumn for badge rendering.
 *
 * Design rationale:
 * - Reuses the existing /api/events SSE connection (no extra socket).
 * - Setter uses functional update to avoid stale closure over the Map.
 * - On `soft:lock:acquired`: add entry. On `soft:lock:released`: remove entry.
 * - TTL safety: the backend sweeps expired locks every minute and emits
 *   'soft:lock:released' — so the Map self-heals even after client crashes.
 */
export function useSoftLockSSE(
  setLockedRooms: (updater: (prev: Map<string, string>) => Map<string, string>) => void,
) {
  useEffect(() => {
    const token = localStorage.getItem('hk_token') ?? ''
    const base = import.meta.env.VITE_API_URL ?? ''
    const url = `${base}/api/events?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)

    const onAcquired = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as SseEvent<{ roomId: string; lockedByName: string }>
        const { roomId, lockedByName } = event.data
        if (!roomId || !lockedByName) return
        setLockedRooms((prev) => {
          const next = new Map(prev)
          next.set(roomId, lockedByName)
          return next
        })
      } catch { /* ignore */ }
    }

    const onReleased = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as SseEvent<{ roomId: string }>
        const { roomId } = event.data
        if (!roomId) return
        setLockedRooms((prev) => {
          const next = new Map(prev)
          next.delete(roomId)
          return next
        })
      } catch { /* ignore */ }
    }

    es.addEventListener('soft:lock:acquired', onAcquired)
    es.addEventListener('soft:lock:released', onReleased)

    return () => {
      es.removeEventListener('soft:lock:acquired', onAcquired)
      es.removeEventListener('soft:lock:released', onReleased)
      es.close()
    }
  }, [setLockedRooms])
}
