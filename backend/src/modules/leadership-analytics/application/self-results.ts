import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import type { AnalyticsReadRepository, IndicatorDefinitionRow, IndicatorPerformanceRow } from "../../performance-analytics/application/analytics-read-repository.js"
import { isWithinReference } from "../../performance-analytics/application/member-performance.js"
import type { OperationalComparison } from "../../performance-analytics/domain/operational-comparison.js"
import { longPeriodLabel, previousReferencePeriod, shortPeriodLabel } from "../../performance-analytics/domain/reference-period.js"
import { ANALYTIC_METHODS } from "../domain/analytic-rules.js"
import type { QueryTableCard, QueryTableColumn, StructureRef } from "../domain/view-models.js"
import { PRV_CODE, PRV_DEFINITION } from "./official-query.js"
import { averageOf, num, pp, round1 } from "./query-common.js"

/**
 * MEUS RESULTADOS — a mesma base oficial das telas, SEMPRE da pessoa da sessão (nenhum parâmetro escolhe outra pessoa): PRV e
 * quartil geral, cada indicador com valor, meta, atingimento, quartil e situação, a evolução nas últimas competências e o período
 * em curso pela medição diária (valor e posição entre os pares, como na aba Indicadores). Sem nomes de colegas.
 */

export type SelfResultsInput = {
  organizationId: string
  person: { id: string; name: string }
  indicators: IndicatorDefinitionRow[]
  periods: string[]
  source: "OFFICIAL" | "OPERATIONAL"
  window: OperationalComparison
  now: Date
}

export async function buildSelfResults(repository: AnalyticsReadRepository, input: SelfResultsInput): Promise<QueryTableCard> {
  const structure: StructureRef = { subject: { kind: "EMPLOYEE", employeeId: input.person.id }, label: input.person.name, description: "Meus resultados" }
  return input.source === "OPERATIONAL" ? operational(repository, input, structure) : official(repository, input, structure)
}

async function official(repository: AnalyticsReadRepository, input: SelfResultsInput, structure: StructureRef): Promise<QueryTableCard> {
  const last = input.periods[input.periods.length - 1]!
  const previous = previousReferencePeriod(last)
  const loaded = input.periods.length > 1 ? input.periods : [previous, last]
  const [catalog, rows, prv] = await Promise.all([repository.loadIndicatorDefinitions(input.organizationId), repository.loadIndicatorPerformance(input.organizationId, [input.person.id], loaded), repository.loadPrvPerformance(input.organizationId, [input.person.id], loaded)])
  const index = new Map<string, IndicatorPerformanceRow>()
  for (const row of rows) index.set(`${row.referencePeriod}|${row.indicatorCode}`, row)
  for (const row of prv) index.set(`${row.referencePeriod}|${PRV_CODE}`, { personId: row.personId, indicatorCode: PRV_CODE, referencePeriod: row.referencePeriod, value: row.achievementPercent, targetValue: 100, achievementPercent: row.achievementPercent, weightPercent: null, quartile: row.quartile, numerator: null, denominator: null, source: row.source })
  const withData = new Set(rows.filter((row) => row.referencePeriod === last).map((row) => row.indicatorCode))
  const indicators = input.indicators.length > 0 ? input.indicators : [PRV_DEFINITION, ...catalog.filter((definition) => withData.has(definition.code))]
  const limitations: string[] = []
  const rowOf = (period: string, code: string) => index.get(`${period}|${code}`) ?? null
  const situation = (row: IndicatorPerformanceRow | null, definition: IndicatorDefinitionRow) => {
    const within = row ? isWithinReference(row, definition.direction) : null
    return within === null ? "sem dado" : within ? "dentro da meta" : "fora da meta"
  }
  if (!indicators.some((definition) => rowOf(last, definition.code))) limitations.push(`Sem fechamento oficial seu em ${longPeriodLabel(last)} para o que foi pedido.`)
  let columns: QueryTableColumn[]
  const tableRows: QueryTableCard["rows"] = []
  if (input.periods.length > 1) {
    columns = [{ key: "indicator", label: "Indicador", numeric: false }, ...input.periods.map((period, position) => ({ key: `m${position}`, label: shortPeriodLabel(period), numeric: true })), { key: "mean", label: "Média", numeric: true }, { key: "monthsBelow", label: "Meses fora", numeric: true }]
    for (const definition of indicators) {
      const series = input.periods.map((period) => rowOf(period, definition.code))
      if (series.every((row) => row === null)) continue
      tableRows.push({
        cells: { indicator: definition.name, ...Object.fromEntries(series.map((row, position) => [`m${position}`, row ? `${num(row.achievementPercent, "%")}${row.quartile ? ` (${row.quartile})` : ""}` : "—"])), mean: num(averageOf(series.map((row) => row?.achievementPercent ?? null)), "%"), monthsBelow: String(series.filter((row) => situation(row, definition) === "fora da meta").length) },
        subject: null,
        personId: null,
      })
    }
  } else {
    columns = [{ key: "indicator", label: "Indicador", numeric: false }, { key: "value", label: "Resultado", numeric: true }, { key: "target", label: "Meta", numeric: true }, { key: "achievement", label: "Atingimento", numeric: true }, { key: "quartile", label: "Quartil oficial", numeric: false }, { key: "situation", label: "Situação", numeric: false }, { key: "change", label: `vs. ${shortPeriodLabel(previous)}`, numeric: true }]
    // PRV primeiro; depois do menor para o maior atingimento ("meu pior indicador" é a primeira linha depois do PRV).
    const achievementOf = (definition: IndicatorDefinitionRow) => rowOf(last, definition.code)?.achievementPercent ?? Number.POSITIVE_INFINITY
    const ordered = [...indicators].sort((a, b) => (a.code === PRV_CODE ? -1 : b.code === PRV_CODE ? 1 : achievementOf(a) - achievementOf(b)))
    for (const definition of ordered) {
      const row = rowOf(last, definition.code)
      if (!row) continue
      const before = rowOf(previous, definition.code)
      const change = row.achievementPercent !== null && before?.achievementPercent != null ? round1(row.achievementPercent - before.achievementPercent) : null
      tableRows.push({
        cells: { indicator: definition.name, value: definition.code === PRV_CODE ? "—" : formatIndicatorValue(row.value, definition.unit), target: definition.code === PRV_CODE || row.targetValue === null ? "—" : formatIndicatorValue(row.targetValue, definition.unit), achievement: num(row.achievementPercent, "%"), quartile: row.quartile ?? "—", situation: situation(row, definition), change: pp(change) },
        subject: null,
        personId: null,
      })
    }
  }
  return card(input, structure, {
    title: input.periods.length > 1 ? `Meus resultados — evolução (${shortPeriodLabel(input.periods[0]!)} a ${shortPeriodLabel(last)})` : `Meus resultados — ${longPeriodLabel(last)}`,
    scopeNote: input.periods.length > 1 ? `Competências oficiais: ${shortPeriodLabel(input.periods[0]!)} a ${shortPeriodLabel(last)}` : `Competência oficial: ${longPeriodLabel(last)}`,
    period: last,
    columns,
    rows: tableRows,
    methods: [ANALYTIC_METHODS.reference, ANALYTIC_METHODS.officialQuartile, "PRV = seu resultado geral oficial (atingimento e quartil da fonte). Indicadores do menor para o maior atingimento."],
    limitations,
  })
}

