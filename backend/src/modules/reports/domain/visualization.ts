import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import type { ReportVisualization, VisualizationType } from "./report-definition.js"

/**
 * VISUALIZAÇÃO de uma entrega — calculada pela aplicação a partir do cartão da ferramenta (a mesma tabela do chat), nunca pela IA.
 * Os valores vêm dos formatos da própria aplicação (`num`, `share`, `pp`, `formatIndicatorValue`); "—" é ausência, NUNCA zero.
 * A compatibilidade é decidida pelo formato dos dados: evolução (linha/área) só existe com dimensão temporal (uma coluna por
 * competência ou linhas por competência); distribuição só com colunas de faixas (Q1–Q4, situações funcionais).
 */
export type CellUnit = "PERCENT" | "PP" | "SECONDS" | "STARS" | "POINTS" | "COUNT" | "NUMBER"
export type ParsedCell = { value: number | null; percent: number | null; unit: CellUnit | null }

const NUMBER = "([+\\-−]?\\d{1,3}(?:\\.\\d{3})*(?:,\\d+)?|[+\\-−]?\\d+(?:,\\d+)?)"
const CELL_PATTERN = new RegExp(`^${NUMBER}\\s*(%|p\\.p\\.|s|★|pts|casos|/dia)?(?:\\s*\\(${NUMBER}%\\))?(?:\\s+de\\s+${NUMBER})?$`)

function toNumber(text: string): number {
  return Number(text.replace("−", "-").replace(/\./g, "").replace(",", "."))
}

export function parseCell(text: string | undefined | null): ParsedCell {
  const trimmed = (text ?? "").trim()
  if (!trimmed || trimmed === "—" || trimmed === "-") return { value: null, percent: null, unit: null }
  const match = CELL_PATTERN.exec(trimmed)
  if (!match) return { value: null, percent: null, unit: null }
  const value = toNumber(match[1]!)
  const suffix = match[2]
  const unit: CellUnit = suffix === "%" ? "PERCENT" : suffix === "p.p." ? "PP" : suffix === "s" ? "SECONDS" : suffix === "★" ? "STARS" : suffix === "pts" ? "POINTS" : match[3] !== undefined || match[4] !== undefined ? "COUNT" : "NUMBER"
  return { value, percent: match[3] !== undefined ? toNumber(match[3]) : null, unit }
}

/** Uma métrica candidata do gráfico: a coluna e se o valor plotado é o percentual da célula "n (x%)". */
export type MetricOption = { key: string; label: string; unit: CellUnit; usePercent: boolean }

const MONTH_LABEL = /\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\/\d{2}\b/i
const LONG_MONTH = /^(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) \d{4}$/i
const QUARTILE_KEYS = ["Q1", "Q2", "Q3", "Q4"]

export function labelColumnOf(card: QueryTableCard): string | null {
  return card.columns.find((column) => !column.numeric)?.key ?? null
}

export function metricOptions(card: QueryTableCard): MetricOption[] {
  const options: MetricOption[] = []
  for (const column of card.columns) {
    if (!column.numeric) continue
    const parsed = card.rows.map((row) => parseCell(row.cells[column.key]))
    const withValue = parsed.filter((cell) => cell.value !== null)
    if (withValue.length === 0) continue
    const usePercent = withValue.every((cell) => cell.percent !== null)
    options.push({ key: column.key, label: usePercent ? `${column.label} (%)` : column.label, unit: usePercent ? "PERCENT" : (withValue[0]!.unit ?? "NUMBER"), usePercent })
  }
  return options
}

function monthColumns(card: QueryTableCard) {
  return card.columns.filter((column) => column.numeric && MONTH_LABEL.test(column.label))
}

function rowsAreMonths(card: QueryTableCard): boolean {
  const label = labelColumnOf(card)
  return label !== null && card.rows.length >= 2 && card.rows.every((row) => LONG_MONTH.test(row.cells[label] ?? ""))
}

function bucketColumns(card: QueryTableCard) {
  const quartiles = card.columns.filter((column) => QUARTILE_KEYS.includes(column.key))
  if (quartiles.length === 4) return quartiles
  // Situações funcionais (força de trabalho): colunas em maiúsculas com "n (x%)".
  const statuses = card.columns.filter((column) => column.numeric && /^[A-Z_]+$/.test(column.key) && card.rows.some((row) => parseCell(row.cells[column.key]).percent !== null))
  return statuses.length >= 2 ? statuses : []
}

/** Visualizações compatíveis com o formato dos dados (a tabela sempre é). */
export function compatibleVisualizations(card: QueryTableCard): VisualizationType[] {
  const types: VisualizationType[] = ["TABLE"]
  const metrics = metricOptions(card)
  if (card.rows.length === 1 && metrics.length > 0) types.push("KPI")
  if (labelColumnOf(card) && metrics.length > 0 && card.rows.length >= 1) types.push("BAR")
  if (monthColumns(card).length >= 2 || (rowsAreMonths(card) && metrics.length > 0)) types.push("LINE", "AREA")
  if (bucketColumns(card).length >= 2) types.push("DISTRIBUTION")
  return types
}

/** Sugestão inicial pelo formato: distribuição → evolução → indicadores resumidos → barras → tabela. */
export function suggestVisualization(card: QueryTableCard): ReportVisualization {
  const types = compatibleVisualizations(card)
  if (types.includes("DISTRIBUTION")) return { type: "DISTRIBUTION" }
  if (types.includes("LINE")) return { type: "LINE" }
  if (types.includes("KPI")) return { type: "KPI" }
  if (types.includes("BAR")) {
    const preferred = metricOptions(card).find((option) => ["belowPercent", "achievement", "mean", "prv", "q4", "worstShare", "impact"].includes(option.key))
    return { type: "BAR", ...(preferred ? { metric: preferred.key } : {}) }
  }
  return { type: "TABLE" }
}

