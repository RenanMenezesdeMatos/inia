import type { Database } from "../../../infrastructure/database/pool.js"
import type { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { visibleInFollowUpSql } from "./follow-up-visibility.js"

/**
 * LEITOR ANALÍTICO dos feedbacks publicados (Monitoria de usabilidade). Fonte oficial da disponibilização e da ciência:
 * `published_at` e `acknowledged_at`. Feedback ocultado do Acompanhamento não conta como disponibilizado ao destinatário.
 *
 * Colunas de `publishedFeedbackSourcesSql`: source_kind ('PUBLISHED_FEEDBACK'), source_id, recipient_person_id, feedback_kind
 * ('INDICATOR' | 'MONITORING'), available_at (published_at), acknowledged_at, case_id.
 */
type Queryable = Pick<Database, "query">

export function publishedFeedbackSourcesSql(p: SqlParams, organizationId: string): string {
  return `select 'PUBLISHED_FEEDBACK'::text source_kind, f.id source_id, f.operator_id recipient_person_id, f.feedback_kind::text feedback_kind,
      f.published_at available_at, f.acknowledged_at, f.case_id
    from feedbacks f
    where f.organization_id = ${p.typed(organizationId, "uuid")} and f.published_at is not null and f.status::text in ('PUBLISHED', 'ACKNOWLEDGED') and ${visibleInFollowUpSql("f")}`
}

/** Destinatário de cada feedback publicado (validação de eventos do navegador). */
export async function recipientsOfFeedbacks(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = await db.query<{ id: string; operator_id: string }>(`select id, operator_id from feedbacks where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...new Set(ids)]])
  return new Map(result.rows.map((row) => [row.id, row.operator_id]))
}
