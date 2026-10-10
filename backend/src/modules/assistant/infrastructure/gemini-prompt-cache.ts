import { createHash } from "node:crypto"
import { env } from "../../../config/env.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"

/**
 * PROMPT CACHE EXPLÍCITO do Gemini (V1.3 — §23–26), só na infraestrutura do provedor. O que vai
 * para o cache é exclusivamente o PREFIXO ESTÁTICO que o gateway marcou como cacheável (prompt
 * de sistema + declarações de Tools) — por contrato do gateway, sem dado de colaborador, sem
 * transcrição, sem ledger, sem KB dinâmica. A chave inclui o modelo e o hash do conteúdo (que já
 * embute a versão dos componentes de prompt): mudou o prompt, mudou a chave — cache obsoleto
 * nunca é reaproveitado. Restrições reais da API verificadas em 2026-09-18: mínimo 1.024 tokens
 * (`min_total_token_count`), e a request que usa `cachedContent` NÃO pode repetir
 * system_instruction/tools (400) — por isso os clientes omitem os dois quando o nome vem preenchido.
 * Qualquer falha ao criar/usar o cache cai para a request normal (nunca bloqueia a resposta).
 */
const CACHED_CONTENTS_URL = "https://generativelanguage.googleapis.com/v1beta/cachedContents"
export const EXPLICIT_CACHE_MIN_TOKENS = 1_024
/** Margem antes do vencimento para não usar um cache que expira durante a request. */
const EXPIRY_MARGIN_MS = 60_000
const REQUEST_TIMEOUT_MS = 20_000

type CacheEntry = { name: string; expiresAt: number; tokens: number }
const entries = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<CacheEntry | null>>()

export type CachedPrefix = { model: string; systemPrompt: string; tools: unknown[]; cacheKeyVersion: string }

export function promptCacheKey(prefix: CachedPrefix): string {
  const hash = createHash("sha256").update(prefix.systemPrompt).update("\n---tools---\n").update(JSON.stringify(prefix.tools)).digest("hex").slice(0, 24)
  return `${prefix.model}:${prefix.cacheKeyVersion}:${hash}`
}

export function explicitCacheEnabled(): boolean {
  return env.INIA_PROMPT_CACHE === "EXPLICIT"
}

/** Só para testes. */
export function resetPromptCacheForTests(): void {
  entries.clear()
  pending.clear()
}

/**
 * Devolve o nome do cache pronto para `cachedContent` (criando-o na primeira vez) ou null quando o
 * prefixo é pequeno demais, a API falhou ou o cache está desligado. `created` = esta chamada criou
 * o cache (os tokens do prefixo são cobrados como entrada uma vez).
 */
export async function ensureCachedPrefix(prefix: CachedPrefix, now = Date.now()): Promise<{ name: string; created: boolean; tokens: number } | null> {
  if (!explicitCacheEnabled() || !env.GEMINI_API_KEY) return null
  if (estimateTokens(prefix.systemPrompt, JSON.stringify(prefix.tools)) < EXPLICIT_CACHE_MIN_TOKENS) return null
  const key = promptCacheKey(prefix)
  const existing = entries.get(key)
  if (existing && existing.expiresAt - EXPIRY_MARGIN_MS > now) return { name: existing.name, created: false, tokens: existing.tokens }
  let creation = pending.get(key)
  if (!creation) {
    creation = createCache(prefix).finally(() => pending.delete(key))
    pending.set(key, creation)
  }
  const entry = await creation
  if (!entry) return null
  entries.set(key, entry)
  return { name: entry.name, created: true, tokens: entry.tokens }
}

async function createCache(prefix: CachedPrefix): Promise<CacheEntry | null> {
  const ttlSeconds = env.INIA_PROMPT_CACHE_TTL_SECONDS
  try {
    const response = await fetch(CACHED_CONTENTS_URL, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY!, "content-type": "application/json" },
      body: JSON.stringify({
        model: `models/${prefix.model}`,
        systemInstruction: { parts: [{ text: prefix.systemPrompt }] },
        ...(prefix.tools.length > 0 ? { tools: [{ functionDeclarations: prefix.tools }] } : {}),
        ttl: `${ttlSeconds}s`,
        displayName: `inia-prefix-${prefix.cacheKeyVersion}`,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) {
      const body = await response.text()
      console.warn(JSON.stringify({ event: "prompt_cache_create_failed", model: prefix.model, status: response.status, body: body.slice(0, 300) }))
      return null
    }
    const payload = (await response.json()) as { name?: string; expireTime?: string; usageMetadata?: { totalTokenCount?: number } }
    if (!payload.name) return null
    const expiresAt = payload.expireTime ? new Date(payload.expireTime).getTime() : Date.now() + ttlSeconds * 1000
    return { name: payload.name, expiresAt, tokens: payload.usageMetadata?.totalTokenCount ?? 0 }
  } catch (error) {
    console.warn(JSON.stringify({ event: "prompt_cache_create_failed", model: prefix.model, message: error instanceof Error ? error.message : String(error) }))
    return null
  }
}
