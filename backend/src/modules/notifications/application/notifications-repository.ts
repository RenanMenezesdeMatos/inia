import { EXECUTION_BLOCKED_ALERT_TYPE, executionBlockedWorkflowIdSql } from "../../workflows/application/blocked-execution-notice.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { alertOutputIdSql, CHAT_ALERT_KEY_PREFIX, recadoAlertCoveredByFollowUpSql } from "../../conversational-delivery/application/recado-follow-up-invite.js"

export type AlertRow = {
  id: string
  alertType: string
  title: string
  description: string
  severity: "INFO" | "MEDIUM" | "HIGH" | "CRITICAL"
  status: string
  createdAt: string
  readAt: string | null
  caseId: string | null
  dedupeKey: string
  operator: { personId: string; name: string } | null
  /** Workflow Outputs V1 — conversa criada pela entrega de Chat que gerou este aviso (null nos demais). */
  conversationId?: string | null
}

/** Workflow de um aviso de execução bloqueada, com o alcance: só o que a permissão precisa, nunca o grafo. */
export type BlockedNoticeWorkflow = { workflowId: string; scopeType: string; teamId: string | null; subteamId: string | null }
export type BlockedNoticeDetail = { workflowId: string; nodeId: string; workflowName: string; stepLabel: string | null }

/**
 * `allowedBlockedWorkflowIds`: os workflows cujos avisos de execução bloqueada a pessoa pode ver agora. É a MESMA lista na lista, na
 * contagem e ao marcar como lido; os demais tipos de aviso não dependem dela. Vazia = nenhum aviso desse tipo.
 */
export interface NotificationsRepository {
  loadBlockedNoticeWorkflows(viewerId: string, organizationId: string): Promise<BlockedNoticeWorkflow[]>
  loadBlockedNoticeDetails(organizationId: string, keys: { workflowId: string; nodeId: string }[]): Promise<BlockedNoticeDetail[]>
  loadRecentAlerts(viewerId: string, organizationId: string, limit: number, allowedBlockedWorkflowIds?: readonly string[]): Promise<AlertRow[]>
  countUnread(viewerId: string, organizationId: string, allowedBlockedWorkflowIds?: readonly string[]): Promise<number>
  /** Marca como lida SÓ se o alerta for do viewer e ele puder vê-lo — devolve false nos demais casos. */
  markRead(viewerId: string, organizationId: string, alertId: string, allowedBlockedWorkflowIds?: readonly string[]): Promise<boolean>
  markAllRead(viewerId: string, organizationId: string, allowedBlockedWorkflowIds?: readonly string[]): Promise<number>
}

/**
 * Aviso que o sino mostra. "Um convite só": o aviso de recado de voz cujo recado ficou coberto pelo Acompanhamento (o mesmo
 * Output/artefato virou feedback publicado — quem convida é a aplicação de feedback) não aparece nem conta — é a MESMA regra
 * que tira o recado do inbox (recado-follow-up-invite.ts), então o sino nunca aponta para um convite que não existe.
 */
const SHOWN_CONDITION = `not ${recadoAlertCoveredByFollowUpSql("a")}`

/** Não lido = sem `read_at` e ainda vivo (resolvido/expirado não conta no badge) — o índice parcial `idx_alerts_recipient_unread`
 * (migration 132) tem exatamente este predicado: o badge lê só os não lidos de quem pergunta. */
const UNREAD_CONDITION = `a.read_at is null and a.status in ('OPEN', 'SEEN', 'ACKNOWLEDGED') and ${SHOWN_CONDITION}`

/** Aviso de execução bloqueada só existe para quem administra o workflow agora; os demais tipos passam direto. */
const visibleNoticeCondition = (allowedParam: string) =>
  `(a.alert_type <> '${EXECUTION_BLOCKED_ALERT_TYPE}' or ${executionBlockedWorkflowIdSql("a")} = any(${allowedParam}::uuid[]))`

export class PgNotificationsRepository implements NotificationsRepository {
  constructor(private readonly db: Database) {}

  async loadBlockedNoticeWorkflows(viewerId: string, organizationId: string): Promise<BlockedNoticeWorkflow[]> {
    const result = await this.db.query<BlockedNoticeWorkflow>(
      `select distinct w.id "workflowId", w.scope_type "scopeType", w.team_id "teamId", w.subteam_id "subteamId"
       from alerts a
       join workflows w on w.id = ${executionBlockedWorkflowIdSql("a")} and w.organization_id = a.organization_id
       where a.recipient_id = $1 and a.organization_id = $2 and a.alert_type = '${EXECUTION_BLOCKED_ALERT_TYPE}' and a.status <> 'EXPIRED'`,
      [viewerId, organizationId],
    )
    return result.rows
  }

