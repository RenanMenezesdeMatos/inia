import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { labelColumnOf, parseCell, type CellUnit } from "./visualization.js"

/**
 * COMPARAÇÃO de uma entrega com a referência equivalente — calculada pela aplicação, com a MESMA definição, escopo e filtros.
 * Melhora × piora segue a semântica de cada coluna (nunca "subiu = melhorou"): % fora, Q4 e dispersão — menor é melhor;
 * atingimento, mediana e PRV — maior é melhor (o atingimento já vem ajustado à direção do indicador); o VALOR do indicador segue a
 * direção do catálogo (meta-alvo = neutro); situações funcionais e contagens de contexto são neutras.
 */
export type MetricDirection = "HIGHER_BETTER" | "LOWER_BETTER" | "NEUTRAL"
export type ChangeAssessment = "IMPROVED" | "WORSENED" | "STABLE" | "NEUTRAL"

const LOWER_BETTER = new Set(["belowPercent", "below", "belowAny", "q4", "prvQ4", "Q4", "stdev", "monthsBelow", "monthsQ4", "above"])
const HIGHER_BETTER = new Set(["achievement", "mean", "median", "prv", "Q1"])
const SKIPPED = new Set(["withReference", "withQuartile", "withData", "people", "total", "coverage", "months", "range", "target", "change", "worstCalls"])

export function columnDirection(key: string, label: string, valueDirection: "HIGHER" | "LOWER" | "TARGET" | null): MetricDirection | null {
  if (SKIPPED.has(key)) return null
  if (key === "value") return valueDirection === "HIGHER" ? "HIGHER_BETTER" : valueDirection === "LOWER" ? "LOWER_BETTER" : "NEUTRAL"
  if (LOWER_BETTER.has(key)) return "LOWER_BETTER"
  if (HIGHER_BETTER.has(key)) return "HIGHER_BETTER"
  if (/^m\d+$/.test(key)) return /fora|Q4/i.test(label) ? "LOWER_BETTER" : /atingimento|PRV/i.test(label) ? "HIGHER_BETTER" : "NEUTRAL"
  return "NEUTRAL"
}

export function assess(direction: MetricDirection, delta: number): ChangeAssessment {
  if (Math.abs(delta) < 1e-9) return "STABLE"
  if (direction === "NEUTRAL") return "NEUTRAL"
  return (direction === "HIGHER_BETTER") === delta > 0 ? "IMPROVED" : "WORSENED"
}

export type MetricChange = {
  row: string
  column: string
  columnLabel: string
  unit: CellUnit | null
  current: number
  previous: number
  delta: number
  /** Variação relativa (%); null quando a referência é zero. */
  deltaPercent: number | null
  direction: MetricDirection
  assessment: ChangeAssessment
}

