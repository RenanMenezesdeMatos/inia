import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { acknowledgeFeedback } from "../../feedbacks/application/acknowledge-feedback.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { acknowledgeFeedbackDelivery } from "../../interaction-feedback/application/deliver-feedback.js"
import { createPostgresFeedbackDeliveryStore } from "../../interaction-feedback/infrastructure/postgres-feedback-delivery-store.js"
import type { FeedbackApplicationStatus, FeedbackSourceRef } from "../domain/feedback-application.js"
import {
  credentialFailureOf,
  loginMatchesAccount,
  READ_CONFIRMATION_FAILURE_WINDOW_MINUTES,
  readConfirmationThrottle,
  type ReadConfirmationClientEvent,
  type ReadConfirmationDevice,
  type ReadConfirmationEntryPoint,
  type ReadConfirmationEvent,
  type ReadConfirmationFailure,
} from "../domain/read-confirmation.js"
import { applicationSourceLockKey, completeApplication, findApplicationViewBySource, type ApplicationScope, type FeedbackApplicationView } from "./feedback-application-service.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"

/**
 * CONFIRMAÇÃO DE CIÊNCIA COM LOGIN E SENHA (ver domain/read-confirmation.ts) — `/api/v1/feedback-read-confirmations`.
 *
 * A pessoa e a conta vêm SEMPRE da sessão; o login digitado precisa ser o da PRÓPRIA conta (digitar as credenciais de outra
 * pessoa não confirma nada). A fonte é autorizada aqui (organização + destinatário + publicado/entregue + visível): de outra
 * pessoa = 404, sem distinguir. Confirmar, numa transação sob o MESMO lock por fonte de iniciar a aplicação: grava a ciência pela
 * função de ciência de cada fonte e, se a aplicação estiver em andamento, conclui a aplicação. Idempotente: outra aba que
 * confirmou antes = `alreadyConfirmed`.
 */
type Queryable = Pick<Database, "query">
export type ReadConfirmationScope = ApplicationScope & { accountId: string }

export type ReadConfirmationAttempt = {
  source: FeedbackSourceRef
  entryPoint: ReadConfirmationEntryPoint
  attemptId: string
  device: ReadConfirmationDevice | null
  elapsedMs: number | null
}

export type ReadConfirmationResult = {
  source: FeedbackSourceRef
  acknowledgedAt: string
  alreadyConfirmed: boolean
  /** A aplicação da fonte depois da confirmação (concluída se estava em andamento); null = nenhuma aplicação. */
  application: FeedbackApplicationView | null
}

export type PasswordVerifier = (plain: string, hash: string) => Promise<boolean>

type OwnedSourceState = { acknowledgedAt: Date | null }

/** Estado da fonte do PRÓPRIO destinatário — a mesma autorização da aplicação (sem montar o contexto do feedback). */
async function loadOwnedSourceState(db: Queryable, scope: ApplicationScope, source: FeedbackSourceRef, lock = false): Promise<OwnedSourceState | null> {
  const forUpdate = lock ? " for update" : ""
  const row =
    source.kind === "PUBLISHED_FEEDBACK"
      ? (
          await db.query<{ acknowledged_at: Date | null }>(
            `select f.acknowledged_at from feedbacks f
              where f.id = $1 and f.organization_id = $2 and f.operator_id = $3 and f.status = 'PUBLISHED' and ${visibleInFollowUpSql("f")}${forUpdate}`,
            [source.id, scope.organizationId, scope.personId],
          )
        ).rows[0]
      : (
          await db.query<{ acknowledged_at: Date | null }>(
            `select x.acknowledged_at from interaction_feedback_deliveries x where x.id = $1 and x.organization_id = $2 and x.collaborator_id = $3${forUpdate}`,
            [source.id, scope.organizationId, scope.personId],
          )
        ).rows[0]
  return row ? { acknowledgedAt: row.acknowledged_at } : null
}

const notFound = () => new DomainError("Feedback não encontrado.", "FEEDBACK_READ_CONFIRMATION_SOURCE_NOT_FOUND", 404)

