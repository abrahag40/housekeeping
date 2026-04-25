import { api } from './client'

const BASE = '/v1/notification-center'

export type AppNotificationType     = 'INFORMATIONAL' | 'ACTION_REQUIRED' | 'APPROVAL_REQUIRED'
export type AppNotificationCategory =
  | 'CHECKIN_UNCONFIRMED' | 'EARLY_CHECKOUT' | 'NO_SHOW' | 'NO_SHOW_REVERTED'
  | 'ARRIVAL_RISK' | 'CHECKOUT_COMPLETE' | 'TASK_COMPLETED' | 'MAINTENANCE_REPORTED'
  | 'PAYMENT_PENDING' | 'SYSTEM'
export type AppNotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export interface AppNotification {
  id:          string
  type:        AppNotificationType
  category:    AppNotificationCategory
  priority:    AppNotificationPriority
  title:       string
  body:        string
  metadata:    Record<string, unknown> | null
  actionUrl:   string | null
  createdAt:   string
  isRead:      boolean
  readAt:      string | null
  triggeredBy: string | null
  approval:    { action: 'APPROVED' | 'REJECTED' | 'ESCALATED'; actionAt: string; reason: string | null } | null
}

export const notificationsApi = {
  list: (propertyId: string, limit = 50) =>
    api.get<AppNotification[]>(`${BASE}?propertyId=${propertyId}&limit=${limit}`),

  unreadCount: (propertyId: string) =>
    api.get<{ count: number }>(`${BASE}/unread-count?propertyId=${propertyId}`),

  markRead: (id: string) =>
    api.patch(`${BASE}/${id}/read`, {}),

  markAllRead: (propertyId: string) =>
    api.patch(`${BASE}/read-all?propertyId=${propertyId}`, {}),

  approve: (id: string, reason?: string) =>
    api.post(`${BASE}/${id}/approve`, { reason }),

  reject: (id: string, reason?: string) =>
    api.post(`${BASE}/${id}/reject`, { reason }),

  auditLog: (propertyId: string, from: Date, to: Date) =>
    api.get(`${BASE}/audit?propertyId=${propertyId}&from=${from.toISOString()}&to=${to.toISOString()}`),
}
