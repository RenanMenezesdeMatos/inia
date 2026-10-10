import { evaluateAttainment } from "../../indicators/domain/evaluate-attainment.js"
import type { Trend } from "../domain/achievement-math.js"
import { classifyMemberSituation } from "../domain/member-situation.js"
import type { MemberSituation } from "../domain/view-models.js"
import { comparison, indicatorRowsOf, memberAverageAchievement, prvRowOf, type PerformanceDataset } from "./performance-dataset.js"
import type { IndicatorPerformanceRow } from "./analytics-read-repository.js"

/** Leitura de um colaborador na competência, derivada só de linhas oficiais. Compartilhada por
 * Equipe (linha do colaborador), pelos grupos do "Agrupar por" e pelo resumo da estrutura. */
export type MemberPerformance = {
  personId: string
  hasAnyData: boolean
  averageAchievementPercent: number | null
  previousAverageAchievementPercent: number | null
  deltaPp: number | null
  trend: Trend
  prvAchievementPercent: number | null
  prvQuartile: IndicatorPerformanceRow["quartile"]
  indicatorsWithData: number
  indicatorsBelowTarget: number
  belowTargetRows: IndicatorPerformanceRow[]
  situation: MemberSituation
}

/**
 * Regra ÚNICA de "dentro/abaixo da referência" de um indicador: o atingimento oficial
 * (`achievement_percent` ≥ 100 = dentro) manda sempre que existe; só sem ele cai na meta vigente
 * (valor x meta x direção — `evaluateAttainment`, fato determinístico já existente no domínio).
 * `null` = nem atingimento nem meta → não dá pra afirmar nada. Usada tanto no card do indicador
 * quanto na situação do colaborador, pra nunca mostrar "dentro da meta" ao lado de "93% de
 * atingimento".
 */
export function isWithinReference(row: IndicatorPerformanceRow, direction: "HIGHER" | "LOWER" | "TARGET"): boolean | null {
  if (row.achievementPercent !== null) return row.achievementPercent >= 100
  return evaluateAttainment(row.value, row.targetValue, direction)
}

export function isBelowReference(row: IndicatorPerformanceRow, direction: "HIGHER" | "LOWER" | "TARGET"): boolean {
  return isWithinReference(row, direction) === false
}

export function buildMemberPerformance(dataset: PerformanceDataset, personId: string): MemberPerformance {
  const rows = indicatorRowsOf(dataset, personId, dataset.period)
  const prv = prvRowOf(dataset, personId, dataset.period)
  const average = memberAverageAchievement(dataset, personId, dataset.period)
  const previousAverage = memberAverageAchievement(dataset, personId, dataset.previousPeriod)
  const { deltaPp, trend } = comparison(average, previousAverage)
  const belowTargetRows = rows.filter((row) => isBelowReference(row, dataset.definitions.get(row.indicatorCode)?.direction ?? "HIGHER"))
  const hasAnyData = rows.length > 0 || prv !== null
  return {
    personId,
    hasAnyData,
    averageAchievementPercent: average,
    previousAverageAchievementPercent: previousAverage,
    deltaPp,
    trend,
    prvAchievementPercent: prv?.achievementPercent ?? null,
    prvQuartile: prv?.quartile ?? null,
    indicatorsWithData: rows.length,
    indicatorsBelowTarget: belowTargetRows.length,
    belowTargetRows,
    situation: classifyMemberSituation({ hasAnyData, indicatorsBelowTarget: belowTargetRows.length, prvQuartile: prv?.quartile ?? null, deltaPp }),
  }
}
