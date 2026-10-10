import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * LEITOR ANALÍTICO das entregas de Workflow em Chat/Avatar (Monitoria de usabilidade). `workflow_outputs` é o registro
 * oficial: entregue (DELIVERED/delivered_at), convite oferecido/aceito/tocado, falhas.
 *
 * Colunas de `workflowOutputsSql`: output_id, enrollment_id, recipient_person_id, surface, delivery_status, created_at,
 * delivered_at, offered_at, accepted_at, playing_at, failed_at, conversation_id.
 */
type Queryable = Pick<Database, "query">

export async function recipientsOfWorkflowOutputs(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = await db.query<{ id: string; recipient_id: string }>(`select id, recipient_id from workflow_outputs where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...new Set(ids)]])
  return new Map(result.rows.map((row) => [row.id, row.recipient_id]))
}

export function workflowOutputsSql(organizationParam: string): string {
  return `select o.id output_id, o.enrollment_id, o.recipient_id recipient_person_id, o.surface, o.delivery_status, o.created_at, o.delivered_at,
      o.offered_at, o.accepted_at, o.playing_at, o.failed_at, o.conversation_id
    from workflow_outputs o where o.organization_id = ${organizationParam}`
}
