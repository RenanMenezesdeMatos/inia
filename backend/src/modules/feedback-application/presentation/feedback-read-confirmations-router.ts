import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { verifyPassword } from "../../auth/infrastructure/password-hasher.js"
import { FEEDBACK_SOURCE_KINDS } from "../domain/feedback-application.js"
import { READ_CONFIRMATION_CLIENT_EVENTS, READ_CONFIRMATION_DEVICES, READ_CONFIRMATION_ENTRY_POINTS } from "../domain/read-confirmation.js"
import { readAgreementInputSchema } from "../../feedback-rating/domain/feedback-rating.js"
import { confirmFeedbackReading, recordReadConfirmationEvent, type NetworkPasswordVerifier, type PasswordVerifier, type ReadConfirmationScope } from "../application/read-confirmation-service.js"
import type { DirectoryAuthenticator } from "../../auth/application/directory-authenticator.js"
import { directoryFromEnv } from "../../auth/infrastructure/ldap-directory-authenticator.js"
import { createPostgresNetworkPasswordVerifier } from "../../auth/infrastructure/postgres-network-password-verifier.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Confirmação de ciência com login e senha — `/api/v1/feedback-read-confirmations`, sempre do PRÓPRIO destinatário (pessoa e
 * conta da sessão; nunca um id de pessoa no corpo). Fonte de outra pessoa/organização = 404.
 *
 *   POST /events   OPENED | CANCELLED do elemento de confirmação (usabilidade; nada além do registro muda) → 204
 *   POST /         confirmar com login + senha + a escolha obrigatória `agreement` ({ value: AGREE } | { value: DISAGREE,
 *                  reason, justification }) → ciência + escolha (+ conclusão da aplicação em andamento), numa transação
 *                  400 VALIDATION_ERROR (corpo inválido, antes de conferir credenciais) ·
 *                  422 READ_CONFIRMATION_INVALID_CREDENTIALS { remainingAttempts } (sem `remainingAttempts` no login pela rede: a
 *                  trava é a da matrícula, somando o login) · 429 READ_CONFIRMATION_TOO_MANY_ATTEMPTS { retryAt? }
 *
 * A senha nunca é gravada, devolvida nem registrada em log; o login digitado também não é gravado.
 */
const attemptSchema = z
  .object({
    source: z.object({ kind: z.enum(FEEDBACK_SOURCE_KINDS), id: z.string().uuid() }).strict(),
    entryPoint: z.enum(READ_CONFIRMATION_ENTRY_POINTS),
    attemptId: z.string().uuid(),
    device: z.enum(READ_CONFIRMATION_DEVICES).nullable().default(null),
    elapsedMs: z.number().int().min(0).max(86_400_000).nullable().default(null),
  })
  .strict()

export function createFeedbackReadConfirmationsRouter(db: Database, deps: { now?: () => Date; verifyPassword?: PasswordVerifier; directory?: DirectoryAuthenticator } = {}) {
  const router = Router()
  const now = deps.now ?? (() => new Date())
  const verify = deps.verifyPassword ?? verifyPassword
  const directory = deps.directory ?? directoryFromEnv()
  // Senha de rede pelo portão da matrícula (o mesmo do login): falhas da ciência somam com as do login. Sobre o POOL, chamado
  // fora de transação (read-confirmation-service.ts).
  const verifyNetworkPassword: NetworkPasswordVerifier = createPostgresNetworkPasswordVerifier(db, directory, now)
  const scopeOf = (request: { user?: { organizationId: string; personId: string; sub: string } }): ReadConfirmationScope => ({
    organizationId: sessionUser(request).organizationId,
    personId: sessionUser(request).personId,
    accountId: sessionUser(request).sub,
  })

  router.post("/events", async (request, response) => {
    const input = attemptSchema.extend({ event: z.enum(READ_CONFIRMATION_CLIENT_EVENTS) }).parse(request.body)
    const { event, ...attempt } = input
    await recordReadConfirmationEvent(db, scopeOf(request), attempt, event, now())
    response.status(204).send()
  })

  router.post("/", async (request, response) => {
    const input = attemptSchema.extend({ login: z.string().max(320), password: z.string().min(1).max(200), agreement: readAgreementInputSchema }).parse(request.body)
    response.json({ data: await confirmFeedbackReading(db, scopeOf(request), input, now(), { verifyPassword: verify, verifyNetworkPassword }) })
  })

  return router
}
