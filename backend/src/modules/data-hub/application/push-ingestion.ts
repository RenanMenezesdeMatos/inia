import { DomainError } from "../../../shared/domain/domain-error.js"
import type { DataHubContext } from "./data-hub-context.js"
import { findRun, SELECT_FEED, SELECT_SOURCE, type DataFeedRow, type DataRunRow, type DataSourceRow } from "./records.js"
import { enqueueRun } from "./run-service.js"
import { hashPushToken } from "./source-service.js"

/**
 * API Push: o cliente envia `POST /api/v1/data-ingestion/:sourcePublicId/:feedKey` com
 * `Authorization: Bearer <token>` e `Idempotency-Key`. O payload é retido como objeto bruto e
 * vira um Run na fila (202 + runId) — nunca processado dentro do request. Mesmo lote com a mesma
 * Idempotency-Key devolve o MESMO Run (nada duplica).
 *
 * Rate limit: token bucket em memória por token (60 req/min, burst 60) — proteção do endpoint
 * inbound proporcional à infraestrutura atual (uma instância); atrás de um gateway com rate limit
 * próprio, o dele prevalece.
 */
const RATE_LIMIT_PER_MINUTE = 60
const buckets = new Map<string, { tokens: number; refilledAt: number }>()
/** Teto de baldes vivos: a chave é o id do token JÁ AUTENTICADO (nunca o texto enviado), mas o mapa nunca cresce sem limite. */
const MAX_BUCKETS = 10_000

export function checkRateLimit(key: string, now = Date.now(), limit = RATE_LIMIT_PER_MINUTE): boolean {
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value
    if (oldest !== undefined) buckets.delete(oldest)
  }
  const bucket = buckets.get(key) ?? { tokens: limit, refilledAt: now }
  const elapsedMinutes = (now - bucket.refilledAt) / 60_000
  bucket.tokens = Math.min(limit, bucket.tokens + elapsedMinutes * limit)
  bucket.refilledAt = now
  if (bucket.tokens < 1) {
    buckets.set(key, bucket)
    return false
  }
  bucket.tokens -= 1
  buckets.set(key, bucket)
  return true
}

export type PushAuth = { source: DataSourceRow; feed: DataFeedRow; tokenId: string }

/** Autentica o token contra a fonte/feed da URL. Erros são genéricos de propósito (não revelam se a fonte existe). */
export async function authenticatePush(ctx: DataHubContext, input: { sourcePublicId: string; feedKey: string; token: string | null }): Promise<PushAuth> {
  const unauthorized = () => new DomainError("Credencial inválida.", "DATA_PUSH_UNAUTHORIZED", 401)
  // Token real = `inia_push_` + 32 caracteres; qualquer coisa muito maior nem chega ao banco.
  if (!input.token || input.token.length > 200) throw unauthorized()
  const tokenRow = await ctx.db.query<{ id: string; source_id: string; feed_id: string | null }>(`select id, source_id, feed_id from data_push_tokens where token_hash = $1 and revoked_at is null`, [hashPushToken(input.token)])
  const token = tokenRow.rows[0]
  if (!token) throw unauthorized()
  const source = (await ctx.db.query<DataSourceRow>(`${SELECT_SOURCE} where s.id = $1 and s.public_id = $2 and s.deleted_at is null`, [token.source_id, input.sourcePublicId])).rows[0]
  if (!source || source.kind !== "API_PUSH") throw unauthorized()
  const feed = (await ctx.db.query<DataFeedRow>(`${SELECT_FEED} where f.source_id = $1 and f.feed_key = $2 and f.deleted_at is null`, [source.id, input.feedKey])).rows[0]
  if (!feed) throw unauthorized()
  if (token.feed_id && token.feed_id !== feed.id) throw unauthorized()
  if (source.status !== "ACTIVE") throw new DomainError("A fonte está pausada ou em rascunho — ative-a na Central de Dados.", "DATA_SOURCE_INACTIVE", 409)
  if (feed.status !== "ACTIVE" && feed.status !== "DEGRADED") throw new DomainError("O feed não está ativo — ative-o na Central de Dados.", "DATA_FEED_INACTIVE", 409)
  await ctx.db.query(`update data_push_tokens set last_used_at = now() where id = $1`, [token.id])
  return { source, feed, tokenId: token.id }
}

export async function receivePush(ctx: DataHubContext, auth: PushAuth, input: { body: unknown; idempotencyKey: string | null; rawBytes: number }): Promise<{ run: DataRunRow; deduplicated: boolean }> {
  if (input.idempotencyKey) {
    const existing = await ctx.db.query<{ id: string }>(`select id from data_ingestion_runs where feed_id = $1 and idempotency_key = $2`, [auth.feed.id, input.idempotencyKey])
    if (existing.rows[0]) {
      return { run: (await findRun(ctx.db, auth.source.organizationId, existing.rows[0].id))!, deduplicated: true }
    }
  }
  const raw = await ctx.rawObjects.put({ organizationId: auth.source.organizationId, sourceId: auth.source.id, feedId: auth.feed.id, filename: null, contentType: "application/json", content: new TextEncoder().encode(JSON.stringify(input.body)) })
  try {
    return await enqueueRun(ctx, { organizationId: auth.source.organizationId, feed: auth.feed, triggerKind: "PUSH", requestedBy: null, rawObjectId: raw.id, idempotencyKey: input.idempotencyKey })
  } catch (error) {
    // Corrida entre dois envios com a mesma chave: o índice único decide; devolve o vencedor.
    if ((error as { code?: string }).code === "23505" && input.idempotencyKey) {
      const existing = await ctx.db.query<{ id: string }>(`select id from data_ingestion_runs where feed_id = $1 and idempotency_key = $2`, [auth.feed.id, input.idempotencyKey])
      return { run: (await findRun(ctx.db, auth.source.organizationId, existing.rows[0]!.id))!, deduplicated: true }
    }
    throw error
  }
}
