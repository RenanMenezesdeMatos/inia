import type { IndicatorDefinitionRow, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { AnalyticsSubject } from "../../performance-analytics/domain/analytics-subject.js"
import { GROUPING_LABELS, groupingOptionsBelow, isHierarchyRole, type GroupingDimension } from "../../performance-analytics/domain/hierarchy-levels.js"
import type { OperationalComparison } from "../../performance-analytics/domain/operational-comparison.js"
import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import type { QueryTableCard, QueryTableColumn, QueryTableRow } from "../domain/view-models.js"
import type { ResolvedStructure } from "./references.js"
import { unitBuckets } from "./structure-units.js"

/**
 * Peças comuns da CONSULTA FLEXÍVEL (oficial e operacional): o pedido normalizado, os recortes da estrutura, ordenação/limite,
 * estatística descritiva e a montagem do cartão `QUERY_TABLE` (+ a mesma tabela em markdown).
 */

export type QueryGrouping = "STRUCTURE" | "UNIT" | GroupingDimension | "PERSON" | "PERIOD"
export type QuerySituation = "BELOW" | "WITHIN" | "NO_DATA"
export type QuerySort = "BELOW_PERCENT" | "BELOW" | "ACHIEVEMENT" | "CHANGE" | "NAME" | "Q4" | "DISPERSION"
/** INDICATOR = por indicador; CONSOLIDATED = todos os indicadores juntos (+ PRV); QUARTILES = distribuição Q1–Q4 e dispersão. */
export type QueryView = "INDICATOR" | "CONSOLIDATED" | "QUARTILES"
/** Como ler várias competências: a última (com variação), a média, uma coluna por mês, ou a recorrência (quantas vezes fora/no Q4). */
export type PeriodMode = "LATEST" | "AVERAGE" | "BY_MONTH" | "RECURRENCE"

export type IndicatorQueryInput = {
  structure: ResolvedStructure
  /** Vazio = todos os indicadores com dado na competência. Pode conter o PRV (resultado geral). */
  indicators: IndicatorDefinitionRow[]
  /** Competências oficiais em ordem crescente (1 a 6); a última é a de referência. */
  periods: string[]
  groupBy: QueryGrouping
  view: QueryView
  periodMode: PeriodMode
  source: "OFFICIAL" | "OPERATIONAL"
  window: OperationalComparison
  situation: QuerySituation | null
  quartiles: Quartile[] | null
  minBelowIndicators: number | null
  sort: QuerySort | null
  order: "asc" | "desc" | null
  limit: number
  now: Date
}

export const MAX_QUERY_ROWS = 50

export type Group = { key: string; label: string; description: string | null; subject: AnalyticsSubject | null; members: PersonNode[] }
export type SortableRow = QueryTableRow & { sortKeys: Partial<Record<QuerySort, number | string | null>> }

export const num = (value: number | null, suffix = "") => (value === null ? "—" : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${suffix}`)
export const pp = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`)
export const share = (part: number, whole: number) => (whole > 0 ? `${part} (${num(Math.round((part / whole) * 1000) / 10, "%")})` : `${part}`)
export const round1 = (value: number) => Math.round(value * 10) / 10

export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return round1(sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower))
}

export function median(values: number[]): number | null {
  return percentile(values, 0.5)
}

/** Desvio padrão populacional (p.p. de atingimento) — a "dispersão" dentro do recorte. */
export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return round1(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length))
}

export function averageOf(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value !== null)
  return valid.length === 0 ? null : round1(valid.reduce((sum, value) => sum + value, 0) / valid.length)
}

