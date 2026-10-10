import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import { averageValid, deltaPercentagePoints, trendFromDelta, type Trend } from "../domain/achievement-math.js"
import { previousReferencePeriod, referencePeriodWindow, shortPeriodLabel } from "../domain/reference-period.js"
import type { HistoryPoint, QuartileDistribution } from "../domain/view-models.js"
import type { AnalyticsReadRepository, IndicatorDefinitionRow, IndicatorPerformanceRow, PrvPerformanceRow } from "./analytics-read-repository.js"

/** Competências no histórico (inclui a atual). 6 meses cabe num gráfico legível e cobre um semestre. */
export const HISTORY_LENGTH = 6

/**
 * Tudo que os builders precisam sobre performance de um conjunto de pessoas, carregado em DUAS
 * queries (indicadores + PRV) e indexado em memória. O período anterior à janela entra junto pra
 * que a variação do ponto mais antigo do histórico também seja calculável.
 */
export type PerformanceDataset = {
  period: string
  previousPeriod: string
  /** Janela de histórico, do mais antigo pro mais recente (termina em `period`). */
  historyPeriods: string[]
  definitions: Map<string, IndicatorDefinitionRow>
  indicatorRows: IndicatorPerformanceRow[]
  prvRows: PrvPerformanceRow[]
  indicatorIndex: Map<string, Map<string, Map<string, IndicatorPerformanceRow>>>
  prvIndex: Map<string, Map<string, PrvPerformanceRow>>
}

export async function loadPerformanceDataset(repository: AnalyticsReadRepository, organizationId: string, personIds: string[], period: string): Promise<PerformanceDataset> {
  const historyPeriods = referencePeriodWindow(period, HISTORY_LENGTH)
  const loadedPeriods = [previousReferencePeriod(historyPeriods[0]!), ...historyPeriods]
  const [definitions, indicatorRows, prvRows] = await Promise.all([
    repository.loadIndicatorDefinitions(organizationId),
    repository.loadIndicatorPerformance(organizationId, personIds, loadedPeriods),
    repository.loadPrvPerformance(organizationId, personIds, loadedPeriods),
  ])

  const indicatorIndex = new Map<string, Map<string, Map<string, IndicatorPerformanceRow>>>()
  for (const row of indicatorRows) {
    const byPeriod = indicatorIndex.get(row.personId) ?? new Map<string, Map<string, IndicatorPerformanceRow>>()
    const byCode = byPeriod.get(row.referencePeriod) ?? new Map<string, IndicatorPerformanceRow>()
    byCode.set(row.indicatorCode, row)
    byPeriod.set(row.referencePeriod, byCode)
    indicatorIndex.set(row.personId, byPeriod)
  }
  const prvIndex = new Map<string, Map<string, PrvPerformanceRow>>()
  for (const row of prvRows) {
    const byPeriod = prvIndex.get(row.personId) ?? new Map<string, PrvPerformanceRow>()
    byPeriod.set(row.referencePeriod, row)
    prvIndex.set(row.personId, byPeriod)
  }

  return {
    period,
    previousPeriod: previousReferencePeriod(period),
    historyPeriods,
    definitions: new Map(definitions.map((definition) => [definition.code, definition])),
    indicatorRows,
    prvRows,
    indicatorIndex,
    prvIndex,
  }
}

export function indicatorRowsOf(dataset: PerformanceDataset, personId: string, period: string): IndicatorPerformanceRow[] {
  return [...(dataset.indicatorIndex.get(personId)?.get(period)?.values() ?? [])]
}

export function indicatorRowOf(dataset: PerformanceDataset, personId: string, period: string, code: string): IndicatorPerformanceRow | null {
  return dataset.indicatorIndex.get(personId)?.get(period)?.get(code) ?? null
}

export function prvRowOf(dataset: PerformanceDataset, personId: string, period: string): PrvPerformanceRow | null {
  return dataset.prvIndex.get(personId)?.get(period) ?? null
}

/** Média dos atingimentos válidos de TODOS os indicadores de TODOS os membros na competência —
 * a regra de consolidação (mesma da Unidade de Análise do Workflow Engine). */
export function consolidatedAchievement(dataset: PerformanceDataset, personIds: string[], period: string): number | null {
  return averageValid(personIds.flatMap((personId) => indicatorRowsOf(dataset, personId, period).map((row) => row.achievementPercent)))
}

/** Média dos atingimentos válidos de UM indicador entre os membros na competência. */
export function indicatorConsolidatedAchievement(dataset: PerformanceDataset, personIds: string[], code: string, period: string): number | null {
  return averageValid(personIds.map((personId) => indicatorRowOf(dataset, personId, period, code)?.achievementPercent ?? null))
}

/** Média dos atingimentos válidos dos indicadores de um colaborador — leitura rápida, NÃO é PRV. */
export function memberAverageAchievement(dataset: PerformanceDataset, personId: string, period: string): number | null {
  return averageValid(indicatorRowsOf(dataset, personId, period).map((row) => row.achievementPercent))
}

export function historyOf(dataset: PerformanceDataset, valueAt: (period: string) => number | null): HistoryPoint[] {
  return dataset.historyPeriods.map((period) => ({ period, label: shortPeriodLabel(period), value: valueAt(period) }))
}

export function comparison(current: number | null, previous: number | null): { deltaPp: number | null; trend: Trend } {
  const deltaPp = deltaPercentagePoints(current, previous)
  return { deltaPp, trend: trendFromDelta(deltaPp) }
}

export function emptyDistribution(): QuartileDistribution {
  return { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NO_DATA: 0 }
}

export function countQuartiles(quartiles: (Quartile | null)[]): QuartileDistribution {
  const distribution = emptyDistribution()
  for (const quartile of quartiles) {
    if (quartile) distribution[quartile] += 1
    else distribution.NO_DATA += 1
  }
  return distribution
}

/** Códigos de indicador com alguma linha entre os membros na competência, na ordem do catálogo. */
export function indicatorCodesWithData(dataset: PerformanceDataset, personIds: string[], period: string): string[] {
  const seen = new Set<string>()
  for (const personId of personIds) for (const row of indicatorRowsOf(dataset, personId, period)) seen.add(row.indicatorCode)
  return [...dataset.definitions.keys()].filter((code) => seen.has(code))
}
