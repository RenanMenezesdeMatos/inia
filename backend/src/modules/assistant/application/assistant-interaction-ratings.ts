import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import {
  CHAT_DISLIKE_REASONS_VERSION,
  ratingView,
  shouldWriteRating,
  type AssistantRatingDetails,
  type AssistantRatingValue,
  type AssistantRatingView,
  type ChatDislikeReason,
  type CurrentRating,
} from "../domain/assistant-interaction-rating.js"
import type { ConversationOrigin } from "../domain/assistant-conversation.js"
import { transactionRunner } from "../../../shared/infrastructure/database/transaction.js"

type Queryable = Pick<Database, "query">
type RatingScope = { organizationId: string; ownerPersonId: string }

export type RateConversationMessageInput = { conversationId: string; interactionId: string; value: AssistantRatingValue; details?: AssistantRatingDetails | null }

/** A avaliação vigente de uma resposta (curtida ou descurtida; retirada não aparece). */
export type RatingSnapshot = { rating: Exclude<AssistantRatingView, null>; ratingId: string; details: AssistantRatingDetails | null }

/** Resultado de gravar: a vigente depois da chamada, a origem da conversa e se uma versão nova foi gravada. */
export type RatingResult = { rating: AssistantRatingView; ratingId: string | null; details: AssistantRatingDetails | null; conversationOrigin: ConversationOrigin; written: boolean }

const notRateable = () => new DomainError("Resposta não encontrada.", "ASSISTANT_MESSAGE_NOT_FOUND", 404)

const inTransaction = transactionRunner("assistant_interaction_rating")

type CurrentRow = { id: string; value: AssistantRatingValue; reason: ChatDislikeReason | null; comment: string | null; still_needs_help: boolean | null }
const detailsOf = (row: Pick<CurrentRow, "reason" | "comment" | "still_needs_help">): AssistantRatingDetails | null =>
  row.reason && row.still_needs_help !== null ? { reason: row.reason, comment: row.comment, stillNeedsHelp: row.still_needs_help } : null

/**
 * Grava o curtir/descurtir (ou a retirada, `NONE`) de uma resposta da INIA e devolve a vigente. Só a DONA da conversa avalia, só
 * respostas da INIA daquela conversa, na organização da sessão — qualquer outra combinação é 404 (não revela o que existe).
 * O motivo da descurtida (`details`) só vale no CHAT LIVRE (`origin = USER`): na sessão de feedback e no recado é 422.
 * Histórico: a anterior é encerrada, nunca reescrita; as regras de quando gravar estão em `shouldWriteRating`. Concorrência (duplo
 * clique, outra aba): lock por pessoa × resposta na transação. Conversa encerrada também aceita: a avaliação não muda a conversa.
 */
export async function rateConversationMessage(db: Database, scope: RatingScope, input: RateConversationMessageInput, now: Date): Promise<RatingResult> {
  return inTransaction(db, async (client) => {
    const message = await client.query<{ origin: ConversationOrigin }>(
      `select c.origin from assistant_interactions i
         join assistant_conversations c on c.id = i.conversation_id
        where i.id = $1 and i.conversation_id = $2 and i.role = 'assistant'
          and c.organization_id = $3 and c.owner_person_id = $4`,
      [input.interactionId, input.conversationId, scope.organizationId, scope.ownerPersonId],
    )
    const origin = message.rows[0]?.origin
    if (!origin) throw notRateable()
    const details = input.value === "DOWN" ? (input.details ?? null) : null
    if (details && origin !== "USER") throw new DomainError("O motivo da descurtida só vale nas conversas abertas por você com a INIA.", "RATING_DETAILS_NOT_ALLOWED", 422)
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`assistant_interaction_rating:${scope.ownerPersonId}:${input.interactionId}`])
    const currentRow = (
      await client.query<CurrentRow>(
        `select r.id, r.value, d.reason, d.comment, d.still_needs_help
           from assistant_interaction_ratings r left join assistant_interaction_rating_details d on d.rating_id = r.id
          where r.organization_id = $1 and r.person_id = $2 and r.interaction_id = $3 and r.superseded_at is null`,
        [scope.organizationId, scope.ownerPersonId, input.interactionId],
      )
    ).rows[0] ?? null
    const current: CurrentRating | null = currentRow ? { value: currentRow.value, details: detailsOf(currentRow) } : null
    if (!shouldWriteRating(current, { value: input.value, details })) {
      const vigente = currentRow && currentRow.value !== "NONE" ? currentRow : null
      return { rating: ratingView(vigente?.value), ratingId: vigente?.id ?? null, details: vigente ? detailsOf(vigente) : null, conversationOrigin: origin, written: false }
    }
    if (currentRow) {
      await client.query(`update assistant_interaction_ratings set superseded_at = $4 where organization_id = $1 and person_id = $2 and interaction_id = $3 and superseded_at is null`, [
        scope.organizationId,
        scope.ownerPersonId,
        input.interactionId,
        now,
      ])
    }
    const inserted = await client.query<{ id: string }>(
      `insert into assistant_interaction_ratings (organization_id, person_id, conversation_id, interaction_id, value, created_at) values ($1, $2, $3, $4, $5, $6) returning id`,
      [scope.organizationId, scope.ownerPersonId, input.conversationId, input.interactionId, input.value, now],
    )
    const ratingId = inserted.rows[0]!.id
    if (details) {
      await client.query(
        `insert into assistant_interaction_rating_details (rating_id, organization_id, person_id, reason, comment, still_needs_help, catalog_version) values ($1, $2, $3, $4, $5, $6, $7)`,
        [ratingId, scope.organizationId, scope.ownerPersonId, details.reason, details.comment, details.stillNeedsHelp, CHAT_DISLIKE_REASONS_VERSION],
      )
    }
    return { rating: ratingView(input.value), ratingId: input.value === "NONE" ? null : ratingId, details, conversationOrigin: origin, written: true }
  })
}

/** Avaliações vigentes da dona para as respostas de uma página do histórico (retiradas não aparecem), com o motivo da descurtida. */
export async function loadConversationRatings(db: Queryable, scope: RatingScope, interactionIds: readonly string[]): Promise<Map<string, RatingSnapshot>> {
  if (interactionIds.length === 0) return new Map()
  const result = await db.query<CurrentRow & { interaction_id: string }>(
    `select r.interaction_id, r.id, r.value, d.reason, d.comment, d.still_needs_help
       from assistant_interaction_ratings r left join assistant_interaction_rating_details d on d.rating_id = r.id
      where r.organization_id = $1 and r.person_id = $2 and r.interaction_id = any($3::uuid[]) and r.superseded_at is null and r.value <> 'NONE'`,
    [scope.organizationId, scope.ownerPersonId, [...interactionIds]],
  )
  return new Map(result.rows.flatMap((row) => {
    const view = ratingView(row.value)
    return view ? [[row.interaction_id, { rating: view, ratingId: row.id, details: detailsOf(row) }] as const] : []
  }))
}
