import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import type { AnalyticsReadRepository, IndicatorDefinitionRow, IndicatorPerformanceRow, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import { isWithinReference } from "../../performance-analytics/application/member-performance.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { longPeriodLabel, shortPeriodLabel } from "../../performance-analytics/domain/reference-period.js"
import { ANALYTIC_METHODS, percentOf } from "../domain/analytic-rules.js"
import type { QueryTableCard, QueryTableColumn } from "../domain/view-models.js"
import { averageOf, buildCard, finish, groupCell, groupsFor, median, num, percentile, pp, round1, share, standardDeviation, type IndicatorQueryInput, type QuerySort, type SortableRow } from "./query-common.js"
import { unitBuckets } from "./structure-units.js"

/**
 * FONTE OFICIAL da consulta flexível (fechamento mensal persistido — nada é recalculado): por indicador, CONSOLIDADA (todos os
 * indicadores + PRV) ou QUARTIS (distribuição Q1–Q4 oficial e dispersão do atingimento), por estrutura, unidades, dimensão, pessoa
 * ou competência; várias competências lidas como a última, a média, mês a mês ou a recorrência.
 */

/** O PRV (resultado geral da pessoa) entra na consulta como um "indicador" — conceito da plataforma, não um código do catálogo. */
export const PRV_CODE = "PRV"
export const PRV_DEFINITION: IndicatorDefinitionRow = {
  id: "prv",
  code: PRV_CODE,
  name: "PRV (resultado geral)",
  unit: "PERCENT",
  direction: "HIGHER",
  capabilities: { operationalEnabled: false, operationalAggregation: "AVERAGE", officialClosureSupported: true },
}

const QUARTILES: Quartile[] = ["Q1", "Q2", "Q3", "Q4"]

type Data = {
  rowOf: (period: string, code: string, personId: string) => IndicatorPerformanceRow | null
  catalog: IndicatorDefinitionRow[]
  codesWithData: (period: string) => Set<string>
}

/** Abaixo desta fração de pessoas com dado, o indicador pedido "quase não existe" nesta estrutura (aviso + indicadores com dado). */
const MINIMUM_INDICATOR_COVERAGE = 0.5

async function loadData(repository: AnalyticsReadRepository, scope: ViewerScope, members: PersonNode[], periods: string[]): Promise<Data> {
  const ids = members.map((member) => member.id)
  const [catalog, rows, prv] = await Promise.all([repository.loadIndicatorDefinitions(scope.organizationId), repository.loadIndicatorPerformance(scope.organizationId, ids, periods), repository.loadPrvPerformance(scope.organizationId, ids, periods)])
  const index = new Map<string, IndicatorPerformanceRow>()
  for (const row of rows) index.set(`${row.referencePeriod}|${row.indicatorCode}|${row.personId}`, row)
  // PRV como linha de indicador: valor = atingimento, referência = 100% (dentro = atingimento ≥ 100%), quartil oficial.
  for (const row of prv) index.set(`${row.referencePeriod}|${PRV_CODE}|${row.personId}`, { personId: row.personId, indicatorCode: PRV_CODE, referencePeriod: row.referencePeriod, value: row.achievementPercent, targetValue: 100, achievementPercent: row.achievementPercent, weightPercent: null, quartile: row.quartile, numerator: null, denominator: null, source: row.source })
  return {
    rowOf: (period, code, personId) => index.get(`${period}|${code}|${personId}`) ?? null,
    catalog,
    codesWithData: (period) => new Set(rows.filter((row) => row.referencePeriod === period).map((row) => row.indicatorCode)),
  }
}

type Stats = { people: number; withData: number; withReference: number; below: number; belowPercent: number | null; mean: number | null; median: number | null; quartiles: Record<Quartile, number>; withQuartile: number; q4Percent: number | null; stdev: number | null; p10: number | null; p90: number | null }

function statsOf(members: PersonNode[], period: string, definition: IndicatorDefinitionRow, data: Data): Stats {
  const rows = members.map((member) => data.rowOf(period, definition.code, member.id)).filter((row): row is IndicatorPerformanceRow => row !== null)
  const evaluable = rows.map((row) => isWithinReference(row, definition.direction)).filter((value) => value !== null)
  const below = evaluable.filter((value) => value === false).length
  const achievements = rows.map((row) => row.achievementPercent).filter((value): value is number => value !== null)
  const quartiles: Record<Quartile, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }
  for (const row of rows) if (row.quartile) quartiles[row.quartile] += 1
  const withQuartile = QUARTILES.reduce((sum, quartile) => sum + quartiles[quartile], 0)
  return { people: members.length, withData: rows.length, withReference: evaluable.length, below, belowPercent: percentOf(below, evaluable.length), mean: averageOf(achievements), median: median(achievements), quartiles, withQuartile, q4Percent: percentOf(quartiles.Q4, withQuartile), stdev: standardDeviation(achievements), p10: percentile(achievements, 0.1), p90: percentile(achievements, 0.9) }
}

