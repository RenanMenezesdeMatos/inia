import type { Database } from "../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { publishedFeedbackSourcesSql } from "../../feedbacks/application/usage-analytics-reader.js"
import { deliveredInteractionFeedbackSourcesSql } from "../../usage-analytics/application/feedback-sources.js"
import { CONTESTATION_DECISIONS, FEEDBACK_DISLIKE_REASON_LABELS, FEEDBACK_DISLIKE_REASONS, type ContestationDecision, type FeedbackDislikeReason } from "../domain/feedback-rating.js"
import type { Reviewer } from "./contestation-review-service.js"

/**
 * TAXA DE CONTESTAÇÃO DOS FEEDBACKS (KPI pedido pela gestão em 2026-11-10). Coorte = feedbacks DISPONIBILIZADOS no período (data
 * local da organização) a pessoas do escopo de quem revisa, menos as do próprio revisor — feedbacks publicados no Acompanhamento e
 * entregas de feedback de atendimento, pelas MESMAS leituras da Monitoria de usabilidade (os números batem entre as telas).
 * Contestado = o destinatário marcou "não foi útil" (com motivo e descrição) e a contestação está vigente ou já foi respondida — a
 * mesma regra da fila de contestações; retirada sem resposta não conta. Taxa = contestados ÷ disponibilizados, só com 5 ou mais
 * feedbacks (abaixo disso aparece a contagem, nunca uma porcentagem frágil; sem nenhum, "sem dados"). Cada feedback conta uma vez,
 * com a contestação mais recente (motivo e situação da resposta).
 */
type Queryable = Pick<Database, "query">

export const CONTESTATION_RATE_MIN_SAMPLE = 5
const PERMISSION = "feedback_contestations.review" as const

export type ContestationSummary = {
  from: string
  to: string
  /** Feedbacks disponibilizados no período (coorte). */
  delivered: number
  /** Destes, quantos foram contestados. */
  contested: number
  /** contested ÷ delivered; null com menos de `CONTESTATION_RATE_MIN_SAMPLE` feedbacks. */
  rate: number | null
  byReason: { reason: FeedbackDislikeReason; label: string; count: number }[]
  byStatus: { pending: number } & Record<ContestationDecision, number>
}

export async function contestationSummary(db: Queryable, reviewer: Reviewer, period: { from: string; to: string }): Promise<ContestationSummary> {
  const p = new SqlParams()
  const org = p.typed(reviewer.organizationId, "uuid")
  const viewer = p.typed(reviewer.personId, "uuid")
  const from = p.typed(period.from, "date")
  const to = p.typed(period.to, "date")
  const sources = `${publishedFeedbackSourcesSql(p, reviewer.organizationId)} union all ${deliveredInteractionFeedbackSourcesSql(p, reviewer.organizationId)}`
  const scope = scopedPeopleSql(p, { organizationId: reviewer.organizationId, viewerPersonId: reviewer.personId, permission: PERMISSION })
  const result = await db.query<{ delivered: number; reason: FeedbackDislikeReason | null; decision: ContestationDecision | null; contested: boolean }>(
    `with bounds as (
       select (${from})::timestamp at time zone analytics_org_timezone(${org}) starts_at, (${to} + 1)::timestamp at time zone analytics_org_timezone(${org}) ends_at
     ), cohort as (
       select src.source_kind, src.source_id, src.recipient_person_id
         from (${sources}) src cross join bounds b
        where src.available_at >= b.starts_at and src.available_at < b.ends_at
          and src.recipient_person_id <> ${viewer} and src.recipient_person_id in (${scope})
     ), contested as (
       select distinct on (c.source_kind, c.source_id) c.source_kind, c.source_id, r.reason, rv.decision
         from cohort c
         join feedback_ratings r on r.organization_id = ${org} and r.person_id = c.recipient_person_id and r.source_kind = c.source_kind
          and coalesce(r.feedback_id, r.interaction_delivery_id) = c.source_id
         left join feedback_rating_reviews rv on rv.rating_id = r.id
        where r.value = 'DOWN' and (r.superseded_at is null or rv.id is not null)
        order by c.source_kind, c.source_id, r.created_at desc, r.id desc
     )
     select (select count(*)::int from cohort) delivered, ct.reason, ct.decision, ct.source_id is not null contested
       from (select 1) one left join contested ct on true`,
    p.values,
  )
  const delivered = result.rows[0]?.delivered ?? 0
  const rows = result.rows.filter((row) => row.contested)
  const reasonCounts = new Map<FeedbackDislikeReason, number>()
  const byStatus: ContestationSummary["byStatus"] = { pending: 0, ...(Object.fromEntries(CONTESTATION_DECISIONS.map((decision) => [decision, 0])) as Record<ContestationDecision, number>) }
  for (const row of rows) {
    if (row.reason) reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1)
    if (row.decision) byStatus[row.decision] += 1
    else byStatus.pending += 1
  }
  const contested = rows.length
  return {
    from: period.from,
    to: period.to,
    delivered,
    contested,
    rate: delivered >= CONTESTATION_RATE_MIN_SAMPLE ? contested / delivered : null,
    // Do maior para o menor (empate na ordem do catálogo), como nos demais cards de motivo.
    byReason: FEEDBACK_DISLIKE_REASONS.map((reason) => ({ reason, label: FEEDBACK_DISLIKE_REASON_LABELS[reason], count: reasonCounts.get(reason) ?? 0 }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count),
    byStatus,
  }
}
