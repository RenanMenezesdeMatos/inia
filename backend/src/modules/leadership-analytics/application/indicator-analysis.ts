import { DomainError } from "../../../shared/domain/domain-error.js"
import type { Quartile } from "../../indicators/domain/employee-performance-schema.js"
import type { AnalyticsReadRepository, IndicatorDefinitionRow, IndicatorPerformanceRow, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import { isWithinReference } from "../../performance-analytics/application/member-performance.js"
import { cachedOfficial } from "../../performance-analytics/application/official-analytics-cache.js"
import type { GroupBucket } from "../../performance-analytics/application/structure-groups.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { averageValid } from "../../performance-analytics/domain/achievement-math.js"
import { GROUPING_LABELS, type GroupingDimension } from "../../performance-analytics/domain/hierarchy-levels.js"
import { longPeriodLabel, previousReferencePeriod } from "../../performance-analytics/domain/reference-period.js"
import { buildIndicatorViewCapabilities } from "../../performance-analytics/domain/view-capabilities.js"
import { ANALYTIC_METHODS, assignDeciles, comparisonGroups, competitionRanking, DOMINANT_GROUP_SHARE, evaluateComparability, evaluateConcentration, LOW_COVERAGE_THRESHOLD, percentOf, type RankedEntry } from "../domain/analytic-rules.js"
import type { AnalysisMember, AnalysisUnit, IndicatorAnalysisCard } from "../domain/view-models.js"
import type { ResolvedStructure } from "./references.js"
import { unitBuckets } from "./structure-units.js"

/** Quantas pessoas cada ponta do ranking mostra (o cartão e o texto do modelo). */
export const RANKING_EDGE_SIZE = 5
/** Unidades no cartão: as de maior volume de desvio primeiro. */
export const MAX_UNITS = 15

type MemberFact = { member: PersonNode; row: IndicatorPerformanceRow | null; within: boolean | null; unitLabel: string | null }

/**
 * UM indicador numa estrutura, na competência oficial: população e denominador explícitos, dentro/fora (n e %), ranking com
 * empates, quartis oficiais, decis da estrutura, unidades abaixo (volume de desvio, comparabilidade) e o padrão
 * concentrado × disseminado. Tudo sobre as linhas oficiais persistidas (`employee_indicator_performance`) — nada recalculado.
 */
export async function buildIndicatorAnalysis(
  repository: AnalyticsReadRepository,
  scope: ViewerScope,
  input: { structure: ResolvedStructure; indicator: IndicatorDefinitionRow; period: string; groupBy?: GroupingDimension | null; now?: Date },
): Promise<IndicatorAnalysisCard> {
  const { structure, indicator, period } = input
  const groupBy = input.groupBy ?? null
  if (groupBy && !buildIndicatorViewCapabilities(scope.role, structure.subject.kind).groupingOptions.includes(groupBy)) {
    throw new DomainError(`Agrupar por ${GROUPING_LABELS[groupBy]} não está disponível para esta estrutura.`, "INVALID_GROUPING", 400)
  }
  const members = structure.resolved.members
  const card = await cachedOfficial(repository, scope, ["leadership-indicator", structure.subject, period, indicator.code, groupBy], members.length, () => compute(repository, scope, structure, indicator, period, groupBy))
  return { ...card, generatedAt: (input.now ?? new Date()).toISOString() }
}

async function compute(repository: AnalyticsReadRepository, scope: ViewerScope, structure: ResolvedStructure, indicator: IndicatorDefinitionRow, period: string, groupBy: GroupingDimension | null): Promise<IndicatorAnalysisCard> {
  const members = structure.resolved.members
  const previousPeriod = previousReferencePeriod(period)
  const rows = (await repository.loadIndicatorPerformance(scope.organizationId, members.map((member) => member.id), [period, previousPeriod])).filter((row) => row.indicatorCode === indicator.code)
  const current = new Map(rows.filter((row) => row.referencePeriod === period).map((row) => [row.personId, row]))
  const previous = new Map(rows.filter((row) => row.referencePeriod === previousPeriod).map((row) => [row.personId, row]))

  const { buckets, groupedBy } = unitBuckets(scope, structure, groupBy)
  const unitOf = new Map<string, string>()
  for (const bucket of buckets) for (const member of bucket.members) unitOf.set(member.id, bucket.label)

  const facts: MemberFact[] = members.map((member) => {
    const row = current.get(member.id) ?? null
    return { member, row, within: row ? isWithinReference(row, indicator.direction) : null, unitLabel: unitOf.get(member.id) ?? null }
  })
  const withData = facts.filter((fact) => fact.row !== null)
  const evaluable = facts.filter((fact) => fact.within !== null)
  const within = evaluable.filter((fact) => fact.within === true).length
  const below = evaluable.length - within

  const previousEvaluable = members.map((member) => previous.get(member.id)).filter((row): row is IndicatorPerformanceRow => row !== undefined).map((row) => isWithinReference(row, indicator.direction)).filter((value) => value !== null)
  const previousBelowPercent = percentOf(previousEvaluable.filter((value) => value === false).length, previousEvaluable.length)
  const belowPercent = percentOf(below, evaluable.length)

  // Ranking/decis: atingimento oficial (já ajustado à direção). Direção TARGET não tem "melhor" sem regra oficial.
  const rankingSupported = indicator.direction !== "TARGET"
  const ranked = rankingSupported ? competitionRanking(withData.filter((fact) => fact.row!.achievementPercent !== null).map((fact) => ({ id: fact.member.id, name: fact.member.name, score: fact.row!.achievementPercent! }))) : []
  const deciles = assignDeciles(ranked)
  const factById = new Map(facts.map((fact) => [fact.member.id, fact]))
  const toMember = (entry: RankedEntry): AnalysisMember => {
    const fact = factById.get(entry.id)!
    return {
      personId: entry.id,
      name: entry.name,
      value: fact.row?.value ?? null,
      targetValue: fact.row?.targetValue ?? null,
      achievementPercent: fact.row?.achievementPercent ?? null,
      position: entry.position,
      decile: deciles.byId.get(entry.id) ?? null,
      officialQuartile: fact.row?.quartile ?? null,
      within: fact.within,
      unitLabel: fact.unitLabel,
    }
  }
  const edge = ranked.length <= RANKING_EDGE_SIZE * 2 ? Math.ceil(ranked.length / 2) : RANKING_EDGE_SIZE
  const best = ranked.slice(0, edge).map(toMember)
  const worst = ranked.slice(edge).slice(-edge).reverse().map(toMember)

  const officialQuartiles: Record<Quartile | "NO_DATA", number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, NO_DATA: 0 }
  for (const fact of facts) officialQuartiles[fact.row?.quartile ?? "NO_DATA"] += 1

  const units = buildUnits(buckets, factById)
  const totalBelowInUnits = units.reduce((sum, unit) => sum + unit.below, 0)
  for (const unit of units) unit.shareOfDeviationsPercent = percentOf(unit.below, totalBelowInUnits)
  units.sort((a, b) => b.below - a.below || (b.belowPercent ?? -1) - (a.belowPercent ?? -1) || a.label.localeCompare(b.label, "pt-BR"))
  const navigableUnits = units.filter((unit) => unit.subject !== null)
  const concentration = navigableUnits.length > 0 ? evaluateConcentration(navigableUnits.map((unit) => ({ key: unit.key, label: unit.label, withReference: unit.withReference, below: unit.below }))) : null
  const groups = comparisonGroups(navigableUnits.map((unit) => ({ key: unit.key, comparable: unit.comparable, groupKey: unit.groupName, groupLabel: unit.groupName })))

  const coverage = members.length > 0 ? withData.length / members.length : null
  const limitations: string[] = []
  if (evaluable.length === 0) limitations.push(`Sem dado oficial de ${indicator.name} em ${longPeriodLabel(period)} para esta estrutura.`)
  else if (coverage !== null && coverage < LOW_COVERAGE_THRESHOLD) limitations.push(`Dados incompletos: só ${withData.length} de ${members.length} pessoas (${percentOf(withData.length, members.length)}%) têm dado oficial de ${indicator.name} em ${longPeriodLabel(period)}; em ${longPeriodLabel(previousPeriod)} eram ${previous.size}.`)
  const withoutReference = withData.length - evaluable.length
  if (withoutReference > 0) limitations.push(`${withoutReference} ${withoutReference === 1 ? "pessoa tem" : "pessoas têm"} valor sem meta nem atingimento — fora do denominador.`)
  if (!rankingSupported) limitations.push("O indicador tem direção 'na meta' (nem maior nem menor é melhor): sem ranking nem decis.")
  else if (ranked.length > 0 && deciles.reason === "INSUFFICIENT_POPULATION") limitations.push(`Decis exigem ao menos 10 pessoas ranqueadas (há ${ranked.length}).`)
  const notComparable = navigableUnits.filter((unit) => !unit.comparable)
  if (notComparable.length > 0) limitations.push(`Não comparáveis diretamente: ${notComparable.slice(0, 5).map((unit) => `${unit.label} (${unit.comparabilityReasons.join("; ")})`).join(" · ")}${notComparable.length > 5 ? ` e mais ${notComparable.length - 5}` : ""}.`)
  const comparisonNote = groups.length > 1 ? `As unidades estão em Grupos diferentes (${groups.map((group) => group.groupLabel ?? "sem Grupo").join("; ")}): compare só dentro do mesmo Grupo.` : null

  const methods: string[] = [ANALYTIC_METHODS.reference, ANALYTIC_METHODS.denominator]
  if (ranked.length > 0) methods.push(ANALYTIC_METHODS.ranking, ANALYTIC_METHODS.decile)
  methods.push(ANALYTIC_METHODS.officialQuartile, ANALYTIC_METHODS.averageAchievement)
  if (navigableUnits.length > 0) methods.push(ANALYTIC_METHODS.offender, ANALYTIC_METHODS.concentration, ANALYTIC_METHODS.comparability)
  methods.push(ANALYTIC_METHODS.currentStructure)

  return {
    type: "INDICATOR_ANALYSIS",
    generatedAt: "",
    structure: structure.ref,
    period,
    periodLabel: longPeriodLabel(period),
    indicator: { code: indicator.code, name: indicator.name, unit: indicator.unit, direction: indicator.direction },
    population: { memberCount: members.length, membersWithData: withData.length, withReference: evaluable.length, noData: members.length - withData.length, coveragePercent: coverage === null ? null : percentOf(withData.length, members.length) },
    reference: { within, below, withinPercent: percentOf(within, evaluable.length), belowPercent },
    previous: { period: previousPeriod, periodLabel: longPeriodLabel(previousPeriod), withReference: previousEvaluable.length, belowPercent: previousBelowPercent, deltaPp: belowPercent !== null && previousBelowPercent !== null ? Math.round((belowPercent - previousBelowPercent) * 10) / 10 : null },
    averageAchievementPercent: averageValid(withData.map((fact) => fact.row!.achievementPercent)),
    ranking: { reason: !rankingSupported ? "DIRECTION_UNSUPPORTED" : ranked.length === 0 ? "NO_DATA" : "OK", rankedCount: ranked.length, best, worst },
    officialQuartiles,
    deciles: { reason: rankingSupported ? deciles.reason : "DIRECTION_UNSUPPORTED", rankedCount: ranked.length, counts: deciles.counts },
    units: units.slice(0, MAX_UNITS),
    unitsGroupBy: groupedBy,
    unitsGroupByLabel: groupedBy ? GROUPING_LABELS[groupedBy] : null,
    concentration,
    comparison: { groups: groups.map((group) => ({ teamName: group.groupLabel, unitKeys: group.keys })), note: comparisonNote },
    limitations,
    methods,
  }
}