type Consolidated = { people: number; withData: number; belowAny: number; belowAnyPercent: number | null; mean: number | null; prvMean: number | null; prvWithData: number; prvQ4: number; prvQ4Percent: number | null }

function consolidatedOf(members: PersonNode[], period: string, indicators: IndicatorDefinitionRow[], data: Data): Consolidated {
  let withData = 0
  let belowAny = 0
  const achievements: number[] = []
  const prv: number[] = []
  let prvQ4 = 0
  for (const member of members) {
    const rows = indicators.map((definition) => ({ definition, row: data.rowOf(period, definition.code, member.id) })).filter((entry) => entry.row !== null)
    if (rows.length > 0) withData += 1
    if (rows.some((entry) => isWithinReference(entry.row!, entry.definition.direction) === false)) belowAny += 1
    for (const entry of rows) if (entry.row!.achievementPercent !== null) achievements.push(entry.row!.achievementPercent)
    const prvRow = data.rowOf(period, PRV_CODE, member.id)
    if (prvRow?.achievementPercent !== null && prvRow?.achievementPercent !== undefined) prv.push(prvRow.achievementPercent)
    if (prvRow?.quartile === "Q4") prvQ4 += 1
  }
  return { people: members.length, withData, belowAny, belowAnyPercent: percentOf(belowAny, withData), mean: averageOf(achievements), prvMean: averageOf(prv), prvWithData: prv.length, prvQ4, prvQ4Percent: percentOf(prvQ4, prv.length) }
}

type Context = { input: IndicatorQueryInput; data: Data; indicators: IndicatorDefinitionRow[]; periods: string[]; last: string; first: string; limitations: string[]; periodScope: string; months: string[] }

export async function officialQuery(repository: AnalyticsReadRepository, scope: ViewerScope, input: IndicatorQueryInput): Promise<QueryTableCard> {
  const periods = input.periods
  const last = periods[periods.length - 1]!
  const first = periods[0]!
  const data = await loadData(repository, scope, input.structure.resolved.members, periods)
  const limitations: string[] = []
  const withData = data.codesWithData(last)
  const catalogWithData = data.catalog.filter((definition) => withData.has(definition.code))
  // Quartis sem indicador = quartil geral (PRV); consolidado sem indicador = todos os do catálogo com dado.
  const requested = input.indicators.length > 0 ? input.indicators : input.view === "QUARTILES" ? [PRV_DEFINITION] : catalogWithData
  const missing = input.indicators.filter((definition) => definition.code !== PRV_CODE && !withData.has(definition.code))
  if (missing.length > 0) limitations.push(`Sem dado oficial em ${longPeriodLabel(last)} para: ${missing.map((definition) => definition.name).join(", ")}.`)
  // Indicador pedido com pouca gente nesta estrutura (outro nome para um indicador parecido? população de outro canal?): diz a
  // cobertura e quais indicadores têm dado aqui — evita concluir sobre 1 pessoa e poupa consultas às cegas.
  const members = input.structure.resolved.members
  const sparse = input.indicators.filter((definition) => definition.code !== PRV_CODE).map((definition) => ({ definition, covered: members.filter((member) => data.rowOf(last, definition.code, member.id) !== null).length })).filter((entry) => entry.covered < members.length * MINIMUM_INDICATOR_COVERAGE)
  for (const entry of sparse) if (entry.covered > 0) limitations.push(`${entry.definition.name} tem dado para só ${entry.covered} de ${members.length} pessoas desta estrutura em ${longPeriodLabel(last)}.`)
  if (sparse.length > 0) limitations.push(`Indicadores com dado para a maioria desta estrutura em ${longPeriodLabel(last)}: ${data.catalog.filter((definition) => members.filter((member) => data.rowOf(last, definition.code, member.id) !== null).length >= members.length * MINIMUM_INDICATOR_COVERAGE).map((definition) => definition.name).join(", ") || "nenhum"}.`)
  const context: Context = {
    input,
    data,
    indicators: requested,
    periods,
    last,
    first,
    limitations,
    periodScope: periods.length > 1 ? `Competências oficiais: ${shortPeriodLabel(first)} a ${shortPeriodLabel(last)}` : `Competência oficial: ${longPeriodLabel(last)}`,
    months: periods.map(shortPeriodLabel),
  }
  const methods = [ANALYTIC_METHODS.reference, ANALYTIC_METHODS.denominator, ANALYTIC_METHODS.averageAchievement, ANALYTIC_METHODS.officialQuartile, "PRV = resultado geral oficial da pessoa (atingimento e quartil da fonte); dentro = atingimento ≥ 100%.", ANALYTIC_METHODS.currentStructure]
  if (input.view === "QUARTILES") methods.push("Dispersão = desvio padrão do atingimento no recorte (p.p.) e amplitude entre os 10% menores e os 10% maiores (P10–P90).")
  if (input.periodMode === "RECURRENCE") methods.push("Recorrência = em quantas das competências escolhidas a pessoa ficou fora da referência ou no Q4 oficial; para recortes, em quantas o % fora ficou acima do % fora da estrutura inteira.")

  const result = input.groupBy === "PERSON" ? personRows(scope, context) : input.groupBy === "PERIOD" ? periodRows(context) : groupRows(scope, context)
  return buildCard(input, { ...result, scopeNote: context.periodScope, period: last, methods, limitations })
}

