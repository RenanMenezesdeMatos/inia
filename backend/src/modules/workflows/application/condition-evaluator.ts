import type { Database } from "../../../infrastructure/database/pool.js"
import {
  aggregateAchievementClosures,
  aggregateAchievementHistory,
  findLatestIndicatorPerformance,
  findLatestPrvPerformance,
  findRecentIndicatorPerformance,
  findRecentPrvPerformance,
} from "../../indicators/application/resolve-employee-performance.js"
import { eligibleDayRanges, eligibleMeasurementSql, resolveEligibleDaysBySubject, resolveOperationalClosedMonths, resolveOperationalWindow, type OperationalWindowResult } from "../../indicators/application/operational-measurement-resolver.js"
import type { MeasurementAggregation, OperationalAggregationKind } from "../../indicators/domain/operational-aggregation.js"
import { NON_ELIGIBLE_EMPLOYMENT_STATUSES } from "../../people/domain/employment-status.js"
import { resolveOperationalQuartiles, type OperationalQuartileOutcome } from "./operational-quartile-resolver.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "./organization-timezone.js"
import { businessDaysInWindow, closedCalendarMonths, describeTimeWindow, localDateOf, resolvePreviousTimeWindow, resolveTimeWindow, type TimeWindow } from "./time-window.js"
import type { FlowNode, HistoricalPeriod, HistoricalQuery, PerformanceQuery } from "../domain/graph-schema.js"

/**
 * Evaluator determinístico das Conditions "de dados" (histórico do indicador e performance do
 * colaborador) — a ÚNICA implementação dessas regras no sistema. Extraído de node-handlers.ts
 * (onde vivia inline no `case "condition"`) exatamente pra que produção (`processNode`), a
 * execução do QA Lab (que também roda `processNode`) e a PRÉVIA de massa de teste do QA Lab
 * cheguem à mesma decisão pra uma mesma Condition + sujeito + relógio + dados. A única coisa que
 * muda entre os chamadores é COMO o sujeito é resolvido (do enrollment, em produção; de cada
 * colaborador/estrutura candidato, na prévia) — nunca a regra.
 *
 * Zero efeito colateral: só leitura. Nunca chama IA.
 */
export type ConditionSubject = {
  /** O colaborador "da ocorrência" — usado pelas consultas de performance (sempre individuais). */
  operatorId: string
  /** Conjunto agregado — o próprio operador (modo Individual) ou os membros da Estrutura
   * Consolidada. Nunca vazio. */
  subjectIds: string[]
  /** População do quartil OPERACIONAL (source OPERATIONAL_QUARTILE): Abrangência ∩ Filtro
   * populacional do Workflow, ou a coleção anterior — resolvida pelo chamador, nunca "a empresa". */
  populationIds?: string[]
}

export type ConditionBranch = "true" | "false" | "no_data"

export type DataConditionConfig = Extract<FlowNode, { type: "condition" }>["config"]

export type ConditionEvaluation = { branch: ConditionBranch; matched: boolean; evaluation: Record<string, unknown> }

export type NoDataReason =
  | "NO_VALUE"
  | "NO_GOAL"
  | "INCOMPATIBLE_GOALS"
  | "INSUFFICIENT_CLOSURES"
  | "INSUFFICIENT_CLOSED_MONTHS"
  | "BELOW_MINIMUM_SAMPLE"
  | "BELOW_MINIMUM_COVERAGE"
  | "NO_PREVIOUS_PERIOD"
  | "PREVIOUS_PERIOD_ZERO"
  | "NO_PERFORMANCE"
  | "INSUFFICIENT_RECURRENCE"
  | "NO_ELIGIBLE_DAYS"
  | "EMPLOYMENT_STATUS_STALE"
  | "WORK_SCHEDULE_STALE"
  | "WORK_SCHEDULE_UNKNOWN"

/** Texto amigável do motivo de Sem Dados (Parte 15) — produzido aqui, uma vez, pra prévia,
 * debug e trace mostrarem exatamente a mesma explicação. */
export function describeNoDataReason(reason: NoDataReason, details: { available?: number | undefined; requested?: number | undefined; minimum?: number | undefined; since?: string | undefined } = {}): string {
  switch (reason) {
    case "NO_VALUE":
      return "Não há medições no período."
    case "NO_GOAL":
      return "Não há meta vigente cadastrada para o indicador."
    case "INCOMPATIBLE_GOALS":
      return "A estrutura possui metas diferentes entre os Subgrupos/Times."
    case "INSUFFICIENT_CLOSURES":
      return `Existem apenas ${details.available ?? 0} dos ${details.requested ?? "?"} fechamentos necessários.`
    case "INSUFFICIENT_CLOSED_MONTHS":
      return `Existem medições em apenas ${details.available ?? 0} dos ${details.requested ?? "?"} meses fechados necessários.`
    case "BELOW_MINIMUM_SAMPLE":
      return `Não há medições suficientes (${details.available ?? 0} de ${details.minimum ?? "?"} mínimas).`
    case "BELOW_MINIMUM_COVERAGE":
      return `Cobertura insuficiente: ${details.available ?? 0} de ${details.requested ?? "?"} dias elegíveis com medição (mínimo ${Math.round((details.minimum ?? 0) * 100)}%).`
    case "NO_ELIGIBLE_DAYS":
      return "Nenhum dia elegível na janela (situação funcional não produtiva, folga programada ou anterior à admissão) — o colaborador não deveria ter produzido neste período."
    case "EMPLOYMENT_STATUS_STALE":
      return `Sem medição em ${details.available ?? "?"} dia(s) elegível(is) que a INIA só PRESUME (fonte de situação funcional atrasada desde ${details.since ?? "?"}) — não é possível afirmar se o colaborador deveria ter produzido.`
    case "WORK_SCHEDULE_STALE":
      return `Sem medição em ${details.available ?? "?"} dia(s) cuja escala a INIA só PRESUME (fonte de escala atrasada desde ${details.since ?? "?"}) — a folga pode ter mudado; não é possível afirmar se o colaborador deveria ter produzido.`
    case "WORK_SCHEDULE_UNKNOWN":
      return `A escala do colaborador é desconhecida em ${details.available ?? "?"} dia(s) da janela (regime 6x1 sem folga informada) e não há medição nos dias restantes — a INIA não inventa folga nem cobra produção.`
    case "NO_PREVIOUS_PERIOD":
      return "Não existe período anterior disponível."
    case "PREVIOUS_PERIOD_ZERO":
      return "O período anterior é zero — variação percentual indefinida."
    case "NO_PERFORMANCE":
      return "Não há registro de performance para este colaborador."
    case "INSUFFICIENT_RECURRENCE":
      return `Existem apenas ${details.available ?? 0} dos ${details.requested ?? "?"} fechamentos necessários.`
  }
}

/**
 * Comparadores que não fazem sentido em `comparatorMatches` (booleano/numérico puro) — texto e
 * array. Comparador desconhecido para o tipo = não bate, nunca lança — quem valida que o
 * comparador é compatível com o tipo é o publish (workflow-router.ts).
 */