/** Recortes da estrutura: a estrutura inteira, as unidades abaixo (cascata) ou uma dimensão permitida ao papel âncora. */
export function groupsFor(scope: ViewerScope, input: Pick<IndicatorQueryInput, "structure" | "groupBy">, limitations: string[]): { groups: Group[]; label: string } {
  const whole: Group = { key: "structure", label: input.structure.ref.label, description: input.structure.ref.description, subject: input.structure.subject, members: input.structure.resolved.members }
  if (input.groupBy === "STRUCTURE" || input.groupBy === "PERSON" || input.groupBy === "PERIOD") return { groups: [whole], label: "Estrutura" }
  let dimension: GroupingDimension | null = null
  if (input.groupBy !== "UNIT") {
    const anchorRole = input.structure.resolved.anchor?.role
    const allowed: GroupingDimension[] = anchorRole && isHierarchyRole(anchorRole) ? groupingOptionsBelow(anchorRole) : ["TEAM", "SUBTEAM"]
    if (allowed.includes(input.groupBy)) dimension = input.groupBy
    else limitations.push(`Agrupar por ${GROUPING_LABELS[input.groupBy]} não se aplica a esta estrutura; usei as unidades logo abaixo.`)
  }
  let { buckets, groupedBy } = unitBuckets(scope, input.structure, dimension)
  // Nível pedido que não existe abaixo desta estrutura (ex.: Coordenador numa gerência com supervisores ligados direto): tudo cairia
  // no balde "Sem …" — mostra as unidades logo abaixo (cascata) e diz isso.
  if (dimension && dimension !== "TEAM" && dimension !== "SUBTEAM" && buckets.every((bucket) => bucket.leader === null)) {
    ;({ buckets, groupedBy } = unitBuckets(scope, input.structure, null))
    limitations.push(`Não há ${GROUPING_LABELS[dimension]} abaixo desta estrutura; mostro as unidades logo abaixo${groupedBy ? ` (${GROUPING_LABELS[groupedBy]})` : ""}.`)
  }
  if (buckets.length === 0) {
    limitations.push("Esta estrutura não tem unidades abaixo (a equipe é formada diretamente pelos operadores); mostro a estrutura inteira.")
    return { groups: [whole], label: "Estrutura" }
  }
  return { groups: buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, description: bucket.description, subject: bucket.subject, members: bucket.members })), label: groupedBy ? GROUPING_LABELS[groupedBy] : "Unidade" }
}

export function groupCell(group: Group, columnLabel: string): string {
  return group.description && group.key !== "structure" && group.description !== columnLabel ? `${group.label} (${group.description})` : group.label
}

export function finish(rows: SortableRow[], input: Pick<IndicatorQueryInput, "sort" | "order" | "limit">, defaultSort: QuerySort, defaultOrder: "asc" | "desc"): { rows: QueryTableRow[]; total: number } {
  const sort = input.sort ?? defaultSort
  const order = input.order ?? defaultOrder
  const direction = order === "asc" ? 1 : -1
  const byName = (a: SortableRow, b: SortableRow) => String(a.sortKeys.NAME ?? "").localeCompare(String(b.sortKeys.NAME ?? ""), "pt-BR")
  const sorted = [...rows].sort((a, b) => {
    const left = a.sortKeys[sort] ?? null
    const right = b.sortKeys[sort] ?? null
    if (left === null && right === null) return byName(a, b)
    if (left === null) return 1
    if (right === null) return -1
    const compared = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "pt-BR")
    return direction * compared || byName(a, b)
  })
  const limit = Math.min(MAX_QUERY_ROWS, Math.max(1, input.limit))
  return { rows: sorted.slice(0, limit).map((row) => ({ cells: row.cells, subject: row.subject, personId: row.personId })), total: rows.length }
}

export function buildCard(input: Pick<IndicatorQueryInput, "structure" | "source" | "now">, content: { title: string; scopeNote: string; period: string | null; indicatorCode: string | null; columns: QueryTableColumn[]; rows: QueryTableRow[]; total: number; methods: string[]; limitations: string[]; highlights?: string[] }): QueryTableCard {
  return {
    type: "QUERY_TABLE",
    generatedAt: input.now.toISOString(),
    structure: input.structure.ref,
    source: input.source,
    title: content.title,
    scopeNote: content.scopeNote,
    period: content.period,
    indicatorCode: content.indicatorCode,
    columns: content.columns,
    rows: content.rows,
    totalRows: content.total,
    highlights: content.highlights ?? [],
    methods: content.methods,
    limitations: content.limitations,
  }
}

/** A tabela em markdown — o mesmo conteúdo do cartão, para a INIA copiar sem recalcular. */
export function queryTableMarkdown(card: QueryTableCard): string {
  if (card.rows.length === 0) return "_Nenhuma linha para os filtros pedidos._"
  // Célula pode trazer dado da integração (nome da pessoa vindo do feed): nada dele vira link, ênfase ou HTML no Markdown
  // (achado DATA-13 da auditoria de 17/10/2026); a barra vertical não pode quebrar a tabela.
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/([[\]`*_<>])/g, "\\$1").replace(/\|/g, "/")
  const header = `| ${card.columns.map((column) => column.label).join(" | ")} |`
  const separator = `| ${card.columns.map((column) => (column.numeric ? "---:" : "---")).join(" | ")} |`
  const body = card.rows.map((row) => `| ${card.columns.map((column) => escape(row.cells[column.key] ?? "—")).join(" | ")} |`)
  return [header, separator, ...body].join("\n")
}
