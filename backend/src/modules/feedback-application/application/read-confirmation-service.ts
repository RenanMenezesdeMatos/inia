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
import { readAgreementInputSchema, sameAgreement, type ReadAgreementInput, type ReadAgreementView } from "../../feedback-rating/domain/feedback-rating.js"
import { findReadAgreement, recordReadAgreement } from "../../feedback-rating/application/read-agreement-service.js"
import { loadFeedbackEvaluation } from "../../feedback-rating/application/feedback-evaluation-reader.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { networkLoginMatches, normalizeNetworkLogin } from "../../auth/domain/network-login.js"
import type { NetworkPasswordCheck } from "../../auth/application/authenticate-network.js"

/**
 * CONFIRMAÇÃO DE CIÊNCIA COM LOGIN E SENHA (ver domain/read-confirmation.ts) — `/api/v1/feedback-read-confirmations`.
 *
 * Com CONCORDÂNCIA (migration 186): o pedido traz a escolha obrigatória do colaborador ("Concordo" / "Não concordo" + motivo e
 * justificativa) e a ciência e a escolha são gravadas na MESMA transação — nunca uma sem a outra. Discordar é contestação (aviso
 * aos revisores, na mesma transação) e não impede a ciência. Ciência anterior à escolha (sem concordância registrada) registra a
 * escolha uma vez; ciência com escolha nunca muda a escolha (devolve a registrada).
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
  /** A escolha registrada para a fonte (a desta confirmação, a de uma confirmação anterior ou, numa ciência anterior à escolha,
   * a registrada agora). Sempre presente depois do sucesso. */
  agreement: ReadAgreementView | null
  /** O pedido trouxe uma escolha diferente da que já estava registrada (outra aba, reenvio): valeu a registrada. */
  agreementDiffered: boolean
  /** A aplicação da fonte depois da confirmação (concluída se estava em andamento); null = nenhuma aplicação. */
  application: FeedbackApplicationView | null
}

export type PasswordVerifier = (plain: string, hash: string) => Promise<boolean>

/**
 * Conferência da senha de REDE para a ciência (login pela rede ligado e conta comum): passa pelo MESMO portão da matrícula do
 * login (auth/application/authenticate-network.ts), então login e ciência somam as mesmas falhas e nunca chegam perto do
 * bloqueio da conta de rede. Só é chamada com a matrícula da PRÓPRIA pessoa.
 */
export type NetworkPasswordVerifier = (input: { normalized: string; password: string; accountId: string }) => Promise<NetworkPasswordCheck>

/** Recusas vindas da rede, no formato `status, code, message` que o inventário do catálogo de erros lê. */
export const NETWORK_CREDENTIAL_ERRORS = {
  LOCKED: { status: 429, code: "READ_CONFIRMATION_TOO_MANY_ATTEMPTS", message: "Muitas tentativas com a senha de rede errada. Aguarde alguns minutos — insistir pode bloquear a sua conta de rede." },
  ACCOUNT_LOCKED: { status: 403, code: "NETWORK_ACCOUNT_LOCKED", message: "Sua conta de rede está bloqueada. Procure o suporte de TI para desbloquear." },
  PASSWORD_EXPIRED: { status: 403, code: "NETWORK_PASSWORD_EXPIRED", message: "Sua senha de rede venceu ou precisa ser trocada. Troque a senha de rede e tente de novo." },
  ACCOUNT_DISABLED: { status: 403, code: "NETWORK_ACCOUNT_DISABLED", message: "Sua conta de rede está desativada ou sem permissão de acesso agora. Procure o suporte de TI." },
  UNAVAILABLE: { status: 503, code: "NETWORK_LOGIN_UNAVAILABLE", message: "A conferência pela rede está indisponível no momento. Tente de novo em alguns minutos." },
} as const

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

type CredentialAccountRow = { email: string; password_hash: string; active: boolean; matricula: string | null; network: boolean }