// ---------------------------------------------------------------------------------------------
// Recortes (estrutura, unidades, dimensão)
// ---------------------------------------------------------------------------------------------

type Table = { title: string; indicatorCode: string | null; columns: QueryTableColumn[]; rows: QueryTableCard["rows"]; total: number }

function groupRows(scope: ViewerScope, context: Context): Table {
  const { input, data, indicators, periods, last, first, months } = context
  const { groups, label } = groupsFor(scope, input, context.limitations)
  const whole = input.structure.resolved.members
  const showIndicator = indicators.length > 1 && input.view !== "CONSOLIDATED"
  const head: QueryTableColumn[] = [{ key: "group", label, numeric: false }, ...(showIndicator ? [{ key: "indicator", label: "Indicador", numeric: false }] : [])]
  const rows: SortableRow[] = []
  const mode = periods.length > 1 ? input.periodMode : "LATEST"
  let columns: QueryTableColumn[] = head

  if (input.view === "CONSOLIDATED") {
    const metric = (members: PersonNode[], period: string) => consolidatedOf(members, period, indicators.filter((definition) => definition.code !== PRV_CODE), data)
    if (mode === "BY_MONTH" || mode === "RECURRENCE") {
      columns = [...head, ...periods.map((period, index) => ({ key: `m${index}`, label: `% com indicador fora ${months[index]}`, numeric: true })), ...(mode === "RECURRENCE" ? [{ key: "above", label: "Meses acima da estrutura", numeric: true }] : [])]
      const reference = periods.map((period) => metric(whole, period).belowAnyPercent)
      for (const group of groups) {
        const series = periods.map((period) => metric(group.members, period).belowAnyPercent)
        const above = series.filter((value, index) => value !== null && reference[index] !== null && value > reference[index]!).length
        rows.push({ cells: { group: groupCell(group, label), ...Object.fromEntries(series.map((value, index) => [`m${index}`, num(value, "%")])), above: String(above) }, subject: group.subject, personId: null, sortKeys: { NAME: group.label, BELOW_PERCENT: mode === "RECURRENCE" ? above * 1000 + (series.at(-1) ?? 0) : series.at(-1) ?? null, CHANGE: series.at(-1) !== null && series[0] !== null ? round1(series.at(-1)! - series[0]!) : null } })
      }
    } else if (mode === "AVERAGE") {
      columns = [...head, { key: "belowAny", label: `% com indicador fora (média de ${periods.length} meses)`, numeric: true }, { key: "mean", label: "Atingimento médio geral (média)", numeric: true }, { key: "prv", label: "PRV médio (média)", numeric: true }, { key: "prvQ4", label: "% no Q4 de PRV (média)", numeric: true }]
      for (const group of groups) {
        const series = periods.map((period) => metric(group.members, period))
        const values = { belowAny: averageOf(series.map((entry) => entry.belowAnyPercent)), mean: averageOf(series.map((entry) => entry.mean)), prv: averageOf(series.map((entry) => entry.prvMean)), prvQ4: averageOf(series.map((entry) => entry.prvQ4Percent)) }
        rows.push({ cells: { group: groupCell(group, label), belowAny: num(values.belowAny, "%"), mean: num(values.mean, "%"), prv: num(values.prv, "%"), prvQ4: num(values.prvQ4, "%") }, subject: group.subject, personId: null, sortKeys: { NAME: group.label, BELOW_PERCENT: values.belowAny, ACHIEVEMENT: values.mean, Q4: values.prvQ4 } })
      }
    } else {
      columns = [...head, { key: "people", label: "Pessoas", numeric: true }, { key: "belowAny", label: "Com indicador fora", numeric: true }, { key: "mean", label: "Atingimento médio geral", numeric: true }, { key: "prv", label: "PRV médio", numeric: true }, { key: "prvQ4", label: "No Q4 de PRV", numeric: true }, ...(periods.length > 1 ? [{ key: "change", label: `Δ PRV médio desde ${months[0]}`, numeric: true }] : [])]
      for (const group of groups) {
        const current = metric(group.members, last)
        const initial = periods.length > 1 ? metric(group.members, first) : null
        const change = initial && current.prvMean !== null && initial.prvMean !== null ? round1(current.prvMean - initial.prvMean) : null
        rows.push({ cells: { group: groupCell(group, label), people: String(current.people), belowAny: share(current.belowAny, current.withData), mean: num(current.mean, "%"), prv: num(current.prvMean, "%"), prvQ4: share(current.prvQ4, current.prvWithData), change: pp(change) }, subject: group.subject, personId: null, sortKeys: { NAME: group.label, BELOW_PERCENT: current.belowAnyPercent, BELOW: current.belowAny, ACHIEVEMENT: current.mean, Q4: current.prvQ4Percent, CHANGE: change } })
      }
    }
    const { rows: finalRows, total } = finish(rows, input, "BELOW_PERCENT", "desc")
    return { title: `Resultado consolidado por ${label.toLowerCase()}`, indicatorCode: null, columns, rows: finalRows, total }
  }

  for (const group of groups) {
    for (const definition of indicators) {
      const cellsBase = { group: groupCell(group, label), indicator: definition.name }
      if (input.view === "QUARTILES") {
        if (mode === "BY_MONTH" || mode === "AVERAGE") {
          const series = periods.map((period) => statsOf(group.members, period, definition, data))
          if (mode === "BY_MONTH") {
            columns = [...head, ...periods.map((period, index) => ({ key: `m${index}`, label: `% no Q4 ${months[index]}`, numeric: true }))]
            rows.push({ cells: { ...cellsBase, ...Object.fromEntries(series.map((stats, index) => [`m${index}`, num(stats.q4Percent, "%")])) }, subject: group.subject, personId: null, sortKeys: { NAME: group.label, Q4: series.at(-1)?.q4Percent ?? null } })
          } else {
            columns = [...head, { key: "q4", label: `% no Q4 (média de ${periods.length} meses)`, numeric: true }, { key: "stdev", label: "Desvio padrão (média)", numeric: true }]
            const q4 = averageOf(series.map((stats) => stats.q4Percent))
            const stdev = averageOf(series.map((stats) => stats.stdev))
            rows.push({ cells: { ...cellsBase, q4: num(q4, "%"), stdev: num(stdev, " p.p.") }, subject: group.subject, personId: null, sortKeys: { NAME: group.label, Q4: q4, DISPERSION: stdev } })
          }
          continue
        }
        const stats = statsOf(group.members, last, definition, data)
        columns = [...head, { key: "withQuartile", label: "Com quartil", numeric: true }, ...QUARTILES.map((quartile) => ({ key: quartile, label: quartile, numeric: true })), { key: "stdev", label: "Desvio padrão", numeric: true }, { key: "range", label: "Amplitude P10–P90", numeric: true }]
        rows.push({
          cells: { ...cellsBase, withQuartile: `${stats.withQuartile} de ${stats.people}`, ...Object.fromEntries(QUARTILES.map((quartile) => [quartile, share(stats.quartiles[quartile], stats.withQuartile)])), stdev: num(stats.stdev, " p.p."), range: stats.p10 !== null && stats.p90 !== null ? `${num(stats.p10, "%")} – ${num(stats.p90, "%")}` : "—" },
          subject: group.subject,
          personId: null,
          sortKeys: { NAME: group.label, Q4: stats.q4Percent, DISPERSION: stats.stdev, ACHIEVEMENT: stats.mean },
        })
        continue
      }
      // Visão por indicador.
      if (mode === "BY_MONTH" || mode === "RECURRENCE") {
        const series = periods.map((period) => statsOf(group.members, period, definition, data).belowPercent)
        const reference = periods.map((period) => statsOf(whole, period, definition, data).belowPercent)
        const above = series.filter((value, index) => value !== null && reference[index] !== null && value > reference[index]!).length
        columns = [...head, ...periods.map((period, index) => ({ key: `m${index}`, label: `% fora ${months[index]}`, numeric: true })), ...(mode === "RECURRENCE" ? [{ key: "above", label: "Meses acima da estrutura", numeric: true }] : [])]
        rows.push({ cells: { ...cellsBase, ...Object.fromEntries(series.map((value, index) => [`m${index}`, num(value, "%")])), above: String(above) }, subject: group.subject, personId: null, sortKeys: { NAME: group.label, BELOW_PERCENT: mode === "RECURRENCE" ? above * 1000 + (series.at(-1) ?? 0) : series.at(-1) ?? null, CHANGE: series.at(-1) !== null && series[0] !== null ? round1(series.at(-1)! - series[0]!) : null } })
        continue
      }
      if (mode === "AVERAGE") {
        const series = periods.map((period) => statsOf(group.members, period, definition, data))
        const below = averageOf(series.map((stats) => stats.belowPercent))
        const mean = averageOf(series.map((stats) => stats.mean))
        columns = [...head, { key: "below", label: `% fora (média de ${periods.length} meses)`, numeric: true }, { key: "mean", label: "Atingimento médio (média)", numeric: true }, { key: "months", label: "Meses com dado", numeric: true }]
        rows.push({ cells: { ...cellsBase, below: num(below, "%"), mean: num(mean, "%"), months: String(series.filter((stats) => stats.withReference > 0).length) }, subject: group.subject, personId: null, sortKeys: { NAME: group.label, BELOW_PERCENT: below, ACHIEVEMENT: mean } })
        continue
      }
      const stats = statsOf(group.members, last, definition, data)
      const initial = periods.length > 1 ? statsOf(group.members, first, definition, data) : null
      const change = initial && stats.belowPercent !== null && initial.belowPercent !== null ? round1(stats.belowPercent - initial.belowPercent) : null
      columns = [...head, { key: "withReference", label: "Com referência", numeric: true }, { key: "below", label: "Fora", numeric: true }, { key: "belowPercent", label: "% fora", numeric: true }, { key: "mean", label: "Atingimento médio", numeric: true }, { key: "median", label: "Mediana", numeric: true }, { key: "q4", label: "Q4 oficial", numeric: true }, ...(periods.length > 1 ? [{ key: "change", label: `Δ % fora desde ${months[0]}`, numeric: true }] : [])]
      rows.push({
        cells: { ...cellsBase, withReference: `${stats.withReference} de ${stats.people}`, below: num(stats.below), belowPercent: num(stats.belowPercent, "%"), mean: num(stats.mean, "%"), median: num(stats.median, "%"), q4: share(stats.quartiles.Q4, stats.withQuartile), change: pp(change) },
        subject: group.subject,
        personId: null,
        sortKeys: { NAME: group.label, BELOW_PERCENT: stats.belowPercent, BELOW: stats.below, ACHIEVEMENT: stats.mean, CHANGE: change, Q4: stats.q4Percent, DISPERSION: stats.stdev },
      })
    }
  }
  const defaultSort: QuerySort = input.view === "QUARTILES" ? "Q4" : "BELOW_PERCENT"
  const { rows: finalRows, total } = finish(rows, input, defaultSort, "desc")
  const subjectName = indicators.length === 1 ? indicators[0]!.name : "Indicadores"
  return { title: input.view === "QUARTILES" ? `Quartis e dispersão — ${subjectName} por ${label.toLowerCase()}` : `${subjectName} por ${label.toLowerCase()}`, indicatorCode: indicators.length === 1 && indicators[0]!.code !== PRV_CODE ? indicators[0]!.code : null, columns, rows: finalRows, total }
}