export function evaluateGenericComparator(comparator: string, raw: string | unknown[], threshold: string | undefined): boolean {
  if (Array.isArray(raw)) {
    switch (comparator) {
      case "CONTAINS":
        return threshold !== undefined && raw.some((item) => String(item) === threshold)
      case "NOT_CONTAINS":
        return threshold === undefined || !raw.some((item) => String(item) === threshold)
      case "IS_EMPTY":
        return raw.length === 0
      case "NOT_EMPTY":
        return raw.length > 0
      default:
        return false
    }
  }
  switch (comparator) {
    case "EQUALS":
      return raw === threshold
    case "NOT_EQUALS":
      return raw !== threshold
    case "CONTAINS":
      return threshold !== undefined && raw.includes(threshold)
    case "NOT_CONTAINS":
      return threshold === undefined || !raw.includes(threshold)
    case "STARTS_WITH":
      return threshold !== undefined && raw.startsWith(threshold)
    case "ENDS_WITH":
      return threshold !== undefined && raw.endsWith(threshold)
    case "IS_EMPTY":
      return raw.trim() === ""
    case "NOT_EMPTY":
      return raw.trim() !== ""
    default:
      return false
  }
}

export function comparatorMatches(
  comparator: string,
  isBoolean: boolean,
  actualValue: boolean | number,
  thresholdBoolean: boolean | null | undefined,
  thresholdNumeric: number | null | undefined,
): boolean {
  if (isBoolean) return comparator === "EQUALS" && actualValue === (thresholdBoolean ?? null)
  const threshold = Number(thresholdNumeric)
  const value = actualValue as number
  switch (comparator) {
    case "EQUALS":
      return value === threshold
    case "NOT_EQUALS":
      return value !== threshold
    case "GT":
      return value > threshold
    case "LT":
      return value < threshold
    case "GTE":
      return value >= threshold
    case "LTE":
      return value <= threshold
    default:
      return false
  }
}

/**
 * Resolve a janela [start, end) de uma consulta histórica — ROLLING_DAYS é uma janela móvel
 * terminando agora; CALENDAR delega pro mesmo resolvedor de calendário já usado pelas ações
 * agendadas (`resolvePeriodWindow`), evitando duplicar a matemática de semana/mês/trimestre
 * civil. `windowDays` é o formato legado (Conditions publicadas antes de `period` existir).
 */
/** Opções de avaliação propagadas pelo chamador (contexto organizacional — nunca uma string manual em cada módulo). */
export type EvaluationOptions = {
  /** Organização da execução (matrícula/Workflow, prévia do QA, política) — a definição de cada indicador lida pelo código é a DELA, nunca a de outra empresa com o mesmo código. Obrigatória de propósito. */
  organizationId: string
  /** Timezone IANA da organização (organization-timezone.ts). Ausente = fallback documentado. */
  timeZone?: string
  /** Cache por request/tick das resoluções de quartil operacional (prévia do QA e critérios avaliam N colaboradores sobre a MESMA população — uma query só). */
  quartileCache?: Map<string, Promise<OperationalQuartileOutcome>>
}

export function resolveHistoricalWindow(query: HistoricalQuery, now: Date, timeZone: string = DEFAULT_ORGANIZATION_TIMEZONE): TimeWindow {
  const period: HistoricalPeriod = query.period ?? { kind: "ROLLING_DAYS", days: query.windowDays ?? 7 }
  // CLOSURES nunca chega aqui — resolveHistoricalResult desvia pra resolveClosuresAggregation
  // antes (contagem de fechamentos, não intervalo de datas). A semântica das janelas (dia
  // alinhado ao calendário local, hoje parcial, janela anterior de mesmo tamanho) vive em
  // time-window.ts — única no sistema.
  return resolveTimeWindow(period, now, timeZone)
}

/** Janela do período ANTERIOR ao de `resolveHistoricalWindow`, pro mesmo `query.period` — usado
 * só por `compareTo: PREVIOUS_PERIOD`. */
function resolvePreviousHistoricalWindow(query: HistoricalQuery, now: Date, timeZone: string): TimeWindow {
  const period: HistoricalPeriod = query.period ?? { kind: "ROLLING_DAYS", days: query.windowDays ?? 7 }
  return resolvePreviousTimeWindow(period, now, timeZone)
}

/** Evidência de como um valor operacional foi formado (QA Lab, trace, contexto de Agent). */
export type OperationalEvidence = {
  windowLabel: string
  aggregation: MeasurementAggregation
  aggregationKind: OperationalAggregationKind
  method: string
  sampleCount: number
  daysWithData: number
  /** Dias elegíveis (dias úteis da janela a partir da admissão) — denominador da cobertura. */
  expectedDays: number | null
  coverage: number | null
  /** Cobertura mínima configurada no Workflow (fração), quando houver, e se foi atingida. */
  minimumCoverage: number | null
  coverageSatisfied: boolean | null
  numerator: number | null
  denominator: number | null
  sampleTotal: number | null
  /** Medições da janela em datas NÃO elegíveis (folga, day off, férias…) — preservadas, fora do cálculo. Só contagem. */
  ignoredMeasurements?: number
  /** Como os dias elegíveis foram formados: calendário, admissão, situação funcional, exceções, escala, feriado. */
  eligibility?: {
    businessDays: number
    calendarDays?: number
    scheduledWorkDays?: number
    eligibleDays: number
    excludedBeforeHire: number
    excludedByStatus: Partial<Record<string, number>>
    excludedByScheduleException?: Partial<Record<string, number>>
    excludedByScheduledDayOff?: number
    excludedByHoliday?: number
    excludedByUnknownSchedule?: number
    statusConfidence?: { freshness: "FRESH" | "STALE" | "UNKNOWN"; unconfirmedDays: number; lastSuccessLocalDate: string | null }
    scheduleConfidence?: { freshness: "FRESH" | "STALE" | "UNKNOWN"; basis: string; scheduleType: string | null; unconfirmedScheduleDays: number; unknownScheduleDays: number; lastSuccessLocalDate: string | null }
    holidayConfidence?: { policy: string; operationalCapitalCode: string | null; confidence: "CAPITAL_KNOWN" | "CAPITAL_UNKNOWN"; applicableHolidayDays: number }
    /** PLANEJADO × OBSERVADO: dias com evidência de produção, plano superado, produção ausente pós-turno, inconsistência de situação. */
    observed?: { workedObservedDays: number; workedDespitePlan: { exception: Partial<Record<string, number>>; scheduledDayOff: number; holiday: number; unknownSchedule: number }; missingExpectedProductionDays: number; productionWithNonEligibleStatusDays: number; evidenceSources: { interactions: boolean; indicatorCodes: string[] } }
  }
}

/** Dias elegíveis presumidos sob fonte de situação ATRASADA — só conta quando há pelo menos um. */
function staleUnconfirmedDays(evidence: OperationalEvidence | undefined): number {
  const confidence = evidence?.eligibility?.statusConfidence
  return confidence && confidence.freshness === "STALE" ? confidence.unconfirmedDays : 0
}

/** Dias elegíveis cuja ESCALA é presumida sob fonte de escala ATRASADA (fallback legado não conta como "stale"). */
function staleScheduleDays(evidence: OperationalEvidence | undefined): number {
  const confidence = evidence?.eligibility?.scheduleConfidence
  return confidence && confidence.freshness === "STALE" ? confidence.unconfirmedScheduleDays : 0
}

/** Dias da janela com escala DESCONHECIDA (regime 6x1 sem folga informada). */
function unknownScheduleDays(evidence: OperationalEvidence | undefined): number {
  return evidence?.eligibility?.excludedByUnknownSchedule ?? 0
}

