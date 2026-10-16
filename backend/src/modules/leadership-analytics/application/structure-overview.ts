import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import type { AnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { buildTeamOverview } from "../../performance-analytics/application/build-team-overview.js"
import { isWithinReference } from "../../performance-analytics/application/member-performance.js"
import { cachedOfficial } from "../../performance-analytics/application/official-analytics-cache.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { averageValid } from "../../performance-analytics/domain/achievement-math.js"
import { GROUPING_LABELS } from "../../performance-analytics/domain/hierarchy-levels.js"
import { longPeriodLabel, previousReferencePeriod } from "../../performance-analytics/domain/reference-period.js"
import { ANALYTIC_METHODS, LOW_COVERAGE_THRESHOLD, percentOf } from "../domain/analytic-rules.js"
import type { OverviewIndicator, StructureOverviewCard } from "../domain/view-models.js"
import type { ResolvedStructure } from "./references.js"

export const MAX_OVERVIEW_UNITS = 15

/**
 * Visão geral de uma estrutura na competência: pessoas por situação (a MESMA da aba Equipe), cada indicador com quantas pessoas
 * estão fora da referência (n e %, com a variação contra a competência anterior) e as unidades abaixo com mais pessoas fora.
 */
export async function buildStructureOverview(repository: AnalyticsReadRepository, scope: ViewerScope, input: { structure: ResolvedStructure; period: string; now?: Date }): Promise<StructureOverviewCard> {
  const { structure, period } = input
  const memberIds = structure.resolved.members.map((member) => member.id)
  const now = input.now ?? new Date()
  const [team, indicators, operationalSummary] = await Promise.all([
    buildTeamOverview(repository, scope, structure.subject, period),
    cachedOfficial(repository, scope, ["leadership-overview-indicators", structure.subject, period], memberIds.length, () => indicatorCounts(repository, scope.organizationId, memberIds, period)),
    // Mês corrente pela medição diária (read model): "como estão neste mês" sempre tem a resposta do período em curso ao lado do fechamento.
    repository.loadStructureOperationalSummary(scope.organizationId, memberIds, now, "MONTH"),
  ])
  const summary = team.summary
  const withData = summary.memberCount - summary.noData
  const coverage = summary.memberCount > 0 ? withData / summary.memberCount : null
  const limitations: string[] = []
  if (withData === 0) limitations.push(`Nenhuma pessoa da estrutura tem dado oficial em ${longPeriodLabel(period)}.`)
  else if (coverage !== null && coverage < LOW_COVERAGE_THRESHOLD) limitations.push(`Dados incompletos: só ${withData} de ${summary.memberCount} pessoas têm dado oficial em ${longPeriodLabel(period)}.`)
  const units = team.units
    .map((unit) => ({
      label: unit.label,
      description: unit.description,
      subject: unit.subject,
      memberCount: unit.memberCount,
      membersWithData: unit.membersWithData,
      belowReferenceCount: unit.attentionCount,
      belowReferencePercent: percentOf(unit.attentionCount, unit.membersWithData),
      topAttentionIndicators: unit.topAttentionIndicators.map((indicator) => ({ code: indicator.code, name: indicator.name })),
    }))
    .sort((a, b) => (b.belowReferencePercent ?? -1) - (a.belowReferencePercent ?? -1) || b.belowReferenceCount - a.belowReferenceCount || a.label.localeCompare(b.label, "pt-BR"))
    .slice(0, MAX_OVERVIEW_UNITS)
  return {
    type: "STRUCTURE_OVERVIEW",
    generatedAt: now.toISOString(),
    structure: structure.ref,
    period,
    periodLabel: longPeriodLabel(period),
    members: { total: summary.memberCount, withData, belowReference: summary.belowReference, withinReference: summary.withinReference, improving: summary.improving, noData: summary.noData, coveragePercent: coverage === null ? null : percentOf(withData, summary.memberCount) },
    indicators,
    units,
    unitsGroupByLabel: team.unitsGroupBy ? GROUPING_LABELS[team.unitsGroupBy] : null,
    awaitingAcknowledgement: summary.unacknowledgedFollowUps,
    operational: operationalSummary
      ? {
          label: operationalSummary.comparison.label,
          windowLabel: operationalSummary.windowLabel,
          previousWindowLabel: operationalSummary.previousWindowLabel,
          indicators: operationalSummary.indicators.map((indicator) => ({
            code: indicator.code,
            name: indicator.name,
            current: indicator.currentValue === null ? "—" : formatIndicatorValue(indicator.currentValue, indicator.unit),
            previous: indicator.previousValue === null ? "—" : formatIndicatorValue(indicator.previousValue, indicator.unit),
            trend: indicator.performanceTrend === "IMPROVED" ? "melhorou" : indicator.performanceTrend === "DECLINED" ? "piorou" : indicator.performanceTrend === "STABLE" ? "estável" : null,
            coverage: `${indicator.membersWithData} de ${indicator.eligibleMemberCount}`,
          })),
        }
      : null,
    limitations,
    methods: [
      "Situação da pessoa: fora da referência = algum indicador com atingimento oficial abaixo de 100% (ou PRV no Q4); em evolução = média dos atingimentos subiu ≥ 5 p.p.; sem dado = nenhuma linha oficial na competência.",
      ANALYTIC_METHODS.reference,
      ANALYTIC_METHODS.denominator,
      ANALYTIC_METHODS.averageAchievement,
      ANALYTIC_METHODS.currentStructure,
    ],
  }
}

async function indicatorCounts(repository: AnalyticsReadRepository, organizationId: string, memberIds: string[], period: string): Promise<OverviewIndicator[]> {
  const previousPeriod = previousReferencePeriod(period)
  const [definitions, rows] = await Promise.all([repository.loadIndicatorDefinitions(organizationId), repository.loadIndicatorPerformance(organizationId, memberIds, [period, previousPeriod])])
  const result: OverviewIndicator[] = []
  for (const definition of definitions) {
    const current = rows.filter((row) => row.indicatorCode === definition.code && row.referencePeriod === period)
    if (current.length === 0) continue
    const evaluate = (list: typeof rows) => list.map((row) => isWithinReference(row, definition.direction)).filter((value) => value !== null)
    const evaluable = evaluate(current)
    const previous = evaluate(rows.filter((row) => row.indicatorCode === definition.code && row.referencePeriod === previousPeriod))
    const below = evaluable.filter((value) => value === false).length
    const belowPercent = percentOf(below, evaluable.length)
    const previousBelowPercent = percentOf(previous.filter((value) => value === false).length, previous.length)
    result.push({
      code: definition.code,
      name: definition.name,
      unit: definition.unit,
      direction: definition.direction,
      withReference: evaluable.length,
      below,
      belowPercent,
      previousBelowPercent,
      deltaPp: belowPercent !== null && previousBelowPercent !== null ? Math.round((belowPercent - previousBelowPercent) * 10) / 10 : null,
      averageAchievementPercent: averageValid(current.map((row) => row.achievementPercent)),
    })
  }
  return result.sort((a, b) => b.below - a.below || (b.belowPercent ?? -1) - (a.belowPercent ?? -1) || a.name.localeCompare(b.name, "pt-BR"))
}