// ---------------------------------------------------------------------------------------------
// Evolução da estrutura (uma linha por competência)
// ---------------------------------------------------------------------------------------------

function periodRows(context: Context): Table {
  const { input, data, indicators, periods } = context
  const members = input.structure.resolved.members
  const rows: SortableRow[] = []
  let columns: QueryTableColumn[]
  if (input.view === "CONSOLIDATED") {
    columns = [{ key: "period", label: "Competência", numeric: false }, { key: "belowAny", label: "Com indicador fora", numeric: true }, { key: "mean", label: "Atingimento médio geral", numeric: true }, { key: "prv", label: "PRV médio", numeric: true }, { key: "prvQ4", label: "No Q4 de PRV", numeric: true }]
    for (const period of periods) {
      const stats = consolidatedOf(members, period, indicators.filter((definition) => definition.code !== PRV_CODE), data)
      rows.push({ cells: { period: longPeriodLabel(period), belowAny: share(stats.belowAny, stats.withData), mean: num(stats.mean, "%"), prv: num(stats.prvMean, "%"), prvQ4: share(stats.prvQ4, stats.prvWithData) }, subject: null, personId: null, sortKeys: { NAME: period } })
    }
  } else {
    const quartiles = input.view === "QUARTILES"
    columns = [{ key: "period", label: "Competência", numeric: false }, { key: "indicator", label: "Indicador", numeric: false }, ...(quartiles ? [...QUARTILES.map((quartile) => ({ key: quartile, label: quartile, numeric: true })), { key: "stdev", label: "Desvio padrão", numeric: true }] : [{ key: "withReference", label: "Com referência", numeric: true }, { key: "below", label: "Fora", numeric: true }, { key: "belowPercent", label: "% fora", numeric: true }, { key: "mean", label: "Atingimento médio", numeric: true }, { key: "median", label: "Mediana", numeric: true }, { key: "q4", label: "Q4 oficial", numeric: true }])]
    for (const definition of indicators) {
      for (const period of periods) {
        const stats = statsOf(members, period, definition, data)
        rows.push({
          cells: { period: longPeriodLabel(period), indicator: definition.name, withReference: `${stats.withReference} de ${stats.people}`, below: num(stats.below), belowPercent: num(stats.belowPercent, "%"), mean: num(stats.mean, "%"), median: num(stats.median, "%"), q4: share(stats.quartiles.Q4, stats.withQuartile), ...Object.fromEntries(QUARTILES.map((quartile) => [quartile, share(stats.quartiles[quartile], stats.withQuartile)])), stdev: num(stats.stdev, " p.p.") },
          subject: null,
          personId: null,
          sortKeys: { NAME: `${period}|${definition.name}` },
        })
      }
    }
  }
  const { rows: finalRows, total } = finish(rows, { ...input, sort: "NAME", order: "asc" }, "NAME", "asc")
  return { title: `Evolução — ${input.view === "CONSOLIDATED" ? "resultado consolidado" : indicators.map((definition) => definition.name).join(", ")}`, indicatorCode: null, columns, rows: finalRows, total }
}

