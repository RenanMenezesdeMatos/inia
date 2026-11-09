import type { Database } from "../../../infrastructure/database/pool.js"
import { loadIndicatorOperationalDefinition, resolveEligibleDaysBySubject, resolveOperationalWindowBySubject, type IndicatorOperationalDefinition, type OperationalWindowResult, type WorkdayResolutionCache } from "../../indicators/application/operational-measurement-resolver.js"
import { MEASUREMENT_AGGREGATION_LABELS, type MeasurementAggregation } from "../../indicators/domain/operational-aggregation.js"
import { assignOperationalQuartiles, type OperationalQuartile } from "../../indicators/domain/operational-quartile.js"
import type { HistoricalPeriod } from "../domain/graph-schema.js"
import { businessDaysInWindow, describePeriod, describeTimeWindow, resolveTimeWindow, type TimeWindow } from "./time-window.js"

/**
 * Resolução ÚNICA do quartil OPERACIONAL de uma população: UMA query em lote pelos valores
 * operacionais da janela (resolvedor de medições), cobertura mínima, e a MESMA classificação de
 * `assignOperationalQuartiles` (direção oficial, empates na mesma posição, mínimo de 4). Ranking
 * (seleção por quartil) e Condition (source OPERATIONAL_QUARTILE) chamam isto — nunca duas
 * implementações, nunca N+1.
 *
 * "Quem" é a população vem do chamador: Abrangência ∩ Filtro populacional do Workflow, ou a
 * coleção anterior — nunca a empresa inteira por padrão.
 */
export type OperationalQuartileInput = {
  indicatorCode: string
  aggregation: MeasurementAggregation
  period: HistoricalPeriod
  minimumCoverage?: number | undefined
  populationIds: string[]
  now: Date
  timeZone: string
  /** Memo por request da resolução de dias de trabalho (compartilhado com as janelas do mesmo request). */
  workdayCache?: WorkdayResolutionCache | undefined
  /** Definição do indicador já lida pelo chamador (fica fora da chave do cache: é função do código); ausente = lida aqui. */
  definition?: IndicatorOperationalDefinition | undefined
}

export type OperationalQuartileMember = {
  employeeId: string
  value: number
  position: number
  quartile: OperationalQuartile | null
  result: OperationalWindowResult
}

export type OperationalQuartileOutcome = {
  direction: "HIGHER" | "LOWER" | "TARGET" | null
  window: TimeWindow
  windowLabel: string
  periodLabel: string
  aggregation: MeasurementAggregation
  method: string | null
  /** Tamanho da população informada pelo chamador. */
  evaluatedCount: number
  /** Quantos da população têm ao menos 1 dia elegível na janela (fora: férias/afastamento a janela inteira, antes da admissão). */
  eligibleCount: number
  ineligibleCount: number
  rankedCount: number
  noDataCount: number
  belowCoverageCount: number
  reason: "OK" | "INSUFFICIENT_POPULATION" | "DIRECTION_UNSUPPORTED"
  members: Map<string, OperationalQuartileMember>
  /** Quem ficou fora e por quê (pra trace individual, sem segunda consulta). */
  ineligibleIds: Set<string>
  belowCoverageIds: Set<string>
  /** Sem medição na janela E com dias elegíveis não confirmados por fonte de situação ATRASADA: "não sei se deveria ter produzido". */
  staleStatusIds: Set<string>
  /** Sem medição na janela E com dias cuja ESCALA é presumida/desconhecida (fonte de escala atrasada ou 6x1 sem folga informada). */
  staleScheduleIds: Set<string>
  unknownScheduleIds: Set<string>
  /** Confiança da fonte de situação funcional (metadata da Central) na avaliação. */
  statusFreshness: "FRESH" | "STALE" | "UNKNOWN"
  scheduleFreshness: "FRESH" | "STALE" | "UNKNOWN"
}

/** Chave de cache por (indicador, janela, agregação, cobertura, população) — a prévia do QA e o critério de seleção reutilizam a mesma resolução pra N colaboradores. */
export function operationalQuartileCacheKey(input: OperationalQuartileInput): string {
  return JSON.stringify([input.indicatorCode, input.aggregation, input.period, input.minimumCoverage ?? null, input.now.toISOString(), input.timeZone, [...input.populationIds].sort()])
}