async function loadCredentialAccount(db: Queryable, scope: ReadConfirmationScope): Promise<CredentialAccountRow | undefined> {
  return (
    await db.query<CredentialAccountRow>(
      `select ua.email, ua.password_hash, ua.active, p.matricula, (o.network_login_enabled and not ua.emergency_local_access) network
         from user_accounts ua join people p on p.id = ua.person_id join organizations o on o.id = ua.organization_id
        where ua.id = $1 and ua.organization_id = $2 and ua.person_id = $3`,
      [scope.accountId, scope.organizationId, scope.personId],
    )
  ).rows[0]
}

const lockCredential = (client: Queryable, scope: ReadConfirmationScope) => client.query("select pg_advisory_xact_lock(hashtext('read_confirmation_credential:' || $1::text))", [scope.accountId])

type CredentialVerdict =
  | { kind: "OK" }
  | { kind: "BLOCKED"; retryAt: Date }
  | { kind: "FAILED"; remaining: number; network: boolean }
  | { kind: "NETWORK"; problem: keyof typeof NETWORK_CREDENTIAL_ERRORS }
  | { kind: "CHANGED" }

/**
 * Confere as credenciais da ciência. Contar falhas → conferir a senha → gravar a falha acontece SOB uma trava por conta (achado
 * I-F9): sem ela, N tentativas em paralelo leem "menos de 5 falhas" antes de qualquer uma ser gravada e o limite deixa de valer.
 * A falha é gravada e CONFIRMADA antes do erro sair (o erro é lançado fora da transação).
 *
 * Senha LOCAL (bcrypt, ~100 ms): tudo numa transação curta. Senha de REDE (achados SLR-05/DADOS-02/QA-09 da run-9): a chamada
 * ao AD pode levar segundos por servidor e NUNCA fica dentro de transação nem segurando conexão do pool. Três passos:
 *  1. transação curta: trava por conta, contador da ciência, conta e a matrícula digitada (precisa ser a da PRÓPRIA pessoa);
 *  2. fora de transação: o portão da matrícula + o AD (autocommit; a reserva gravada antes do AD segura tentativas paralelas — o
 *     limite de N senhas de rede no AD continua valendo mesmo com o contador da ciência lido antes);
 *  3. transação curta: trava por conta de novo, confere que a conta não mudou no meio (ainda pela rede, habilitada, mesma
 *     matrícula) e grava a falha (senha errada ou trava da matrícula = FAILED, como as demais).
 */
