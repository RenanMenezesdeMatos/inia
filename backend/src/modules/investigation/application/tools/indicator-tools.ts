import { resolveOfficialClosure } from "../../../indicators/application/official-closure.js"
import { resolveOperationalDailySeries, resolveOperationalWindow, resolveOperationalWindowBySubject, type OperationalWindowResult, type WindowDefinitionParam } from "../../../indicators/application/operational-measurement-resolver.js"
import { combineWindowComponents, defaultMeasurementAggregation, mergeRawComponents } from "../../../indicators/domain/operational-aggregation.js"
import { formatIndicatorValue } from "../../../indicators/domain/indicator-definition.js"
import { localDateOf } from "../../../workflows/application/time-window.js"
import { percentageChange } from "../../../workflows/application/condition-evaluator.js"
import { detectAnomalies, type SeriesPoint } from "../../domain/anomaly-detection.js"
import { ANALYSIS_DIMENSION_DEFINITIONS, dimensionsForIndicator, type AnalysisDimension } from "../../domain/analysis-dimensions.js"
import { deltaOf, noData, notSupported, percentOf, sufficient, type ToolQuality, type ToolResult } from "../../domain/tool-output.js"
import { describeWindow, loadIndicator, loadPeerPopulation, MINIMUM_COMPARISON_POPULATION, previousPeriodOf, resolvePeriod, type IndicatorInfo, type InvestigationPeriod, type ToolContext } from "../tool-context.js"
import { countInteractions, segmentInteractions } from "./interaction-tools.js"

const WEEKDAY_LABELS = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]

function definitionParam(indicator: IndicatorInfo): WindowDefinitionParam {
  return { kind: indicator.kind, unjustifiedAbsencePolicy: indicator.unjustifiedAbsencePolicy }
}

/** Janela operacional do colaborador pela semântica do catálogo (mesmo resolvedor de Condition/Ranking/Analytics). */
export async function operationalWindowFor(context: ToolContext, indicator: IndicatorInfo, period: InvestigationPeriod, subjectIds: string[] = [context.subject.operatorId]): Promise<OperationalWindowResult> {
  return resolveOperationalWindow(
    context.db,
    { indicatorCode: indicator.code, subjectIds, window: period, aggregation: defaultMeasurementAggregation(indicator.kind), expectedDays: 0, timeZone: context.timeZone, now: context.now, workdayCache: context.workdayCache },
    definitionParam(indicator),
  )
}

/**
 * Qualidade de uma janela: SEM DADOS > cobertura mínima do catálogo > amostra mínima > fonte de
 * situação desatualizada > fonte atrasada — reutiliza as mesmas semânticas de Analytics/Calendário.
 */
