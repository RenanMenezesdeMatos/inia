import express, { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { authenticatePush, checkRateLimit, receivePush } from "../application/push-ingestion.js"
import { kickWorker } from "../application/run-service.js"

/**
 * Endpoint inbound do API Push — `POST /api/v1/data-ingestion/:sourcePublicId/:feedKey`.
 * Autenticação por token de push (Bearer), `Idempotency-Key` opcional mas recomendado, corpo
 * JSON até 10 MB, rate limit por token. Sempre 202 com o runId: o processamento é assíncrono.
 * Nunca usa a sessão de usuário — é o cliente (sistema) que chama.
 */
const paramsSchema = z.object({ sourcePublicId: z.string().regex(/^[a-z0-9]{4,32}$/), feedKey: z.string().regex(/^[a-z0-9][a-z0-9-_]{1,63}$/) })

export function createDataIngestionRouter(db: Database, contextOverrides: Partial<Omit<DataHubContext, "db">> = {}) {
  const ctx = createDataHubContext(db, contextOverrides)
  const router = Router()
  router.use(express.json({ limit: "10mb" }))

  router.post("/:sourcePublicId/:feedKey", async (request, response) => {
    const params = paramsSchema.safeParse(request.params)
    if (!params.success) throw new DomainError("Credencial inválida.", "DATA_PUSH_UNAUTHORIZED", 401)
    const header = request.header("authorization") ?? ""
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null
    // Antes de autenticar, só o limite por IP (app.ts); o balde por token usa o id do token JÁ validado (achado I-F6: antes a
    // chave era o texto enviado — tokens forjados únicos enchiam a memória do processo).
    const auth = await authenticatePush(ctx, { sourcePublicId: params.data.sourcePublicId, feedKey: params.data.feedKey, token })
    if (!checkRateLimit(auth.tokenId)) throw new DomainError("Limite de requisições excedido. Tente novamente em instantes.", "DATA_PUSH_RATE_LIMITED", 429)
    const idempotencyKey = request.header("idempotency-key")?.trim().slice(0, 200) || null
    const body = request.body
    if (body === undefined || body === null || (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0)) {
      throw new DomainError("Envie um corpo JSON com os registros (ex.: { \"records\": [...] }).", "DATA_PUSH_EMPTY_BODY", 422)
    }
    const { run, deduplicated } = await receivePush(ctx, auth, { body, idempotencyKey, rawBytes: Number(request.header("content-length") ?? 0) })
    if (!deduplicated) kickWorker(ctx)
    response.status(202).json({ data: { runId: run.id, status: run.status, deduplicated, feedKey: auth.feed.feedKey, contract: `${auth.feed.contractKey}@${auth.feed.contractVersion}` } })
  })

  return router
}
