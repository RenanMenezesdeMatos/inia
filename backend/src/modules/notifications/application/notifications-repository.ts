import type { Database } from "../../../infrastructure/database/pool.js"
import { recadoAlertCoveredByFollowUpSql } from "../../conversational-delivery/application/recado-follow-up-invite.js"

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

export interface NotificationsRepository {
  loadRecentAlerts(viewerId: string, organizationId: string, limit: number): Promise<AlertRow[]>
  countUnread(viewerId: string, organizationId: string): Promise<number>
  /** Marca como lida SÓ se o alerta for do viewer — devolve false quando não é dele. */
  markRead(viewerId: string, organizationId: string, alertId: string): Promise<boolean>
  markAllRead(viewerId: string, organizationId: string): Promise<number>
}

/**
 * Aviso que o sino mostra. "Um convite só": o aviso de recado de voz cujo recado ficou coberto pelo Acompanhamento (o mesmo
 * Output/artefato virou feedback publicado — quem convida é a aplicação de feedback) não aparece nem conta — é a MESMA regra
 * que tira o recado do inbox (recado-follow-up-invite.ts), então o sino nunca aponta para um convite que não existe.
 */
const SHOWN_CONDITION = `not ${recadoAlertCoveredByFollowUpSql("a")}`

/** Não lido = sem `read_at` e ainda vivo (resolvido/expirado não conta no badge). */
const UNREAD_CONDITION = `a.read_at is null and a.status in ('OPEN', 'SEEN', 'ACKNOWLEDGED') and ${SHOWN_CONDITION}`

export class PgNotificationsRepository implements NotificationsRepository {
  constructor(private readonly db: Database) {}

  async loadRecentAlerts(viewerId: string, organizationId: string, limit: number): Promise<AlertRow[]> {
    const result = await this.db.query<{ id: string; alert_type: string; title: string; description: string; severity: AlertRow["severity"]; status: string; created_at: string; read_at: string | null; case_id: string | null; dedupe_key: string; operator_id: string | null; operator_name: string | null; conversation_id: string | null }>(
      `select a.id, a.alert_type, a.title, a.description, a.severity, a.status::text, a.created_at, a.read_at, a.case_id, a.dedupe_key, c.operator_id, p.name operator_name, wo.conversation_id
       from alerts a left join supervision_cases c on c.id = a.case_id left join people p on p.id = c.operator_id
       left join workflow_outputs wo on a.alert_type = 'WORKFLOW_CHAT_MESSAGE' and a.dedupe_key = 'workflow_chat:' || wo.id::text
       where a.recipient_id = $1 and a.organization_id = $2 and a.status <> 'EXPIRED' and ${SHOWN_CONDITION}
       order by a.created_at desc limit $3`,
      [viewerId, organizationId, limit],
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

  async countUnread(viewerId: string, organizationId: string): Promise<number> {
    const result = await this.db.query<{ unread: number }>(`select count(*)::int unread from alerts a where a.recipient_id = $1 and a.organization_id = $2 and ${UNREAD_CONDITION}`, [viewerId, organizationId])
    return Number(result.rows[0]?.unread ?? 0)
  }

  async markRead(viewerId: string, organizationId: string, alertId: string): Promise<boolean> {
    const result = await this.db.query(
      `update alerts a set read_at = coalesce(a.read_at, now()), status = case when a.status = 'OPEN' then 'SEEN'::alert_status else a.status end
       where a.id = $3 and a.recipient_id = $1 and a.organization_id = $2`,
      [viewerId, organizationId, alertId],
    )
    return (result.rowCount ?? 0) > 0
  }

  async markAllRead(viewerId: string, organizationId: string): Promise<number> {
    const result = await this.db.query(
      `update alerts a set read_at = now(), status = case when a.status = 'OPEN' then 'SEEN'::alert_status else a.status end
       where a.recipient_id = $1 and a.organization_id = $2 and ${UNREAD_CONDITION}`,
      [viewerId, organizationId],
    )
    return result.rowCount ?? 0
  }
}
