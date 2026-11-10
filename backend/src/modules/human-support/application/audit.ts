import type { Queryable } from "./locks.js"

/** Auditoria do Apoio com Anjo em `audit_logs` (só ids e códigos, nunca conteúdo de conversa). */
export type HumanSupportAuditAction = "HUMAN_SUPPORT_SETTINGS_CHANGED" | "HUMAN_SUPPORT_SCOPE_STATE_CHANGED" | "HUMAN_SUPPORT_CAPACITY_CHANGED" | "HUMAN_SUPPORT_ATTENDANCE_CLASSIFIED"

export async function recordHumanSupportAudit(db: Queryable, entry: { organizationId: string; actorPersonId: string; action: HumanSupportAuditAction; entityType: string; entityId: string; payload: Record<string, unknown> }): Promise<void> {
  await db.query(
    `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, $3, $4, $5, $6, statement_timestamp())`,
    [entry.organizationId, entry.actorPersonId, entry.action, entry.entityType, entry.entityId, JSON.stringify(entry.payload)],
  )
}