export async function resolveOperationalQuartiles(db: Database, input: OperationalQuartileInput, cache?: Map<string, Promise<OperationalQuartileOutcome>>): Promise<OperationalQuartileOutcome> {
  const key = operationalQuartileCacheKey(input)
  const cached = cache?.get(key)
  if (cached) return cached
  const pending = compute(db, input)
  cache?.set(key, pending)
  return pending
}

async function compute(db: Database, input: OperationalQuartileInput): Promise<OperationalQuartileOutcome> {
  const window = resolveTimeWindow(input.period, input.now, input.timeZone)
  const definition = input.definition ?? (await loadIndicatorOperationalDefinition(db, input.indicatorCode))
  const direction = definition?.direction ?? null
  const [bySubject, eligibility] = await Promise.all([
    resolveOperationalWindowBySubject(
      db,
      { indicatorCode: input.indicatorCode, subjectIds: input.populationIds, window, aggregation: input.aggregation, expectedDays: businessDaysInWindow(window, input.timeZone), timeZone: input.timeZone, now: input.now, ...(input.workdayCache ? { workdayCache: input.workdayCache } : {}) },
      definition ?? undefined,
    ),
    resolveEligibleDaysBySubject(db, input.populationIds, window, input.timeZone, { now: input.now, ...(input.workdayCache ? { cache: input.workdayCache } : {}) }),
  ])
  const ineligibleIds = new Set(input.populationIds.filter((id) => (eligibility.get(id)?.eligibleDays ?? 0) === 0))
  const statusFreshness = eligibility.values().next().value?.statusConfidence.freshness ?? "UNKNOWN"
  const staleStatusIds = new Set(input.populationIds.filter((id) => (eligibility.get(id)?.statusConfidence.unconfirmedDays ?? 0) > 0 && (bySubject.get(id)?.value ?? null) === null))
  const scheduleFreshness = eligibility.values().next().value?.scheduleConfidence.freshness ?? "UNKNOWN"
  const staleScheduleIds = new Set(input.populationIds.filter((id) => !staleStatusIds.has(id) && scheduleFreshness === "STALE" && (eligibility.get(id)?.scheduleConfidence.unconfirmedScheduleDays ?? 0) > 0 && (bySubject.get(id)?.value ?? null) === null))
  const unknownScheduleIds = new Set(input.populationIds.filter((id) => !staleStatusIds.has(id) && !staleScheduleIds.has(id) && (eligibility.get(id)?.excludedByUnknownSchedule ?? 0) > 0 && (bySubject.get(id)?.value ?? null) === null && !ineligibleIds.has(id)))
  const ineligibleCount = ineligibleIds.size
  const belowCoverageIds = new Set<string>()
  const candidates: { employeeId: string; value: number }[] = []
  for (const employeeId of input.populationIds) {
    const result = bySubject.get(employeeId)
    if (!result || result.value === null) continue
    if (input.minimumCoverage !== undefined && result.coverage !== null && result.coverage < input.minimumCoverage) {
      belowCoverageIds.add(employeeId)
      continue
    }
    candidates.push({ employeeId, value: result.value })
  }
  const belowCoverageCount = belowCoverageIds.size
  const classification = assignOperationalQuartiles(candidates, direction ?? "TARGET")
  const members = new Map<string, OperationalQuartileMember>()
  for (const assignment of classification.assignments) {
    members.set(assignment.employeeId, { ...assignment, result: bySubject.get(assignment.employeeId)! })
  }
  return {
    direction,
    window,
    windowLabel: describeTimeWindow(window, input.timeZone),
    periodLabel: describePeriod(input.period),
    aggregation: input.aggregation,
    // Método da POPULAÇÃO = a agregação aplicada a cada colaborador (o "Σ x ÷ Σ y" individual fica na evidência do próprio colaborador).
    method: MEASUREMENT_AGGREGATION_LABELS[input.aggregation],
    evaluatedCount: input.populationIds.length,
    eligibleCount: input.populationIds.length - ineligibleCount,
    ineligibleCount,
    rankedCount: candidates.length,
    noDataCount: input.populationIds.length - candidates.length,
    belowCoverageCount,
    reason: direction === null ? "DIRECTION_UNSUPPORTED" : classification.reason,
    members,
    ineligibleIds,
    belowCoverageIds,
    staleStatusIds,
    staleScheduleIds,
    unknownScheduleIds,
    statusFreshness,
    scheduleFreshness,
  }
}