/**
 * Motivo de "sem valor" quando não há medição: NÃO SEI (situação atrasada / escala atrasada /
 * escala desconhecida) antes de NÃO PRODUZIU (NO_VALUE). Causas diferentes, códigos diferentes.
 */
function noMeasurementReason(evidence: OperationalEvidence | undefined): NoDataReason {
  if (staleUnconfirmedDays(evidence) > 0) return "EMPLOYMENT_STATUS_STALE"
  if (staleScheduleDays(evidence) > 0) return "WORK_SCHEDULE_STALE"
  if (unknownScheduleDays(evidence) > 0) return "WORK_SCHEDULE_UNKNOWN"
  return "NO_VALUE"
}

/** Cobertura mínima: só falha quando há cobertura calculável abaixo do mínimo configurado. */
export function coverageSatisfied(coverage: number | null, minimumCoverage: number | undefined): boolean | null {
  if (minimumCoverage === undefined) return null
  if (coverage === null) return true
  return coverage >= minimumCoverage
}

function toEvidence(result: OperationalWindowResult, window: TimeWindow, timeZone: string, minimumCoverage?: number): OperationalEvidence {
  return {
    windowLabel: describeTimeWindow(window, timeZone),
    aggregation: result.aggregation,
    aggregationKind: result.kind,
    method: result.method,
    sampleCount: result.sampleCount,
    daysWithData: result.daysWithData,
    expectedDays: result.expectedDays,
    coverage: result.coverage,
    minimumCoverage: minimumCoverage ?? null,
    coverageSatisfied: coverageSatisfied(result.coverage, minimumCoverage),
    numerator: result.numerator,
    denominator: result.denominator,
    sampleTotal: result.sampleTotal,
    ignoredMeasurements: result.ignoredMeasurements,
    ...(result.eligibility
      ? {
          eligibility: {
            businessDays: result.eligibility.businessDays,
            calendarDays: result.eligibility.calendarDays,
            scheduledWorkDays: result.eligibility.scheduledWorkDays,
            eligibleDays: result.eligibility.eligibleDays,
            excludedBeforeHire: result.eligibility.excludedBeforeHire,
            excludedByStatus: result.eligibility.excludedByStatus,
            excludedByScheduleException: result.eligibility.excludedByScheduleException,
            excludedByScheduledDayOff: result.eligibility.excludedByScheduledDayOff,
            excludedByHoliday: result.eligibility.excludedByHoliday,
            excludedByUnknownSchedule: result.eligibility.excludedByUnknownSchedule,
            statusConfidence: { freshness: result.eligibility.statusConfidence.freshness, unconfirmedDays: result.eligibility.statusConfidence.unconfirmedDays, lastSuccessLocalDate: result.eligibility.statusConfidence.lastSuccessLocalDate },
            scheduleConfidence: {
              freshness: result.eligibility.scheduleConfidence.freshness,
              basis: result.eligibility.scheduleConfidence.basis,
              scheduleType: result.eligibility.scheduleConfidence.scheduleType,
              unconfirmedScheduleDays: result.eligibility.scheduleConfidence.unconfirmedScheduleDays,
              unknownScheduleDays: result.eligibility.scheduleConfidence.unknownScheduleDays,
              lastSuccessLocalDate: result.eligibility.scheduleConfidence.lastSuccessLocalDate,
            },
            holidayConfidence: result.eligibility.holidayConfidence,
            observed: {
              workedObservedDays: result.eligibility.observed.workedObservedDays,
              workedDespitePlan: result.eligibility.observed.workedDespitePlan,
              missingExpectedProductionDays: result.eligibility.observed.missingExpectedProductionDays,
              productionWithNonEligibleStatusDays: result.eligibility.observed.productionWithNonEligibleStatusDays,
              evidenceSources: result.eligibility.observed.evidenceSources,
            },
          },
        }
      : {}),
  }
}

type ClosureDetail = { label: string; value: number | null; sampleCount: number }

export type HistoricalResult =
  | { kind: "count"; count: number; window: { start: string; end: string } }
  | {
      kind: "aggregate"
      // Sempre o valor bruto agregado do período atual (nunca a variação percentual) — usado
      // tanto na comparação de sempre quanto no payload de debug.
      value: number | null
      sampleCount: number
      referenceValue?: number | null
      // Só presente em compareTo PREVIOUS_PERIOD + changeMode "PERCENT": o que é efetivamente
      // comparado contra thresholdNumeric no lugar de `value` — a variação percentual entre o
      // período atual e o anterior, nunca o valor bruto.
      comparisonValue?: number
      // Só-debug — nunca influencia a comparação.
      previousValue?: number
      changeMode?: "PERCENT"
      noDataReason?: NoDataReason
      totalClosures?: number
      closuresRequested?: number
      goalSource?: GoalSource | null
      window?: { start: string; end: string }
      previousWindow?: { start: string; end: string }
      // Por fechamento/mês (Parte 22 — debug "Junho 3,2 · Julho 3,0 · Agosto 2,8").
      closures?: ClosureDetail[]
      // Só MEASUREMENT (camada operacional): como o valor foi formado — janela, método, amostra.
      evidence?: OperationalEvidence
      previousEvidence?: OperationalEvidence
    }

type WindowAggregation = { sampleCount: number; value: number | null; avg: number | null; min: number | null; max: number | null; evidence?: OperationalEvidence }

/** Agregação de uma janela: MEASUREMENT vai pelo resolvedor operacional (camada 1, com componentes
 * e evidência); Atingimento/PRV continuam agregando o percentual oficial já pronto (camada 2). */
async function runHistoricalAggregation(db: Database, organizationId: string, query: HistoricalQuery, subjectIds: string[], window: TimeWindow, timeZone: string, now: Date): Promise<WindowAggregation> {
  if (query.source === "MEASUREMENT" || query.source === undefined) {
    const result = await resolveOperationalWindow(
      db,
      {
        indicatorCode: query.indicatorCode!,
        subjectIds,
        window,
        aggregation: (query.aggregation ?? "AVERAGE") as MeasurementAggregation,
        expectedDays: businessDaysInWindow(window, timeZone),
        timeZone,
      },
      { organizationId },
    )
    return { sampleCount: result.sampleCount, value: result.value, avg: result.value, min: result.value, max: result.value, evidence: toEvidence(result, window, timeZone, query.minimumCoverage) }
  }
  const table = query.source === "INDICATOR_ACHIEVEMENT" ? "employee_indicator_performance" : "employee_prv_performance"
  const agg = await aggregateAchievementHistory(db, table, subjectIds, query.indicatorCode, window.start, window.end, now, timeZone)
  return { sampleCount: agg.count, value: pickAggregate(query.aggregation, agg), avg: agg.avg, min: agg.min, max: agg.max }
}

/**
 * Últimos N MESES DE CALENDÁRIO já fechados (Valor do indicador — não confundir com "Últimos N
 * fechamentos" de Atingimento/PRV). A matemática de calendário vive em time-window.ts
 * (`closedCalendarMonths`): o mês corrente nunca entra, mesmo parcial, e os N meses são sempre
 * consecutivos (nunca pula uma competência).
 */
function resolveClosedCalendarMonths(now: Date, count: number, timeZone: string): { start: Date; end: Date }[] {
  return closedCalendarMonths(now, count, timeZone)
}

const MONTH_LABELS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

