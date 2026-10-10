import type { LlmCacheRecord, LlmUsage } from "../llm-telemetry.js"

/** Cache OBSERVADO a partir do uso informado pelo provider: tokens cacheados > 0 sem cache explícito = implícito. */
export function observedCacheRecord(usage: LlmUsage, cacheKeyVersion: string | null): LlmCacheRecord {
  const cached = usage.cachedInputTokens
  const prompt = usage.promptTokens
  return { mode: cached !== null && cached > 0 ? "IMPLICIT" : "NONE", cacheKeyVersion, cachedTokens: cached, hitRate: cached !== null && prompt !== null && prompt > 0 ? Math.round((cached / prompt) * 1000) / 1000 : null }
}
