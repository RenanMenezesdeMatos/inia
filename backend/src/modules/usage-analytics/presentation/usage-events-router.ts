import express, { Router } from "express"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { MAX_BATCH_BYTES } from "../domain/ingestion-rules.js"
import { ingestClientBatch } from "../application/ingest-client-events.js"

/**
 * `POST /api/v1/usage/events/batch` — ingestão autenticada (cookie de sessão) dos eventos permitidos do navegador.
 *
 * Aceita `application/json` (envio normal) e `text/plain` (envio final no fechamento da página por `fetch keepalive`/beacon,
 * que não pode fazer preflight). No `text/plain`, o Origin precisa ser o do frontend configurado (CORS_ORIGIN) — sem isso o
 * lote é recusado. Resposta 202 com a contagem (aceitos/duplicados/recusados por motivo); 409 quando o lote é de outra conta.
 */
export function createUsageEventsRouter(db: Database, options: { now?: () => Date } = {}) {
  const router = Router()
  router.post("/events/batch", express.text({ type: "text/plain", limit: MAX_BATCH_BYTES }), async (request, response) => {
    const user = request.user!
    let body: unknown = request.body
    let transport: "FETCH" | "BEACON" = "FETCH"
    if (typeof body === "string") {
      const origin = request.headers.origin
      if (origin && origin !== env.CORS_ORIGIN) throw new DomainError("Origem não permitida.", "USAGE_ORIGIN_NOT_ALLOWED", 403)
      transport = "BEACON"
      try {
        body = JSON.parse(body)
      } catch {
        throw new DomainError("Lote de eventos inválido.", "USAGE_BATCH_INVALID", 400)
      }
    } else if (Buffer.byteLength(JSON.stringify(body ?? {})) > MAX_BATCH_BYTES) {
      throw new DomainError("Lote acima do limite.", "USAGE_BATCH_TOO_LARGE", 413)
    }
    const result = await ingestClientBatch(db, { organizationId: user.organizationId, accountId: user.sub, personId: user.personId }, body, { transport, ...(options.now ? { now: options.now() } : {}) })
    response.status(202).json({ data: result })
  })
  return router
}