function buildUnits(buckets: GroupBucket[], factById: Map<string, MemberFact>): AnalysisUnit[] {
  return buckets.map((bucket) => {
    const facts = bucket.members.map((member) => factById.get(member.id)).filter((fact): fact is MemberFact => fact !== undefined)
    const withData = facts.filter((fact) => fact.row !== null)
    const evaluable = facts.filter((fact) => fact.within !== null)
    const within = evaluable.filter((fact) => fact.within === true).length
    const comparability = evaluateComparability({ key: bucket.key, memberCount: facts.length, membersWithData: withData.length, withReference: evaluable.length, memberTeams: bucket.members.map((member) => ({ teamId: member.teamId, teamName: member.teamName })) })
    return {
      key: bucket.key,
      label: bucket.label,
      description: bucket.description,
      subject: bucket.subject,
      memberCount: facts.length,
      membersWithData: withData.length,
      withReference: evaluable.length,
      within,
      below: evaluable.length - within,
      belowPercent: percentOf(evaluable.length - within, evaluable.length),
      shareOfDeviationsPercent: null,
      averageAchievementPercent: averageValid(withData.map((fact) => fact.row!.achievementPercent)),
      comparable: comparability.comparable,
      comparabilityReasons: comparability.reasons,
      groupName: comparability.dominantTeam && comparability.dominantTeam.share >= DOMINANT_GROUP_SHARE ? (comparability.dominantTeam.teamName ?? comparability.dominantTeam.teamId) : null,
    }
  })
}
