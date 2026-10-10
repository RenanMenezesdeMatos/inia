import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * V1.5.9 — MÉTRICAS da política de entrega (sem dashboard): tudo já está persistido por item em
 * `interaction_feedback_delivery_decisions` (política, seção, tipo de achado, disposição, motivos, autonomia, entrega real) e
 * `interaction_feedback_item_reviews` (resultado do QA). Duas agregações por SQL, escopadas à organização:
 *   - destino × resultado: quantos AUTO_DELIVER / HOLD_FOR_QA / BLOCKED por política × seção × tipo, quantos foram entregues e
 *     o que o QA fez com os que foram para QA (aprovado, editado, rejeitado, pendente);
 *   - motivos: contagem de cada motivo estruturado por política × disposição.
 */
export type DeliveryOutcomeRow = { policyVersion: string; section: string; findingKind: string; disposition: string; qaStatus: string | null; autonomyEligible: boolean | null; delivered: number; items: number }
export type DeliveryReasonRow = { policyVersion: string; disposition: string; reason: string; items: number }
export type FeedbackDeliveryMetrics = { outcomes: DeliveryOutcomeRow[]; reasons: DeliveryReasonRow[] }

export async function loadFeedbackDeliveryMetrics(db: Pick<Database, "query">, input: { organizationId: string; runIds?: readonly string[]; since?: Date }): Promise<FeedbackDeliveryMetrics> {
  const params = [input.organizationId, input.runIds ?? null, input.since ?? null]
  const scope = `d.organization_id = $1 and ($2::uuid[] is null or d.run_id = any($2::uuid[])) and ($3::timestamptz is null or d.created_at >= $3)`
  const [outcomes, reasons] = await Promise.all([
    db.query<DeliveryOutcomeRow>(
      `select d.policy_version "policyVersion", d.section, d.finding_kind "findingKind", d.disposition, r.review_status "qaStatus", d.autonomy_eligible "autonomyEligible",
              count(*) filter (where d.delivered_at is not null)::int delivered, count(*)::int items
       from interaction_feedback_delivery_decisions d left join interaction_feedback_item_reviews r on r.id = d.item_review_id
       where ${scope}
       group by 1, 2, 3, 4, 5, 6 order by 1, 2, 3, 4, 5, 6`,
      params,
    ),
    db.query<DeliveryReasonRow>(
      `select d.policy_version "policyVersion", d.disposition, reason, count(*)::int items
       from interaction_feedback_delivery_decisions d cross join lateral unnest(d.reasons) reason
       where ${scope}
       group by 1, 2, 3 order by 1, 2, 3`,
      params,
    ),
  ])
  return { outcomes: outcomes.rows, reasons: reasons.rows }
}
