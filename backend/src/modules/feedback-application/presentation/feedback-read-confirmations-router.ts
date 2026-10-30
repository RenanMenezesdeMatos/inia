import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { verifyPassword } from "../../auth/infrastructure/password-hasher.js"
import { FEEDBACK_SOURCE_KINDS } from "../domain/feedback-application.js"
import { READ_CONFIRMATION_CLIENT_EVENTS, READ_CONFIRMATION_DEVICES, READ_CONFIRMATION_ENTRY_POINTS } from "../domain/read-confirmation.js"
import { confirmFeedbackReading, recordReadConfirmationEvent, type PasswordVerifier, type ReadConfirmationScope } from "../application/read-confirmation-service.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

/**
 * Confirmação de ciência com login e senha — `/api/v1/feedback-read-confirmations`, sempre do PRÓPRIO destinatário (pessoa e
 * conta da sessão; nunca um id de pessoa no corpo). Fonte de outra pessoa/organização = 404.
 *
 *   POST /events   OPENED | CANCELLED do elemento de confirmação (usabilidade; nada além do registro muda) → 204
 *   POST /         confirmar com login + senha → ciência (+ conclusão da aplicação em andamento)
 *                  422 READ_CONFIRMATION_INVALID_CREDENTIALS { remainingAttempts } · 429 READ_CONFIRMATION_TOO_MANY_ATTEMPTS { retryAt }
 *
 * A senha nunca é gravada, devolvida nem registrada em log; o login digitado também não é gravado.
 */
const attemptSchema = z.object({
  source: z.object({ kind: z.enum(FEEDBACK_SOURCE_KINDS), id: z.string().uuid() }),
  entryPoint: z.enum(READ_CONFIRMATION_ENTRY_POINTS),
  attemptId: z.string().uuid(),
  device: z.enum(READ_CONFIRMATION_DEVICES).nullable().default(null),
  elapsedMs: z.number().int().min(0).max(86_400_000).nullable().default(null),
})

export function createFeedbackReadConfirmationsRouter(db: Database, deps: { now?: () => Date; verifyPassword?: PasswordVerifier } = {}) {
  const router = Router()
  const now = deps.now ?? (() => new Date())
  const verify = deps.verifyPassword ?? verifyPassword
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
    const input = attemptSchema.extend({ login: z.string().max(320), password: z.string().max(200) }).parse(request.body)
    response.json({ data: await confirmFeedbackReading(db, scopeOf(request), input, now(), { verifyPassword: verify }) })
  })

  return router
}
