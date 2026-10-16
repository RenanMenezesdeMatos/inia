import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import type { AnalyticsReadRepository, IndicatorDefinitionRow, IndicatorPerformanceRow, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import { isWithinReference } from "../../performance-analytics/application/member-performance.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { longPeriodLabel, previousReferencePeriod, shortPeriodLabel } from "../../performance-analytics/domain/reference-period.js"
import { ANALYTIC_METHODS, percentOf } from "../domain/analytic-rules.js"
import type { QueryTableCard, QueryTableColumn } from "../domain/view-models.js"
import { PRV_CODE, PRV_DEFINITION } from "./official-query.js"
import { averageOf, buildCard, finish, num, round1, type SortableRow } from "./query-common.js"
import type { ResolvedStructure } from "./references.js"
import { unitBuckets } from "./structure-units.js"

/**
 * DIAGNÓSTICO DE UM INDICADOR na estrutura — "onde está o principal problema em X?". Compara quem está FORA da referência (ou no Q4
 * oficial) com quem está DENTRO (ou no Q1) usando o que a plataforma registra de fato:
 *  - interações dos dois grupos na janela (motivo e submotivo, volume por pessoa, duração início→fim);
 *  - para indicador de TEMPO (unidade SECONDS — comportamento do catálogo, nunca o código): quanto cada motivo/submotivo explica da
 *    diferença de duração entre os grupos (participação × diferença de duração);
 *  - para os demais: quais motivos aparecem mais (ou menos) entre os piores;
 *  - tempo de casa e onde os piores estão (unidades).
 * Correlação, nunca causa: a resposta deve tratar os achados como hipóteses e mostrar o tamanho das amostras.
 */

export type InteractionStatRow = { personId: string; reason: string; subReason: string | null; calls: number; seconds: number }
export type InteractionStatsLoader = (personIds: string[], fromDate: string, toDateExclusive: string) => Promise<InteractionStatRow[]>
export type HireDatesLoader = (personIds: string[]) => Promise<Map<string, string | null>>

/** Motivo/submotivo entra na tabela com ao menos este número de chamadas no grupo dos piores (abaixo: "Outros"). */
export const MINIMUM_REASON_CALLS = 5
export const DIAGNOSIS_ROWS = 12

type GroupStats = { people: number; withCalls: number; calls: number; seconds: number }

export async function buildIndicatorDiagnosis(
  repository: AnalyticsReadRepository,
  scope: ViewerScope,
  input: { structure: ResolvedStructure; indicator: IndicatorDefinitionRow; period: string; months: number; compare: "BELOW_VS_WITHIN" | "Q4_VS_Q1"; level: "REASON" | "SUB_REASON"; loadInteractions: InteractionStatsLoader; loadHireDates: HireDatesLoader | null; now: Date },
): Promise<QueryTableCard> {
  const { structure, indicator, period } = input
  const members = structure.resolved.members
  const ids = members.map((member) => member.id)
  const rows: IndicatorPerformanceRow[] =
    indicator.code === PRV_CODE
      ? (await repository.loadPrvPerformance(scope.organizationId, ids, [period])).map((row) => ({ personId: row.personId, indicatorCode: PRV_CODE, referencePeriod: row.referencePeriod, value: row.achievementPercent, targetValue: 100, achievementPercent: row.achievementPercent, weightPercent: null, quartile: row.quartile, numerator: null, denominator: null, source: row.source }))
      : (await repository.loadIndicatorPerformance(scope.organizationId, ids, [period])).filter((row) => row.indicatorCode === indicator.code)
  const byPerson = new Map(rows.map((row) => [row.personId, row]))
  const definition = indicator.code === PRV_CODE ? PRV_DEFINITION : indicator
  const classify = (member: PersonNode): "WORST" | "BEST" | null => {
    const row = byPerson.get(member.id)
    if (!row) return null
    if (input.compare === "Q4_VS_Q1") return row.quartile === "Q4" ? "WORST" : row.quartile === ("Q1" satisfies Quartile) ? "BEST" : null
    const within = isWithinReference(row, definition.direction)
    return within === null ? null : within ? "BEST" : "WORST"
  }
  const worst = members.filter((member) => classify(member) === "WORST")
  const best = members.filter((member) => classify(member) === "BEST")

  // Janela de interações: os `months` meses que terminam na competência (inclusive).
  let start = period
  for (let index = 1; index < input.months; index += 1) start = previousReferencePeriod(start)
  const [nextYear, nextMonth] = period.split("-").map(Number) as [number, number]
  const toExclusive = nextMonth === 12 ? `${nextYear + 1}-01-01` : `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01`
  const [interactions, hireDates] = await Promise.all([input.loadInteractions([...worst, ...best].map((member) => member.id), `${start}-01`, toExclusive), input.loadHireDates ? input.loadHireDates([...worst, ...best].map((member) => member.id)) : Promise.resolve(new Map<string, string | null>())])
  const worstIds = new Set(worst.map((member) => member.id))
  const bestIds = new Set(best.map((member) => member.id))
  const totals = (group: Set<string>, people: number): GroupStats => {
    const own = interactions.filter((row) => group.has(row.personId))
    return { people, withCalls: new Set(own.map((row) => row.personId)).size, calls: own.reduce((sum, row) => sum + row.calls, 0), seconds: own.reduce((sum, row) => sum + row.seconds, 0) }
  }
  const worstTotals = totals(worstIds, worst.length)
  const bestTotals = totals(bestIds, best.length)
  const timeIndicator = definition.unit === "SECONDS"

  // Motivo › submotivo: participação nas chamadas de cada grupo e duração média.
  type ReasonAgg = { reason: string; subReason: string | null; worstCalls: number; worstSeconds: number; bestCalls: number; bestSeconds: number }
  const byReason = new Map<string, ReasonAgg>()
  for (const row of interactions) {
    // Nível MOTIVO agrega os submotivos (visão genérica); SUBMOTIVO mostra o detalhe.
    const subReason = input.level === "REASON" ? null : row.subReason
    const key = `${row.reason}|${subReason ?? ""}`
    const entry = byReason.get(key) ?? { reason: row.reason, subReason, worstCalls: 0, worstSeconds: 0, bestCalls: 0, bestSeconds: 0 }
    if (worstIds.has(row.personId)) {
      entry.worstCalls += row.calls
      entry.worstSeconds += row.seconds
    } else if (bestIds.has(row.personId)) {
      entry.bestCalls += row.calls
      entry.bestSeconds += row.seconds
    }
    byReason.set(key, entry)
  }
  const worstAvgDuration = worstTotals.calls > 0 ? worstTotals.seconds / worstTotals.calls : null
  const bestAvgDuration = bestTotals.calls > 0 ? bestTotals.seconds / bestTotals.calls : null
  const tableRows: SortableRow[] = []
  let otherCalls = 0
  for (const entry of byReason.values()) {
    if (entry.worstCalls < MINIMUM_REASON_CALLS) {
      otherCalls += entry.worstCalls
      continue
    }
    const worstShare = percentOf(entry.worstCalls, worstTotals.calls)
    const bestShare = percentOf(entry.bestCalls, bestTotals.calls)
    const worstDuration = entry.worstCalls > 0 ? entry.worstSeconds / entry.worstCalls : null
    const bestDuration = entry.bestCalls > 0 ? entry.bestSeconds / entry.bestCalls : null
    // Tempo: quanto o motivo explica da diferença de duração média entre os grupos (participação nos piores × diferença de duração).
    const impact = timeIndicator && worstDuration !== null && bestDuration !== null && worstTotals.calls > 0 ? round1((entry.worstCalls / worstTotals.calls) * (worstDuration - bestDuration)) : null
    const shareGap = worstShare !== null && bestShare !== null ? round1(worstShare - bestShare) : null
    tableRows.push({
      cells: {
        reason: entry.reason,
        subReason: entry.subReason ?? "—",
        worstCalls: String(entry.worstCalls),
        worstShare: num(worstShare, "%"),
        bestShare: num(bestShare, "%"),
        shareGap: shareGap === null ? "—" : `${shareGap > 0 ? "+" : ""}${num(shareGap, " p.p.")}`,
        worstDuration: worstDuration === null ? "—" : `${Math.round(worstDuration)} s`,
        bestDuration: bestDuration === null ? "—" : `${Math.round(bestDuration)} s`,
        impact: impact === null ? "—" : `${impact > 0 ? "+" : ""}${num(impact, " s")}`,
      },
      subject: null,
      personId: null,
      sortKeys: { NAME: `${entry.reason}|${entry.subReason ?? ""}`, CHANGE: timeIndicator ? impact : shareGap, BELOW: entry.worstCalls },
    })
  }
  const columns: QueryTableColumn[] = [
    { key: "reason", label: "Motivo", numeric: false },
    ...(input.level === "REASON" ? [] : [{ key: "subReason", label: "Submotivo", numeric: false }]),
    { key: "worstCalls", label: "Chamadas (piores)", numeric: true },
    { key: "worstShare", label: "% das chamadas (piores)", numeric: true },
    { key: "bestShare", label: "% das chamadas (melhores)", numeric: true },
    { key: "shareGap", label: "Diferença", numeric: true },
    ...(timeIndicator ? [{ key: "worstDuration", label: "Duração média (piores)", numeric: true }, { key: "bestDuration", label: "Duração média (melhores)", numeric: true }, { key: "impact", label: "Peso na diferença de duração", numeric: true }] : []),
  ]
  const { rows: finalRows, total } = finish(tableRows, { sort: "CHANGE", order: "desc", limit: DIAGNOSIS_ROWS }, "CHANGE", "desc")

  // Contexto: tempo de casa e onde os piores estão.
  const tenure = (group: PersonNode[]) => averageOf(group.map((member) => monthsSince(hireDates.get(member.id) ?? null, input.now)))
  const unitCounts = new Map<string, number>()
  for (const bucket of unitBuckets(scope, structure, null).buckets) {
    const count = bucket.members.filter((member) => worstIds.has(member.id)).length
    if (count > 0) unitCounts.set(bucket.label, count)
  }
  const groupNames = input.compare === "Q4_VS_Q1" ? { worst: "Q4 oficial", best: "Q1 oficial" } : { worst: "fora da referência", best: "dentro da referência" }
  const window = input.months > 1 ? `${shortPeriodLabel(start)} a ${shortPeriodLabel(period)}` : longPeriodLabel(period)
  const limitations: string[] = []
  if (worst.length === 0) limitations.push(`Ninguém da estrutura está ${groupNames.worst} em ${definition.name} em ${longPeriodLabel(period)}.`)
  if (best.length === 0) limitations.push(`Ninguém está ${groupNames.best} para comparar.`)
  if (worstTotals.calls < 30) limitations.push(`Amostra pequena de interações dos piores (${worstTotals.calls} chamadas em ${window}): trate os achados como pistas.`)
  if (otherCalls > 0) limitations.push(`${otherCalls} chamadas dos piores em motivos/submotivos com menos de ${MINIMUM_REASON_CALLS} chamadas ficaram fora da tabela.`)
  if (worstTotals.withCalls < worst.length) limitations.push(`${worst.length - worstTotals.withCalls} das ${worst.length} pessoas ${groupNames.worst} não têm interação registrada na janela.`)
  const summary = [
    `Grupos comparados (${longPeriodLabel(period)}): ${worst.length} pessoas ${groupNames.worst} × ${best.length} ${groupNames.best}.`,
    `Interações em ${window}: piores ${worstTotals.calls} chamadas (${num(worst.length > 0 ? round1(worstTotals.calls / worst.length) : null)} por pessoa${worstAvgDuration !== null ? `, duração média ${Math.round(worstAvgDuration)} s` : ""}) × melhores ${bestTotals.calls} (${num(best.length > 0 ? round1(bestTotals.calls / best.length) : null)} por pessoa${bestAvgDuration !== null ? `, duração média ${Math.round(bestAvgDuration)} s` : ""}).`,
    `Tempo de casa médio: piores ${num(tenure(worst), " meses")} × melhores ${num(tenure(best), " meses")}.`,
    unitCounts.size > 0 ? `Onde estão os piores: ${[...unitCounts].sort((a, b) => b[1] - a[1]).map(([label, count]) => `${label} ${count}`).join(", ")}.` : "",
  ].filter(Boolean)
  return buildCard({ structure, source: "OFFICIAL", now: input.now }, {
    title: `Diagnóstico — ${definition.name}: ${groupNames.worst} × ${groupNames.best}`,
    scopeNote: `Competência oficial: ${longPeriodLabel(period)} · interações de ${window}`,
    period,
    indicatorCode: definition.code === PRV_CODE ? null : definition.code,
    columns,
    rows: finalRows,
    total,
    highlights: summary,
    methods: [
      ANALYTIC_METHODS.reference,
      "Grupos pelo fechamento oficial da competência; interações (motivo › submotivo, duração início→fim) na janela indicada, só das pessoas dos dois grupos.",
      timeIndicator ? "Peso na diferença de duração = participação do motivo nas chamadas dos piores × (duração média dos piores − dos melhores) no motivo: quanto ele empurra a duração média dos piores para cima." : "Diferença = participação do motivo nas chamadas dos piores − nas dos melhores (p.p.).",
      "Associação, não causa: use como hipótese a confirmar (ex.: ouvir chamadas, monitoria) antes de agir.",
    ],
    limitations,
  })
}

function monthsSince(date: string | null, now: Date): number | null {
  if (!date) return null
  const since = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(since.getTime())) return null
  return Math.max(0, Math.round(((now.getTime() - since.getTime()) / (30.44 * 24 * 3_600_000)) * 10) / 10)
}
