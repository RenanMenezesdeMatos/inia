/**
 * Aritmética de atingimento — sempre sobre `achievement_percent` (normalizado, comparável entre
 * indicadores de unidades diferentes), NUNCA sobre valores brutos (segundos, notas, %). SEM DADOS
 * (null) é first-class: fica fora de qualquer média, nunca vira zero.
 */

/** Média aritmética simples dos valores válidos; `null` quando não há nenhum. */
export function averageValid(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  if (valid.length === 0) return null
  return roundTo(valid.reduce((sum, value) => sum + value, 0) / valid.length, 1)
}

/** Diferença em pontos percentuais (p.p.) entre dois atingimentos — `null` se algum lado não existe. */
export function deltaPercentagePoints(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null
  return roundTo(current - previous, 1)
}

export type Trend = "UP" | "DOWN" | "FLAT" | "UNKNOWN"

/** Variações menores que 0,5 p.p. são ruído de arredondamento, não tendência. */
export const FLAT_TREND_THRESHOLD_PP = 0.5

export function trendFromDelta(delta: number | null): Trend {
  if (delta === null) return "UNKNOWN"
  if (delta >= FLAT_TREND_THRESHOLD_PP) return "UP"
  if (delta <= -FLAT_TREND_THRESHOLD_PP) return "DOWN"
  return "FLAT"
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Quantas competências consecutivas (a partir da mais recente) satisfazem o predicado. A série
 * chega do mais antigo pro mais recente; `null` interrompe a sequência (SEM DADOS não conta). */
export function consecutiveFromLatest(series: (number | null)[], predicate: (value: number) => boolean): number {
  let count = 0
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const value = series[index]
    if (value === null || value === undefined || !predicate(value)) break
    count += 1
  }
  return count
}