/** "junho/2026" a partir do início local de um mês civil, na timezone da organização. */
function labelCalendarMonth(start: Date, timeZone: string): string {
  const local = localDateOf(start, timeZone)
  return `${MONTH_LABELS[Number(local.slice(5, 7)) - 1]}/${local.slice(0, 4)}`
}

/** "AAAA-MM" → "junho/2026". */
function labelReferencePeriod(referencePeriod: string): string {
  const [year, month] = referencePeriod.split("-")
  const index = Number(month) - 1
  return MONTH_LABELS[index] ? `${MONTH_LABELS[index]}/${year}` : referencePeriod
}

/**
 * "Últimos N meses fechados" pra Valor bruto (`indicator_measurements` não tem competência —
 * só `period_end`). Consulta EXATAMENTE os N meses civis esperados, nunca "os últimos N meses
 * que têm alguma medição": uma competência esperada sem medição nunca é substituída por um mês
 * mais antigo. `monthsWithData < monthsExpected` vira Sem Dados, nunca uma média parcial.
 * Devolve também o valor de cada mês (só-debug).
 */
async function aggregateMeasurementClosedMonths(
  db: Database,
  organizationId: string,
  query: HistoricalQuery,
  subjectIds: string[],
  count: number,
  now: Date,
  timeZone: string,
): Promise<{ sampleCount: number; value: number | null; monthsWithData: number; monthsExpected: number; closures: ClosureDetail[]; evidence: OperationalEvidence }> {
  const months = resolveClosedCalendarMonths(now, count, timeZone)
  const aggregation = (query.aggregation ?? "AVERAGE") as MeasurementAggregation
  // UMA query com os N meses esperados: componentes por mês (só-debug + mês sem medição) e o
  // agregado da união (Σ numeradores ÷ Σ denominadores) — nunca "média das médias mensais".
  const resolved = await resolveOperationalClosedMonths(db, { organizationId, indicatorCode: query.indicatorCode!, subjectIds, months, aggregation, expectedDaysByMonth: months.map((month) => businessDaysInWindow(month, timeZone)), timeZone })
  const closures: ClosureDetail[] = resolved.months
    .slice()
    .sort((a, b) => a.window.start.getTime() - b.window.start.getTime())
    .map(({ window, result }) => ({ label: labelCalendarMonth(window.start, timeZone), value: result.value, sampleCount: result.sampleCount }))
  const union: TimeWindow = { start: months[months.length - 1]!.start, end: months[0]!.end }
  return { sampleCount: resolved.total.sampleCount, value: resolved.total.value, monthsWithData: resolved.monthsWithData, monthsExpected: count, closures, evidence: toEvidence(resolved.total, union, timeZone, query.minimumCoverage) }
}

/** Despacha "Últimos N fechamentos" pra Atingimento/PRV — snapshots/reference_period reais já
 * persistidos pela fonte. */
async function resolveClosuresAggregation(
  db: Database,
  query: HistoricalQuery,
  subjectIds: string[],
  count: number,
  now: Date,
  timeZone: string,
): Promise<{ sampleCount: number; avg: number | null; min: number | null; max: number | null; totalClosures: number; closures: ClosureDetail[] }> {
  const table = query.source === "INDICATOR_ACHIEVEMENT" ? "employee_indicator_performance" : "employee_prv_performance"
  const agg = await aggregateAchievementClosures(db, table, subjectIds, query.indicatorCode, count, now, timeZone)
  return {
    sampleCount: agg.sampleCount,
    avg: agg.avg,
    min: agg.min,
    max: agg.max,
    totalClosures: agg.totalClosures,
    closures: (agg.periods ?? []).map((period) => ({ label: labelReferencePeriod(period.referencePeriod), value: period.avg, sampleCount: period.sampleCount })),
  }
}

export type GoalSource = { kind: "SUBTEAM" | "TEAM"; name: string | null }
type GoalResolution = { value: number | null; reason?: "NO_GOAL" | "INCOMPATIBLE_GOALS"; source?: GoalSource | null }

/**
 * Resolve a Meta vigente pra TODOS os `subjectIds` de uma vez. Cada pessoa resolve sua meta
 * mais específica disponível — Subgrupo dela, com fallback pro Time quando não há meta de
 * Subgrupo — e só existe UM valor de meta pra Condition inteira quando TODAS as pessoas do
 * subject set concordam na mesma meta. Se a estrutura mistura Subgrupos com metas diferentes,
 * nunca escolhe uma arbitrariamente: vira Sem Dados (`INCOMPATIBLE_GOALS`). `source` diz de
 * onde a meta veio (Subgrupo X / Time Y) — só-debug (Parte 20).
 */
// `indicatorCode` pode ser undefined pra PRV_ACHIEVEMENT (sem indicador) — a query simplesmente
// não bate meta nenhuma (i.code = $1 nunca casa com NULL), devolvendo NO_GOAL de forma graciosa.
// "Meta vigente" pra PRV não tem uma definição na fonte hoje — fora do escopo desta correção
// (só indicatorCode/COUNT), nunca redesenhada aqui.
async function resolveGoalValue(db: Database, indicatorCode: string | undefined, subjectIds: string[], now: Date): Promise<GoalResolution> {
  // A meta é resolvida UMA vez por Subgrupo/Grupo distinto do conjunto (goal_of) e depois distribuída às pessoas — antes,
  // as duas subconsultas rodavam por pessoa (2 × N buscas em goals × indicator_definitions; estrutura de 2.398 pessoas no
  // dev: 56 ms e 41 mil buffers → 1,8 ms e 673). Mesma regra de vigência e mesmas linhas, na mesma ordem.
  const result = await db.query<{ personId: string; effectiveGoal: string | null; fromSubteam?: boolean | null; subteamName?: string | null; teamName?: string | null }>(
    `with subjects as (
       select p.id, p.subteam_id, p.team_id from people p where p.id = any($3::uuid[])
     ),
     goal_of as (
       select s.kind, s.subject_id,
              (select g.target_value from goals g join indicator_definitions i on i.id = g.indicator_definition_id
                where i.code = $1 and g.subject_type = s.kind and g.subject_id = s.subject_id
                  and g.valid_from <= $2 and (g.valid_until is null or g.valid_until >= $2)
                order by g.valid_from desc limit 1) target_value
       from (select distinct 'SUBTEAM' kind, subteam_id subject_id from subjects where subteam_id is not null
             union all
             select distinct 'TEAM' kind, team_id subject_id from subjects where team_id is not null) s
     ),
     resolved as (
       select p.id "personId", st.name "subteamName", t.name "teamName", sg.target_value "subteamGoal", tg.target_value "teamGoal"
       from people p
       left join subteams st on st.id = p.subteam_id
       left join teams t on t.id = p.team_id
       left join goal_of sg on sg.kind = 'SUBTEAM' and sg.subject_id = p.subteam_id
       left join goal_of tg on tg.kind = 'TEAM' and tg.subject_id = p.team_id
       where p.id = any($3::uuid[])
     )
     select "personId", coalesce("subteamGoal", "teamGoal") "effectiveGoal", ("subteamGoal" is not null) "fromSubteam", "subteamName", "teamName"
     from resolved`,
    [indicatorCode, now.toISOString().slice(0, 10), subjectIds],
  )
  if (result.rows.length === 0 || result.rows.some((row) => row.effectiveGoal === null)) return { value: null, reason: "NO_GOAL" }
  const distinctGoals = new Set(result.rows.map((row) => row.effectiveGoal))
  if (distinctGoals.size > 1) return { value: null, reason: "INCOMPATIBLE_GOALS" }
  const sources = result.rows.map((row): GoalSource => (row.fromSubteam ? { kind: "SUBTEAM", name: row.subteamName ?? null } : { kind: "TEAM", name: row.teamName ?? null }))
  const first = sources[0]!
  const sameSource = sources.every((source) => source.kind === first.kind && source.name === first.name)
  return { value: Number(result.rows[0]!.effectiveGoal), source: sameSource ? first : { kind: first.kind, name: null } }
}

