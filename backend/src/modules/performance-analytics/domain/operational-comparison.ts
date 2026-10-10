import type { HistoricalPeriod } from "../../workflows/domain/graph-schema.js"

/**
 * COMPARAÇÃO OPERACIONAL da área de Indicadores — como o acompanhamento operacional (camada 1,
 * medição diária) escolhe a janela "atual" e a janela "anterior" que aparecem lado a lado no
 * card do colaborador e no resumo da estrutura. Antes era fixa em "últimos 7 dias × 7 dias
 * anteriores"; agora é escolhida na tela (query `comparison`), com o mesmo vocabulário de janela
 * das Conditions/Ranking (time-window.ts) — nunca uma matemática própria da tela.
 *
 * Semântica de cada opção (calendário LOCAL da organização):
 *  - ROLLING_7_DAYS: os 7 dias corridos terminando hoje (parcial) × os 7 dias imediatamente anteriores.
 *  - WEEK/MONTH/TWO_MONTHS/QUARTER: o período civil CORRENTE, parcial até agora (semana = seg–dom;
 *    bimestre = jan–fev, mar–abr…; trimestre = jan–mar…) × o período civil ANTERIOR completo.
 *    O card sempre mostra as datas reais de cada janela, então "parcial" nunca fica implícito.
 */
export const OPERATIONAL_COMPARISONS = ["ROLLING_7_DAYS", "WEEK", "MONTH", "TWO_MONTHS", "QUARTER"] as const
export type OperationalComparison = (typeof OPERATIONAL_COMPARISONS)[number]
export const DEFAULT_OPERATIONAL_COMPARISON: OperationalComparison = "ROLLING_7_DAYS"

export function isOperationalComparison(value: unknown): value is OperationalComparison {
  return typeof value === "string" && (OPERATIONAL_COMPARISONS as readonly string[]).includes(value)
}

/** Período (vocabulário único de time-window.ts) que a comparação usa como janela ATUAL. */
export function operationalComparisonPeriod(comparison: OperationalComparison): HistoricalPeriod {
  if (comparison === "ROLLING_7_DAYS") return { kind: "ROLLING_DAYS", days: 7 }
  return { kind: "CALENDAR", unit: comparison, phase: "CURRENT" }
}

/** Rótulos prontos pra tela — a UI nunca monta "últimos N dias" por conta própria. */
export type OperationalComparisonView = {
  kind: OperationalComparison
  /** "Mês corrente × mês anterior" — nome da opção no seletor e no cabeçalho do resumo. */
  label: string
  /** Janela atual: "Últimos 7 dias" / "Mês corrente (até hoje)". */
  currentLabel: string
  /** Janela anterior: "7 dias anteriores" / "Mês anterior (completo)". */
  previousLabel: string
  /** Frase com preposição pra compor sentenças: "nos últimos 7 dias" / "no mês corrente (até hoje)". */
  currentPhrase: string
  /** Complemento de "comparado com …": "os 7 dias anteriores" / "o mês anterior". */
  previousPhrase: string
  /** Sufixo curto do chip do card: "Operacional 7d" / "Operacional mês". */
  shortLabel: string
  /** true = a janela atual é um período civil ainda em curso (parcial até hoje). */
  currentIsPartial: boolean
}

const VIEWS: Record<OperationalComparison, OperationalComparisonView> = {
  ROLLING_7_DAYS: { kind: "ROLLING_7_DAYS", label: "Últimos 7 dias × 7 dias anteriores", currentLabel: "Últimos 7 dias", previousLabel: "7 dias anteriores", currentPhrase: "nos últimos 7 dias", previousPhrase: "os 7 dias anteriores", shortLabel: "7d", currentIsPartial: false },
  WEEK: { kind: "WEEK", label: "Semana corrente (até hoje) × semana anterior", currentLabel: "Semana corrente (até hoje)", previousLabel: "Semana anterior (completa)", currentPhrase: "na semana corrente (até hoje)", previousPhrase: "a semana anterior", shortLabel: "semana", currentIsPartial: true },
  MONTH: { kind: "MONTH", label: "Mês corrente (até hoje) × mês anterior", currentLabel: "Mês corrente (até hoje)", previousLabel: "Mês anterior (completo)", currentPhrase: "no mês corrente (até hoje)", previousPhrase: "o mês anterior", shortLabel: "mês", currentIsPartial: true },
  TWO_MONTHS: { kind: "TWO_MONTHS", label: "Bimestre corrente (até hoje) × bimestre anterior", currentLabel: "Bimestre corrente (até hoje)", previousLabel: "Bimestre anterior (completo)", currentPhrase: "no bimestre corrente (até hoje)", previousPhrase: "o bimestre anterior", shortLabel: "bimestre", currentIsPartial: true },
  QUARTER: { kind: "QUARTER", label: "Trimestre corrente (até hoje) × trimestre anterior", currentLabel: "Trimestre corrente (até hoje)", previousLabel: "Trimestre anterior (completo)", currentPhrase: "no trimestre corrente (até hoje)", previousPhrase: "o trimestre anterior", shortLabel: "trimestre", currentIsPartial: true },
}

export function describeOperationalComparison(comparison: OperationalComparison): OperationalComparisonView {
  return VIEWS[comparison]
}
