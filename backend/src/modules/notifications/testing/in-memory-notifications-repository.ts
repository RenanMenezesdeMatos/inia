import { EXECUTION_BLOCKED_ALERT_TYPE, parseExecutionBlockedKey } from "../../workflows/application/blocked-execution-notice.js"
import type { AlertRow, BlockedNoticeDetail, BlockedNoticeWorkflow, NotificationsRepository } from "../application/notifications-repository.js"

export class InMemoryNotificationsRepository implements NotificationsRepository {
  constructor(
    public alerts: (AlertRow & { recipientId: string; organizationId: string })[],
    /** Workflows que existem: aviso de um workflow fora daqui é de um workflow removido. */
    public workflows: (BlockedNoticeWorkflow & { organizationId: string; name: string })[] = [],
  ) {}

  private visible(allowed: readonly string[]) {
    return (alert: AlertRow) => alert.alertType !== EXECUTION_BLOCKED_ALERT_TYPE || allowed.includes(parseExecutionBlockedKey(alert.dedupeKey)?.workflowId ?? "")
  }

  async loadBlockedNoticeWorkflows(viewerId: string, organizationId: string): Promise<BlockedNoticeWorkflow[]> {
    const ids = new Set(this.mine(viewerId, organizationId).filter((alert) => alert.alertType === EXECUTION_BLOCKED_ALERT_TYPE).map((alert) => parseExecutionBlockedKey(alert.dedupeKey)?.workflowId))
    return this.workflows.filter((workflow) => workflow.organizationId === organizationId && ids.has(workflow.workflowId))
  }

  async loadBlockedNoticeDetails(organizationId: string, keys: { workflowId: string; nodeId: string }[]): Promise<BlockedNoticeDetail[]> {
    return keys.flatMap((key) => {
      const workflow = this.workflows.find((candidate) => candidate.workflowId === key.workflowId && candidate.organizationId === organizationId)
      return workflow ? [{ ...key, workflowName: workflow.name, stepLabel: null }] : []
    })
  }

  private mine(viewerId: string, organizationId: string) {
    return this.alerts.filter((alert) => alert.recipientId === viewerId && alert.organizationId === organizationId && alert.status !== "EXPIRED")
  }

  async loadRecentAlerts(viewerId: string, organizationId: string, limit: number, allowed: readonly string[] = []): Promise<AlertRow[]> {
    return this.mine(viewerId, organizationId)
      .filter(this.visible(allowed))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  async countUnread(viewerId: string, organizationId: string, allowed: readonly string[] = []): Promise<number> {
    return this.mine(viewerId, organizationId).filter(this.visible(allowed)).filter((alert) => alert.readAt === null && alert.status !== "RESOLVED").length
  }

  async markRead(viewerId: string, organizationId: string, alertId: string, allowed: readonly string[] = []): Promise<boolean> {
    const alert = this.alerts.find((candidate) => candidate.id === alertId && candidate.recipientId === viewerId && candidate.organizationId === organizationId)
    if (!alert || !this.visible(allowed)(alert)) return false
    alert.readAt = alert.readAt ?? "2026-09-15T12:00:00.000Z"
    if (alert.status === "OPEN") alert.status = "SEEN"
    return true
  }

  async markAllRead(viewerId: string, organizationId: string, allowed: readonly string[] = []): Promise<number> {
    let updated = 0
    for (const alert of this.mine(viewerId, organizationId).filter(this.visible(allowed))) {
      if (alert.readAt !== null || alert.status === "RESOLVED") continue
      alert.readAt = "2026-09-15T12:00:00.000Z"
      updated += 1
    }
    return updated
  }
}
