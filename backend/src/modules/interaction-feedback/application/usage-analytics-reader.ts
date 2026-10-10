import type { Database } from "../../../infrastructure/database/pool.js"
import type { SqlParams } from "../../../shared/infrastructure/sql-params.js"

/**
 * LEITOR ANALÍTICO das entregas de feedback de atendimento (Monitoria de usabilidade). Mesmas colunas de
 * `publishedFeedbackSourcesSql` (feedbacks): source_kind ('INTERACTION_FEEDBACK_DELIVERY'), source_id, recipient_person_id,
 * feedback_kind ('MONITORING' — o feedback de atendimento é sempre de uma interação), available_at (delivered_at),
 * acknowledged_at, case_id (null).
 */
type Queryable = Pick<Database, "query">

export function deliveredInteractionFeedbackSourcesSql(p: SqlParams, organizationId: string): string {
  return `select 'INTERACTION_FEEDBACK_DELIVERY'::text source_kind, d.id source_id, d.collaborator_id recipient_person_id, 'MONITORING'::text feedback_kind,
      d.delivered_at available_at, d.acknowledged_at, null::uuid case_id
    from interaction_feedback_deliveries d
    where d.organization_id = ${p.typed(organizationId, "uuid")} and d.delivered_at is not null`
}

export async function recipientsOfDeliveries(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = await db.query<{ id: string; collaborator_id: string }>(`select id, collaborator_id from interaction_feedback_deliveries where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...new Set(ids)]])
  return new Map(result.rows.map((row) => [row.id, row.collaborator_id]))
}
