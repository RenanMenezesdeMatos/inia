import type { PoolClient } from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { FeedbackSourceKind, FeedbackSourceRef } from "../../feedback-application/domain/feedback-application.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { sameRating, type ContestationDecision, type FeedbackDislikeReason, type FeedbackRatingInput, type FeedbackRatingValue, type FeedbackRatingView } from "../domain/feedback-rating.js"
import { notifyContestationReviewers, resolveContestationAlerts } from "./contestation-review-service.js"

/** Sempre a pessoa da sessão: só o destinatário avalia o próprio feedback (de outra pessoa/organização = 404). */
export type RatingScope = { organizationId: string; personId: string }

type Queryable = Pick<Database, "query">
type RatingRow = {
  id: string
  source_kind: FeedbackSourceKind
  feedback_id: string | null
  interaction_delivery_id: string | null
  value: FeedbackRatingValue | "NONE"
  reason: FeedbackDislikeReason | null
  comment: string | null
  created_at: Date
  review_decision?: ContestationDecision | null
  review_response?: string | null
  review_created_at?: Date | null
}

const COLUMNS = "id, source_kind, feedback_id, interaction_delivery_id, value, reason, comment, created_at"
const sourceColumn = (kind: FeedbackSourceKind) => (kind === "PUBLISHED_FEEDBACK" ? "feedback_id" : "interaction_delivery_id")
const notFound = () => new DomainError("Feedback não encontrado.", "FEEDBACK_RATING_SOURCE_NOT_FOUND", 404)

function toView(row: RatingRow): FeedbackRatingView | null {
  if (row.value === "NONE") return null
  return {
    source: { kind: row.source_kind, id: (row.source_kind === "PUBLISHED_FEEDBACK" ? row.feedback_id : row.interaction_delivery_id)! },
    value: row.value,
    reason: row.reason,
    comment: row.comment,
    ratedAt: new Date(row.created_at).toISOString(),
    review: row.review_decision && row.review_response && row.review_created_at ? { decision: row.review_decision, response: row.review_response, respondedAt: new Date(row.review_created_at).toISOString() } : null,
  }
}

/** Fonte que a pessoa pode avaliar: o feedback publicado e visível no Acompanhamento dela, ou a entrega de atendimento dela. */
async function assertRateableSource(db: Queryable, scope: RatingScope, source: FeedbackSourceRef): Promise<void> {
  const result =
    source.kind === "PUBLISHED_FEEDBACK"
      ? await db.query(
          `select 1 from feedbacks f where f.id = $1 and f.organization_id = $2 and f.operator_id = $3 and f.status = 'PUBLISHED' and ${visibleInFollowUpSql("f")}`,
          [source.id, scope.organizationId, scope.personId],
        )
      : await db.query(`select 1 from interaction_feedback_deliveries d where d.id = $1 and d.organization_id = $2 and d.collaborator_id = $3`, [source.id, scope.organizationId, scope.personId])
  if (result.rows.length === 0) throw notFound()
}

async function inTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  // Já dentro de uma transação (prova/teste com cliente dedicado): savepoint em vez de begin.
  if (typeof (db as Partial<PoolClient>).release === "function") {
    const client = db as unknown as PoolClient
    await client.query("savepoint feedback_rating")
    try {
      const result = await work(client)
      await client.query("release savepoint feedback_rating")
      return result
    } catch (error) {
      await client.query("rollback to savepoint feedback_rating").catch(() => {})
      throw error
    }
  }
  const client = await db.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** Avaliações VIGENTES da pessoa (retiradas não aparecem), com a resposta da revisão quando houver. Uma por feedback avaliado. */
export async function listMyRatings(db: Queryable, scope: RatingScope): Promise<FeedbackRatingView[]> {
  const result = await db.query<RatingRow>(
    `select r.id, r.source_kind, r.feedback_id, r.interaction_delivery_id, r.value, r.reason, r.comment, r.created_at,
            rv.decision review_decision, rv.response review_response, rv.created_at review_created_at
       from feedback_ratings r
       left join feedback_rating_reviews rv on rv.rating_id = r.id
      where r.organization_id = $1 and r.person_id = $2 and r.superseded_at is null and r.value <> 'NONE'
      order by r.created_at desc`,
    [scope.organizationId, scope.personId],
  )
  return result.rows.map(toView).filter((view): view is FeedbackRatingView => view !== null)
}

/**
 * Grava a avaliação (ou a retirada, `NONE`) e devolve a vigente. Histórico: a anterior é encerrada, nunca reescrita. Idempotente:
 * a mesma avaliação já vigente não grava nada. Concorrência (duplo clique, outra aba): lock por pessoa × fonte na transação.
 */
export async function rateFeedback(db: Database, scope: RatingScope, input: FeedbackRatingInput, now: Date): Promise<FeedbackRatingView | null> {
  return inTransaction(db, async (client) => {
    await assertRateableSource(client, scope, input.source)
    const column = sourceColumn(input.source.kind)
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`feedback_rating:${scope.personId}:${input.source.kind}:${input.source.id}`])
    const current =
      (
        await client.query<RatingRow>(
          `select ${COLUMNS} from feedback_ratings where organization_id = $1 and person_id = $2 and ${column} = $3 and superseded_at is null`,
          [scope.organizationId, scope.personId, input.source.id],
        )
      ).rows[0] ?? null
    if (sameRating(current, input)) return current ? toView(current) : null
    if (current) {
      await client.query(`update feedback_ratings set superseded_at = $4 where organization_id = $1 and person_id = $2 and ${column} = $3 and superseded_at is null`, [
        scope.organizationId,
        scope.personId,
        input.source.id,
        now,
      ])
      // Contestação retirada ou trocada pelo colaborador: o aviso aos revisores deixa de pedir resposta.
      if (current.value === "DOWN") await resolveContestationAlerts(client, scope.organizationId, current.id, now)
    }
    const inserted = await client.query<RatingRow>(
      `insert into feedback_ratings (organization_id, person_id, source_kind, ${column}, value, reason, comment, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLUMNS}`,
      [
        scope.organizationId,
        scope.personId,
        input.source.kind,
        input.source.id,
        input.value,
        input.value === "DOWN" ? input.reason : null,
        input.value === "DOWN" ? input.comment : null,
        now,
      ],
    )
    const saved = inserted.rows[0]!
    // "Não foi útil" = contestação: quem revisa no escopo do colaborador é avisado no sino.
    if (input.value === "DOWN") await notifyContestationReviewers(client, { organizationId: scope.organizationId, ratingId: saved.id, collaboratorId: scope.personId, reason: input.reason, comment: input.comment, now })
    return toView(saved)
  })
}
