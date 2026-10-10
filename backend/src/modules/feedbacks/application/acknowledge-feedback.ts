import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

export type AcknowledgeFeedbackResult = { id: string; acknowledgedAt: string; alreadyAcknowledged: boolean }

/**
 * Ciência do colaborador: confirmação formal, feita pelo PRÓPRIO destinatário, de que recebeu
 * um feedback publicado. É o que "aguardando ciência" na Equipe e no feed do gestor significa —
 * até esta rota existir, `acknowledged_at` nunca era gravado por ninguém e o contador não tinha
 * como sair do lugar. Só `acknowledged_at` muda: o status continua `PUBLISHED`, porque todo
 * consumidor (feed, contadores, contexto do assistente) filtra por esse status — promover para
 * `ACKNOWLEDGED` faria o feedback sumir das leituras. Idempotente: repetir devolve a mesma data.
 * Não há rota direta: o colaborador confirma com login e senha (feedback-application/read-confirmation-service), que chama esta
 * função dentro da transação da confirmação.
 */
export async function acknowledgeFeedback(db: Pick<Database, "query">, input: { feedbackId: string; personId: string; at?: Date }): Promise<AcknowledgeFeedbackResult> {
  const current = await db.query<{ id: string; operator_id: string; status: string; acknowledged_at: string | null }>(
    `select id, operator_id, status, acknowledged_at from feedbacks where id = $1`,
    [input.feedbackId],
  )
  const feedback = current.rows[0]
  if (!feedback) throw new DomainError("Feedback não encontrado.", "FEEDBACK_NOT_FOUND", 404)
  if (feedback.operator_id !== input.personId) throw new DomainError("Só o próprio colaborador pode dar ciência neste feedback.", "FEEDBACK_ACK_FORBIDDEN", 403)
  if (feedback.acknowledged_at) return { id: feedback.id, acknowledgedAt: new Date(feedback.acknowledged_at).toISOString(), alreadyAcknowledged: true }
  if (feedback.status !== "PUBLISHED") throw new DomainError("Só um feedback publicado pode receber ciência.", "FEEDBACK_NOT_PUBLISHED", 409)

  const updated = await db.query<{ acknowledged_at: string }>(
    `update feedbacks set acknowledged_at = coalesce($2::timestamptz, now()), updated_at = coalesce($2::timestamptz, now()) where id = $1 and acknowledged_at is null returning acknowledged_at`,
    [feedback.id, input.at ?? null],
  )
  const acknowledgedAt = updated.rows[0]?.acknowledged_at
  // Corrida com outra aba: alguém gravou entre o select e o update — o resultado é o mesmo.
  if (!acknowledgedAt) return acknowledgeFeedback(db, input)
  return { id: feedback.id, acknowledgedAt: new Date(acknowledgedAt).toISOString(), alreadyAcknowledged: false }
}
