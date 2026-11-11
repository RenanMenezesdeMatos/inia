import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { redactSensitive } from "../../../shared/application/errors/classify-error.js"
import { ERROR_CATALOG } from "../../../shared/domain/errors/error-catalog.js"
import { createLogger } from "../../../shared/infrastructure/logging/logger.js"
import { verifyAuthToken } from "../../auth/infrastructure/jwt.js"
import { SESSION_COOKIE_NAME } from "../../auth/presentation/session-cookie.js"
import { normalizeRoute, REFERENCE_PATTERN } from "../domain/error-occurrence.js"
import { insertOccurrence } from "../infrastructure/pg-error-occurrence-store.js"

const log = createLogger("client-errors")

/** Só os códigos que nascem no navegador ou no proxy visto pelo navegador — o cliente nunca grava um código da API. */
const CLIENT_CODES = new Set(ERROR_CATALOG.filter((entry) => entry.origin === "CLIENT" || entry.origin === "PROXY" || entry.origin === "INTERFACE").map((entry) => entry.code))

const bodySchema = z.object({
  reference: z.string().regex(REFERENCE_PATTERN),
  code: z.string().max(80),
  route: z.string().max(300),
  occurredAt: z.string().datetime().optional(),
  httpStatus: z.number().int().min(100).max(599).nullable().optional(),
  message: z.string().max(1000).optional(),
  digest: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  online: z.boolean().optional(),
  release: z.string().regex(/^[A-Za-z0-9._+-]{1,64}$/).optional(),
}).strict()

/**
 * `POST /api/v1/client-errors` — o navegador registra uma falha que nasceu nele (tela quebrou, sem conexão, proxy fora, resposta
 * inválida), com a referência que a pessoa vê. Aceita sem sessão (falha na tela de login também conta); a organização vem só do
 * cookie verificado, nunca do corpo. Limite por IP no app.ts; corpo pequeno e estrito; texto livre sanitizado. Responde 201 só
 * DEPOIS de gravar: é a confirmação que a tela usa para dizer "registrada no servidor" (sem ela, a referência é local).
 */
export function createClientErrorsRouter(db: Pick<Database, "query">) {
  const router = Router()
  router.post("/", async (request, response) => {
    const body = bodySchema.parse(request.body)
    const code = CLIENT_CODES.has(body.code) ? body.code : "INIA-INTERFACE-RENDERIZACAO"
    let organizationId: string | null = null
    const token = request.cookies?.[SESSION_COOKIE_NAME] as string | undefined
    if (token) {
      try {
        organizationId = verifyAuthToken(token).organizationId
      } catch {
        organizationId = null
      }
    }
    const now = new Date()
    const claimed = body.occurredAt ? new Date(body.occurredAt) : now
    // Horário do navegador só se plausível (envio adiado de uma referência local): até 24 h atrás, nunca no futuro.
    const occurredAt = claimed.getTime() <= now.getTime() + 60_000 && now.getTime() - claimed.getTime() <= 86_400_000 ? claimed : now
    const route = normalizeRoute(body.route)
    const details = {
      ...(body.message ? { message: redactSensitive(body.message, 300) } : {}),
      ...(body.digest ? { digest: body.digest } : {}),
      ...(body.online !== undefined ? { online: body.online } : {}),
      ...(body.release ? { interfaceRelease: body.release } : {}),
      ...(body.code !== code ? { reportedCode: redactSensitive(body.code, 80) } : {}),
      userAgent: redactSensitive(String(request.get("user-agent") ?? ""), 160),
      ...(occurredAt !== claimed ? { clientClock: body.occurredAt } : {}),
    }
    log.info({ event: "client_error", reference: body.reference, code, status: body.httpStatus ?? null, route, details }, "falha registrada pelo navegador")
    const existing = await db.query<{ one: number }>(`select 1 as one from error_occurrences where reference = $1 and source = 'CLIENT' limit 1`, [body.reference])
    if (existing.rows.length === 0) {
      const severity = ERROR_CATALOG.find((entry) => entry.code === code)?.severity ?? "error"
      await insertOccurrence(db, { reference: body.reference, code, source: "CLIENT", httpStatus: body.httpStatus ?? null, severity, method: null, route, organizationId, authenticated: organizationId !== null, details, occurredAt })
    }
    response.status(201).json({ data: { reference: body.reference, recorded: true } })
  })
  return router
}