type EventRow = {
  attempt: ReadConfirmationAttempt
  event: ReadConfirmationEvent
  failureReason?: ReadConfirmationFailure
  alreadyConfirmed?: boolean
  completedApplication?: boolean
  application: { id: string; status: FeedbackApplicationStatus } | null
}

async function insertEvent(db: Queryable, scope: ReadConfirmationScope, row: EventRow, now: Date) {
  const { source } = row.attempt
  await db.query(
    `insert into feedback_read_confirmation_events
       (organization_id, person_id, account_id, source_kind, feedback_id, interaction_delivery_id, entry_point, attempt_id, event, failure_reason,
        already_confirmed, application_id, application_status, completed_application, device, elapsed_ms, occurred_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
    [
      scope.organizationId,
      scope.personId,
      scope.accountId,
      source.kind,
      source.kind === "PUBLISHED_FEEDBACK" ? source.id : null,
      source.kind === "INTERACTION_FEEDBACK_DELIVERY" ? source.id : null,
      row.attempt.entryPoint,
      row.attempt.attemptId,
      row.event,
      row.failureReason ?? null,
      row.alreadyConfirmed ?? null,
      row.application?.id ?? null,
      row.application?.status ?? null,
      row.completedApplication ?? null,
      row.attempt.device,
      row.attempt.elapsedMs === null ? null : Math.max(0, Math.round(row.attempt.elapsedMs)),
      now,
    ],
  )
}

/** Abrir/fechar o elemento de confirmação (usabilidade). Só para fonte do próprio destinatário; nunca muda nada além do registro. */
export async function recordReadConfirmationEvent(db: Queryable, scope: ReadConfirmationScope, attempt: ReadConfirmationAttempt, event: ReadConfirmationClientEvent, now: Date): Promise<void> {
  if (!(await loadOwnedSourceState(db, scope, attempt.source))) throw notFound()
  const application = await findApplicationViewBySource(db, scope, attempt.source)
  await insertEvent(db, scope, { attempt, event, application: application && { id: application.id, status: application.status } }, now)
}

async function recentCredentialFailures(db: Queryable, scope: ReadConfirmationScope, now: Date): Promise<Date[]> {
  const since = new Date(now.getTime() - READ_CONFIRMATION_FAILURE_WINDOW_MINUTES * 60_000)
  const result = await db.query<{ occurred_at: Date }>(
    `select occurred_at from feedback_read_confirmation_events
      where account_id = $1 and event = 'FAILED' and failure_reason in ('WRONG_LOGIN', 'WRONG_PASSWORD') and occurred_at > $2`,
    [scope.accountId, since],
  )
  return result.rows.map((row) => new Date(row.occurred_at))
}


/**
 * Confirma a ciência com o login e a senha da própria conta. Falha de credencial = evento FAILED + 422 (mensagem única, com as
 * tentativas que restam); trava = evento FAILED (TOO_MANY_ATTEMPTS) + 429 com o horário em que libera. Sucesso = ciência +
 * conclusão da aplicação em andamento + evento CONFIRMED, tudo numa transação.
 */
export async function confirmFeedbackReading(
  db: Database,
  scope: ReadConfirmationScope,
  input: ReadConfirmationAttempt & { login: string; password: string },
  now: Date,
  deps: { verifyPassword: PasswordVerifier },
): Promise<ReadConfirmationResult> {
  const attempt: ReadConfirmationAttempt = { source: input.source, entryPoint: input.entryPoint, attemptId: input.attemptId, device: input.device, elapsedMs: input.elapsedMs }
  if (!(await loadOwnedSourceState(db, scope, input.source))) throw notFound()
  const before = await findApplicationViewBySource(db, scope, input.source)
  const applicationBefore = before && { id: before.id, status: before.status }

  // Contar falhas → conferir a senha → gravar a falha acontece SOB uma trava por conta (achado I-F9): sem ela, N tentativas em
  // paralelo leem "menos de 5 falhas" antes de qualquer uma ser gravada e o limite deixa de valer. A falha é gravada e
  // CONFIRMADA antes do erro sair (o erro é lançado fora da transação).
  const verdict = await inTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('read_confirmation_credential:' || $1::text))", [scope.accountId])
    const throttle = readConfirmationThrottle(await recentCredentialFailures(client, scope, now), now)
    if (throttle.blocked) {
      await insertEvent(client, scope, { attempt, event: "FAILED", failureReason: "TOO_MANY_ATTEMPTS", application: applicationBefore }, now)
      return { kind: "BLOCKED" as const, retryAt: throttle.retryAt }
    }
    const account = (
      await client.query<{ email: string; password_hash: string; active: boolean }>(
        `select email, password_hash, active from user_accounts where id = $1 and organization_id = $2 and person_id = $3`,
        [scope.accountId, scope.organizationId, scope.personId],
      )
    ).rows[0]
    // A senha é sempre conferida contra a PRÓPRIA conta (nunca contra a conta do login digitado).
    const passwordMatches = account ? await deps.verifyPassword(input.password, account.password_hash) : false
    const failure = credentialFailureOf({ accountActive: Boolean(account?.active), loginMatches: account ? loginMatchesAccount(input.login, account.email) : false, passwordMatches })
    if (failure) {
      await insertEvent(client, scope, { attempt, event: "FAILED", failureReason: failure, application: applicationBefore }, now)
      return { kind: "FAILED" as const, remaining: Math.max(0, throttle.remaining - 1) }
    }
    return { kind: "OK" as const }
  })
  if (verdict.kind === "BLOCKED") {
    throw new DomainError("Muitas tentativas com login ou senha incorretos. Aguarde alguns minutos e tente de novo.", "READ_CONFIRMATION_TOO_MANY_ATTEMPTS", 429, { retryAt: verdict.retryAt.toISOString() })
  }
  if (verdict.kind === "FAILED") {
    throw new DomainError("Login ou senha não conferem com a sua conta.", "READ_CONFIRMATION_INVALID_CREDENTIALS", 422, { remainingAttempts: verdict.remaining })
  }

  return inTransaction(db, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('feedback_application:' || $1::text))", [applicationSourceLockKey(scope, input.source)])
    const state = await loadOwnedSourceState(client, scope, input.source, true)
    if (!state) throw notFound()
    const application = await findApplicationViewBySource(client, scope, input.source, true)

    let acknowledgedAt: string
    let alreadyConfirmed: boolean
    if (input.source.kind === "PUBLISHED_FEEDBACK") {
      const result = await acknowledgeFeedback(client, { feedbackId: input.source.id, personId: scope.personId, at: now })
      acknowledgedAt = result.acknowledgedAt
      alreadyConfirmed = result.alreadyAcknowledged
    } else {
      alreadyConfirmed = state.acknowledgedAt !== null
      const result = await acknowledgeFeedbackDelivery({ deliveries: createPostgresFeedbackDeliveryStore(client), now: () => now }, scope, input.source.id)
      acknowledgedAt = result.acknowledgedAt
    }

    const completes = application?.status === "IN_PROGRESS"
    if (completes) await completeApplication(client as unknown as Database, scope, application.id, now, { via: "READ_CONFIRMATION", entryPoint: input.entryPoint, attemptId: input.attemptId })
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'FEEDBACK_READ_CONFIRMED', $3, $4, $5)`,
      [
        scope.organizationId,
        scope.personId,
        input.source.kind === "PUBLISHED_FEEDBACK" ? "feedback" : "interaction_feedback_delivery",
        input.source.id,
        JSON.stringify({ method: "LOGIN_AND_PASSWORD", entryPoint: input.entryPoint, attemptId: input.attemptId, alreadyConfirmed, applicationId: application?.id ?? null, completedApplication: completes }),
      ],
    )
    await insertEvent(client, scope, { attempt, event: "CONFIRMED", alreadyConfirmed, completedApplication: completes, application: application && { id: application.id, status: application.status } }, now)
    const after = await findApplicationViewBySource(client, scope, input.source)
    return { source: input.source, acknowledgedAt, alreadyConfirmed, application: after }
  })
}
