import { createHash } from "node:crypto"
import { BlockList, isIP } from "node:net"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { rateLimitBucket } from "../../../shared/application/rate-limit/rate-limit-store.js"
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
 * Rate limit por TOKEN (60 req/min, janela deslizante): conta na loja de limites do contexto — no servidor, a do PostgreSQL
 * (`rate_limit_hits`), dividida por todas as APIs atrás do IIS (antes era um balde em memória por processo: com N APIs o
 * limite efetivo virava N × 60). A chave é o id do token JÁ AUTENTICADO, nunca o texto enviado. Atrás de um gateway com rate
 * limit próprio, o dele prevalece. Loja fora do ar = a requisição passa (aviso no log).
 */
export const PUSH_RATE_LIMIT_PER_MINUTE = 60

export async function consumePushQuota(ctx: DataHubContext, tokenId: string, limit = PUSH_RATE_LIMIT_PER_MINUTE): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  try {
    const decision = await ctx.pushRateLimits.consume(rateLimitBucket("push-token", tokenId), 60_000, limit)
    return { allowed: decision.allowed, retryAfterSeconds: Math.max(1, Math.ceil(decision.retryAfterMs / 1000)) }
  } catch (error) {
    ctx.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "data-hub push rate limit store unavailable")
    return { allowed: true, retryAfterSeconds: 0 }
  }
}

export type PushAuth = { source: DataSourceRow; feed: DataFeedRow; tokenId: string }

/** Endereço do cliente (IPv4 mapeado em IPv6 vira IPv4) dentro de alguma das redes autorizadas do token (IP ou CIDR). */
export function clientInNetworks(clientIp: string | null, networks: readonly string[]): boolean {
  const ip = clientIp?.replace(/^::ffff:/i, "") ?? ""
  const family = isIP(ip)
  if (!family) return false
  const list = new BlockList()
  for (const network of networks) {
    const [address, prefix] = network.split("/")
    const networkFamily = isIP(address ?? "")
    if (!networkFamily) continue
    const type = networkFamily === 6 ? "ipv6" : "ipv4"
    if (prefix === undefined) list.addAddress(address!, type)
    else list.addSubnet(address!, Number(prefix), type)
  }
  return list.check(ip, family === 6 ? "ipv6" : "ipv4")
}

/**
 * Autentica o token contra a fonte/feed da URL. Erros são genéricos de propósito (não revelam se a fonte existe). Token com
 * validade vencida ou chamado de fora das redes autorizadas dele (R-28) recebe a MESMA recusa de um token inexistente.
 */
export async function authenticatePush(ctx: DataHubContext, input: { sourcePublicId: string; feedKey: string; token: string | null; clientIp?: string | null }): Promise<PushAuth> {
  const unauthorized = () => new DomainError("Credencial inválida.", "DATA_PUSH_UNAUTHORIZED", 401)
  // Token real = `inia_push_` + 32 caracteres; qualquer coisa muito maior nem chega ao banco.
  if (!input.token || input.token.length > 200) throw unauthorized()
  const tokenRow = await ctx.db.query<{ id: string; source_id: string; feed_id: string | null; expired: boolean; allowed_networks: string[] | null }>(
    `select id, source_id, feed_id, (expires_at is not null and expires_at <= now()) expired, allowed_networks from data_push_tokens where token_hash = $1 and revoked_at is null`,
    [hashPushToken(input.token)],
  )
  const token = tokenRow.rows[0]
  if (!token || token.expired) throw unauthorized()
  if (token.allowed_networks && !clientInNetworks(input.clientIp ?? null, token.allowed_networks)) throw unauthorized()
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

/**
 * Mesma `Idempotency-Key` = o MESMO lote: devolve a carga já recebida. Mesma chave com outro corpo é erro do cliente (o lote novo
 * se perderia em silêncio — R-29): 422. Cargas antigas, sem hash do corpo, seguem deduplicadas como antes.
 */
async function existingForKey(ctx: DataHubContext, auth: PushAuth, idempotencyKey: string, bodyHash: string): Promise<{ run: DataRunRow; deduplicated: true } | null> {
  const existing = await ctx.db.query<{ id: string; idempotency_body_sha256: string | null }>(`select id, idempotency_body_sha256 from data_ingestion_runs where feed_id = $1 and idempotency_key = $2`, [auth.feed.id, idempotencyKey])
  const row = existing.rows[0]
  if (!row) return null
  if (row.idempotency_body_sha256 && row.idempotency_body_sha256 !== bodyHash) {
    throw new DomainError("Esta Idempotency-Key já foi usada com outro conteúdo. Use uma chave nova para um lote diferente.", "DATA_PUSH_IDEMPOTENCY_CONFLICT", 422, { runId: row.id })
  }
  return { run: (await findRun(ctx.db, auth.source.organizationId, row.id))!, deduplicated: true }
}

export async function receivePush(ctx: DataHubContext, auth: PushAuth, input: { body: unknown; idempotencyKey: string | null; rawBytes: number }): Promise<{ run: DataRunRow; deduplicated: boolean }> {
  const content = new TextEncoder().encode(JSON.stringify(input.body))
  const bodyHash = createHash("sha256").update(content).digest("hex")
  if (input.idempotencyKey) {
    const existing = await existingForKey(ctx, auth, input.idempotencyKey, bodyHash)
    if (existing) return existing
  }
  const raw = await ctx.rawObjects.put({ organizationId: auth.source.organizationId, sourceId: auth.source.id, feedId: auth.feed.id, filename: null, contentType: "application/json", content })
  try {
    return await enqueueRun(ctx, { organizationId: auth.source.organizationId, feed: auth.feed, triggerKind: "PUSH", requestedBy: null, rawObjectId: raw.id, idempotencyKey: input.idempotencyKey, idempotencyBodySha256: input.idempotencyKey ? bodyHash : null })
  } catch (error) {
    // Corrida entre dois envios com a mesma chave: o índice único decide; devolve o vencedor (ou recusa, se o corpo é outro).
    if ((error as { code?: string }).code === "23505" && input.idempotencyKey) {
      const existing = await existingForKey(ctx, auth, input.idempotencyKey, bodyHash)
      if (existing) return existing
    }
    throw error
  }
}