/**
 * Variação percentual — a ÚNICA fórmula do sistema: (atual − anterior) ÷ anterior × 100.
 * Anterior zero = indefinida (`null` → SEM DADOS), nunca Infinity nem 0%. Reaproveitada pela
 * Condition (compareTo PREVIOUS_PERIOD) e pelo Ranking CHANGE.
 */
export function percentageChange(current: number, previous: number): number | null {
  if (previous === 0) return null
  return ((current - previous) / previous) * 100
}

function pickAggregate(aggregation: HistoricalQuery["aggregation"], agg: { avg: number | null; min: number | null; max: number | null }): number | null {
  return aggregation === "AVERAGE" ? agg.avg : aggregation === "MINIMUM" ? agg.min : agg.max
}

function isoWindow(window: { start: Date; end: Date }): { start: string; end: string } {
  return { start: window.start.toISOString(), end: window.end.toISOString() }
}

/**
 * Generaliza a antiga "conta quantas medições batem um filtro" (COUNT/reincidência) pra também
 * suportar AVERAGE/MINIMUM/MAXIMUM — nesses três, `source` decide se agrega
 * `indicator_measurements.value` ou o atingimento% já normalizado das tabelas de performance —
 * nunca calcula a % em si. `subjectIds` decide se agrega uma pessoa só ou uma estrutura inteira;
 * `compareTo` decide contra o quê comparar.
 *
 * Exportada (evolução de Ranking, Parte 37/38/39 do pedido de "Selecionar colaboradores por
 * ranking") — é literalmente o "resolver o valor antes da comparação" que o ranking precisa: o
 * ranking chama esta MESMA função (com um `query` sem `compareTo`/`comparator`, um candidato por
 * vez) pra obter `.value`, nunca uma segunda implementação e nunca um hack de Condition com
 * threshold infinito (ver select-employees-executor.ts).
 */
export async function resolveHistoricalResult(db: Database, subjectIds: string[], query: HistoricalQuery, now: Date, options: EvaluationOptions): Promise<HistoricalResult> {
  const timeZone = options.timeZone ?? DEFAULT_ORGANIZATION_TIMEZONE
  const source = query.source ?? "MEASUREMENT"
  // Defesa em runtime (nunca confia só no publish/schema) — se uma combinação impossível
  // escapar da validação via payload manual, falha controlada aqui, nunca reinterpreta
  // silenciosamente. Quantidade de ocorrências (COUNT) conta MEDIÇÕES BRUTAS — só existe pra
  // Valor do indicador; Atingimento/PRV sempre agregam um valor já pronto da fonte.
  if ((query.aggregation ?? "COUNT") === "COUNT" && source !== "MEASUREMENT") {
    throw new Error(`Quantidade de ocorrências (COUNT) só está disponível para Valor do indicador — a origem desta consulta é "${source}".`)
  }
  // PRV é uma fonte própria (employee_prv_performance), sem indicador — as demais origens
  // sempre precisam de um pra saber o que consultar (bloqueado no publish; aqui é defesa pro
  // mesmo caso de payload manual).
  if (source !== "PRV_ACHIEVEMENT" && !query.indicatorCode) {
    throw new Error(`Consulta histórica sem indicador configurado (origem: "${source}").`)
  }
  // Meta vigente é referência do VALOR DO INDICADOR — Atingimento (indicador ou PRV) já
  // representa a relação do resultado com a meta, nunca comparado de novo contra a meta bruta
  // (bloqueado no publish; defesa pro mesmo caso de payload manual). Nunca retorna Sem Dados
  // como se fosse uma condição legítima — falha controlada.
  if (query.compareTo?.kind === "GOAL" && source !== "MEASUREMENT") {
    throw new Error(`Meta vigente como referência só está disponível para Valor do indicador — a origem desta consulta é "${source}".`)
  }

  if (query.aggregation === "COUNT" || query.aggregation === undefined) {
    const window = resolveHistoricalWindow(query, now)
    // Reincidência conta MEDIÇÕES BRUTAS — mas só as de datas ELEGÍVEIS (mesmo predicado canônico
    // do valor e da cobertura): medição em folga/day off/férias fica no banco e não vira ocorrência.
    const ranges = eligibleDayRanges(await resolveEligibleDaysBySubject(db, subjectIds, window, timeZone, { now }))
    const eligible = eligibleMeasurementSql({ alias: "m", timeZoneParam: "$5", personIdsParam: "$6", fromParam: "$7", toParam: "$8", statusesParam: "$9" })
    const result = await db.query<{ value: string }>(
      `with ${eligible.cte}
       select m.value
       from indicator_measurements m
       join indicator_definitions i on i.id = m.indicator_definition_id
       ${eligible.join}
       where i.code = $1 and m.subject_type = 'PERSON' and m.subject_id = any($2::uuid[]) and m.period_end >= $3 and m.period_end < $4
         and ${eligible.predicate}`,
      [query.indicatorCode, subjectIds, window.start.toISOString(), window.end.toISOString(), timeZone, ranges.personIds, ranges.from, ranges.to, NON_ELIGIBLE_EMPLOYMENT_STATUSES],
    )
    const count = result.rows.filter((row) => comparatorMatches(query.comparator!, false, Number(row.value), null, query.indicatorThreshold)).length
    return { kind: "count", count, window: isoWindow(window) }
  }

  // "Últimos N fechamentos"/"Últimos N meses fechados" — nunca por janela [start,end); nunca
  // combina com compareTo PREVIOUS_PERIOD (bloqueado no publish) — só GOAL/valor fixo chega aqui.
  // Valor bruto (MEASUREMENT) e Atingimento/PRV têm proveniência DIFERENTE.
  if (query.period?.kind === "CLOSURES") {
    const requested = query.period.count
    const closed =
      query.source === "MEASUREMENT" || query.source === undefined
        ? await (async () => {
            // Non-null: dentro do branch MEASUREMENT/ausente, o guard no topo da função já
            // garantiu indicatorCode presente (só PRV_ACHIEVEMENT dispensa) — nunca alcançado
            // com undefined de verdade.
            const r = await aggregateMeasurementClosedMonths(db, options.organizationId, query, subjectIds, requested, now, timeZone)
            return { ...r, available: r.monthsWithData, reason: "INSUFFICIENT_CLOSED_MONTHS" as const }
          })()
        : await (async () => {
            const r = await resolveClosuresAggregation(db, query, subjectIds, requested, now, timeZone)
            return { ...r, value: pickAggregate(query.aggregation, r), available: r.totalClosures, reason: "INSUFFICIENT_CLOSURES" as const, evidence: undefined }
          })()
    const base = { totalClosures: closed.available, closuresRequested: requested, closures: closed.closures, ...(closed.evidence ? { evidence: closed.evidence } : {}) }
    if (closed.available < requested) return { kind: "aggregate", value: null, sampleCount: closed.sampleCount, noDataReason: closed.reason, ...base }
    const value = closed.value
    if (value === null) return { kind: "aggregate", value: null, sampleCount: closed.sampleCount, noDataReason: "NO_VALUE", ...base }
    if (query.compareTo?.kind === "GOAL") {
      const goal = await resolveGoalValue(db, query.indicatorCode, subjectIds, now)
      if (goal.value === null) return { kind: "aggregate", value: null, sampleCount: 0, noDataReason: goal.reason ?? "NO_GOAL", ...base }
      return { kind: "aggregate", value, sampleCount: closed.sampleCount, referenceValue: goal.value, goalSource: goal.source ?? null, ...base }
    }
    return { kind: "aggregate", value, sampleCount: closed.sampleCount, ...base }
  }

  const window = resolveHistoricalWindow(query, now, timeZone)
  const current = await runHistoricalAggregation(db, options.organizationId, query, subjectIds, window, timeZone, now)
  const { sampleCount } = current
  const evidenceFields = current.evidence ? { evidence: current.evidence } : {}
  if (current.evidence?.eligibility && current.evidence.eligibility.eligibleDays === 0) return { kind: "aggregate", value: null, sampleCount: 0, noDataReason: "NO_ELIGIBLE_DAYS", window: isoWindow(window), ...evidenceFields }
  // Três estados que nunca se confundem: NÃO PRODUZIU (NO_VALUE, situação confiável), NÃO DEVERIA
  // (NO_ELIGIBLE_DAYS) e NÃO SEI COM SEGURANÇA (EMPLOYMENT_STATUS_STALE: sem medição e os dias
  // elegíveis são presumidos sob fonte de situação atrasada). Medição real nunca é invalidada.
  if (sampleCount === 0) return { kind: "aggregate", value: null, sampleCount: 0, noDataReason: noMeasurementReason(current.evidence), window: isoWindow(window), ...evidenceFields }
  const value = current.value

  // compareTo: a referência deixa de ser o thresholdNumeric fixo e passa a ser a Meta vigente ou
  // o mesmo cálculo no período anterior — ambos reais, resolvidos agora. Sem meta / sem amostra
  // no período anterior = Sem Dados (nunca vira Não silenciosamente).
  if (query.compareTo?.kind === "GOAL") {
    const goal = await resolveGoalValue(db, query.indicatorCode, subjectIds, now)
    if (goal.value === null || value === null) {
      return { kind: "aggregate", value: null, sampleCount: 0, noDataReason: value === null ? "NO_VALUE" : (goal.reason ?? "NO_GOAL"), window: isoWindow(window), ...evidenceFields }
    }
    return { kind: "aggregate", value, sampleCount, referenceValue: goal.value, goalSource: goal.source ?? null, window: isoWindow(window), ...evidenceFields }
  }
  if (query.compareTo?.kind === "PREVIOUS_PERIOD") {
    const previousWindow = resolvePreviousHistoricalWindow(query, now, timeZone)
    const previous = await runHistoricalAggregation(db, options.organizationId, query, subjectIds, previousWindow, timeZone, now)
    const previousValue = previous.value
    const windows = { window: isoWindow(window), previousWindow: isoWindow(previousWindow), ...evidenceFields, ...(previous.evidence ? { previousEvidence: previous.evidence } : {}) }
    if (value === null) return { kind: "aggregate", value: null, sampleCount: 0, noDataReason: "NO_VALUE", ...windows }
    if (previous.sampleCount === 0 || previousValue === null) return { kind: "aggregate", value: null, sampleCount: 0, noDataReason: "NO_PREVIOUS_PERIOD", ...windows }
    if (query.compareTo.changeMode === "PERCENT") {
      // Variação de um valor anterior zero não tem percentual significativo (divisão por zero) —
      // Sem Dados, nunca um número inventado (ex.: Infinity ou 0%).
      const percentChange = percentageChange(value, previousValue)
      if (percentChange === null) return { kind: "aggregate", value: null, sampleCount: 0, noDataReason: "PREVIOUS_PERIOD_ZERO", previousValue, ...windows }
      return { kind: "aggregate", value, sampleCount, previousValue, changeMode: "PERCENT", comparisonValue: percentChange, ...windows }
    }
    return { kind: "aggregate", value, sampleCount, referenceValue: previousValue, previousValue, ...windows }
  }

  return { kind: "aggregate", value, sampleCount, window: isoWindow(window), ...evidenceFields }
}

