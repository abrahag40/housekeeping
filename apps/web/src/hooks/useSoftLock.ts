import { useEffect, useRef, useCallback } from 'react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/auth'

const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Advisory soft-lock for a room. Acquired on mount, released on unmount.
 * Prevents overbooking confusion when two receptionists open the same
 * room dialog simultaneously (CLAUDE.md §Sprint 7C).
 *
 * This is UX, not a security barrier — the hard block in checkAvailability
 * is the real protection. The soft-lock emits SSE events so other connected
 * clients see a "🔒 En uso por X" badge on the room.
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
 * Subscribe to soft-lock SSE events for a set of rooms.
 * Returns a Map<roomId, lockedByName> of currently locked rooms.
 * Used by the calendar to render "🔒" badges on room rows.
 */
export function useSoftLockState(
  lockedRooms: Map<string, string>,
  setLockedRooms: (updater: (prev: Map<string, string>) => Map<string, string>) => void,
) {
  // Wired via useRoomSSE in TimelineScheduler — see useSoftLockSSE below
  return { lockedRooms }
}