async function verifyReadConfirmationCredentials(
  db: Database,
  scope: ReadConfirmationScope,
  attempt: ReadConfirmationAttempt,
  input: { login: string; password: string },
  now: Date,
  deps: { verifyPassword: PasswordVerifier; verifyNetworkPassword?: NetworkPasswordVerifier },
  application: EventRow["application"],
): Promise<CredentialVerdict> {
  const first = await inTransaction(db, async (client): Promise<CredentialVerdict | { kind: "CHECK_NETWORK"; normalized: string }> => {
    await lockCredential(client, scope)
    const throttle = readConfirmationThrottle(await recentCredentialFailures(client, scope, now), now)
    if (throttle.blocked) {
      await insertEvent(client, scope, { attempt, event: "FAILED", failureReason: "TOO_MANY_ATTEMPTS", application }, now)
      return { kind: "BLOCKED", retryAt: throttle.retryAt }
    }
    const account = await loadCredentialAccount(client, scope)
    if (account?.network) {
      // LOGIN PELA REDE: a matrícula digitada precisa ser a da PRÓPRIA pessoa ANTES de qualquer chamada ao AD (nunca conferir a
      // senha de rede de outra matrícula). Sem o verificador de rede (instalação sem AD) = indisponível, nunca a senha local.
      const loginMatches = networkLoginMatches(input.login, account.matricula)
      const failure = credentialFailureOf({ accountActive: account.active, loginMatches, passwordMatches: false })
      if (failure === "WRONG_LOGIN") {
        await insertEvent(client, scope, { attempt, event: "FAILED", failureReason: failure, application }, now)
        return { kind: "FAILED", remaining: Math.max(0, throttle.remaining - 1), network: true }
      }
      if (!deps.verifyNetworkPassword) return { kind: "NETWORK", problem: "UNAVAILABLE" }
      // Igual à do cadastro (conferida acima), já no formato do login.
      return { kind: "CHECK_NETWORK", normalized: normalizeNetworkLogin(input.login)! }
    }
    const loginMatches = account ? loginMatchesAccount(input.login, account.email) : false
    // A senha é sempre conferida contra a PRÓPRIA conta (nunca contra a conta do login digitado).
    const passwordMatches = account ? await deps.verifyPassword(input.password, account.password_hash) : false
    const failure = credentialFailureOf({ accountActive: Boolean(account?.active), loginMatches, passwordMatches })
    if (failure) {
      await insertEvent(client, scope, { attempt, event: "FAILED", failureReason: failure, application }, now)
      return { kind: "FAILED", remaining: Math.max(0, throttle.remaining - 1), network: false }
    }
    return { kind: "OK" }
  })
  if (first.kind !== "CHECK_NETWORK") return first

  // Passo 2 — fora de transação, sem conexão presa: portão da matrícula + AD.
  const check = await deps.verifyNetworkPassword!({ normalized: first.normalized, password: input.password, accountId: scope.accountId })

  // Passo 3 — transação curta: nada mudou no meio? grava a falha.
  return inTransaction(db, async (client): Promise<CredentialVerdict> => {
    await lockCredential(client, scope)
    const current = await loadCredentialAccount(client, scope)
    const unchanged = current?.network === true && current.active && networkLoginMatches(first.normalized, current.matricula)
    switch (check) {
      case "OK":
        return unchanged ? { kind: "OK" } : { kind: "CHANGED" }
      case "INVALID":
        await insertEvent(client, scope, { attempt, event: "FAILED", failureReason: "WRONG_PASSWORD", application }, now)
        return { kind: "FAILED", remaining: 0, network: true }
      case "LOCKED":
        // A trava da matrícula (3, somando o login) disparou: a tentativa entra no rastro da ciência como as demais (SLR-09).
        await insertEvent(client, scope, { attempt, event: "FAILED", failureReason: "TOO_MANY_ATTEMPTS", application }, now)
        return { kind: "NETWORK", problem: "LOCKED" }
      default:
        // Situação da conta de rede ou AD fora do ar: a senha nem foi recusada; não vira evento de senha errada.
        return { kind: "NETWORK", problem: check }
    }
  })
}


/**
 * Confirma a ciência com o login e a senha da própria conta. Falha de credencial = evento FAILED + 422 (mensagem única, com as
 * tentativas que restam — pela rede, sem a contagem); trava = evento FAILED (TOO_MANY_ATTEMPTS) + 429 com o horário em que libera. Sucesso = ciência +
 * conclusão da aplicação em andamento + evento CONFIRMED, tudo numa transação.
 */