export function assessWindowQuality(result: OperationalWindowResult, indicator: IndicatorInfo): ToolQuality {
  const eligibility = result.eligibility
  const freshness = eligibility?.statusConfidence.freshness === "STALE" ? "STALE" : eligibility?.statusConfidence.freshness === "FRESH" ? "FRESH" : "UNKNOWN"
  const base = { sampleCount: result.sampleCount, coverage: result.coverage, freshness } as const
  if (result.value === null) {
    return { ...base, status: "NO_DATA", note: result.noDataReason === "NO_ELIGIBLE_DAYS" ? "nenhum dia elegível na janela (situação funcional/escala) — não é performance zero" : "sem medição elegível na janela" }
  }
  if (indicator.minimumCoverage !== null && result.coverage !== null && result.coverage < indicator.minimumCoverage) {
    return { ...base, status: "INSUFFICIENT_COVERAGE", note: `cobertura ${pct(result.coverage)} abaixo da mínima do catálogo (${pct(indicator.minimumCoverage)})` }
  }
  if (indicator.minimumSampleSize !== null && result.sampleCount < indicator.minimumSampleSize) {
    return { ...base, status: "INSUFFICIENT_SAMPLE", note: `${result.sampleCount} medição(ões), mínimo do catálogo ${indicator.minimumSampleSize}` }
  }
  if (eligibility && eligibility.observed.dataSourceDelayDays > 0) {
    return { ...base, status: "SOURCE_DELAY", note: `${eligibility.observed.dataSourceDelayDays} dia(s) com fonte de dados atrasada na janela` }
  }
  if (freshness === "STALE" && eligibility && eligibility.statusConfidence.unconfirmedDays > 0) {
    return { ...base, status: "STALE", note: `situação funcional não confirmada em ${eligibility.statusConfidence.unconfirmedDays} dia(s) (fonte de RH desatualizada)` }
  }
  return { ...base, status: "SUFFICIENT" }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** Meta vigente pela precedência pessoa > Subgrupo > Grupo, na data de fim da janela. */
async function loadTarget(context: ToolContext, indicator: IndicatorInfo, period: InvestigationPeriod): Promise<{ value: number; scope: "PERSON" | "SUBTEAM" | "TEAM" } | null> {
  const at = localDateOf(new Date(period.end.getTime() - 1), context.timeZone)
  const candidates: { type: "PERSON" | "SUBTEAM" | "TEAM"; id: string | null }[] = [
    { type: "PERSON", id: context.subject.operatorId },
    { type: "SUBTEAM", id: context.subject.subteamId },
    { type: "TEAM", id: context.subject.teamId },
  ]
  for (const candidate of candidates) {
    if (!candidate.id) continue
    const row = await context.db.query<{ target_value: string }>(
      `select target_value from goals where organization_id = $1 and indicator_definition_id = $2 and subject_type = $3 and subject_id = $4
         and valid_from <= $5::date and (valid_until is null or valid_until >= $5::date) order by valid_from desc limit 1`,
      [context.organizationId, indicator.id, candidate.type, candidate.id, at],
    )
    if (row.rows[0]) return { value: Number(row.rows[0].target_value), scope: candidate.type }
  }
  return null
}

type OfficialRow = { reference_period: string; value: string; target_value: string | null; achievement_percent: string | null; weight_percent: string | null; quartile: string | null }

/** Fechamentos OFICIAIS do colaborador para o indicador — lidos prontos, até o último mês fechado. */
async function loadOfficialClosures(context: ToolContext, indicator: IndicatorInfo, limit: number): Promise<{ lastClosedPeriod: string; rows: OfficialRow[] }> {
  const closure = await resolveOfficialClosure(context.db, context.organizationId, context.now)
  const rows = await context.db.query<OfficialRow>(
    `select reference_period, value, target_value, achievement_percent, weight_percent, quartile
     from employee_indicator_performance
     where organization_id = $1 and person_id = $2 and indicator_definition_id = $3 and reference_period <= $4
     order by reference_period desc limit $5`,
    [context.organizationId, context.subject.operatorId, indicator.id, closure.lastClosedPeriod, limit],
  )
  return { lastClosedPeriod: closure.lastClosedPeriod, rows: rows.rows }
}

function officialView(row: OfficialRow) {
  return {
    referencePeriod: row.reference_period,
    value: Number(row.value),
    targetValue: row.target_value === null ? null : Number(row.target_value),
    achievementPercent: row.achievement_percent === null ? null : Number(row.achievement_percent),
    weightPercent: row.weight_percent === null ? null : Number(row.weight_percent),
    quartile: row.quartile,
  }
}

function indicatorMeta(indicator: IndicatorInfo) {
  return { code: indicator.code, name: indicator.name, unit: indicator.unit, desiredDirection: indicator.direction, aggregation: indicator.kind, dailySupported: indicator.dailySupported }
}

// ---------------------------------------------------------------------------------------------

export async function getIndicatorSnapshot(context: ToolContext, args: { indicatorCode: string; period?: { from: string; to: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  const period = resolvePeriod(context, args.period)
  const target = await loadTarget(context, indicator, period)
  const official = indicator.officialClosureSupported ? await loadOfficialClosures(context, indicator, 1) : null
  const provenanceBase = { period: describeWindow(period), population: `colaborador ${context.subject.operatorName ?? ""}`.trim(), filters: [] as string[] }

  if (!indicator.dailySupported) {
    const latest = official?.rows[0]
    return {
      data: {
        indicator: indicatorMeta(indicator),
        operational: null,
        target,
        official: latest ? { lastClosedPeriod: official!.lastClosedPeriod, latest: officialView(latest), note: "valores oficiais como fornecidos — nunca recalculados" } : null,
      },
      quality: latest ? sufficient(1, null, "indicador sem medição operacional diária — só fechamento oficial") : noData("indicador sem medição operacional diária e sem fechamento oficial"),
      provenance: { ...provenanceBase, dataSource: "OFFICIAL_PERFORMANCE" },
    }
  }

  const result = await operationalWindowFor(context, indicator, period)
  const quality = assessWindowQuality(result, indicator)
  const latest = official?.rows[0]
  return {
    data: {
      indicator: indicatorMeta(indicator),
      operational: {
        value: result.value,
        formatted: result.value === null ? null : formatIndicatorValue(result.value, indicator.unit),
        granularity: "DAILY",
        sampleCount: result.sampleCount,
        daysWithData: result.daysWithData,
        eligibleDays: result.expectedDays,
        coverage: result.coverage,
        numerator: result.numerator,
        denominator: result.denominator,
        sampleTotal: result.sampleTotal,
        ignoredMeasurements: result.ignoredMeasurements,
        method: result.method,
      },
      target: target ? { ...target, withinTarget: result.value === null ? null : withinTarget(result.value, target.value, indicator.direction), gap: result.value === null ? null : round(result.value - target.value), gapPercent: result.value === null ? null : (deltaOf(result.value, target.value)?.percent ?? null) } : null,
      official: latest ? { lastClosedPeriod: official!.lastClosedPeriod, latest: officialView(latest), note: "valores oficiais como fornecidos — nunca recalculados" } : null,
    },
    quality,
    provenance: { ...provenanceBase, dataSource: "MEASUREMENT (operacional diário)", method: result.method },
  }
}

function withinTarget(value: number, target: number, direction: IndicatorInfo["direction"]): boolean {
  if (direction === "HIGHER") return value >= target
  if (direction === "LOWER") return value <= target
  return value === target
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export async function comparePeriods(context: ToolContext, args: { indicatorCode: string; currentPeriod?: { from: string; to: string }; referencePeriod?: { from: string; to: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  if (!indicator.dailySupported) return { data: { indicator: indicatorMeta(indicator) }, quality: notSupported("indicador sem medição operacional diária — use get_employee_history com layer OFFICIAL"), provenance: { population: "colaborador", filters: [], dataSource: "MEASUREMENT" } }
  const current = resolvePeriod(context, args.currentPeriod)
  const reference = args.referencePeriod ? resolvePeriod(context, args.referencePeriod) : previousPeriodOf(current, context.timeZone)
  const [currentResult, referenceResult] = await Promise.all([operationalWindowFor(context, indicator, current), operationalWindowFor(context, indicator, reference)])
  const currentQuality = assessWindowQuality(currentResult, indicator)
  const referenceQuality = assessWindowQuality(referenceResult, indicator)
  const both = currentResult.value !== null && referenceResult.value !== null
  const absolute = both ? round(currentResult.value! - referenceResult.value!) : null
  const relative = both ? percentageChange(currentResult.value!, referenceResult.value!) : null
  const directionOfChange = absolute === null ? null : absolute > 0 ? "UP" : absolute < 0 ? "DOWN" : "FLAT"
  const performanceDirection = absolute === null || indicator.direction === "TARGET" ? null : absolute === 0 ? "SAME" : (absolute > 0) === (indicator.direction === "HIGHER") ? "IMPROVED" : "DECLINED"
  const worst = [currentQuality, referenceQuality].find((quality) => quality.status !== "SUFFICIENT")
  return {
    data: {
      indicator: indicatorMeta(indicator),
      current: { period: current.label, value: currentResult.value, sampleCount: currentResult.sampleCount, coverage: currentResult.coverage, quality: currentQuality },
      reference: { period: reference.label, value: referenceResult.value, sampleCount: referenceResult.sampleCount, coverage: referenceResult.coverage, quality: referenceQuality },
      absoluteDifference: absolute,
      relativeDifferencePercent: relative === null ? null : Math.round(relative * 10) / 10,
      directionOfChange,
      performanceDirection,
      note: indicator.kind === "SUM" ? "SOMA: períodos de tamanhos diferentes não são comparáveis" : undefined,
    },
    quality: worst ? { ...worst, note: `${worst.note ?? worst.status} (em um dos períodos)` } : sufficient(currentResult.sampleCount + referenceResult.sampleCount, Math.min(currentResult.coverage ?? 1, referenceResult.coverage ?? 1)),
    provenance: { period: describeWindow(current), population: "colaborador", filters: [`referência: ${reference.label}`], dataSource: "MEASUREMENT (operacional diário)", method: `${currentResult.method} × ${referenceResult.method}` },
  }
}

export async function inspectIndicatorComposition(context: ToolContext, args: { indicatorCode: string; period?: { from: string; to: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  const period = resolvePeriod(context, args.period)
  if (!indicator.dailySupported) return { data: { indicator: indicatorMeta(indicator), status: "NOT_SUPPORTED" }, quality: notSupported("sem medição operacional diária — não há componentes registrados"), provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT" } }
  const result = await operationalWindowFor(context, indicator, period)
  const hasComponents = result.numerator !== null && result.denominator !== null
  if (!hasComponents || indicator.kind === "AVERAGE" || indicator.kind === "LATEST") {
    return {
      data: { indicator: indicatorMeta(indicator), status: "NOT_SUPPORTED", registered: { value: result.value, sampleCount: result.sampleCount, sampleTotal: result.sampleTotal } },
      quality: notSupported(`o indicador (${indicator.kind}) não registra componentes decomponíveis — só o valor por dia`),
      provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT (operacional diário)" },
    }
  }
  const components = indicator.kind === "RATE"
    ? [{ component: "numerator", label: "ocorrências", value: result.numerator }, { component: "denominator", label: "elegíveis (base)", value: result.denominator }]
    : indicator.kind === "SUM"
      ? [{ component: "sum", label: "soma dos períodos", value: result.value }, { component: "days", label: "dias com dado", value: result.daysWithData }]
      : [{ component: "numerator", label: `total (${indicator.unit.toLowerCase()})`, value: result.numerator }, { component: "denominator", label: "volume (contatos/avaliações)", value: result.denominator }]
  return {
    data: { indicator: indicatorMeta(indicator), status: "SUPPORTED", value: result.value, components, sampleTotal: result.sampleTotal, method: result.method, note: "componentes = Σ dos componentes diários registrados na fonte; nenhuma parte é estimada" },
    quality: assessWindowQuality(result, indicator),
    provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT (operacional diário)", method: result.method },
  }
}

export async function validateDataQuality(context: ToolContext, args: { indicatorCode: string; period?: { from: string; to: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  const period = resolvePeriod(context, args.period)
  if (!indicator.dailySupported) {
    const official = await loadOfficialClosures(context, indicator, 1)
    return {
      data: { indicator: indicatorMeta(indicator), analysisStatus: official.rows[0] ? "SUFFICIENT" : "NO_DATA", official: official.rows[0] ? officialView(official.rows[0]) : null, note: "indicador só com fechamento oficial" },
      quality: official.rows[0] ? sufficient(1, null) : noData("sem fechamento oficial"),
      provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "OFFICIAL_PERFORMANCE" },
    }
  }
  const result = await operationalWindowFor(context, indicator, period)
  const quality = assessWindowQuality(result, indicator)
  const eligibility = result.eligibility
  const observed = eligibility?.observed
  const missingSources: string[] = []
  if (observed && !observed.evidenceSources.interactions && observed.evidenceSources.indicatorCodes.length === 0) missingSources.push("nenhuma fonte de evidência de atividade configurada")
  if (observed && observed.waitingForSourcesDays > 0) missingSources.push(`${observed.waitingForSourcesDays} dia(s) aguardando fontes`)
  if (observed && observed.dataSourceDelayDays > 0) missingSources.push(`${observed.dataSourceDelayDays} dia(s) com fonte atrasada`)
  return {
    data: {
      indicator: indicatorMeta(indicator),
      sampleCount: result.sampleCount,
      minimumSample: indicator.minimumSampleSize,
      coverage: result.coverage,
      minimumCoverage: indicator.minimumCoverage,
      daysWithData: result.daysWithData,
      eligibleDays: result.expectedDays,
      freshness: quality.freshness,
      availability: observed ? { waitingForSourcesDays: observed.waitingForSourcesDays, dataSourceDelayDays: observed.dataSourceDelayDays } : null,
      missingSources,
      analysisStatus: quality.status,
      note: quality.note ?? null,
    },
    quality,
    provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT + CALENDÁRIO OPERACIONAL" },
  }
}

async function dailySeries(context: ToolContext, indicator: IndicatorInfo, period: InvestigationPeriod) {
  return resolveOperationalDailySeries(
    context.db,
    { indicatorCode: indicator.code, subjectIds: [context.subject.operatorId], window: period, aggregation: defaultMeasurementAggregation(indicator.kind), expectedDays: 0, timeZone: context.timeZone, now: context.now, workdayCache: context.workdayCache },
    definitionParam(indicator),
  )
}

export async function detectIndicatorAnomalies(context: ToolContext, args: { indicatorCode: string; period?: { from: string; to: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  const period = resolvePeriod(context, args.period)
  if (!indicator.dailySupported) return { data: { indicator: indicatorMeta(indicator) }, quality: notSupported("sem série diária"), provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT" } }
  const series = await dailySeries(context, indicator, period)
  const points: SeriesPoint[] = series.points.filter((point) => point.value.value !== null).map((point) => ({ date: point.date, value: point.value.value! }))
  const report = detectAnomalies(points, indicator.direction)
  const quality: ToolQuality = points.length < 5 ? { status: "INSUFFICIENT_SAMPLE", sampleCount: points.length, coverage: null, freshness: null, note: "menos de 5 dias com dado — a baseline não é confiável" } : sufficient(points.length, null)
  return {
    data: {
      indicator: indicatorMeta(indicator),
      method: report.method,
      baseline: report.baseline,
      scale: report.scale,
      pattern: report.pattern,
      anomalies: report.anomalies.map((point) => ({ date: point.date, weekday: WEEKDAY_LABELS[isoWeekday(point.date)], observedValue: point.value, baseline: point.baseline, deviation: point.deviation, score: point.score, classification: point.classification, performance: point.performance })),
      pointsAnalyzed: points.length,
      anomalySharePercent: percentOf(report.anomalies.length, points.length),
    },
    quality,
    provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT (série diária)", method: report.method },
  }
}

function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

function isoWeekStart(date: string): string {
  const base = new Date(`${date}T00:00:00Z`)
  const weekday = isoWeekday(date)
  base.setUTCDate(base.getUTCDate() - (weekday - 1))
  return base.toISOString().slice(0, 10)
}

/** Variação entre o primeiro e o último ponto com valor de uma série (sentido de performance pela direção do indicador) — cálculo da aplicação. */
function seriesChange(values: (number | null | undefined)[], direction: IndicatorInfo["direction"]): { from: number; to: number; absolute: number; percent: number | null; performance: "IMPROVED" | "DECLINED" | "STABLE" | null } | null {
  const present = values.filter((value): value is number => typeof value === "number")
  if (present.length < 2) return null
  const from = present[0]!
  const to = present[present.length - 1]!
  const delta = deltaOf(to, from)
  if (!delta) return null
  // Direção TARGET (valor-alvo) não tem sentido de melhora sem a meta: só a variação é informada.
  const performance = direction === "TARGET" ? null : delta.absolute === 0 ? "STABLE" : (direction === "HIGHER" ? delta.absolute > 0 : delta.absolute < 0) ? "IMPROVED" : "DECLINED"
  return { from, to, absolute: delta.absolute, percent: delta.percent, performance }
}

export async function getEmployeeHistory(context: ToolContext, args: { indicatorCode: string; layer: "OPERATIONAL" | "OFFICIAL"; period?: { from: string; to: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  if (args.layer === "OFFICIAL") {
    const official = await loadOfficialClosures(context, indicator, 12)
    const rows = [...official.rows].reverse().map(officialView)
    return {
      data: { indicator: indicatorMeta(indicator), layer: "OFFICIAL", lastClosedPeriod: official.lastClosedPeriod, series: rows, changeFirstToLast: seriesChange(rows.map((row) => row.value), indicator.direction), note: "fechamentos mensais oficiais como fornecidos — atingimento, quartil e peso nunca recalculados; a variação entre o primeiro e o último ponto é calculada pela aplicação sobre os valores fornecidos" },
      quality: rows.length > 0 ? sufficient(rows.length, null) : noData("sem fechamento oficial para este indicador"),
      provenance: { population: "colaborador", filters: [`até ${official.lastClosedPeriod}`], dataSource: "OFFICIAL_PERFORMANCE" },
    }
  }
  const period = resolvePeriod(context, args.period)
  if (!indicator.dailySupported) return { data: { indicator: indicatorMeta(indicator), layer: "OPERATIONAL" }, quality: notSupported("sem medição operacional diária"), provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT" } }
  const series = await dailySeries(context, indicator, period)
  const byWeek = new Map<string, typeof series.points>()
  for (const point of series.points) {
    const key = isoWeekStart(point.date)
    byWeek.set(key, [...(byWeek.get(key) ?? []), point])
  }
  const weeks = [...byWeek.entries()].map(([weekStart, points]) => {
    const combined = combineWindowComponents(mergeRawComponents(points.map((point) => point.raw)), defaultMeasurementAggregation(indicator.kind), indicator.kind)
    return { weekStart, value: combined.value, daysWithData: points.length, sampleTotal: combined.sampleTotal }
  })
  return {
    data: { indicator: indicatorMeta(indicator), layer: "OPERATIONAL", granularity: "WEEK", series: weeks, changeFirstToLast: seriesChange(weeks.map((week) => week.value), indicator.direction), daily: series.points.map((point) => ({ date: point.date, value: point.value.value })), ignoredMeasurements: series.ignoredMeasurements },
    quality: weeks.length > 0 ? sufficient(series.points.length, series.eligibility && series.eligibility.eligibleDays > 0 ? Math.min(1, series.points.length / series.eligibility.eligibleDays) : null) : noData("sem medição elegível na janela"),
    provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT (série diária agregada por semana)", method: `${indicator.kind} por semana ISO` },
  }
}

export async function getAvailableDimensions(context: ToolContext, args: { indicatorCode: string; period?: { from: string; to: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  const period = resolvePeriod(context, args.period)
  const interactions = await countInteractions(context, period)
  const dimensions = dimensionsForIndicator({ code: indicator.code, unit: indicator.unit, dailySupported: indicator.dailySupported }, interactions > 0)
  return {
    data: { indicator: indicatorMeta(indicator), dimensions, interactionsInPeriod: interactions, note: "recortes por assunto/canal/hora/flag medem as PRÓPRIAS interações registradas (proxy declarada), nunca a medição do indicador" },
    quality: sufficient(null, null),
    provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "CATÁLOGO DE DIMENSÕES + INTERACTIONS" },
  }
}

export async function segmentIndicator(context: ToolContext, args: { indicatorCode: string; dimension: AnalysisDimension; period?: { from: string; to: string }; filters?: { subject?: string; flag?: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  const period = resolvePeriod(context, args.period)
  const definition = ANALYSIS_DIMENSION_DEFINITIONS[args.dimension]
  if (definition.source === "INTERACTION") return segmentInteractions(context, indicator, args.dimension, period, args.filters ?? {})
  if (!indicator.dailySupported) return { data: { indicator: indicatorMeta(indicator), dimension: args.dimension }, quality: notSupported("sem medição operacional diária"), provenance: { period: describeWindow(period), population: "colaborador", filters: [], dataSource: "MEASUREMENT" } }
  const series = await dailySeries(context, indicator, period)
  const bucketKey = (date: string) => (args.dimension === "DAY" ? date : args.dimension === "WEEK" ? isoWeekStart(date) : String(isoWeekday(date)))
  const bucketLabel = (key: string) => (args.dimension === "DAY_OF_WEEK" ? WEEKDAY_LABELS[Number(key)]! : key)
  const groups = new Map<string, typeof series.points>()
  for (const point of series.points) groups.set(bucketKey(point.date), [...(groups.get(bucketKey(point.date)) ?? []), point])
  const total = combineWindowComponents(mergeRawComponents(series.points.map((point) => point.raw)), defaultMeasurementAggregation(indicator.kind), indicator.kind)
  const buckets = [...groups.entries()]
    .map(([key, points]) => {
      const raw = mergeRawComponents(points.map((point) => point.raw))
      const combined = combineWindowComponents(raw, defaultMeasurementAggregation(indicator.kind), indicator.kind)
      const contribution = indicator.kind === "SUM" && total.value ? round((combined.value ?? 0) / total.value) : indicator.kind === "WEIGHTED_AVERAGE" && total.denominator ? round((raw.denominatorSum ?? 0) / total.denominator) : null
      return { dimensionValue: bucketLabel(key), sortKey: key, indicatorValue: combined.value, sampleCount: raw.sampleCount, daysWithData: raw.daysWithData, sampleTotal: raw.sampleTotal, contribution, method: combined.method }
    })
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
  return {
    data: { indicator: indicatorMeta(indicator), dimension: args.dimension, metric: `${indicator.code} (medição operacional diária)`, total: { value: total.value, sampleCount: total.sampleCount }, buckets, contributionNote: contribution(indicator) },
    quality: buckets.length > 0 ? sufficient(series.points.length, series.eligibility && series.eligibility.eligibleDays > 0 ? Math.min(1, series.points.length / series.eligibility.eligibleDays) : null) : noData("sem medição elegível na janela"),
    provenance: { period: describeWindow(period), population: "colaborador", filters: [`dimensão ${definition.label}`], dataSource: "MEASUREMENT (operacional diário)", method: `${definition.grouping} · ${indicator.kind}` },
  }
}

function contribution(indicator: IndicatorInfo): string {
  if (indicator.kind === "SUM") return "contribution = parcela do bucket na soma total"
  if (indicator.kind === "WEIGHTED_AVERAGE") return "contribution = parcela do VOLUME (denominador) do bucket no total — mostra onde o peso está, não a causa"
  return "contribution não se aplica a esta semântica"
}

export async function comparePopulation(context: ToolContext, args: { indicatorCode: string; reference: "SUBGROUP" | "GROUP"; period?: { from: string; to: string } }): Promise<ToolResult> {
  const indicator = await loadIndicator(context, args.indicatorCode)
  const period = resolvePeriod(context, args.period)
  const population = await loadPeerPopulation(context, args.reference)
  const provenanceBase = { period: describeWindow(period), filters: [`referência ${args.reference}`] }
  if (!population) return { data: { reference: args.reference, status: "NO_POPULATION" }, quality: notSupported(args.reference === "SUBGROUP" ? "o colaborador não tem Subgrupo" : "o colaborador não tem Grupo"), provenance: { ...provenanceBase, population: "nenhuma", dataSource: "STRUCTURE" } }
  if (population.ids.length < MINIMUM_COMPARISON_POPULATION) {
    return { data: { reference: args.reference, status: "POPULATION_TOO_SMALL", populationSize: population.ids.length, minimum: MINIMUM_COMPARISON_POPULATION }, quality: notSupported(`população de referência com ${population.ids.length} pessoa(s) — mínimo ${MINIMUM_COMPARISON_POPULATION} (privacidade)`), provenance: { ...provenanceBase, population: population.label, dataSource: "STRUCTURE" } }
  }
  if (!indicator.dailySupported) return { data: { reference: args.reference, status: "NOT_SUPPORTED" }, quality: notSupported("sem medição operacional diária"), provenance: { ...provenanceBase, population: population.label, dataSource: "MEASUREMENT" } }
  // O mínimo de privacidade vale para quem TEM medição na janela, não para a lista de ativos: numa janela em que só um colega
  // trabalhou, a "referência" seria o valor dele (achado C13 da 4ª auditoria). Zero lógico de falta injustificada não conta.
  const peers = await resolveOperationalWindowBySubject(context.db, { indicatorCode: indicator.code, subjectIds: population.ids, window: period, aggregation: defaultMeasurementAggregation(indicator.kind), expectedDays: 0, timeZone: context.timeZone, now: context.now, workdayCache: context.workdayCache }, definitionParam(indicator))
  const contributors = [...peers.values()].filter((entry) => entry.daysWithData > 0).length
  if (contributors < MINIMUM_COMPARISON_POPULATION) {
    return { data: { reference: args.reference, status: "POPULATION_TOO_SMALL", minimum: MINIMUM_COMPARISON_POPULATION }, quality: notSupported(`menos de ${MINIMUM_COMPARISON_POPULATION} colegas com medição na janela — mínimo ${MINIMUM_COMPARISON_POPULATION} (privacidade)`), provenance: { ...provenanceBase, population: population.label, dataSource: "MEASUREMENT" } }
  }
  const [target, reference] = await Promise.all([operationalWindowFor(context, indicator, period), operationalWindowFor(context, indicator, period, population.ids)])
  const targetQuality = assessWindowQuality(target, indicator)
  const both = target.value !== null && reference.value !== null
  const difference = both ? round(target.value! - reference.value!) : null
  const differencePercent = both ? percentageChange(target.value!, reference.value!) : null
  const performance = difference === null || indicator.direction === "TARGET" ? null : difference === 0 ? "SAME" : (difference > 0) === (indicator.direction === "HIGHER") ? "BETTER_THAN_REFERENCE" : "WORSE_THAN_REFERENCE"
  return {
    data: {
      indicator: indicatorMeta(indicator),
      reference: args.reference,
      populationDefinition: `${population.label}: operadores ativos, exceto o colaborador (n=${population.ids.length}) — valor agregado pela semântica do indicador (pooled), nunca dados individuais`,
      targetValue: target.value,
      referenceValue: reference.value,
      difference,
      differencePercent: differencePercent === null ? null : Math.round(differencePercent * 10) / 10,
      performance,
      targetSample: target.sampleCount,
      referenceSample: reference.sampleCount,
      referencePopulation: population.ids.length,
      targetCoverage: target.coverage,
    },
    quality: reference.value === null ? noData("a população de referência não tem medição elegível na janela") : targetQuality,
    provenance: { ...provenanceBase, population: `${population.label} (n=${population.ids.length}, agregado)`, dataSource: "MEASUREMENT (operacional diário, pooled)", method: `${target.method} × ${reference.method}` },
  }
}
