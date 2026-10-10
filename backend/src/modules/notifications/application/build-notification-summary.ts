import { DomainError } from "../../../shared/domain/domain-error.js"
import { RECONCILIATION_RESOLUTION_LABELS } from "../../people/application/workday-reconciliation-service.js"
import { reviewStatus, workdayActionId } from "../../pending-actions/application/build-pending-actions.js"
import type { PendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import type { NotificationItem, NotificationKind, NotificationSummary, NotificationTarget } from "../domain/view-models.js"
import type { AlertRow, NotificationsRepository } from "./notifications-repository.js"

export type Viewer = { personId: string; organizationId: string }

export const NOTIFICATION_LIST_LIMIT = 20

function kindOf(alertType: string): NotificationKind {
  switch (alertType) {
    case "WORKFLOW_HUMAN_REVIEW":
      return "HUMAN_REVIEW"
    case "WORKFLOW_OUTPUT":
      return "WORKFLOW_OUTPUT"
    case "WORKFLOW_ESCALATION":
      return "ESCALATION"
    case "WORKFLOW_CHAT_MESSAGE":
    case "WORKFLOW_AVATAR_MESSAGE":
      return "INIA_MESSAGE"
    case "WORKDAY_MISSING_PRODUCTION":
      return "WORKDAY_RECONCILIATION"
    case "WORKDAY_PRODUCTION_DIVERGENCE":
    case "WORKDAY_STATUS_INCONSISTENCY":
    case "WORKDAY_CLASSIFICATION_SUPERSEDED":
    case "WORK_SCHEDULE_HORIZON":
    case "DATA_SOURCE_AVAILABILITY_DELAYED":
      return "CALENDAR_NOTICE"
    default:
      return "OTHER"
  }
}

const REVIEW_KEY = /^workflow_human_review:([0-9a-f-]{36}):(.+)$/
/** `workday_reconciliation:<kind>:<personId>:<AAAA-MM-DD>` — gravado pelo job de reconciliação. */
const WORKDAY_KEY = /^workday_reconciliation:([A-Z_]+):([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})(?::[0-9a-f-]{36})?$/

function reviewActionId(dedupeKey: string): string | null {
  const match = REVIEW_KEY.exec(dedupeKey)
  return match ? `${match[1]}:${match[2]}` : null
}

/** O texto do alerta de revisão embute o conteúdo inteiro ("Conteúdo: {...}") — no sino só cabe
 * a frase; o conteúdo completo mora no detalhe da Pendência. */
function shortDescription(alert: AlertRow): string {
  const withoutContent = alert.description.split(" Conteúdo: ")[0] ?? alert.description
  return withoutContent.length > 160 ? `${withoutContent.slice(0, 157).trimEnd()}…` : withoutContent
}

function targetOf(alert: AlertRow, kind: NotificationKind, workdayActionId: string | null): NotificationTarget {
  if (kind === "HUMAN_REVIEW") {
    const actionId = reviewActionId(alert.dedupeKey)
    return actionId ? { type: "PENDING_ACTION", actionId } : { type: "NONE" }
  }
  if (kind === "WORKFLOW_OUTPUT" || kind === "ESCALATION") return { type: "FOLLOW_UP", itemId: alert.id, operatorId: alert.operator?.personId ?? null }
  if (kind === "WORKDAY_RECONCILIATION") return workdayActionId ? { type: "PENDING_ACTION", actionId: workdayActionId } : { type: "NONE" }
  if (kind === "CALENDAR_NOTICE") {
    if (alert.alertType === "WORK_SCHEDULE_HORIZON") return { type: "ADMIN_CALENDAR" }
    if (alert.alertType === "DATA_SOURCE_AVAILABILITY_DELAYED") return { type: "ADMIN_DATA_HUB" }
    const match = WORKDAY_KEY.exec(alert.dedupeKey)
    return { type: "TEAM_CALENDAR", operatorId: match?.[2] ?? null, date: match?.[3] ?? null }
  }
  if (alert.alertType === "AI_BUDGET_THRESHOLD") return { type: "ADMIN_AI_USAGE" }
  if (kind === "INIA_MESSAGE") {
    // A conversa/entrega é resolvida pela chave gravada na entrega (`workflow_chat:<outputId>` / `workflow_avatar:<outputId>`).
    const avatar = /^workflow_avatar:([0-9a-f-]{36})$/.exec(alert.dedupeKey)
    if (avatar) return { type: "INIA_AVATAR_DELIVERY", deliveryId: avatar[1]! }
    return alert.conversationId ? { type: "INIA_CONVERSATION", conversationId: alert.conversationId } : { type: "NONE" }
  }
  return { type: "NONE" }
}

/**
 * Sino do viewer: alertas endereçados a ele (o repositório filtra por recipient — nunca um alerta
 * de outra estrutura), badge = não lidos vivos, e a contagem de revisões que ainda exigem decisão
 * vinda da MESMA definição de pendente usada pela Surface Pendências e pelos contadores da Equipe.
 */
export async function buildNotificationSummary(repository: NotificationsRepository, pendingActions: PendingActionsRepository, viewer: Viewer): Promise<NotificationSummary> {
  const [alerts, unreadCount, reviewRows, pendingActionCount] = await Promise.all([
    repository.loadRecentAlerts(viewer.personId, viewer.organizationId, NOTIFICATION_LIST_LIMIT),
    repository.countUnread(viewer.personId, viewer.organizationId),
    pendingActions.loadReviewAlerts(viewer.personId, viewer.organizationId),
    pendingActions.countPending(viewer.personId, viewer.organizationId),
  ])
  const reviewByAlert = new Map(reviewRows.map((row) => [row.alertId, row] as const))
  // Pendências de produção: o alerta aponta para a reconciliação real (id) — abertas continuam acionáveis.
  const workdayRows = alerts.some((alert) => kindOf(alert.alertType) === "WORKDAY_RECONCILIATION") ? await pendingActions.loadWorkdayReconciliations(viewer.personId, viewer.organizationId) : []
  const workdayByAlert = new Map(workdayRows.flatMap((row) => (row.alertId ? [[row.alertId, row] as const] : [])))
  // Revisão sem caso vinculado: o colaborador vem da execução real, não do alerta.
  const missingOperatorIds = alerts.flatMap((alert) => {
    const operatorId = reviewByAlert.get(alert.id)?.enrollment?.operatorId
    return !alert.operator && operatorId ? [operatorId] : []
  })
  const people = missingOperatorIds.length > 0 ? await pendingActions.loadPeople([...new Set(missingOperatorIds)]) : new Map()

  const items: NotificationItem[] = alerts.map((alert) => {
    const kind = kindOf(alert.alertType)
    const review = reviewByAlert.get(alert.id)
    const workday = workdayByAlert.get(alert.id)
    const status = kind === "HUMAN_REVIEW" ? (review ? reviewStatus(review).status : "UNAVAILABLE") : kind === "WORKDAY_RECONCILIATION" ? (workday ? (workday.status === "OPEN" ? "PENDING" : "DECIDED") : "UNAVAILABLE") : null
    const reviewOperatorId = review?.enrollment?.operatorId
    const operator = alert.operator ?? (reviewOperatorId && people.get(reviewOperatorId) ? { personId: reviewOperatorId, name: people.get(reviewOperatorId)!.name } : null)
    return {
      id: alert.id,
      kind,
      title: alert.title,
      description:
        kind === "WORKDAY_RECONCILIATION"
          ? status === "DECIDED"
            ? `Resolvida${workday?.resolution ? ` · ${RECONCILIATION_RESOLUTION_LABELS[workday.resolution]}` : ""}.`
            : status === "UNAVAILABLE"
              ? "Esta pendência não está mais disponível."
              : shortDescription(alert)
          : status === "DECIDED"
            ? "Revisão já decidida."
            : status === "UNAVAILABLE"
              ? "Esta revisão não está mais disponível."
              : status === "PENDING"
                ? "Aguardando sua decisão."
                : shortDescription(alert),
      severity: alert.severity,
      createdAt: alert.createdAt,
      readAt: alert.readAt,
      resolved: alert.status === "RESOLVED",
      operator,
      actionable: status === "PENDING",
      target: status === "UNAVAILABLE" ? { type: "NONE" } : targetOf(alert, kind, workday ? workdayActionId(workday.id) : null),
    }
  })

  return { unreadCount, pendingActionCount, items }
}

export async function markNotificationRead(repository: NotificationsRepository, viewer: Viewer, alertId: string): Promise<void> {
  const updated = await repository.markRead(viewer.personId, viewer.organizationId, alertId)
  if (!updated) throw new DomainError("Notificação não encontrada.", "NOTIFICATION_NOT_FOUND", 404)
}

export async function markAllNotificationsRead(repository: NotificationsRepository, viewer: Viewer): Promise<{ updated: number }> {
  return { updated: await repository.markAllRead(viewer.personId, viewer.organizationId) }
}
