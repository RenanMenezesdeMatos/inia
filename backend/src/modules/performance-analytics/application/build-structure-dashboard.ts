import { DomainError } from "../../../shared/domain/domain-error.js"
import type { StructureAnchor } from "../../workflows/domain/structure-anchor-schema.js"
import { buildAchievementInsights, buildStructureInsights } from "../domain/deterministic-insights.js"
import { GROUPING_LABELS, type GroupingDimension } from "../domain/hierarchy-levels.js"
import { DEFAULT_OPERATIONAL_COMPARISON, type OperationalComparison } from "../domain/operational-comparison.js"
import { longPeriodLabel } from "../domain/reference-period.js"
import { buildIndicatorViewCapabilities } from "../domain/view-capabilities.js"
import type { StructureBreakdown, StructureIndicatorDashboard, StructureIndicatorSummary } from "../domain/view-models.js"
import type { AnalyticsReadRepository } from "./analytics-read-repository.js"
import { buildMemberPerformance, isBelowReference } from "./member-performance.js"
import {
  comparison,
  consolidatedAchievement,
  countQuartiles,
  historyOf,
  indicatorCodesWithData,
  indicatorConsolidatedAchievement,
  indicatorRowOf,
  loadPerformanceDataset,
  prvRowOf,
  type PerformanceDataset,
} from "./performance-dataset.js"
import { splitIntoGroups, summarizeGroup } from "./structure-groups.js"
import { cachedOfficial } from "./official-analytics-cache.js"
import { buildBreadcrumb, resolveSubject, type ResolvedSubject, type ViewerScope } from "./viewer-scope.js"

export const CONSOLIDATION_METHOD =
  "Média aritmética simples dos atingimentos oficiais (achievement_percent) de todos os pares colaborador × indicador da estrutura no período. Sem peso de PRV; competências e indicadores sem dado ficam fora da média (nunca contam como zero)."

/**
 * Visão STRUCTURE: consolidado da estrutura (nunca chamado de PRV), indicadores consolidados,
 * histórico, distribuição por quartil e insights — tudo sobre atingimento normalizado, jamais sobre
 * valores brutos de unidades diferentes.
 */
export async function buildStructureDashboard(repository: AnalyticsReadRepository, scope: ViewerScope, subject: StructureAnchor, period: string, now: Date = new Date(), operationalComparison: OperationalComparison = DEFAULT_OPERATIONAL_COMPARISON): Promise<StructureIndicatorDashboard> {
  const resolved = resolveSubject(scope, subject)
  const memberIds = resolved.members.map((member) => member.id)
  const [official, operationalSummary] = await Promise.all([
    cachedOfficial(repository, scope, ["structure-dashboard", subject, period], memberIds.length, () => buildStructureOfficialDashboard(repository, scope, subject, resolved, memberIds, period)),
    repository.loadStructureOperationalSummary(scope.organizationId, memberIds, now, operationalComparison),
  ])
  return { ...official, operationalSummary }
}

