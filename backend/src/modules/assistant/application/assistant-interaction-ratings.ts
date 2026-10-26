import type { PoolClient } from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { ratingView, sameRating, type AssistantRatingValue, type AssistantRatingView } from "../domain/assistant-interaction-rating.js"

type Queryable = Pick<Database, "query">
type RatingScope = { organizationId: string; ownerPersonId: string }

export type RateConversationMessageInput = { conversationId: string; interactionId: string; value: AssistantRatingValue }

const notRateable = () => new DomainError("Resposta não encontrada.", "ASSISTANT_MESSAGE_NOT_FOUND", 404)

async function inTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  // Já dentro de uma transação (prova/teste com cliente dedicado): savepoint em vez de begin.
  if (typeof (db as Partial<PoolClient>).release === "function") {
    const client = db as unknown as PoolClient
    await client.query("savepoint assistant_interaction_rating")
    try {
      const result = await work(client)
      await client.query("release savepoint assistant_interaction_rating")
      return result
    } catch (error) {
      await client.query("rollback to savepoint assistant_interaction_rating").catch(() => {})
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

/**
 * Grava o curtir/descurtir (ou a retirada, `NONE`) de uma resposta da INIA e devolve a vigente. Só a DONA da conversa avalia, só
 * respostas da INIA daquela conversa, na organização da sessão — qualquer outra combinação é 404 (não revela o que existe).
 * Histórico: a anterior é encerrada, nunca reescrita. Idempotente: o mesmo valor já vigente não grava nada. Concorrência (duplo
 * clique, outra aba): lock por pessoa × resposta na transação. Conversa encerrada também aceita: a avaliação não muda a conversa.
 */
export async function rateConversationMessage(db: Database, scope: RatingScope, input: RateConversationMessageInput, now: Date): Promise<AssistantRatingView> {
  return inTransaction(db, async (client) => {
    const message = await client.query(
      `select 1 from assistant_interactions i
         join assistant_conversations c on c.id = i.conversation_id
        where i.id = $1 and i.conversation_id = $2 and i.role = 'assistant'
          and c.organization_id = $3 and c.owner_person_id = $4`,
      [input.interactionId, input.conversationId, scope.organizationId, scope.ownerPersonId],
    )
    if (!message.rowCount) throw notRateable()
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`assistant_interaction_rating:${scope.ownerPersonId}:${input.interactionId}`])
    const current = (
      await client.query<{ value: AssistantRatingValue }>(
        `select value from assistant_interaction_ratings where organization_id = $1 and person_id = $2 and interaction_id = $3 and superseded_at is null`,
        [scope.organizationId, scope.ownerPersonId, input.interactionId],
      )
    ).rows[0]?.value ?? null
    if (sameRating(current, input.value)) return ratingView(current)
    if (current) {
      await client.query(`update assistant_interaction_ratings set superseded_at = $4 where organization_id = $1 and person_id = $2 and interaction_id = $3 and superseded_at is null`, [
        scope.organizationId,
        scope.ownerPersonId,
        input.interactionId,
        now,
      ])
    }
    await client.query(
      `insert into assistant_interaction_ratings (organization_id, person_id, conversation_id, interaction_id, value, created_at) values ($1, $2, $3, $4, $5, $6)`,
      [scope.organizationId, scope.ownerPersonId, input.conversationId, input.interactionId, input.value, now],
    )
    return ratingView(input.value)
  })
}

/** Avaliações vigentes da dona para as respostas de uma página do histórico (retiradas não aparecem). */
export async function loadConversationRatings(db: Queryable, scope: RatingScope, interactionIds: readonly string[]): Promise<Map<string, Exclude<AssistantRatingView, null>>> {
  if (interactionIds.length === 0) return new Map()
  const result = await db.query<{ interaction_id: string; value: AssistantRatingValue }>(
    `select interaction_id, value from assistant_interaction_ratings
      where organization_id = $1 and person_id = $2 and interaction_id = any($3::uuid[]) and superseded_at is null and value <> 'NONE'`,
    [scope.organizationId, scope.ownerPersonId, [...interactionIds]],
  )
  return new Map(result.rows.flatMap((row) => {
    const view = ratingView(row.value)
    return view ? [[row.interaction_id, view] as const] : []
  }))
}
