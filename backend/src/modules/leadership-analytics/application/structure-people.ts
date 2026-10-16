import type { AnalyticsReadRepository, IndicatorDefinitionRow } from "../../performance-analytics/application/analytics-read-repository.js"
import { buildIndicatorMembers } from "../../performance-analytics/application/build-indicator-members.js"
import { buildTeamMembersPage } from "../../performance-analytics/application/build-team-overview.js"
import { longPeriodLabel } from "../../performance-analytics/domain/reference-period.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import type { MemberSituation } from "../../performance-analytics/domain/view-models.js"
import { ANALYTIC_METHODS } from "../domain/analytic-rules.js"
import type { PeopleCard } from "../domain/view-models.js"
import type { ResolvedStructure } from "./references.js"

/** Pessoas por cartão — o resto fica na aba Equipe (o link leva já filtrado). */
export const MAX_PEOPLE = 20

const SITUATION_LABELS: Record<MemberSituation, string> = {
  BELOW_REFERENCE: "fora da referência",
  NO_DATA: "sem dado oficial",
  IMPROVING: "em evolução",
  WITHIN_REFERENCE: "dentro da referência",
}

/**
 * Quem são as pessoas: fora da referência num indicador (linhas oficiais do indicador), numa situação ou com algo pendente
 * (ciência ou revisão) — estes pelo mesmo `buildTeamMembersPage` que a aba Equipe aplica quando o link chega filtrado.
 */
export async function buildStructurePeople(
  repository: AnalyticsReadRepository,
  scope: ViewerScope,
  input: { structure: ResolvedStructure; period: string; situation?: MemberSituation | null; indicator?: IndicatorDefinitionRow | null; pendingOnly?: boolean; now?: Date },
): Promise<PeopleCard> {
  const { structure, period, indicator } = input
  const situation = indicator ? null : (input.situation ?? null)
  const header = {
    type: "PEOPLE" as const,
    generatedAt: (input.now ?? new Date()).toISOString(),
    structure: structure.ref,
    period,
    periodLabel: longPeriodLabel(period),
    methods: [ANALYTIC_METHODS.reference, ANALYTIC_METHODS.currentStructure],
  }
  if (indicator) {
    // Fora da referência NUM indicador: as linhas oficiais desse indicador (mesma regra `isWithinReference` do filtro da Equipe),
    // do menor atingimento para o maior.
    const all = await buildIndicatorMembers(repository, scope, structure.subject, period, indicator.code, { sort: "achievement", order: "asc", page: 1, pageSize: Math.max(1, structure.resolved.members.length) })
    const below = all.items.filter((item) => item.withinTarget === false)
    return {
      ...header,
      filter: { situation: null, indicatorCode: indicator.code, indicatorName: indicator.name, pendingOnly: false, label: `Fora da referência em ${indicator.name}` },
      total: below.length,
      members: below.slice(0, MAX_PEOPLE).map((item) => ({
        personId: item.personId,
        name: item.name,
        jobTitle: item.jobTitle,
        situation: "BELOW_REFERENCE",
        averageAchievementPercent: null,
        attentionIndicators: [],
        indicator: { value: item.value, targetValue: item.targetValue, achievementPercent: item.achievementPercent },
        awaitingAcknowledgement: 0,
        pendingReviews: 0,
      })),
    }
  }
  const page = await buildTeamMembersPage(repository, scope, structure.subject, period, { situation: situation ?? undefined, pendingOnly: input.pendingOnly === true, sort: "situation", order: "asc", page: 1, pageSize: MAX_PEOPLE })
  const label = situation ? `Pessoas ${SITUATION_LABELS[situation]}` : input.pendingOnly ? "Com ciência ou revisão pendente" : "Pessoas da estrutura"
  return {
    ...header,
    filter: { situation, indicatorCode: null, indicatorName: null, pendingOnly: input.pendingOnly === true, label },
    total: page.total,
    members: page.items.map((item) => ({
      personId: item.personId,
      name: item.name,
      jobTitle: item.jobTitle,
      situation: item.situation,
      averageAchievementPercent: item.averageAchievementPercent,
      attentionIndicators: item.attentionIndicators,
      indicator: null,
      awaitingAcknowledgement: item.followUps.unacknowledged,
      pendingReviews: item.pendingReviews,
    })),
  }
}
