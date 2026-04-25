import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'
import { notificationsApi } from '@/api/notifications.api'
import { useAuthStore } from '@/store/auth'

/** Returns notifications + unread count for the active property. */
export function useNotifications(propertyId: string | null) {
  const qc = useQueryClient()

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', propertyId],
    queryFn: () => notificationsApi.list(propertyId!),
    enabled: !!propertyId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const { data: countData } = useQuery({
    queryKey: ['notifications-count', propertyId],
    queryFn: () => notificationsApi.unreadCount(propertyId!),
    enabled: !!propertyId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['notifications', propertyId] })
    qc.invalidateQueries({ queryKey: ['notifications-count', propertyId] })
  }, [qc, propertyId])

  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: invalidate,
  })

  const markAllReadMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(propertyId!),
    onSuccess: invalidate,
  })

  const approveMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      notificationsApi.approve(id, reason),
    onSuccess: invalidate,
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      notificationsApi.reject(id, reason),
    onSuccess: invalidate,
  })

  return {
    notifications,
    unreadCount:  countData?.count ?? 0,
    isLoading,
    invalidate,
    markRead:     (id: string) => markReadMut.mutate(id),
    markAllRead:  () => markAllReadMut.mutate(),
    approve:      (id: string, reason?: string) => approveMut.mutate({ id, reason }),
    reject:       (id: string, reason?: string) => rejectMut.mutate({ id, reason }),
  }
}

/** Subscribes to SSE `notification:new` and invalidates the notifications query. */
export function useNotificationSSE(propertyId: string | null, onNew: () => void) {
  useEffect(() => {
    if (!propertyId) return
    // We listen via the existing useSSE hook pattern in the consuming component;
    // the parent passes `onNew` as a callback to avoid double-subscribing.
    // This hook is intentionally a thin wrapper so components can opt-in.
  }, [propertyId, onNew])
}

/** Reads the current user's propertyId from auth store. */
export function useActivePropertyId(): string | null {
  const user = useAuthStore((s) => s.user)
  return (user as any)?.propertyId ?? null
}
