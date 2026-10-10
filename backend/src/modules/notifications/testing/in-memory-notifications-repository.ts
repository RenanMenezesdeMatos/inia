import type { AlertRow, NotificationsRepository } from "../application/notifications-repository.js"

export class InMemoryNotificationsRepository implements NotificationsRepository {
  constructor(public alerts: (AlertRow & { recipientId: string; organizationId: string })[]) {}

  private mine(viewerId: string, organizationId: string) {
    return this.alerts.filter((alert) => alert.recipientId === viewerId && alert.organizationId === organizationId && alert.status !== "EXPIRED")
  }

  async loadRecentAlerts(viewerId: string, organizationId: string, limit: number): Promise<AlertRow[]> {
    return this.mine(viewerId, organizationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  async countUnread(viewerId: string, organizationId: string): Promise<number> {
    return this.mine(viewerId, organizationId).filter((alert) => alert.readAt === null && alert.status !== "RESOLVED").length
  }

  async markRead(viewerId: string, organizationId: string, alertId: string): Promise<boolean> {
    const alert = this.alerts.find((candidate) => candidate.id === alertId && candidate.recipientId === viewerId && candidate.organizationId === organizationId)
    if (!alert) return false
    alert.readAt = alert.readAt ?? "2026-09-15T12:00:00.000Z"
    if (alert.status === "OPEN") alert.status = "SEEN"
    return true
  }

  async markAllRead(viewerId: string, organizationId: string): Promise<number> {
    let updated = 0
    for (const alert of this.mine(viewerId, organizationId)) {
      if (alert.readAt !== null || alert.status === "RESOLVED") continue
      alert.readAt = "2026-09-15T12:00:00.000Z"
      updated += 1
    }
    return updated
  }
}