export type VisualizationSeries = { key: string; label: string; values: (number | null)[] }
export type VisualizationData = {
  type: VisualizationType
  title: string
  unit: CellUnit | null
  metricKey: string | null
  metricLabel: string | null
  categories: string[]
  series: VisualizationSeries[]
  kpis: { label: string; text: string; value: number | null }[]
  /** Visualização pedida não cabe nos dados desta entrega (ex.: evolução sem dimensão temporal): cai na tabela e diz por quê. */
  fallbackReason: string | null
  empty: boolean
}

const MAX_CATEGORIES = 25
const MAX_SERIES = 8

export function buildVisualizationData(card: QueryTableCard, visualization: ReportVisualization): VisualizationData {
  const compatible = compatibleVisualizations(card)
  const requested = visualization.type
  const type = compatible.includes(requested) ? requested : "TABLE"
  const base: VisualizationData = { type, title: card.title, unit: null, metricKey: null, metricLabel: null, categories: [], series: [], kpis: [], fallbackReason: type === requested ? null : `A visualização escolhida não cabe nos dados desta entrega (${describeType(requested)}); mostrando a tabela.`, empty: card.rows.length === 0 }
  if (card.rows.length === 0 || type === "TABLE") return base
  const labelKey = labelColumnOf(card)
  const labelOf = (row: QueryTableCard["rows"][number]) => (labelKey ? (row.cells[labelKey] ?? "—") : "—")
  const metrics = metricOptions(card)
  const metric = metrics.find((option) => option.key === visualization.metric) ?? metrics[0] ?? null
  const valueOf = (text: string | undefined, option: MetricOption | null) => {
    const cell = parseCell(text)
    return option?.usePercent ? cell.percent : cell.value
  }

  if (type === "KPI") {
    const row = card.rows[0]!
    return { ...base, kpis: metrics.slice(0, 6).map((option) => ({ label: option.label, text: row.cells[option.key] ?? "—", value: valueOf(row.cells[option.key], option) })) }
  }
  if (type === "BAR" && metric) {
    const rows = card.rows.slice(0, MAX_CATEGORIES)
    return { ...base, unit: metric.unit, metricKey: metric.key, metricLabel: metric.label, categories: rows.map(labelOf), series: [{ key: metric.key, label: metric.label, values: rows.map((row) => valueOf(row.cells[metric.key], metric)) }] }
  }
  if (type === "LINE" || type === "AREA") {
    const months = monthColumns(card)
    if (months.length >= 2) {
      const rows = card.rows.slice(0, MAX_SERIES)
      const first = parseCell(card.rows[0]?.cells[months[0]!.key])
      return {
        ...base,
        unit: first.percent !== null ? "PERCENT" : first.unit,
        metricLabel: months[0]!.label.replace(MONTH_LABEL, "").trim(),
        categories: months.map((column) => MONTH_LABEL.exec(column.label)?.[0] ?? column.label),
        series: rows.map((row, index) => ({ key: `s${index}`, label: labelOf(row), values: months.map((column) => { const cell = parseCell(row.cells[column.key]); return cell.percent ?? cell.value }) })),
      }
    }
    if (metric) {
      const rows = [...card.rows].reverse()
      return { ...base, unit: metric.unit, metricKey: metric.key, metricLabel: metric.label, categories: rows.map(labelOf), series: [{ key: metric.key, label: metric.label, values: rows.map((row) => valueOf(row.cells[metric.key], metric)) }] }
    }
  }
  if (type === "DISTRIBUTION") {
    const buckets = bucketColumns(card)
    const rows = card.rows.slice(0, MAX_CATEGORIES)
    return { ...base, unit: "PERCENT", categories: rows.map(labelOf), series: buckets.map((column) => ({ key: column.key, label: column.label, values: rows.map((row) => parseCell(row.cells[column.key]).percent) })) }
  }
  return { ...base, type: "TABLE" }
}

export function describeType(type: VisualizationType): string {
  return { TABLE: "tabela", KPI: "indicadores resumidos", BAR: "barras", LINE: "linha", AREA: "área", DISTRIBUTION: "distribuição" }[type]
}

/**
 * Compatibilidade ESTÁTICA (antes de existir dado): o que a definição pode produzir. Evolução exige dimensão temporal (várias
 * competências mês a mês ou agrupamento por competência); distribuição exige faixas (quartis ou situações funcionais); indicadores
 * resumidos exigem uma linha (a estrutura inteira).
 */
export function staticCompatibility(definition: import("./report-definition.js").ReportDefinition): VisualizationType[] {
  const types: VisualizationType[] = ["TABLE", "BAR"]
  const temporal = definition.period.mode === "LAST_N_CLOSED" && (definition.period.display === "POR_MES" || definition.groupBy === "COMPETENCIA")
  if (temporal) types.push("LINE", "AREA")
  if (definition.view === "QUARTIS" || (definition.tool === "WORKFORCE" && !definition.listPeople)) types.push("DISTRIBUTION")
  const wholeStructure = definition.groupBy === undefined || definition.groupBy === "ESTRUTURA"
  if (definition.groupBy === "ESTRUTURA" || (definition.tool === "WORKFORCE" && wholeStructure && !definition.listPeople)) types.push("KPI")
  return types
}
