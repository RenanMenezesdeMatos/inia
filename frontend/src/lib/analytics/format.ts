import type { Quartile, Trend } from "@/schemas/analytics/analytics.schema"

/**
 * Formatação de apresentação — só formata o que o backend já calculou. `null` vira sempre
 * "Sem dados" (nunca "0%"), e p.p. nunca é confundido com %.
 */
export const NO_DATA_LABEL = "Sem dados"

const percentFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 })

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_DATA_LABEL
  return `${percentFormatter.format(value)}%`
}

/** Variação em pontos percentuais com sinal: "+2,5 p.p." / "−1 p.p." / "0 p.p.". */
export function formatPp(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_DATA_LABEL
  const sign = value > 0 ? "+" : value < 0 ? "−" : ""
  return `${sign}${percentFormatter.format(Math.abs(value))} p.p.`
}

/** Valor bruto na unidade do indicador — mesma convenção do restante do produto. */
export function formatIndicatorValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) return NO_DATA_LABEL
  switch (unit) {
    case "SECONDS": {
      const minutes = Math.floor(value / 60)
      const seconds = Math.round(value % 60)
      return `${minutes}m${seconds.toString().padStart(2, "0")}s`
    }
    case "PERCENT":
      return `${percentFormatter.format(value)}%`
    case "STARS":
      return `${percentFormatter.format(value)} ★`
    case "POINTS":
      return `${percentFormatter.format(value)} pts`
    case "COUNT":
      return percentFormatter.format(value)
    case "CASES":
      return `${percentFormatter.format(value)} casos`
    case "CASES_PER_DAY":
      return `${percentFormatter.format(value)}/dia`
    default:
      return percentFormatter.format(value)
  }
}

export function formatCount(value: number, singular: string, plural: string): string {
  return `${value.toLocaleString("pt-BR")} ${value === 1 ? singular : plural}`
}

export const TREND_LABELS: Record<Trend, string> = { UP: "Em alta", DOWN: "Em queda", FLAT: "Estável", UNKNOWN: "Sem comparação" }

export const QUARTILE_LABELS: Record<Quartile, string> = { Q1: "Q1 — melhor quartil", Q2: "Q2", Q3: "Q3", Q4: "Q4 — quartil mais baixo" }

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()
}
