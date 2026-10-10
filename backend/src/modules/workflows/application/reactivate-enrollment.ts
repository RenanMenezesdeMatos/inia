import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * V1.5.12 — REATIVA uma matrícula que ESPERA num nó (hoje: "Gerar feedback" retido para QA de exceção). Mesmo mecanismo da
 * decisão de Revisão humana (`submit-human-review-decision.ts`): o Workflow continua dono da sequência — quem decide
 * libera; o motor retoma a MESMA matrícula no próximo tick (`next_eval_at = now()`), nunca uma chamada síncrona.
 *
 * Condicional (idempotente e à prova de corrida): só muda a matrícula da organização que ainda está `waiting` NAQUELE nó.
 * Já reativada, concluída, em outro nó ou de outra organização = nada muda (false). O evento é gravado uma vez por motivo.
 */
export async function reactivateWaitingEnrollment(db: Pick<Database, "query">, input: { organizationId: string; enrollmentId: string; nodeId: string; reason: string; payload?: Record<string, unknown> }): Promise<boolean> {
  const updated = await db.query(
    `update workflow_enrollments
     set status = 'active', next_eval_at = now(), claimed_until = null, revision = revision + 1, updated_at = now()
     where id = $1 and organization_id = $2 and status = 'waiting' and current_node_id = $3`,
    [input.enrollmentId, input.organizationId, input.nodeId],
  )
  if ((updated.rowCount ?? 0) === 0) return false
  await db.query(
    `insert into workflow_enrollment_events(enrollment_id, node_id, event_type, payload, idempotency_key)
     values ($1, $2, $3, $4, $5)
     on conflict (enrollment_id, idempotency_key) do nothing`,
    [input.enrollmentId, input.nodeId, input.reason, JSON.stringify(input.payload ?? {}), `${input.nodeId}:${input.reason}`],
  )
  return true
}