/** Tudo do painel da estrutura que vem do FECHAMENTO OFICIAL (o resumo operacional tem cache próprio). */
async function buildStructureOfficialDashboard(repository: AnalyticsReadRepository, scope: ViewerScope, subject: StructureAnchor, resolved: ResolvedSubject, memberIds: string[], period: string): Promise<Omit<StructureIndicatorDashboard, "operationalSummary">> {
  const dataset = await loadPerformanceDataset(repository, scope.organizationId, memberIds, period)
  const performances = memberIds.map((id) => buildMemberPerformance(dataset, id))

  const consolidated = consolidatedAchievement(dataset, memberIds, period)
  const { deltaPp, trend } = comparison(consolidated, consolidatedAchievement(dataset, memberIds, dataset.previousPeriod))
  const indicators = indicatorCodesWithData(dataset, memberIds, period).map((code) => buildStructureIndicator(dataset, memberIds, code))
  indicators.sort((a, b) => (a.consolidatedAchievementPercent ?? Number.POSITIVE_INFINITY) - (b.consolidatedAchievementPercent ?? Number.POSITIVE_INFINITY))

  const withData = indicators.filter((indicator) => indicator.consolidatedAchievementPercent !== null)
  const weakest = withData[0]
  const strongest = withData[withData.length - 1]
  const insights = buildStructureInsights({
    consolidatedAchievementPercent: consolidated,
    deltaPp,
    memberCount: memberIds.length,
    membersWithData: performances.filter((performance) => performance.hasAnyData).length,
    belowReferenceCount: performances.filter((performance) => performance.indicatorsBelowTarget > 0).length,
    q4Count: performances.filter((performance) => performance.prvQuartile === "Q4").length,
    weakestIndicator: weakest ? { name: weakest.name, consolidatedAchievementPercent: weakest.consolidatedAchievementPercent! } : null,
    strongestIndicator: strongest && strongest !== weakest ? { name: strongest.name, consolidatedAchievementPercent: strongest.consolidatedAchievementPercent! } : null,
  })

  return {
    mode: "STRUCTURE",
    subject: resolved.descriptor,
    breadcrumb: buildBreadcrumb(scope, subject),
    period,
    periodLabel: longPeriodLabel(period),
    memberCount: memberIds.length,
    membersWithData: performances.filter((performance) => performance.hasAnyData).length,
    consolidatedAchievementPercent: consolidated,
    previousConsolidatedAchievementPercent: consolidatedAchievement(dataset, memberIds, dataset.previousPeriod),
    deltaPp,
    trend,
    consolidationMethod: CONSOLIDATION_METHOD,
    history: historyOf(dataset, (historyPeriod) => consolidatedAchievement(dataset, memberIds, historyPeriod)),
    prvDistribution: countQuartiles(memberIds.map((id) => prvRowOf(dataset, id, period)?.quartile ?? null)),
    indicators,
    positives: insights.positives,
    attentionPoints: insights.attentionPoints,
    groupingOptions: buildIndicatorViewCapabilities(scope.role, subject.kind).groupingOptions,
  }
}

function buildStructureIndicator(dataset: PerformanceDataset, memberIds: string[], code: string): StructureIndicatorSummary {
  const definition = dataset.definitions.get(code)!
  const current = indicatorConsolidatedAchievement(dataset, memberIds, code, dataset.period)
  const previous = indicatorConsolidatedAchievement(dataset, memberIds, code, dataset.previousPeriod)
  const { deltaPp, trend } = comparison(current, previous)
  const rows = memberIds.map((id) => indicatorRowOf(dataset, id, dataset.period, code)).filter((row) => row !== null)
  const historyValues = dataset.historyPeriods.map((historyPeriod) => indicatorConsolidatedAchievement(dataset, memberIds, code, historyPeriod))
  const insights = buildAchievementInsights({ label: definition.name, achievementPercent: current, quartile: null, deltaPp, history: historyValues, withinTarget: null })
  return {
    code,
    name: definition.name,
    unit: definition.unit,
    direction: definition.direction,
    capabilities: definition.capabilities,
    consolidatedAchievementPercent: current,
    membersWithData: rows.length,
    membersBelowTarget: rows.filter((row) => isBelowReference(row, definition.direction)).length,
    previousConsolidatedAchievementPercent: previous,
    deltaPp,
    trend,
    distribution: countQuartiles(rows.map((row) => row.quartile)),
    history: historyOf(dataset, (historyPeriod) => indicatorConsolidatedAchievement(dataset, memberIds, code, historyPeriod)),
    positives: insights.positives,
    attentionPoints: insights.attentionPoints,
  }
}

/** "Agrupar por" — o mesmo dataset da estrutura, repartido pela dimensão pedida. */
export async function buildStructureBreakdown(repository: AnalyticsReadRepository, scope: ViewerScope, subject: StructureAnchor, period: string, groupBy: GroupingDimension): Promise<StructureBreakdown> {
  const resolved = resolveSubject(scope, subject)
  const allowed = buildIndicatorViewCapabilities(scope.role, subject.kind).groupingOptions
  if (!allowed.includes(groupBy)) throw new DomainError("Agrupamento não disponível para esta estrutura.", "INVALID_GROUPING", 400)
  const memberIds = resolved.members.map((member) => member.id)
  return cachedOfficial(repository, scope, ["structure-breakdown", subject, period, groupBy], memberIds.length, async () => {
    const dataset = await loadPerformanceDataset(repository, scope.organizationId, memberIds, period)
    const groups = splitIntoGroups(scope, resolved, groupBy).map((bucket) => summarizeGroup(dataset, bucket))
    return { subject: resolved.descriptor, period, groupBy, groupByLabel: GROUPING_LABELS[groupBy], groups }
  })
}