export type ReportComparison = {
  status: "COMPARED" | "NOT_COMPARABLE" | "NO_HISTORY" | "DISABLED"
  /** Período comparado × referência, em texto (ex.: "Agosto 2026 × Julho 2026 — competência anterior, mesma definição e escopo"). */
  basis: string
  reason: string | null
  currentLabel: string | null
  referenceLabel: string | null
  coverage: { currentRows: number; referenceRows: number }
  rowsAdded: string[]
  rowsRemoved: string[]
  changes: MetricChange[]
  summary: { improved: number; worsened: number; stable: number; neutral: number }
  /** A configuração mudou desde a entrega usada como referência (só quando a referência é uma entrega anterior). */
  configurationChanged: boolean
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits

function emptySummary() {
  return { improved: 0, worsened: 0, stable: 0, neutral: 0 }
}

export function notComparable(status: "NOT_COMPARABLE" | "NO_HISTORY" | "DISABLED", basis: string, reason: string): ReportComparison {
  return { status, basis, reason, currentLabel: null, referenceLabel: null, coverage: { currentRows: 0, referenceRows: 0 }, rowsAdded: [], rowsRemoved: [], changes: [], summary: emptySummary(), configurationChanged: false }
}

/** Compara dois cartões da MESMA consulta (linhas casadas pelo rótulo). */
export function compareCards(current: QueryTableCard, reference: QueryTableCard, options: { basis: string; currentLabel: string; referenceLabel: string; valueDirection: "HIGHER" | "LOWER" | "TARGET" | null; configurationChanged?: boolean }): ReportComparison {
  const labelKey = labelColumnOf(current)
  if (!labelKey || reference.columns.map((column) => column.key).join("|") !== current.columns.map((column) => column.key).join("|")) {
    return { ...notComparable("NOT_COMPARABLE", options.basis, "As colunas da referência não são as mesmas desta entrega."), currentLabel: options.currentLabel, referenceLabel: options.referenceLabel }
  }
  if (reference.rows.length === 0) return { ...notComparable("NO_HISTORY", options.basis, `Sem dados na referência (${options.referenceLabel}) para comparar.`), currentLabel: options.currentLabel, referenceLabel: options.referenceLabel, coverage: { currentRows: current.rows.length, referenceRows: 0 } }
  const referenceByLabel = new Map(reference.rows.map((row) => [row.cells[labelKey] ?? "", row]))
  const currentLabels = new Set(current.rows.map((row) => row.cells[labelKey] ?? ""))
  const changes: MetricChange[] = []
  for (const row of current.rows) {
    const label = row.cells[labelKey] ?? ""
    const previousRow = referenceByLabel.get(label)
    if (!previousRow) continue
    for (const column of current.columns) {
      if (!column.numeric) continue
      const direction = columnDirection(column.key, column.label, options.valueDirection)
      if (!direction) continue
      const now = parseCell(row.cells[column.key])
      const before = parseCell(previousRow.cells[column.key])
      const usePercent = now.percent !== null && before.percent !== null
      const currentValue = usePercent ? now.percent : now.value
      const previousValue = usePercent ? before.percent : before.value
      if (currentValue === null || previousValue === null) continue
      const delta = round(currentValue - previousValue)
      changes.push({ row: label, column: column.key, columnLabel: usePercent ? `${column.label} (%)` : column.label, unit: usePercent ? "PERCENT" : now.unit, current: currentValue, previous: previousValue, delta, deltaPercent: previousValue !== 0 ? round((delta / Math.abs(previousValue)) * 100) : null, direction, assessment: assess(direction, delta) })
    }
  }
  const summary = emptySummary()
  for (const change of changes) summary[change.assessment === "IMPROVED" ? "improved" : change.assessment === "WORSENED" ? "worsened" : change.assessment === "STABLE" ? "stable" : "neutral"] += 1
  return {
    status: "COMPARED",
    basis: options.basis,
    reason: null,
    currentLabel: options.currentLabel,
    referenceLabel: options.referenceLabel,
    coverage: { currentRows: current.rows.length, referenceRows: reference.rows.length },
    rowsAdded: [...currentLabels].filter((label) => !referenceByLabel.has(label)),
    rowsRemoved: [...referenceByLabel.keys()].filter((label) => !currentLabels.has(label)),
    changes,
    summary,
    configurationChanged: options.configurationChanged ?? false,
  }
}

/** Mês a mês: compara a primeira com a última competência do próprio conjunto (sem nova consulta). */
export function compareFirstAndLastMonth(card: QueryTableCard): ReportComparison {
  const months = card.columns.filter((column) => /^m\d+$/.test(column.key))
  const labelKey = labelColumnOf(card)
  if (months.length < 2 || !labelKey) return notComparable("NOT_COMPARABLE", "Primeira × última competência", "Sem duas competências no conjunto para comparar.")
  const first = months[0]!
  const last = months[months.length - 1]!
  const firstMonth = /\b\w{3}\/\d{2}\b/.exec(first.label)?.[0] ?? first.label
  const lastMonth = /\b\w{3}\/\d{2}\b/.exec(last.label)?.[0] ?? last.label
  const direction = columnDirection(first.key, first.label, null) ?? "NEUTRAL"
  const changes: MetricChange[] = []
  for (const row of card.rows) {
    const before = parseCell(row.cells[first.key])
    const now = parseCell(row.cells[last.key])
    const previous = before.percent ?? before.value
    const current = now.percent ?? now.value
    if (previous === null || current === null) continue
    const delta = round(current - previous)
    changes.push({ row: row.cells[labelKey] ?? "", column: last.key, columnLabel: last.label.replace(lastMonth, "").trim(), unit: now.percent !== null ? "PERCENT" : now.unit, current, previous, delta, deltaPercent: previous !== 0 ? round((delta / Math.abs(previous)) * 100) : null, direction, assessment: assess(direction, delta) })
  }
  const summary = emptySummary()
  for (const change of changes) summary[change.assessment === "IMPROVED" ? "improved" : change.assessment === "WORSENED" ? "worsened" : change.assessment === "STABLE" ? "stable" : "neutral"] += 1
  return { status: changes.length > 0 ? "COMPARED" : "NO_HISTORY", basis: `${lastMonth} × ${firstMonth} — primeira e última competência do período`, reason: changes.length > 0 ? null : "Sem valores nas duas pontas do período.", currentLabel: lastMonth, referenceLabel: firstMonth, coverage: { currentRows: card.rows.length, referenceRows: card.rows.length }, rowsAdded: [], rowsRemoved: [], changes, summary, configurationChanged: false }
}

/** As mudanças mais relevantes para o resumo (maior variação relativa primeiro; melhoras e pioras antes de neutras). */
export function topChanges(comparison: ReportComparison, limit = 8): MetricChange[] {
  const weight = (change: MetricChange) => (change.assessment === "IMPROVED" || change.assessment === "WORSENED" ? 1 : 0)
  return [...comparison.changes].filter((change) => change.assessment !== "STABLE").sort((a, b) => weight(b) - weight(a) || Math.abs(b.deltaPercent ?? b.delta) - Math.abs(a.deltaPercent ?? a.delta)).slice(0, limit)
}
