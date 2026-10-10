import type { LlmUsage } from "../../../shared/application/llm-telemetry.js"
import { addDecimal, costOfTokens, formatDecimal, isDecimalString, parseDecimal, type Decimal } from "./decimal.js"

/**
 * PRICING VERSIONADO (§40–§44, §47, §94, §95). Custo = USO REAL informado pelo provider × PREÇO
 * CONFIGURADO vigente no instante da chamada — calculado pela aplicação em ponto fixo (nunca float,
 * nunca LLM). Cada versão tem vigência [effectiveFrom, effectiveTo); preço novo FECHA o anterior,
 * nunca o sobrescreve, e o evento de uso guarda o id da versão aplicada → custo histórico reproduzível.
 * Nenhuma conversão de moeda: o custo fica na moeda da tabela.
 */
export type AiPricingVersion = {
  id: string
  modelId: string
  currency: string
  inputPerMillion: string
  outputPerMillion: string
  cachedInputPerMillion: string | null
  reasoningPerMillion: string | null
  effectiveFrom: Date
  effectiveTo: Date | null
  source: "MANUAL"
  note: string | null
}

export const CURRENCY_PATTERN = /^[A-Z]{3}$/

/**
 * EXACT fica reservado para provider que informe o valor cobrado (nenhum dos adapters V1 informa).
 * ESTIMATED = uso informado × tabela; UNKNOWN = sem tabela vigente ou sem uso informado.
 */
export type AiCostStatus = "EXACT" | "ESTIMATED" | "UNKNOWN"
export type AiCostUnknownReason = "NO_PRICING" | "NO_USAGE"

export type AiCostResult =
  | { status: "ESTIMATED"; currency: string; amount: string; pricingId: string; breakdown: { input: string; cachedInput: string; output: string; reasoning: string } }
  | { status: "UNKNOWN"; reason: AiCostUnknownReason; currency: string | null; amount: null; pricingId: string | null }

export function pricingAt(versions: readonly AiPricingVersion[], at: Date): AiPricingVersion | null {
  const time = at.getTime()
  return versions.find((version) => version.effectiveFrom.getTime() <= time && (version.effectiveTo === null || time < version.effectiveTo.getTime())) ?? null
}

/**
 * Custo de UMA chamada. Entrada não cacheada × input; cacheada × cachedInput (ou input sem tarifa
 * própria); saída × output; raciocínio × reasoning SÓ quando a tabela o tarifa à parte (senão o
 * provider já o conta dentro da saída — nunca cobrar duas vezes). Sem uso informado = UNKNOWN (§77):
 * nunca fabricar contagem.
 */
export function computeCallCost(usage: LlmUsage, pricing: AiPricingVersion | null): AiCostResult {
  if (!pricing) return { status: "UNKNOWN", reason: "NO_PRICING", currency: null, amount: null, pricingId: null }
  if (usage.promptTokens === null || usage.outputTokens === null) return { status: "UNKNOWN", reason: "NO_USAGE", currency: pricing.currency, amount: null, pricingId: pricing.id }
  const cachedTokens = Math.min(usage.cachedInputTokens ?? 0, usage.promptTokens)
  const uncachedTokens = usage.promptTokens - cachedTokens
  const inputPrice = parseDecimal(pricing.inputPerMillion)
  const cachedPrice = pricing.cachedInputPerMillion !== null ? parseDecimal(pricing.cachedInputPerMillion) : inputPrice
  const input = costOfTokens(uncachedTokens, inputPrice)
  const cachedInput = costOfTokens(cachedTokens, cachedPrice)
  const output = costOfTokens(usage.outputTokens, parseDecimal(pricing.outputPerMillion))
  const reasoning = pricing.reasoningPerMillion !== null ? costOfTokens(usage.reasoningTokens ?? 0, parseDecimal(pricing.reasoningPerMillion)) : 0n
  const total = addDecimal(input, cachedInput, output, reasoning)
  return { status: "ESTIMATED", currency: pricing.currency, amount: formatDecimal(total), pricingId: pricing.id, breakdown: { input: formatDecimal(input), cachedInput: formatDecimal(cachedInput), output: formatDecimal(output), reasoning: formatDecimal(reasoning) } }
}

/** Estimativa ANTES da chamada (§53): só a entrada é previsível — a saída é variável e fica de fora (limitação documentada). */
export function estimateInputCost(estimatedInputTokens: number, pricing: AiPricingVersion | null): Decimal | null {
  if (!pricing) return null
  return costOfTokens(Math.max(0, Math.round(estimatedInputTokens)), parseDecimal(pricing.inputPerMillion))
}

/** Preço "combinado" para ordenar COST_FIRST: entrada + saída por milhão (documentado; não é custo real). */
export function blendedPrice(pricing: AiPricingVersion | null): Decimal | null {
  if (!pricing) return null
  return parseDecimal(pricing.inputPerMillion) + parseDecimal(pricing.outputPerMillion)
}

export function isZeroPricing(pricing: AiPricingVersion | null): boolean {
  if (!pricing) return false
  return [pricing.inputPerMillion, pricing.outputPerMillion, pricing.cachedInputPerMillion ?? "0", pricing.reasoningPerMillion ?? "0"].every((value) => parseDecimal(value) === 0n)
}

export type PricingInput = {
  currency: string
  inputPerMillion: string
  outputPerMillion: string
  cachedInputPerMillion?: string | null
  reasoningPerMillion?: string | null
  effectiveFrom: Date
}

/** Validação de uma versão nova — decimal não negativo, moeda ISO de 3 letras. */
export function validatePricingInput(input: PricingInput): string[] {
  const issues: string[] = []
  if (!CURRENCY_PATTERN.test(input.currency)) issues.push("Moeda deve ser um código ISO de 3 letras (ex.: USD, BRL).")
  const fields: [string, string | null | undefined][] = [["inputPerMillion", input.inputPerMillion], ["outputPerMillion", input.outputPerMillion], ["cachedInputPerMillion", input.cachedInputPerMillion], ["reasoningPerMillion", input.reasoningPerMillion]]
  for (const [name, value] of fields) {
    if (value === null || value === undefined) continue
    if (!isDecimalString(value) || parseDecimal(value) < 0n) issues.push(`${name} deve ser um decimal não negativo.`)
  }
  if (Number.isNaN(input.effectiveFrom.getTime())) issues.push("Início de vigência inválido.")
  return issues
}
