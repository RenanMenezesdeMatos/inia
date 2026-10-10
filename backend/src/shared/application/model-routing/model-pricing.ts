import { env } from "../../../config/env.js"
import type { LlmUsage } from "../llm-telemetry.js"

/**
 * PRICING CONFIGURÁVEL por perfil de modelo (V1.3 — §28/29). Nenhum preço é hard-coded no
 * domínio: `INIA_MODEL_PRICING` (JSON) informa, por id de perfil OU por nome de modelo, as tarifas
 * por milhão de tokens. Sem configuração o custo é NOT_CONFIGURED — nunca um número inventado.
 * O resultado é sempre ESTIMATED_PROVIDER_COST (estimativa a partir do uso informado pelo
 * provider), nunca fatura real.
 *
 * Exemplo: INIA_MODEL_PRICING='[{"model":"gemini-3.8-flash","inputPerMillion":0.3,"cachedInputPerMillion":0.03,"outputPerMillion":2.5,"currency":"USD"}]'
 */
export type ModelPricing = {
  /** id do perfil (model-registry) ou nome do modelo — o que casar primeiro. */
  profileId?: string
  model?: string
  inputPerMillion: number
  cachedInputPerMillion: number | null
  outputPerMillion: number
  /** Tokens de raciocínio — quando o provider cobra à parte; null = cobrados como saída. */
  reasoningPerMillion: number | null
  currency: string
}

export type CostEstimate =
  | { status: "NOT_CONFIGURED" }
  | { status: "ESTIMATED_PROVIDER_COST"; currency: string; inputCost: number; cachedInputCost: number; outputCost: number; reasoningCost: number; totalEstimatedCost: number }

let cached: ModelPricing[] | null = null

export function listModelPricing(): ModelPricing[] {
  if (cached) return cached
  cached = []
  const raw = env.INIA_MODEL_PRICING
  if (!raw) return cached
  try {
    const parsed = JSON.parse(raw) as Partial<ModelPricing>[]
    cached = parsed
      .filter((item) => typeof item.inputPerMillion === "number" && typeof item.outputPerMillion === "number" && (typeof item.profileId === "string" || typeof item.model === "string"))
      .map((item) => ({
        ...(item.profileId ? { profileId: item.profileId } : {}),
        ...(item.model ? { model: item.model } : {}),
        inputPerMillion: item.inputPerMillion!,
        cachedInputPerMillion: typeof item.cachedInputPerMillion === "number" ? item.cachedInputPerMillion : null,
        outputPerMillion: item.outputPerMillion!,
        reasoningPerMillion: typeof item.reasoningPerMillion === "number" ? item.reasoningPerMillion : null,
        currency: typeof item.currency === "string" ? item.currency : "USD",
      }))
  } catch {
    console.warn(JSON.stringify({ event: "model_pricing_invalid", message: "INIA_MODEL_PRICING não é JSON válido — custo NOT_CONFIGURED" }))
  }
  return cached
}

/** Só para testes. */
export function setModelPricingForTests(pricing: ModelPricing[] | null): void {
  cached = pricing
}

export function pricingFor(profileId: string | null, model: string): ModelPricing | null {
  const list = listModelPricing()
  return list.find((item) => item.profileId && item.profileId === profileId) ?? list.find((item) => item.model && item.model === model) ?? null
}

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000

/**
 * Custo estimado de UMA request: entrada não cacheada × input; entrada cacheada × cached (ou
 * input quando a tarifa cacheada não foi configurada); saída × output; raciocínio × reasoning
 * quando configurado (senão já está dentro da saída informada pelo provider — não cobra duas vezes).
 */
export function estimateCost(usage: LlmUsage, pricing: ModelPricing | null): CostEstimate {
  if (!pricing) return { status: "NOT_CONFIGURED" }
  const cachedTokens = usage.cachedInputTokens ?? 0
  const uncachedTokens = Math.max(0, (usage.promptTokens ?? 0) - cachedTokens)
  const inputCost = (uncachedTokens / 1_000_000) * pricing.inputPerMillion
  const cachedInputCost = (cachedTokens / 1_000_000) * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion)
  const outputCost = ((usage.outputTokens ?? 0) / 1_000_000) * pricing.outputPerMillion
  const reasoningCost = pricing.reasoningPerMillion !== null ? ((usage.reasoningTokens ?? 0) / 1_000_000) * pricing.reasoningPerMillion : 0
  return {
    status: "ESTIMATED_PROVIDER_COST",
    currency: pricing.currency,
    inputCost: round6(inputCost),
    cachedInputCost: round6(cachedInputCost),
    outputCost: round6(outputCost),
    reasoningCost: round6(reasoningCost),
    totalEstimatedCost: round6(inputCost + cachedInputCost + outputCost + reasoningCost),
  }
}

export function addCost(acc: CostEstimate, cost: CostEstimate): CostEstimate {
  if (cost.status === "NOT_CONFIGURED") return acc
  if (acc.status === "NOT_CONFIGURED") return cost
  return {
    status: "ESTIMATED_PROVIDER_COST",
    currency: acc.currency,
    inputCost: round6(acc.inputCost + cost.inputCost),
    cachedInputCost: round6(acc.cachedInputCost + cost.cachedInputCost),
    outputCost: round6(acc.outputCost + cost.outputCost),
    reasoningCost: round6(acc.reasoningCost + cost.reasoningCost),
    totalEstimatedCost: round6(acc.totalEstimatedCost + cost.totalEstimatedCost),
  }
}