export async function confirmFeedbackReading(
  db: Database,
  scope: ReadConfirmationScope,
  input: ReadConfirmationAttempt & { login: string; password: string; agreement: ReadAgreementInput },
  now: Date,
  deps: { verifyPassword: PasswordVerifier; verifyNetworkPassword?: NetworkPasswordVerifier },
): Promise<ReadConfirmationResult> {
  const attempt: ReadConfirmationAttempt = { source: input.source, entryPoint: input.entryPoint, attemptId: input.attemptId, device: input.device, elapsedMs: input.elapsedMs }
  // A escolha é validada (e a justificativa aparada) AQUI também, antes das credenciais — vale para qualquer chamador, não só a rota.
  const chosen = readAgreementInputSchema.parse(input.agreement)
  if (!(await loadOwnedSourceState(db, scope, input.source))) throw notFound()
  const before = await findApplicationViewBySource(db, scope, input.source)
  const applicationBefore = before && { id: before.id, status: before.status }

  const verdict = await verifyReadConfirmationCredentials(db, scope, attempt, input, now, deps, applicationBefore)
  if (verdict.kind === "NETWORK") {
    // Recusa vinda da rede (fora a senha errada e a trava, gravadas como FAILED): a situação é da conta de rede.
    const problem = NETWORK_CREDENTIAL_ERRORS[verdict.problem]
    throw new DomainError(problem.message, problem.code, problem.status)
  }
  if (verdict.kind === "CHANGED") {
    throw new DomainError("A forma de entrar da sua conta mudou durante a confirmação. Abra a confirmação de novo e tente outra vez.", "READ_CONFIRMATION_ACCOUNT_CHANGED", 409)
  }
  if (verdict.kind === "BLOCKED") {
    throw new DomainError("Muitas tentativas com login ou senha incorretos. Aguarde alguns minutos e tente de novo.", "READ_CONFIRMATION_TOO_MANY_ATTEMPTS", 429, { retryAt: verdict.retryAt.toISOString() })
  }
  if (verdict.kind === "FAILED") {
    // Pela rede, sem "restam N": a trava que vale é a da matrícula (3, somando o login), não o contador da ciência.
    if (verdict.network) throw new DomainError("Matrícula ou senha de rede não conferem com a sua conta. Atenção: várias senhas erradas bloqueiam a sua conta de rede.", "READ_CONFIRMATION_INVALID_CREDENTIALS", 422)
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

    // A escolha. Ciência nova: gravada junto, no instante da ciência que a fonte devolveu (uma escolha que já existisse para uma
    // fonte sem ciência é estado impossível pelo código — o índice único recusa, 409, e TUDO é desfeito). Ciência anterior sem
    // escolha: registrada agora (registro único). Ciência com escolha: nada muda — vale a registrada, mesmo que o pedido traga outra.
    const recorded = alreadyConfirmed ? await findReadAgreement(client, scope, input.source) : null
    const agreementRecorded = recorded === null
    const agreement = recorded ?? (await recordReadAgreement(client, scope, input.source, chosen, alreadyConfirmed ? now : new Date(acknowledgedAt)))
    const agreementDiffered = recorded !== null && !sameAgreement(recorded, chosen)

    const completes = application?.status === "IN_PROGRESS"
    if (completes) await completeApplication(client as unknown as Database, scope, application.id, now, { via: "READ_CONFIRMATION", entryPoint: input.entryPoint, attemptId: input.attemptId })
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'FEEDBACK_READ_CONFIRMED', $3, $4, $5)`,
      [
        scope.organizationId,
        scope.personId,
        input.source.kind === "PUBLISHED_FEEDBACK" ? "feedback" : "interaction_feedback_delivery",
        input.source.id,
        JSON.stringify({
          method: "LOGIN_AND_PASSWORD",
          entryPoint: input.entryPoint,
          attemptId: input.attemptId,
          alreadyConfirmed,
          applicationId: application?.id ?? null,
          completedApplication: completes,
          // A justificativa fica só em `feedback_read_agreements`; aqui, a referência e a escolha.
          agreement: agreement.value,
          agreementId: agreement.id,
          reason: agreement.reason,
          agreementRecorded,
          agreementDiffered,
        }),
      ],
    )
    await insertEvent(client, scope, { attempt, event: "CONFIRMED", alreadyConfirmed, completedApplication: completes, application: application && { id: application.id, status: application.status } }, now)
    const after = await findApplicationViewBySource(client, scope, input.source)
    const evaluation = await loadFeedbackEvaluation(client, scope, input.source)
    return { source: input.source, acknowledgedAt, alreadyConfirmed, agreement: evaluation.agreement, agreementDiffered, application: after }
  })
}
