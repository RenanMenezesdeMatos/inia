import { canManageScope, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { EXECUTION_BLOCKED_ALERT_TYPE, parseExecutionBlockedKey } from "../../workflows/application/blocked-execution-notice.js"
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
      // Políticas de acompanhamento: atribuição, aprovação/decisão pedida, aprovada/devolvida/decidida, encaminhada, novo sinal.
      if (alertType.startsWith("INTERVENTION_")) return "INTERVENTION"
      // Contestação recebida (quem revisa) e respondida (o colaborador) — migration 150.
      if (alertType.startsWith("FEEDBACK_CONTESTATION_")) return "FEEDBACK_CONTESTATION"
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
  if (kind === "INTERVENTION") {
    const intervention = /^intervention:([0-9a-f-]{36}):/.exec(alert.dedupeKey)
    return intervention && alert.caseId ? { type: "INTERVENTION", caseId: alert.caseId, interventionId: intervention[1]! } : { type: "NONE" }
  }
  if (kind === "FEEDBACK_CONTESTATION") {
    // `feedback_contestation:<avaliação>:<revisor>` → a contestação; `feedback_contestation_answer:<avaliação>:<feedback>` → o
    // feedback no Acompanhamento do colaborador.
    const received = /^feedback_contestation:([0-9a-f-]{36}):/.exec(alert.dedupeKey)
    if (received) return { type: "ADMIN_FEEDBACK_CONTESTATION", contestationId: received[1]! }
    const answered = /^feedback_contestation_answer:[0-9a-f-]{36}:([0-9a-f-]{36})$/.exec(alert.dedupeKey)
    return answered ? { type: "FOLLOW_UP", itemId: answered[1]!, operatorId: null } : { type: "NONE" }
  }
  if (kind === "INIA_MESSAGE") {
    // A conversa/entrega é resolvida pela chave gravada na entrega (`workflow_chat:<outputId>` / `workflow_avatar:<outputId>`).
    const avatar = /^workflow_avatar:([0-9a-f-]{36})$/.exec(alert.dedupeKey)
    if (avatar) return { type: "INIA_AVATAR_DELIVERY", deliveryId: avatar[1]! }
    return alert.conversationId ? { type: "INIA_CONVERSATION", conversationId: alert.conversationId } : { type: "NONE" }
  }
  return { type: "NONE" }
}

/** Os alcances em que quem lê administra workflows agora. Só é chamado quando a pessoa tem aviso de execução bloqueada. */
export type ScopesLoader = () => Promise<ManageableScopes>

const NO_SCOPES: ScopesLoader = async () => ({ unrestricted: false, allTeams: false, teamIds: new Set(), subteamIds: new Set() })

/**
 * Regra única de visibilidade do aviso de execução bloqueada (D1): o mesmo `canManageScope` que protege a aba Execuções. O resultado
 * vale para a lista, a contagem e o marcar como lido; o workflow removido não volta na consulta, e o aviso dele fica invisível. O custo
 * segue o número de workflows com aviso da pessoa, não o histórico: quem não tem nenhum nem carrega os alcances.
 */
async function allowedBlockedNoticeWorkflowIds(repository: NotificationsRepository, viewer: Viewer, loadScopes: ScopesLoader): Promise<string[]> {
  const workflows = await repository.loadBlockedNoticeWorkflows(viewer.personId, viewer.organizationId)
  if (workflows.length === 0) return []
  const scopes = await loadScopes()
  return workflows.filter((workflow) => canManageScope(scopes, workflow)).map((workflow) => workflow.workflowId)
}

/**
 * Sino do viewer: alertas endereçados a ele (o repositório filtra por recipient — nunca um alerta
 * de outra estrutura), badge = não lidos vivos, e a contagem de revisões que ainda exigem decisão
 * vinda da MESMA definição de pendente usada pela Surface Pendências e pelos contadores da Equipe.
 */
export async function buildNotificationSummary(
  repository: NotificationsRepository,
  pendingActions: PendingActionsRepository,
  viewer: Viewer,
  loadScopes: ScopesLoader = NO_SCOPES,
): Promise<NotificationSummary> {
  const allowedBlockedWorkflowIds = await allowedBlockedNoticeWorkflowIds(repository, viewer, loadScopes)
  const [alerts, unreadCount, pendingActionCount] = await Promise.all([
    repository.loadRecentAlerts(viewer.personId, viewer.organizationId, NOTIFICATION_LIST_LIMIT, allowedBlockedWorkflowIds),
    repository.countUnread(viewer.personId, viewer.organizationId, allowedBlockedWorkflowIds),
    pendingActions.countPending(viewer.personId, viewer.organizationId),
  ])
  // Nome e etapa só dos avisos de execução bloqueada que esta lista mostra.
  const blockedKeys = alerts.flatMap((alert) => {
    const key = alert.alertType === EXECUTION_BLOCKED_ALERT_TYPE ? parseExecutionBlockedKey(alert.dedupeKey) : null
    return key ? [key] : []
  })
  const blockedDetails = blockedKeys.length > 0 ? await repository.loadBlockedNoticeDetails(viewer.organizationId, blockedKeys) : []
  const blockedDetailOf = (key: { workflowId: string; nodeId: string }) => blockedDetails.find((detail) => detail.workflowId === key.workflowId && detail.nodeId === key.nodeId)
  // Situação (pendente/decidida/indisponível) só das revisões que o sino está mostrando — nunca as últimas 200 com o Execution
  // Context (o sino roda para todo mundo a cada minuto).
  const reviewAlertIds = alerts.filter((alert) => kindOf(alert.alertType) === "HUMAN_REVIEW").map((alert) => alert.id)
  const reviewRows = reviewAlertIds.length > 0 ? await pendingActions.loadReviewAlerts(viewer.personId, viewer.organizationId, { alertIds: reviewAlertIds }) : []
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
    const blockedKey = alert.alertType === EXECUTION_BLOCKED_ALERT_TYPE ? parseExecutionBlockedKey(alert.dedupeKey) : null
    const blockedDetail = blockedKey ? blockedDetailOf(blockedKey) : undefined
    if (blockedKey && blockedDetail) {
      return {
        id: alert.id,
        kind,
        title: `Execução bloqueada: ${blockedDetail.workflowName}`,
        description: `${blockedDetail.stepLabel ? `Etapa “${blockedDetail.stepLabel}”. ` : ""}${shortDescription(alert)} Veja em Execuções.`,
        severity: alert.severity,
        createdAt: alert.createdAt,
        readAt: alert.readAt,
        resolved: alert.status === "RESOLVED",
        operator: null,
        actionable: false,
        target: { type: "ADMIN_WORKFLOW_EXECUTIONS", workflowId: blockedKey.workflowId },
      }
    }
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

export async function markNotificationRead(repository: NotificationsRepository, viewer: Viewer, alertId: string, loadScopes: ScopesLoader = NO_SCOPES): Promise<void> {
  const updated = await repository.markRead(viewer.personId, viewer.organizationId, alertId, await allowedBlockedNoticeWorkflowIds(repository, viewer, loadScopes))
  if (!updated) throw new DomainError("Notificação não encontrada.", "NOTIFICATION_NOT_FOUND", 404)
}

export async function markAllNotificationsRead(repository: NotificationsRepository, viewer: Viewer, loadScopes: ScopesLoader = NO_SCOPES): Promise<{ updated: number }> {
  return { updated: await repository.markAllRead(viewer.personId, viewer.organizationId, await allowedBlockedNoticeWorkflowIds(repository, viewer, loadScopes)) }
}
