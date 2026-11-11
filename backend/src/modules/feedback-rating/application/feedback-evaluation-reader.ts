import type { Database } from "../../../infrastructure/database/pool.js"
import { sourceKey, type FeedbackSourceRef } from "../../feedback-application/domain/feedback-application.js"
import { EMPTY_EVALUATION, type ContestationDecision, type ContestationReason, type ContestationReviewView, type FeedbackEvaluationView, type ReadAgreementValue } from "../domain/feedback-rating.js"

/**
 * AVALIAÇÃO DO ITEM do Acompanhamento do PRÓPRIO colaborador: a escolha registrada na ciência (com a resposta da revisão, se
 * discordou e já foi respondido) e a avaliação "não foi útil" antiga ainda vigente (com a resposta). Só lê o que é da PESSOA DA
 * SESSÃO — quem chama passa a identidade da sessão, nunca a de outra pessoa (a liderança vê só o estado da ciência). Recebe as
 * fontes de UMA página do feed (duas consultas por página, nunca a lista inteira da pessoa).
 */
type Queryable = Pick<Database, "query">
export type EvaluationReader = { organizationId: string; personId: string }

type ReviewColumns = { review_decision: ContestationDecision | null; review_response: string | null; review_created_at: Date | null }
const reviewOf = (row: ReviewColumns): ContestationReviewView | null =>
  row.review_decision && row.review_response && row.review_created_at ? { decision: row.review_decision, response: row.review_response, respondedAt: new Date(row.review_created_at).toISOString() } : null
const keyOf = (row: { feedback_id: string | null; interaction_delivery_id: string | null }) =>
  row.feedback_id ? sourceKey({ kind: "PUBLISHED_FEEDBACK", id: row.feedback_id }) : sourceKey({ kind: "INTERACTION_FEEDBACK_DELIVERY", id: row.interaction_delivery_id! })

export async function loadFeedbackEvaluations(db: Queryable, reader: EvaluationReader, sources: readonly FeedbackSourceRef[]): Promise<Map<string, FeedbackEvaluationView>> {
  const evaluations = new Map<string, FeedbackEvaluationView>()
  const feedbackIds = sources.filter((source) => source.kind === "PUBLISHED_FEEDBACK").map((source) => source.id)
  const deliveryIds = sources.filter((source) => source.kind === "INTERACTION_FEEDBACK_DELIVERY").map((source) => source.id)
  if (feedbackIds.length === 0 && deliveryIds.length === 0) return evaluations
  const params = [reader.organizationId, reader.personId, feedbackIds, deliveryIds]
  const forSources = "(x.feedback_id = any($3::uuid[]) or x.interaction_delivery_id = any($4::uuid[]))"
  const entry = (key: string) => evaluations.get(key) ?? { ...EMPTY_EVALUATION }

  const agreements = await db.query<{ feedback_id: string | null; interaction_delivery_id: string | null; agreement: ReadAgreementValue; reason: ContestationReason | null; justification: string | null; created_at: Date } & ReviewColumns>(
    `select x.feedback_id, x.interaction_delivery_id, x.agreement, x.reason, x.justification, x.created_at,
            rv.decision review_decision, rv.response review_response, rv.created_at review_created_at
       from feedback_read_agreements x
       left join feedback_rating_reviews rv on rv.agreement_id = x.id
      where x.organization_id = $1 and x.person_id = $2 and ${forSources}`,
    params,
  )
  for (const row of agreements.rows) {
    const key = keyOf(row)
    evaluations.set(key, { ...entry(key), agreement: { value: row.agreement, reason: row.reason, justification: row.justification, recordedAt: new Date(row.created_at).toISOString(), review: reviewOf(row) } })
  }

  // Contestação antiga = avaliação "não foi útil" que o colaborador não trocou nem retirou (a mesma definição da fila).
  const legacy = await db.query<{ feedback_id: string | null; interaction_delivery_id: string | null; reason: ContestationReason; comment: string; created_at: Date } & ReviewColumns>(
    `select x.feedback_id, x.interaction_delivery_id, x.reason, x.comment, x.created_at, x.review_decision, x.review_response, x.review_created_at
       from feedback_contestations x
      where x.origin = 'USEFULNESS_RATING' and x.superseded_at is null and x.organization_id = $1 and x.person_id = $2 and ${forSources}`,
    params,
  )
  for (const row of legacy.rows) {
    const key = keyOf(row)
    evaluations.set(key, { ...entry(key), legacyContestation: { reason: row.reason, comment: row.comment, contestedAt: new Date(row.created_at).toISOString(), review: reviewOf(row) } })
  }
  return evaluations
}

/** Atalho para uma fonte (resultado da confirmação de ciência). */
export async function loadFeedbackEvaluation(db: Queryable, reader: EvaluationReader, source: FeedbackSourceRef): Promise<FeedbackEvaluationView> {
  return (await loadFeedbackEvaluations(db, reader, [source])).get(sourceKey(source)) ?? { ...EMPTY_EVALUATION }
}