/**
 * Consulta de performance de colaborador — sempre o registro mais recente (nunca agregação),
 * lido pronto das tabelas de performance. `null` = sem nenhum registro pra esse colaborador/
 * indicador ainda (vira SEM_DADOS, nunca FALSE).
 */
async function resolvePerformanceQuery(db: Database, operatorId: string, query: PerformanceQuery, now: Date, timeZone: string): Promise<{ raw: number | string | null; referencePeriod: string | null }> {
  if (query.metric === "PRV_ACHIEVEMENT" || query.metric === "PRV_QUARTILE") {
    const perf = await findLatestPrvPerformance(db, operatorId, now, timeZone)
    if (!perf) return { raw: null, referencePeriod: null }
    return { raw: query.metric === "PRV_ACHIEVEMENT" ? perf.achievementPercent : perf.quartile, referencePeriod: perf.referencePeriod }
  }

  if (!query.indicatorCode) throw new Error("Consulta de performance sem indicador configurado.")
  const perf = await findLatestIndicatorPerformance(db, operatorId, query.indicatorCode, now, timeZone)
  if (!perf) return { raw: null, referencePeriod: null }
  switch (query.metric) {
    case "INDICATOR_VALUE":
      return { raw: perf.value, referencePeriod: perf.referencePeriod }
    case "INDICATOR_ACHIEVEMENT":
      return { raw: perf.achievementPercent, referencePeriod: perf.referencePeriod }
    case "INDICATOR_WEIGHT":
      return { raw: perf.weightPercent, referencePeriod: perf.referencePeriod }
    case "INDICATOR_QUARTILE":
      return { raw: perf.quartile, referencePeriod: perf.referencePeriod }
  }
}

type PerformanceRecurrenceResult = { matchCount: number; totalPeriods: number; snapshots: { referencePeriod: string; quartile: string }[] } | null

/**
 * Recorrência de Quartil — "Q4 em 3 dos últimos 3 fechamentos": conta quantos dos últimos N
 * snapshots mensais JÁ PERSISTIDOS batem o quartil-alvo, nunca calcula quartil. `null` = sem
 * nenhum registro ainda. Menos snapshots do que os N pedidos = histórico insuficiente (Sem
 * Dados) — nunca compara uma contagem parcial como se fosse a janela inteira.
 */
