import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { FeedbackSourceRef } from "../../feedback-application/domain/feedback-application.js"
import type { ContestationReason, ReadAgreementInput, ReadAgreementValue } from "../domain/feedback-rating.js"
import { notifyContestationReviewers } from "./contestation-review-service.js"

/**
 * CONCORDÂNCIA NA CIÊNCIA (migration 186) — a escrita, sempre DENTRO da transação da confirmação de ciência
 * (`feedback-application/application/read-confirmation-service.ts`), sob o lock por fonte e com a fonte travada: ou a ciência e a
 * escolha (e o aviso aos revisores, quando discorda) ficam juntas, ou nada fica. Pessoa, conta e organização vêm da sessão.
 */
type Queryable = Pick<Database, "query">
export type AgreementAuthor = { organizationId: string; personId: string; accountId: string }
export type RecordedAgreement = { id: string; value: ReadAgreementValue; reason: ContestationReason | null; justification: string | null; recordedAt: string }

type Row = { id: string; agreement: ReadAgreementValue; reason: ContestationReason | null; justification: string | null; created_at: Date }
const toRecorded = (row: Row): RecordedAgreement => ({ id: row.id, value: row.agreement, reason: row.reason, justification: row.justification, recordedAt: new Date(row.created_at).toISOString() })
const sourceColumn = (source: FeedbackSourceRef) => (source.kind === "PUBLISHED_FEEDBACK" ? "feedback_id" : "interaction_delivery_id")

/** A escolha já registrada para a fonte (do próprio destinatário), ou null. */
export async function findReadAgreement(db: Queryable, scope: { organizationId: string; personId: string }, source: FeedbackSourceRef): Promise<RecordedAgreement | null> {
  const result = await db.query<Row>(
    `select id, agreement, reason, justification, created_at from feedback_read_agreements
      where organization_id = $1 and person_id = $2 and ${sourceColumn(source)} = $3`,
    [scope.organizationId, scope.personId, source.id],
  )
  return result.rows[0] ? toRecorded(result.rows[0]) : null
}

/**
 * Grava a escolha (instante = o da ciência, devolvido pela fonte) e, se o colaborador não concorda, avisa quem revisa as
 * contestações dele. Uma escolha por fonte (índice único): uma segunda gravação é um estado que o lock da confirmação impede —
 * se acontecer, 409 e a transação inteira (inclusive a ciência) é desfeita.
 */
export async function recordReadAgreement(db: Queryable, author: AgreementAuthor, source: FeedbackSourceRef, input: ReadAgreementInput, at: Date): Promise<RecordedAgreement> {
  let row: Row
  try {
    row = (
      await db.query<Row>(
        `insert into feedback_read_agreements (organization_id, person_id, account_id, source_kind, ${sourceColumn(source)}, agreement, reason, justification, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         returning id, agreement, reason, justification, created_at`,
        [
          author.organizationId,
          author.personId,
          author.accountId,
          source.kind,
          source.id,
          input.value,
          input.value === "DISAGREE" ? input.reason : null,
          input.value === "DISAGREE" ? input.justification : null,
          at,
        ],
      )
    ).rows[0]!
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new DomainError("A escolha deste feedback já foi registrada.", "FEEDBACK_READ_AGREEMENT_CONFLICT", 409)
    }
    throw error
  }
  // Discordar = contestação: quem revisa no escopo do colaborador é avisado no sino (na mesma transação).
  if (input.value === "DISAGREE") {
    await notifyContestationReviewers(db, { organizationId: author.organizationId, contestationId: row.id, origin: "READ_AGREEMENT", collaboratorId: author.personId, reason: input.reason, text: input.justification, now: at })
  }
  return toRecorded(row)
}