  /** Nome e etapa só dos avisos que a lista vai mostrar. A etapa é procurada no banco: o grafo não trafega. */
  async loadBlockedNoticeDetails(organizationId: string, keys: { workflowId: string; nodeId: string }[]): Promise<BlockedNoticeDetail[]> {
    const result = await this.db.query<BlockedNoticeDetail>(
      `select k.workflow_id "workflowId", k.node_id "nodeId", w.name "workflowName",
              (select node->>'label'
               from workflow_versions v cross join lateral jsonb_array_elements(v.graph->'nodes') node
               where v.id = w.active_version_id and node->>'id' = k.node_id limit 1) "stepLabel"
       from unnest($2::uuid[], $3::text[]) k(workflow_id, node_id)
       join workflows w on w.id = k.workflow_id and w.organization_id = $1`,
      [organizationId, keys.map((key) => key.workflowId), keys.map((key) => key.nodeId)],
    )
    return result.rows
  }

  async loadRecentAlerts(viewerId: string, organizationId: string, limit: number, allowedBlockedWorkflowIds: readonly string[] = []): Promise<AlertRow[]> {
    const result = await this.db.query<{ id: string; alert_type: string; title: string; description: string; severity: AlertRow["severity"]; status: string; created_at: string; read_at: string | null; case_id: string | null; dedupe_key: string; operator_id: string | null; operator_name: string | null; conversation_id: string | null }>(
      `select a.id, a.alert_type, a.title, a.description, a.severity, a.status::text, a.created_at, a.read_at, a.case_id, a.dedupe_key, c.operator_id, p.name operator_name, wo.conversation_id
       from alerts a left join supervision_cases c on c.id = a.case_id left join people p on p.id = c.operator_id
       left join workflow_outputs wo on a.alert_type = 'WORKFLOW_CHAT_MESSAGE' and wo.id = ${alertOutputIdSql("a", CHAT_ALERT_KEY_PREFIX)}
       where a.recipient_id = $1 and a.organization_id = $2 and a.status <> 'EXPIRED' and ${SHOWN_CONDITION} and ${visibleNoticeCondition("$4")}
       order by a.created_at desc limit $3`,
      [viewerId, organizationId, limit, allowedBlockedWorkflowIds],
    )
    return result.rows.map((row) => ({
      id: row.id,
      alertType: row.alert_type,
      title: row.title,
      description: row.description,
      severity: row.severity,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      caseId: row.case_id,
      dedupeKey: row.dedupe_key,
      operator: row.operator_id ? { personId: row.operator_id, name: row.operator_name ?? "" } : null,
      conversationId: row.conversation_id,
    }))
  }

  async countUnread(viewerId: string, organizationId: string, allowedBlockedWorkflowIds: readonly string[] = []): Promise<number> {
    const result = await this.db.query<{ unread: number }>(`select count(*)::int unread from alerts a where a.recipient_id = $1 and a.organization_id = $2 and ${UNREAD_CONDITION} and ${visibleNoticeCondition("$3")}`, [viewerId, organizationId, allowedBlockedWorkflowIds])
    return Number(result.rows[0]?.unread ?? 0)
  }

  async markRead(viewerId: string, organizationId: string, alertId: string, allowedBlockedWorkflowIds: readonly string[] = []): Promise<boolean> {
    const result = await this.db.query(
      `update alerts a set read_at = coalesce(a.read_at, now()), status = case when a.status = 'OPEN' then 'SEEN'::alert_status else a.status end
       where a.id = $3 and a.recipient_id = $1 and a.organization_id = $2 and ${visibleNoticeCondition("$4")}`,
      [viewerId, organizationId, alertId, allowedBlockedWorkflowIds],
    )
    return (result.rowCount ?? 0) > 0
  }

  // Só o que a pessoa vê: um aviso escondido por falta de permissão continua não lido, e volta assim se ela recuperar o acesso.
  async markAllRead(viewerId: string, organizationId: string, allowedBlockedWorkflowIds: readonly string[] = []): Promise<number> {
    const result = await this.db.query(
      `update alerts a set read_at = now(), status = case when a.status = 'OPEN' then 'SEEN'::alert_status else a.status end
       where a.recipient_id = $1 and a.organization_id = $2 and ${UNREAD_CONDITION} and ${visibleNoticeCondition("$3")}`,
      [viewerId, organizationId, allowedBlockedWorkflowIds],
    )
    return result.rowCount ?? 0
  }
}
