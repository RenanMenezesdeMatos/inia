/**
 * VALOR DE MÉTRICA — a forma única em que todo número sai da API (cards, tabelas e CSV usam a mesma). Quatro estados que
 * NUNCA se confundem:
 *   - VALUE            número observado com cobertura (inclusive 0 observado: zero só aparece quando houve medição);
 *   - NO_DATA          a fonte não tinha medição no período (telemetria ausente / antes do início da coleta) — nunca 0;
 *   - NOT_APPLICABLE   o denominador é zero (taxa sem base);
 *   - PARTIAL          o número existe, mas parte do período não estava coberto (dito junto do número).
 */
export type MetricStatus = "VALUE" | "NO_DATA" | "NOT_APPLICABLE" | "PARTIAL"
export type CoverageStatus = "FULL" | "PARTIAL" | "NONE"
export type Coverage = { status: CoverageStatus; from: string | null; note: string | null }

export type VariationKind = "PERCENT" | "PERCENTAGE_POINTS"
export type Variation = {
  kind: VariationKind
  value: number | null
  /** NO_BASE = anterior zero (sem base para variação percentual); NOT_APPLICABLE = taxa sem denominador em algum dos lados. */
  status: "VALUE" | "NO_BASE" | "NOT_APPLICABLE" | "NO_DATA"
  previous: number | null
  label: string
}

export type MetricValue = {
  metric: string
  status: MetricStatus
  value: number | null
  numerator: number | null
  denominator: number | null
  coverage: Coverage
  variation: Variation | null
}

export const round = (value: number, digits = 1) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Taxa em % com 1 casa; denominador zero = não aplicável (null). */
export const rate = (numerator: number, denominator: number): number | null => (denominator > 0 ? round((numerator / denominator) * 100, 1) : null)

/** Variação de VOLUME (percentual). Anterior 0 → "sem base para variação percentual" — nunca infinito. */
export function volumeVariation(current: number | null, previous: number | null): Variation {
  if (current === null || previous === null) return { kind: "PERCENT", value: null, status: "NO_DATA", previous, label: "Sem dados para comparar" }
  if (previous === 0) return { kind: "PERCENT", value: null, status: "NO_BASE", previous, label: current === 0 ? "Sem variação (0 → 0)" : "Sem base para variação percentual" }
  const value = round(((current - previous) / previous) * 100, 1)
  return { kind: "PERCENT", value, status: "VALUE", previous, label: `${value > 0 ? "+" : ""}${formatDecimal(value)}% vs. período anterior` }
}

/** Variação de TAXA em pontos percentuais. Qualquer lado sem base = não aplicável. */
export function rateVariation(current: number | null, previous: number | null): Variation {
  if (current === null || previous === null) return { kind: "PERCENTAGE_POINTS", value: null, status: "NOT_APPLICABLE", previous, label: "Comparação não aplicável" }
  const value = round(current - previous, 1)
  return { kind: "PERCENTAGE_POINTS", value, status: "VALUE", previous, label: `${value > 0 ? "+" : ""}${formatDecimal(value)} p.p. vs. período anterior` }
}

export const formatDecimal = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })

/** Cobertura de um período [start, end) por uma fonte que começou em `since` (null = nunca coletou). */
export function coverageOf(since: Date | null, start: Date, end: Date, note: string | null = null): Coverage {
  if (!since || since.getTime() >= end.getTime()) return { status: "NONE", from: since?.toISOString() ?? null, note: note ?? "Histórico não medido neste período." }
  if (since.getTime() > start.getTime()) return { status: "PARTIAL", from: since.toISOString(), note: note ?? "Período parcialmente coberto: antes do início da medição não há dados." }
  return { status: "FULL", from: since.toISOString(), note }
}

/** Contagem (pessoas, sessões, eventos). Zero com cobertura = 0; sem cobertura = sem dados. */
export function countMetric(metric: string, value: number, coverage: Coverage, previous?: { value: number; coverage: Coverage } | null): MetricValue {
  if (coverage.status === "NONE") return { metric, status: "NO_DATA", value: null, numerator: null, denominator: null, coverage, variation: null }
  const variation = previous ? (previous.coverage.status === "NONE" ? volumeVariation(value, null) : volumeVariation(value, previous.value)) : null
  return { metric, status: coverage.status === "PARTIAL" ? "PARTIAL" : "VALUE", value, numerator: null, denominator: null, coverage, variation }
}

/** Taxa com numerador e base. Base zero = não aplicável; sem cobertura = sem dados. */
export function rateMetric(metric: string, numerator: number, denominator: number, coverage: Coverage, previous?: { numerator: number; denominator: number; coverage: Coverage } | null): MetricValue {
  if (coverage.status === "NONE") return { metric, status: "NO_DATA", value: null, numerator: null, denominator: null, coverage, variation: null }
  const value = rate(numerator, denominator)
  const previousValue = previous && previous.coverage.status !== "NONE" ? rate(previous.numerator, previous.denominator) : null
  return {
    metric,
    status: value === null ? "NOT_APPLICABLE" : coverage.status === "PARTIAL" ? "PARTIAL" : "VALUE",
    value,
    numerator,
    denominator,
    coverage,
    variation: previous ? rateVariation(value, previousValue) : null,
  }
}

/** Valor contínuo (duração, latência, razão) — null = sem observações (não aplicável). */
export function valueMetric(metric: string, value: number | null, coverage: Coverage, previous?: { value: number | null; coverage: Coverage } | null): MetricValue {
  if (coverage.status === "NONE") return { metric, status: "NO_DATA", value: null, numerator: null, denominator: null, coverage, variation: null }
  const variation = previous ? volumeVariation(value, previous.coverage.status === "NONE" ? null : previous.value) : null
  return { metric, status: value === null ? "NOT_APPLICABLE" : coverage.status === "PARTIAL" ? "PARTIAL" : "VALUE", value, numerator: null, denominator: null, coverage, variation }
}

/** Percentil contínuo (interpolação linear — o mesmo `percentile_cont` do Postgres). Lista vazia = null. */
export function percentileCont(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const lowerValue = sorted[lower]!
  const upperValue = sorted[upper]!
  return lowerValue + (upperValue - lowerValue) * (position - lower)
}

export function distribution(values: readonly number[]) {
  if (values.length === 0) return { count: 0, mean: null, median: null, p95: null }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return { count: values.length, mean: round(mean, 1), median: round(percentileCont(values, 0.5)!, 1), p95: round(percentileCont(values, 0.95)!, 1) }
}
