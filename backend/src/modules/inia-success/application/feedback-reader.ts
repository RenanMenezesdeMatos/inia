import { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import { scopedPeopleSql } from "../../access/application/scope-people-reader.js"
import { publishedFeedbackSourcesSql } from "../../feedbacks/application/usage-analytics-reader.js"
// Ponto único de leitura das entregas de feedback de atendimento fora do módulo (somente leitura).
import { deliveredInteractionFeedbackSourcesSql } from "../../usage-analytics/application/feedback-sources.js"
import { CONTESTATION_DECISION_LABELS, CONTESTATION_REASON_LABELS, CONTESTATION_REASONS, type ContestationReason } from "../../feedback-rating/domain/feedback-rating.js"
import { foldByBucket, rate, type Bucket, type Rate } from "../domain/success-metrics.js"
import { boundsCte, placementFilter, type Queryable, type SuccessQuery, type SuccessViewer } from "./success-query.js"

/**
 * FEEDBACKS DA INIA AVALIADOS PELO COLABORADOR — ciência, "Este conteúdo foi útil?" e a revisão das contestações. Coorte = feedbacks
 * DISPONIBILIZADOS no período (data local) a pessoas do alcance de `feedback_contestations.review`, menos os do próprio leitor (ninguém
 * revisa a própria contestação) — feedbacks publicados no Acompanhamento e entregas de feedback de atendimento, pelas leituras oficiais
 * da Monitoria de usabilidade. Numerador e denominador são SEMPRE do mesmo conjunto de feedbacks (o estado de hoje de cada um).
 *
 * Quatro coisas diferentes, nunca misturadas:
 *  - CIÊNCIA = o próprio colaborador confirmou com login e senha que LEU (`acknowledged_at`). Não é concordância nem utilidade.
 *  - AVALIAÇÃO = a VIGENTE ("útil" / "não foi útil"); retirada (`NONE`) não é avaliação; trocas ficam no histórico (contadas à parte).
 *  - CONTESTAÇÃO = a mesma regra da fila de contestações (visão `feedback_contestations`, migration 186): a DISCORDÂNCIA registrada na
 *    ciência ou, antes dela, um "não foi útil" vigente OU já respondido pela revisão; "não foi útil" retirado sem resposta não conta.
 *    Cada feedback conta uma vez, com a contestação mais recente.
 *  - REVISÃO = a decisão humana sobre a contestação: procedente, procedente em parte ou feedback mantido. "Procedente" = a contestação
 *    tinha razão (não é aprovação do feedback). Pendente = ainda sem decisão (fora do denominador da procedência).
 * Concordância: registrada na ciência desde a migration 186 (`feedback_read_agreements`); a discordância já entra como contestação,
 * mas a taxa de concordância ainda não é exibida aqui (`agreement.status` continua NOT_COLLECTED até a tela ganhar esse bloco).
 */
export type FeedbackCounts = { delivered: number; acknowledged: number; up: number; down: number; withdrawn: number; changed: number; contested: number; pending: number; accepted: number; partial: number; rejected: number }
export type FeedbackKindSummary = { kind: "INDICATOR" | "MONITORING"; counts: FeedbackCounts; contestation: Rate; positive: Rate }
export type FeedbackSummary = {
  counts: FeedbackCounts
  acknowledgement: Rate
  ratingRate: Rate
  positive: Rate
  negative: Rate
  contestation: Rate
  reviewed: number
  procedence: { accepted: Rate; partial: Rate; rejected: Rate }
  reasons: { reason: ContestationReason; label: string; count: number; share: Rate }[]
  decisionLabels: Record<string, string>
  byKind: FeedbackKindSummary[]
  agreement: { status: "NOT_COLLECTED" }
  series: { bucket: Bucket; delivered: number; contested: number; up: number; down: number; contestation: Rate; positive: Rate }[]
}

const emptyCounts = (): FeedbackCounts => ({ delivered: 0, acknowledged: 0, up: 0, down: 0, withdrawn: 0, changed: 0, contested: 0, pending: 0, accepted: 0, partial: 0, rejected: 0 })
type DayRow = { day: string; feedback_kind: string; delivered: number; acknowledged: number; up: number; down: number; withdrawn: number; changed: number; contested: number; pending: number; accepted: number; partial: number; rejected: number }
const COUNT_KEYS = Object.keys(emptyCounts()) as (keyof FeedbackCounts)[]

export async function feedbackSummary(db: Queryable, viewer: SuccessViewer, query: SuccessQuery): Promise<FeedbackSummary> {
  const p = new SqlParams()
  const org = p.typed(viewer.organizationId, "uuid")
  const self = p.typed(viewer.personId, "uuid")
  const bounds = boundsCte(p, viewer.organizationId, query)
  const sources = `${publishedFeedbackSourcesSql(p, viewer.organizationId)} union all ${deliveredInteractionFeedbackSourcesSql(p, viewer.organizationId)}`
  const scope = scopedPeopleSql(p, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, permission: "feedback_contestations.review" })
  const placed = placementFilter(p, query)
  const result = await db.query<{ days: DayRow[] | null; reasons: { reason: ContestationReason; count: number }[] | null }>(
    `with ${bounds},
     cohort as (
       select src.source_kind, src.source_id, src.recipient_person_id, src.feedback_kind, src.acknowledged_at,
              to_char((src.available_at at time zone b.tz)::date, 'YYYY-MM-DD') as day
         from (${sources}) src
         cross join bounds b
         join people p on p.id = src.recipient_person_id
         left join subteams st on st.id = p.subteam_id
        where src.available_at >= b.starts and src.available_at < b.ends
          and src.recipient_person_id <> ${self} and src.recipient_person_id in (${scope}) and ${placed}
     ),
     history as (
       select c.source_kind, c.source_id, r.id, r.value, r.reason, r.created_at, r.superseded_at, rv.decision
         from cohort c
         join feedback_ratings r on r.organization_id = ${org} and r.person_id = c.recipient_person_id and r.source_kind = c.source_kind
          and coalesce(r.feedback_id, r.interaction_delivery_id) = c.source_id
         left join feedback_rating_reviews rv on rv.rating_id = r.id
     ),
     current_rating as (
       select distinct on (source_kind, source_id) source_kind, source_id, value
         from history where superseded_at is null order by source_kind, source_id, created_at desc, id desc
     ),
     contested as (
       select distinct on (c.source_kind, c.source_id) c.source_kind, c.source_id, fc.reason, fc.review_decision decision
         from cohort c
         join feedback_contestations fc on fc.organization_id = ${org} and fc.person_id = c.recipient_person_id and fc.source_kind = c.source_kind
          and coalesce(fc.feedback_id, fc.interaction_delivery_id) = c.source_id
        where fc.superseded_at is null or fc.review_id is not null
        order by c.source_kind, c.source_id, fc.created_at desc, fc.id desc
     ),
     versions as (select source_kind, source_id, count(*) n from history group by source_kind, source_id),
     items as (
       select c.day, c.feedback_kind, c.acknowledged_at, cr.value current_value, coalesce(v.n, 0) versions,
              ct.source_id is not null contested, ct.reason contest_reason, ct.decision
         from cohort c
         left join current_rating cr on cr.source_kind = c.source_kind and cr.source_id = c.source_id
         left join contested ct on ct.source_kind = c.source_kind and ct.source_id = c.source_id
         left join versions v on v.source_kind = c.source_kind and v.source_id = c.source_id
     ),
     by_day as (
       select day, feedback_kind, count(*)::int delivered,
              count(*) filter (where acknowledged_at is not null)::int acknowledged,
              count(*) filter (where current_value = 'UP')::int up,
              count(*) filter (where current_value = 'DOWN')::int down,
              count(*) filter (where current_value = 'NONE')::int withdrawn,
              count(*) filter (where versions > 1)::int changed,
              count(*) filter (where contested)::int contested,
              count(*) filter (where contested and decision is null)::int pending,
              count(*) filter (where decision = 'ACCEPTED')::int accepted,
              count(*) filter (where decision = 'PARTIALLY_ACCEPTED')::int partial,
              count(*) filter (where decision = 'REJECTED')::int rejected
         from items group by day, feedback_kind
     )
     select (select json_agg(by_day) from by_day) days,
            (select json_agg(x) from (select contest_reason reason, count(*)::int count from items where contested group by contest_reason) x) reasons`,
    p.values,
  )
  const row = result.rows[0]!
  const days = row.days ?? []
  const sum = (rows: readonly DayRow[]): FeedbackCounts => {
    const totals = emptyCounts()
    for (const day of rows) for (const key of COUNT_KEYS) totals[key] += Number(day[key] ?? 0)
    return totals
  }
  const counts = sum(days)
  const reviewed = counts.accepted + counts.partial + counts.rejected
  const reasonCounts = new Map((row.reasons ?? []).map((entry) => [entry.reason, entry.count]))
  const series = foldByBucket(days, query, () => ({ delivered: 0, contested: 0, up: 0, down: 0 }), (totals, day) => {
    totals.delivered += day.delivered
    totals.contested += day.contested
    totals.up += day.up
    totals.down += day.down
  }).map(({ bucket, totals }) => ({ bucket, ...totals, contestation: rate(totals.contested, totals.delivered), positive: rate(totals.up, totals.up + totals.down) }))
  return {
    counts,
    acknowledgement: rate(counts.acknowledged, counts.delivered),
    ratingRate: rate(counts.up + counts.down, counts.delivered),
    positive: rate(counts.up, counts.up + counts.down),
    negative: rate(counts.down, counts.up + counts.down),
    contestation: rate(counts.contested, counts.delivered),
    reviewed,
    procedence: { accepted: rate(counts.accepted, reviewed), partial: rate(counts.partial, reviewed), rejected: rate(counts.rejected, reviewed) },
    // Uma contestação tem um motivo só: as parcelas somam 100% das contestações.
    reasons: CONTESTATION_REASONS.map((reason) => ({ reason, label: CONTESTATION_REASON_LABELS[reason], count: reasonCounts.get(reason) ?? 0, share: rate(reasonCounts.get(reason) ?? 0, counts.contested) }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count),
    decisionLabels: { ...CONTESTATION_DECISION_LABELS },
    byKind: (["INDICATOR", "MONITORING"] as const).map((kind) => {
      const kindCounts = sum(days.filter((day) => day.feedback_kind === kind))
      return { kind, counts: kindCounts, contestation: rate(kindCounts.contested, kindCounts.delivered), positive: rate(kindCounts.up, kindCounts.up + kindCounts.down) }
    }),
    agreement: { status: "NOT_COLLECTED" },
    series,
  }
}
