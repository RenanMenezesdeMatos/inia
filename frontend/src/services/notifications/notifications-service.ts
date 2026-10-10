import { apiGet, apiPost } from "@/lib/api/api-client"
import { notificationSummarySchema, type NotificationSummary } from "@/schemas/notifications/notifications.schema"

const BASE = "/api/v1/notifications"

export async function fetchNotifications(): Promise<NotificationSummary> {
  return notificationSummarySchema.parse(await apiGet<unknown>(BASE))
}

export async function markNotificationRead(id: string): Promise<void> {
  await apiPost(`${BASE}/${id}/read`)
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiPost<{ updated: number }>(`${BASE}/read-all`)
}