async function resolvePerformanceRecurrence(db: Database, operatorId: string, query: PerformanceQuery, now: Date, timeZone: string): Promise<PerformanceRecurrenceResult> {
  const recurrence = query.recurrence!
  const rows =
    query.metric === "PRV_QUARTILE"
      ? await findRecentPrvPerformance(db, operatorId, now, recurrence.periods, timeZone)
      : await (async () => {
          if (!query.indicatorCode) throw new Error("Consulta de performance sem indicador configurado.")
          return findRecentIndicatorPerformance(db, operatorId, query.indicatorCode, now, recurrence.periods, timeZone)
        })()

  if (rows.length === 0) return null
  // Uma linha sem quartile ainda calculado pela fonte não conta como um "fechamento" válido —
  // cai fora tanto da contagem quanto do total.
  const snapshots = rows.filter((row): row is typeof row & { quartile: string } => row.quartile !== null).map((row) => ({ referencePeriod: row.referencePeriod, quartile: row.quartile }))
  const matchCount = snapshots.filter((row) => row.quartile === recurrence.matchQuartile).length
  return { matchCount, totalPeriods: snapshots.length, snapshots }
}

/** Uma Condition é "de dados" quando depende do colaborador/estrutura (histórico ou
 * performance) — é o que a prévia de massa consegue classificar. As demais (valor do gatilho,
 * sourcePath, grupo AND/OR) dependem do Execution Context de UMA execução. */
export function isDataCondition(config: DataConditionConfig): boolean {
  return !config.group && Boolean(config.historicalQuery || config.performanceQuery)
}

/**
 * A avaliação em si — chamada por `processNode` (produção e QA Lab) e pela prévia de massa de
 * teste. Devolve `null` quando a Condition não é "de dados" (quem chama trata os demais casos
 * com o Execution Context). O `evaluation` é o payload de debug (evento `condition_evaluated`,
 * trace do QA Lab, evidência na lista de massa) — sempre com os valores efetivamente resolvidos.
 */
export async function evaluateDataCondition(db: Database, config: DataConditionConfig, subject: ConditionSubject, now: Date, options: EvaluationOptions): Promise<ConditionEvaluation | null> {
  if (config.group) return null
  const timeZone = options.timeZone ?? DEFAULT_ORGANIZATION_TIMEZONE

  if (config.historicalQuery?.source === "OPERATIONAL_QUARTILE") {
    return evaluateOperationalQuartileCondition(db, config, subject, now, options)
  }

  if (config.historicalQuery) {
    const query = config.historicalQuery
    const result = await resolveHistoricalResult(db, subject.subjectIds, query, now, options)
    if (result.kind === "count") {
      const matched = comparatorMatches(config.comparator, false, result.count, null, config.thresholdNumeric)
      return {
        branch: matched ? "true" : "false",
        matched,
        evaluation: { kind: "historical_count", count: result.count, comparator: config.comparator, threshold: config.thresholdNumeric ?? null, window: result.window },
      }
    }
    const belowMinimum = query.minimumSampleSize !== undefined && result.sampleCount < query.minimumSampleSize
    // Cobertura mínima operacional (Parte C): janela com dado, mas em poucos dos dias elegíveis,
    // vira SEM DADOS — nunca zero, nunca um valor de confiança igual ao de quem tem cobertura cheia.
    const belowCoverage = result.evidence !== undefined && result.evidence.coverageSatisfied === false
    const common = {
      kind: "historical_aggregate",
      aggregation: query.aggregation ?? "COUNT",
      indicatorCode: query.indicatorCode,
      source: query.source ?? "MEASUREMENT",
      value: result.value,
      sampleCount: result.sampleCount,
      ...(result.window ? { window: result.window } : {}),
      ...(result.previousWindow ? { previousWindow: result.previousWindow } : {}),
      ...(result.closures ? { closures: result.closures } : {}),
      ...(result.totalClosures !== undefined ? { totalClosures: result.totalClosures, closuresRequested: result.closuresRequested } : {}),
      ...(result.evidence ? { evidence: result.evidence } : {}),
      ...(result.previousEvidence ? { previousEvidence: result.previousEvidence } : {}),
    }
    if (result.value === null || belowMinimum || belowCoverage) {
      const staleDays = staleUnconfirmedDays(result.evidence)
      const staleSchedule = staleScheduleDays(result.evidence)
      // Cobertura abaixo do mínimo por dias que a INIA só presume elegíveis (situação ou escala
      // atrasada) é "não sei", não "não produziu" — a medição existente continua na evidência.
      const reason: NoDataReason = result.value === null ? (result.noDataReason ?? "NO_VALUE") : belowMinimum ? "BELOW_MINIMUM_SAMPLE" : staleDays > 0 ? "EMPLOYMENT_STATUS_STALE" : staleSchedule > 0 ? "WORK_SCHEDULE_STALE" : "BELOW_MINIMUM_COVERAGE"
      const details =
        reason === "EMPLOYMENT_STATUS_STALE"
          ? { available: staleDays, since: result.evidence?.eligibility?.statusConfidence?.lastSuccessLocalDate ?? undefined }
          : reason === "WORK_SCHEDULE_STALE"
            ? { available: staleSchedule, since: result.evidence?.eligibility?.scheduleConfidence?.lastSuccessLocalDate ?? undefined }
            : reason === "WORK_SCHEDULE_UNKNOWN"
              ? { available: unknownScheduleDays(result.evidence) }
          : reason === "BELOW_MINIMUM_COVERAGE"
            ? { available: result.evidence?.daysWithData, requested: result.evidence?.expectedDays ?? undefined, minimum: query.minimumCoverage }
            : { available: result.totalClosures ?? result.sampleCount, requested: result.closuresRequested, minimum: query.minimumSampleSize }
      return {
        branch: "no_data",
        matched: false,
        evaluation: {
          ...common,
          minimumSampleSize: query.minimumSampleSize ?? null,
          minimumCoverage: query.minimumCoverage ?? null,
          reason,
          reasonText: describeNoDataReason(reason, details),
          ...(result.previousValue !== undefined ? { previousValue: result.previousValue } : {}),
        },
      }
    }
    const reference = result.referenceValue !== undefined ? result.referenceValue! : config.thresholdNumeric
    // Em changeMode PERCENT, comparisonValue (a variação %) é o que é comparado contra a
    // referência — nunca o valor bruto (result.value), que só existe pro payload de debug.
    const comparisonSubject = result.comparisonValue !== undefined ? result.comparisonValue : result.value
    const matched = comparatorMatches(config.comparator, false, comparisonSubject, null, reference)
    return {
      branch: matched ? "true" : "false",
      matched,
      evaluation: {
        ...common,
        comparator: config.comparator,
        reference: reference ?? null,
        referenceKind: query.compareTo?.kind ?? "FIXED",
        comparisonValue: comparisonSubject,
        ...(result.goalSource !== undefined ? { goalSource: result.goalSource } : {}),
        ...(result.previousValue !== undefined ? { previousValue: result.previousValue } : {}),
        ...(result.changeMode === "PERCENT" ? { changeMode: "PERCENT", percentChange: result.comparisonValue } : {}),
      },
    }
  }

  if (config.performanceQuery?.recurrence) {
    // Recorrência de Quartil — menos snapshots do que os N pedidos é histórico insuficiente.
    const query = config.performanceQuery
    const recurrence = query.recurrence!
    const result = await resolvePerformanceRecurrence(db, subject.operatorId, query, now, timeZone)
    const base = { kind: "performance_recurrence", metric: query.metric, indicatorCode: query.indicatorCode ?? null, matchQuartile: recurrence.matchQuartile, periodsRequested: recurrence.periods }
    if (result === null || result.totalPeriods < recurrence.periods) {
      const available = result?.totalPeriods ?? 0
      return {
        branch: "no_data",
        matched: false,
        evaluation: { ...base, totalPeriods: available, snapshots: result?.snapshots ?? [], reason: "INSUFFICIENT_RECURRENCE", reasonText: describeNoDataReason("INSUFFICIENT_RECURRENCE", { available, requested: recurrence.periods }) },
      }
    }
    const matched = comparatorMatches(config.comparator, false, result.matchCount, null, config.thresholdNumeric)
    return {
      branch: matched ? "true" : "false",
      matched,
      evaluation: { ...base, totalPeriods: result.totalPeriods, matchCount: result.matchCount, snapshots: result.snapshots, comparator: config.comparator, threshold: config.thresholdNumeric ?? null },
    }
  }

  if (config.performanceQuery) {
    const query = config.performanceQuery
    const { raw, referencePeriod } = await resolvePerformanceQuery(db, subject.operatorId, query, now, timeZone)
    const base = { kind: "performance", metric: query.metric, indicatorCode: query.indicatorCode ?? null, referencePeriod }
    if (raw === null || raw === undefined) {
      return { branch: "no_data", matched: false, evaluation: { ...base, value: null, reason: "NO_PERFORMANCE", reasonText: describeNoDataReason("NO_PERFORMANCE") } }
    }
    if (typeof raw === "number") {
      const matched = comparatorMatches(config.comparator, false, raw, null, config.thresholdNumeric)
      return { branch: matched ? "true" : "false", matched, evaluation: { ...base, value: raw, comparator: config.comparator, threshold: config.thresholdNumeric ?? null } }
    }
    const matched = evaluateGenericComparator(config.comparator, raw, config.thresholdText)
    return { branch: matched ? "true" : "false", matched, evaluation: { ...base, value: raw, comparator: config.comparator, threshold: config.thresholdText ?? null } }
  }

  return null
}