// ---------------------------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------------------------

function personRows(scope: ViewerScope, context: Context): Table {
  const { input, data, periods, last, first, months } = context
  const unitOf = new Map<string, string>()
  for (const bucket of unitBuckets(scope, input.structure, null).buckets) for (const member of bucket.members) unitOf.set(member.id, bucket.label)
  const members = input.structure.resolved.members
  const mode = periods.length > 1 ? input.periodMode : "LATEST"
  const quartileFilter = input.quartiles && input.quartiles.length > 0 ? new Set(input.quartiles) : null
  const rows: SortableRow[] = []
  let columns: QueryTableColumn[]
  const indicators = input.view === "CONSOLIDATED" ? context.indicators.filter((definition) => definition.code !== PRV_CODE) : context.indicators
  const unit = (member: PersonNode) => unitOf.get(member.id) ?? "—"
  // Equipe sem unidades abaixo (Supervisor): a coluna "Unidade" seria só traços.
  const withUnits = unitOf.size > 0
  const unitColumn: QueryTableColumn[] = withUnits ? [{ key: "unit", label: "Unidade", numeric: false }] : []

  if (input.view === "CONSOLIDATED" || indicators.length > 1) {
    // Pessoas × todos os indicadores: quantos fora (ofensor por volume), atingimento médio e PRV.
    const minimum = input.minBelowIndicators ?? (input.situation === "BELOW" ? 1 : null)
    if (mode === "LATEST") {
      columns = [{ key: "person", label: "Pessoa", numeric: false }, ...unitColumn, { key: "withData", label: "Indicadores com dado", numeric: true }, { key: "below", label: "Fora", numeric: true }, { key: "worst", label: "Indicadores fora (menor atingimento primeiro)", numeric: false }, { key: "mean", label: "Atingimento médio", numeric: true }, { key: "prv", label: "PRV", numeric: true }, { key: "prvQuartile", label: "Quartil PRV", numeric: false }]
      for (const member of members) {
        const entries = indicators.map((definition) => ({ definition, row: data.rowOf(last, definition.code, member.id) })).filter((entry) => entry.row !== null)
        const below = entries.filter((entry) => isWithinReference(entry.row!, entry.definition.direction) === false).sort((a, b) => (a.row!.achievementPercent ?? 1e9) - (b.row!.achievementPercent ?? 1e9))
        const prv = data.rowOf(last, PRV_CODE, member.id)
        if (minimum !== null && below.length < minimum) continue
        if (input.situation === "WITHIN" && (entries.length === 0 || below.length > 0)) continue
        if (input.situation === "NO_DATA" && entries.length > 0) continue
        if (quartileFilter && !(prv?.quartile && quartileFilter.has(prv.quartile))) continue
        const mean = averageOf(entries.map((entry) => entry.row!.achievementPercent))
        rows.push({
          cells: { person: member.name, unit: unit(member), withData: String(entries.length), below: String(below.length), worst: below.slice(0, 3).map((entry) => `${entry.definition.name} (${num(entry.row!.achievementPercent, "%")})`).join("; ") || "—", mean: num(mean, "%"), prv: num(prv?.achievementPercent ?? null, "%"), prvQuartile: prv?.quartile ?? "—" },
          subject: null,
          personId: member.id,
          sortKeys: { NAME: member.name, BELOW: below.length, ACHIEVEMENT: prv?.achievementPercent ?? mean, BELOW_PERCENT: percentOf(below.length, entries.length) },
        })
      }
      const { rows: finalRows, total } = finish(rows, input, "BELOW", "desc")
      return { title: minimum ? `Pessoas fora da referência em ${minimum} ou mais indicadores` : quartileFilter ? `Pessoas no ${[...quartileFilter].join("/")} de PRV` : "Pessoas e indicadores fora da referência", indicatorCode: null, columns, rows: finalRows, total }
    }
    columns = [{ key: "person", label: "Pessoa", numeric: false }, ...unitColumn, { key: "monthsBelow", label: `Meses com indicador fora (de ${periods.length})`, numeric: true }, { key: "monthsQ4", label: "Meses no Q4 de PRV", numeric: true }, { key: "prv", label: "PRV médio", numeric: true }, ...(mode === "BY_MONTH" ? periods.map((period, index) => ({ key: `m${index}`, label: `PRV ${months[index]}`, numeric: true })) : [])]
    for (const member of members) {
      const perMonth = periods.map((period) => {
        const entries = indicators.map((definition) => ({ definition, row: data.rowOf(period, definition.code, member.id) })).filter((entry) => entry.row !== null)
        return { below: entries.some((entry) => isWithinReference(entry.row!, entry.definition.direction) === false), prv: data.rowOf(period, PRV_CODE, member.id) }
      })
      const monthsBelow = perMonth.filter((entry) => entry.below).length
      const monthsQ4 = perMonth.filter((entry) => entry.prv?.quartile === "Q4").length
      if (input.situation === "BELOW" && monthsBelow === 0) continue
      if (quartileFilter && !perMonth.some((entry) => entry.prv?.quartile && quartileFilter.has(entry.prv.quartile))) continue
      const prvMean = averageOf(perMonth.map((entry) => entry.prv?.achievementPercent ?? null))
      rows.push({ cells: { person: member.name, unit: unit(member), monthsBelow: String(monthsBelow), monthsQ4: String(monthsQ4), prv: num(prvMean, "%"), ...Object.fromEntries(perMonth.map((entry, index) => [`m${index}`, num(entry.prv?.achievementPercent ?? null, "%")])) }, subject: null, personId: member.id, sortKeys: { NAME: member.name, BELOW: monthsBelow * 100 + monthsQ4, Q4: monthsQ4, ACHIEVEMENT: prvMean } })
    }
    const { rows: finalRows, total } = finish(rows, input, "BELOW", "desc")
    return { title: `Pessoas — recorrência em ${periods.length} competências`, indicatorCode: null, columns, rows: finalRows, total }
  }

  // Um indicador (ou o PRV).
  const definition = indicators[0] ?? PRV_DEFINITION
  const situationOf = (row: IndicatorPerformanceRow | null) => {
    const within = row ? isWithinReference(row, definition.direction) : null
    return within === null ? "NO_DATA" : within ? "WITHIN" : "BELOW"
  }
  const label = { NO_DATA: "sem dado", WITHIN: "dentro", BELOW: "fora" } as const
  if (mode === "LATEST") {
    columns = [{ key: "person", label: "Pessoa", numeric: false }, ...unitColumn, ...(definition.code === PRV_CODE ? [] : [{ key: "value", label: "Valor", numeric: true }, { key: "target", label: "Meta", numeric: true }]), { key: "achievement", label: "Atingimento", numeric: true }, { key: "quartile", label: "Quartil oficial", numeric: false }, { key: "situation", label: "Situação", numeric: false }, ...(periods.length > 1 ? [{ key: "change", label: `Δ atingimento desde ${months[0]}`, numeric: true }] : [])]
    let withoutData = 0
    for (const member of members) {
      const row = data.rowOf(last, definition.code, member.id)
      const situation = situationOf(row)
      // Ranking de pessoas: quem está sem dado não entra (sem dado nunca é desempenho ruim) — vira nota, salvo quando pedido.
      if (situation === "NO_DATA" && input.situation !== "NO_DATA") {
        withoutData += 1
        continue
      }
      if (input.situation && input.situation !== situation) continue
      if (quartileFilter && !(row?.quartile && quartileFilter.has(row.quartile))) continue
      const initial = periods.length > 1 ? data.rowOf(first, definition.code, member.id) : null
      const change = row?.achievementPercent != null && initial?.achievementPercent != null ? round1(row.achievementPercent - initial.achievementPercent) : null
      rows.push({
        cells: { person: member.name, unit: unit(member), value: row ? formatIndicatorValue(row.value, definition.unit) : "—", target: row?.targetValue != null ? formatIndicatorValue(row.targetValue, definition.unit) : "—", achievement: num(row?.achievementPercent ?? null, "%"), quartile: row?.quartile ?? "—", situation: label[situation], change: pp(change) },
        subject: null,
        personId: member.id,
        sortKeys: { NAME: member.name, ACHIEVEMENT: row?.achievementPercent ?? null, CHANGE: change, BELOW: situation === "BELOW" ? 1 : 0, BELOW_PERCENT: row?.achievementPercent ?? null, Q4: row?.quartile === "Q4" ? 1 : 0 },
      })
    }
    if (withoutData > 0) context.limitations.push(`${withoutData} ${withoutData === 1 ? "pessoa sem dado" : "pessoas sem dado"} de ${definition.name} em ${longPeriodLabel(last)} — fora da lista.`)
    const { rows: finalRows, total } = finish(rows, input, "ACHIEVEMENT", "asc")
    return { title: `Pessoas — ${definition.name}${input.situation === "BELOW" ? " (fora da referência)" : quartileFilter ? ` (${[...quartileFilter].join("/")})` : ""}`, indicatorCode: definition.code === PRV_CODE ? null : definition.code, columns, rows: finalRows, total }
  }
  // Vários meses de um indicador: média, mês a mês ou recorrência.
  columns = [{ key: "person", label: "Pessoa", numeric: false }, ...unitColumn, { key: "mean", label: `Atingimento médio (${periods.length} meses)`, numeric: true }, { key: "monthsBelow", label: "Meses fora", numeric: true }, { key: "monthsQ4", label: "Meses no Q4", numeric: true }, ...(mode === "BY_MONTH" ? periods.map((period, index) => ({ key: `m${index}`, label: months[index]!, numeric: true })) : [{ key: "last", label: `Atingimento ${months.at(-1)}`, numeric: true }])]
  for (const member of members) {
    const series = periods.map((period) => data.rowOf(period, definition.code, member.id))
    const monthsBelow = series.filter((row) => situationOf(row) === "BELOW").length
    const monthsQ4 = series.filter((row) => row?.quartile === "Q4").length
    if (input.situation === "BELOW" && monthsBelow === 0) continue
    if (input.situation === "WITHIN" && (monthsBelow > 0 || series.every((row) => row === null))) continue
    if (quartileFilter && !series.some((row) => row?.quartile && quartileFilter.has(row.quartile))) continue
    const mean = averageOf(series.map((row) => row?.achievementPercent ?? null))
    if (mean === null && input.situation !== "NO_DATA") continue
    rows.push({ cells: { person: member.name, unit: unit(member), mean: num(mean, "%"), monthsBelow: String(monthsBelow), monthsQ4: String(monthsQ4), last: num(series.at(-1)?.achievementPercent ?? null, "%"), ...Object.fromEntries(series.map((row, index) => [`m${index}`, num(row?.achievementPercent ?? null, "%")])) }, subject: null, personId: member.id, sortKeys: { NAME: member.name, ACHIEVEMENT: mean, BELOW: monthsBelow * 100 + monthsQ4, Q4: monthsQ4 } })
  }
  const { rows: finalRows, total } = finish(rows, input, mode === "RECURRENCE" ? "BELOW" : "ACHIEVEMENT", mode === "RECURRENCE" ? "desc" : "asc")
  return { title: `Pessoas — ${definition.name} em ${periods.length} competências`, indicatorCode: definition.code === PRV_CODE ? null : definition.code, columns, rows: finalRows, total }
}

