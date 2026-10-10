import type { LlmUsage } from "../../../shared/application/llm-telemetry.js"
import type { InvestigationTokens, TokenBudgetStatus } from "./tool-trace.js"

/** Limiar 0/ausente = desligado (null). */
export type TokenThresholds = { total: number | null; input: number | null; output: number | null }

export const EMPTY_TOKENS: InvestigationTokens = { input: null, cached: null, output: null, reasoning: null, total: null }

/** Soma tokens informados pelo provider — campo fica null enquanto NENHUMA request o informou. */
export function addTokens(acc: InvestigationTokens, usage: LlmUsage): InvestigationTokens {
  const sum = (left: number | null, right: number | null) => (left === null && right === null ? null : (left ?? 0) + (right ?? 0))
  return {
    input: sum(acc.input, usage.promptTokens),
    cached: sum(acc.cached, usage.cachedInputTokens),
    output: sum(acc.output, usage.outputTokens),
    reasoning: sum(acc.reasoning, usage.reasoningTokens),
    total: sum(acc.total, usage.totalTokens),
  }
}

/** Observabilidade do Token Budget: OK / WARNING (algum limiar ultrapassado) / NOT_INFORMED (provider sem contagem). */
export function evaluateTokenBudget(tokens: InvestigationTokens, thresholds: TokenThresholds): TokenBudgetStatus {
  const normalized: TokenThresholds = { total: thresholds.total || null, input: thresholds.input || null, output: thresholds.output || null }
  if (tokens.total === null && tokens.input === null && tokens.output === null) return { status: "NOT_INFORMED", thresholds: normalized, exceeded: [] }
  const exceeded: TokenBudgetStatus["exceeded"] = []
  if (normalized.total !== null && tokens.total !== null && tokens.total > normalized.total) exceeded.push("total")
  if (normalized.input !== null && tokens.input !== null && tokens.input > normalized.input) exceeded.push("input")
  if (normalized.output !== null && tokens.output !== null && tokens.output > normalized.output) exceeded.push("output")
  return { status: exceeded.length > 0 ? "WARNING" : "OK", thresholds: normalized, exceeded }
}