/**
 * Condition "Quartil operacional" — "este colaborador está no Q4 OPERACIONAL de TMA nos últimos 7
 * dias?". A população é a do Workflow (resolvida pelo chamador em `subject.populationIds`); o
 * cálculo é o MESMO do Ranking (operational-quartile-resolver.ts). SEM DADOS quando o colaborador
 * não tem valor/cobertura na janela, quando a população ranqueada tem menos de 4 ou quando o
 * indicador não tem direção HIGHER/LOWER — nunca um Q4 inventado. O trace traz população, com/sem
 * dados, posição, quartil, janela e método (Parte 38).
 */
async function evaluateOperationalQuartileCondition(db: Database, config: DataConditionConfig, subject: ConditionSubject, now: Date, options: EvaluationOptions): Promise<ConditionEvaluation> {
  const query = config.historicalQuery!
  if (!query.indicatorCode) throw new Error("Condition de quartil operacional sem indicador configurado.")
  if (!query.period || query.period.kind === "CLOSURES") throw new Error("Condition de quartil operacional precisa de uma janela de período (dias, semana, mês).")
  const populationIds = subject.populationIds ?? subject.subjectIds
  const timeZone = options.timeZone ?? DEFAULT_ORGANIZATION_TIMEZONE
  const outcome = await resolveOperationalQuartiles(
    db,
    { organizationId: options.organizationId, indicatorCode: query.indicatorCode, aggregation: (query.aggregation ?? "WEIGHTED_AVERAGE") as MeasurementAggregation, period: query.period, minimumCoverage: query.minimumCoverage, populationIds, now, timeZone },
    options.quartileCache,
  )
  const member = outcome.members.get(subject.operatorId)
  const base = {
    kind: "operational_quartile",
    indicatorCode: query.indicatorCode,
    source: "OPERATIONAL_QUARTILE",
    aggregation: outcome.aggregation,
    periodLabel: outcome.periodLabel,
    window: { start: outcome.window.start.toISOString(), end: outcome.window.end.toISOString() },
    windowLabel: outcome.windowLabel,
    method: outcome.method,
    direction: outcome.direction,
    population: { evaluatedCount: outcome.evaluatedCount, eligibleCount: outcome.eligibleCount, ineligibleCount: outcome.ineligibleCount, rankedCount: outcome.rankedCount, noDataCount: outcome.noDataCount, belowCoverageCount: outcome.belowCoverageCount, staleStatusCount: outcome.staleStatusIds.size, staleScheduleCount: outcome.staleScheduleIds.size, unknownScheduleCount: outcome.unknownScheduleIds.size },
    statusFreshness: outcome.statusFreshness,
    scheduleFreshness: outcome.scheduleFreshness,
    minimumCoverage: query.minimumCoverage ?? null,
    quartileReason: outcome.reason,
    ...(member ? { evidence: toEvidence(member.result, outcome.window, timeZone, query.minimumCoverage) } : {}),
  }
  const noData = (reason: NoDataReason, reasonText: string): ConditionEvaluation => ({ branch: "no_data", matched: false, evaluation: { ...base, value: null, position: member?.position ?? null, reason, reasonText } })
  if (outcome.reason === "DIRECTION_UNSUPPORTED") return noData("NO_VALUE", "O indicador não tem direção de desempenho HIGHER/LOWER — sem regra de classificação em quartis operacionais.")
  if (!member) {
    const inPopulation = populationIds.includes(subject.operatorId)
    if (!inPopulation) return noData("NO_VALUE", "O colaborador não faz parte da população elegível do Workflow.")
    if (outcome.ineligibleIds.has(subject.operatorId)) return noData("NO_ELIGIBLE_DAYS", describeNoDataReason("NO_ELIGIBLE_DAYS"))
    if (outcome.staleStatusIds.has(subject.operatorId)) return noData("EMPLOYMENT_STATUS_STALE", `Sem medições na janela ${outcome.windowLabel} e a fonte de situação funcional está atrasada — não é possível afirmar se o colaborador deveria ter produzido.`)
    if (outcome.staleScheduleIds.has(subject.operatorId)) return noData("WORK_SCHEDULE_STALE", `Sem medições na janela ${outcome.windowLabel} e a fonte de escala está atrasada — a folga pode ter mudado; não é possível afirmar se o colaborador deveria ter produzido.`)
    if (outcome.unknownScheduleIds.has(subject.operatorId)) return noData("WORK_SCHEDULE_UNKNOWN", `Sem medições na janela ${outcome.windowLabel} e a escala do colaborador (6x1) não informa a folga — a INIA não inventa folga nem cobra produção.`)
    return outcome.belowCoverageIds.has(subject.operatorId)
      ? noData("BELOW_MINIMUM_COVERAGE", `Cobertura insuficiente na janela ${outcome.windowLabel} (mínimo ${Math.round((query.minimumCoverage ?? 0) * 100)}%).`)
      : noData("NO_VALUE", `Não há medições do colaborador na janela ${outcome.windowLabel}.`)
  }
  if (outcome.reason === "INSUFFICIENT_POPULATION" || member.quartile === null) {
    return noData("INSUFFICIENT_RECURRENCE", `População insuficiente para quartil operacional: ${outcome.rankedCount} colaborador(es) com dados (mínimo 4).`)
  }
  const matched = evaluateGenericComparator(config.comparator, member.quartile, config.thresholdText)
  return {
    branch: matched ? "true" : "false",
    matched,
    evaluation: { ...base, value: member.quartile, position: member.position, rankedCount: outcome.rankedCount, operationalValue: member.value, comparator: config.comparator, threshold: config.thresholdText ?? null },
  }
}