async function operational(repository: AnalyticsReadRepository, input: SelfResultsInput, structure: StructureRef): Promise<QueryTableCard> {
  const codes = input.indicators.filter((definition) => definition.code !== PRV_CODE).map((definition) => definition.code)
  const trends = await repository.loadEmployeeOperationalTrends(input.organizationId, input.person.id, input.now, input.window, codes.length > 0 ? codes : undefined)
  const catalog = await repository.loadIndicatorDefinitions(input.organizationId)
  const nameOf = new Map(catalog.map((definition) => [definition.code, definition.name]))
  const first = [...trends.values()][0]
  const columns: QueryTableColumn[] = [{ key: "indicator", label: "Indicador", numeric: false }, { key: "current", label: first?.comparison.currentLabel ?? "Atual", numeric: true }, { key: "previous", label: first?.comparison.previousLabel ?? "Anterior", numeric: true }, { key: "trend", label: "Desempenho", numeric: false }, { key: "position", label: "Posição entre os pares", numeric: true }]
  const trendText = { IMPROVED: "melhorou", DECLINED: "piorou", STABLE: "estável" } as const
  const rows: QueryTableCard["rows"] = [...trends.values()].map((trend) => ({
    cells: {
      indicator: nameOf.get(trend.indicatorCode) ?? trend.indicatorCode,
      current: trend.current.value === null ? "—" : formatIndicatorValue(trend.current.value, trend.unit),
      previous: trend.previous.value === null ? "—" : formatIndicatorValue(trend.previous.value, trend.unit),
      trend: trend.performanceTrend ? trendText[trend.performanceTrend] : "—",
      position: trend.quartile.position !== null ? `${trend.quartile.position}º de ${trend.quartile.rankedCount}${trend.quartile.quartile ? ` (${trend.quartile.quartile})` : ""}` : "—",
    },
    subject: null,
    personId: null,
  }))
  const limitations = rows.length === 0 ? ["Nenhuma medição diária sua no período."] : rows.every((row) => row.cells.current === "—") ? ["Ainda não há medição diária sua no período em curso."] : []
  return card(input, structure, {
    title: `Meus resultados — ${first?.comparison.label ?? "período em curso"}`,
    scopeNote: first ? `${first.current.label} × ${first.previous.label} (medição diária, parcial)` : "Medição diária",
    period: null,
    columns,
    rows,
    methods: ["Medição diária consolidada pela estratégia do indicador, só com dias elegíveis; sem meta oficial. Posição = quartil operacional entre os pares (mesmo Grupo/Subgrupo), como na aba Indicadores."],
    limitations,
  })
}

function card(input: SelfResultsInput, structure: StructureRef, content: { title: string; scopeNote: string; period: string | null; columns: QueryTableColumn[]; rows: QueryTableCard["rows"]; methods: string[]; limitations: string[] }): QueryTableCard {
  return { type: "QUERY_TABLE", generatedAt: input.now.toISOString(), structure, source: input.source, title: content.title, scopeNote: content.scopeNote, period: content.period, indicatorCode: null, columns: content.columns, rows: content.rows, totalRows: content.rows.length, highlights: [], methods: content.methods, limitations: content.limitations }
}
