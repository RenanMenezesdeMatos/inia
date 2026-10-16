import type { StructureAnchor } from "../../workflows/domain/structure-anchor-schema.js"
import { isHierarchyRole, type GroupingDimension } from "../domain/hierarchy-levels.js"
import { longPeriodLabel } from "../domain/reference-period.js"
import { buildIndicatorViewCapabilities } from "../domain/view-capabilities.js"
import type { MemberSituation, StructureGroupSummary, StructureUnitSummary, TeamMemberSummary, TeamMembersPage, TeamOverview, TeamSummaryCounts } from "../domain/view-models.js"
import type { AnalyticsReadRepository, FollowUpCounts, PersonNode } from "./analytics-read-repository.js"
import { buildMemberPerformance, type MemberPerformance } from "./member-performance.js"
import { indicatorCodesWithData, loadPerformanceDataset, type PerformanceDataset } from "./performance-dataset.js"
import { splitIntoGroups, summarizeGroup, TOP_ATTENTION_INDICATORS, type GroupBucket } from "./structure-groups.js"
import { cachedOfficial } from "./official-analytics-cache.js"
import { buildBreadcrumb, resolveSubject, type ResolvedSubject, type ViewerScope } from "./viewer-scope.js"

/**
 * O que a Equipe deriva do FECHAMENTO OFICIAL de uma estrutura — guardado no cache da camada oficial
 * (official-analytics-cache.ts): desempenho por membro, indicadores de atenção já nomeados, unidades subordinadas com os
 * consolidados e as opções de filtro. Acompanhamentos e pendências entram a cada request (MemberContext).
 */
type OfficialTeamBase = {
  performances: Map<string, MemberPerformance>
  attentionIndicators: Map<string, TeamMemberSummary["attentionIndicators"]>
  units: { summary: StructureGroupSummary; bucket: GroupBucket }[]
  topGroupBy: GroupingDimension | null
  directMemberCount: number
  filterOptions: TeamOverview["filterOptions"]
}

type MemberContext = {
  base: OfficialTeamBase
  followUps: Map<string, FollowUpCounts>
  pendingReviews: Map<string, number>
}

async function loadMemberContext(repository: AnalyticsReadRepository, scope: ViewerScope, subject: StructureAnchor, resolved: ResolvedSubject, period: string): Promise<MemberContext> {
  const memberIds = resolved.members.map((member) => member.id)
  const [base, followUps, pendingReviews] = await Promise.all([
    cachedOfficial(repository, scope, ["team-base", subject, period], memberIds.length, () => buildOfficialTeamBase(repository, scope, subject, resolved, period)),
    repository.loadFollowUpCounts(memberIds),
    repository.loadPendingReviewCounts(scope.organizationId, scope.viewer.id, memberIds),
  ])
  return { base, followUps, pendingReviews }
}

async function buildOfficialTeamBase(repository: AnalyticsReadRepository, scope: ViewerScope, subject: StructureAnchor, resolved: ResolvedSubject, period: string): Promise<OfficialTeamBase> {
  const dataset = await loadPerformanceDataset(repository, scope.organizationId, resolved.members.map((member) => member.id), period)
  const performances = new Map(resolved.members.map((member) => [member.id, buildMemberPerformance(dataset, member.id)]))
  const attentionIndicators = new Map(
    [...performances].map(([personId, performance]) => [
      personId,
      performance.belowTargetRows
        .map((row) => ({ code: row.indicatorCode, name: dataset.definitions.get(row.indicatorCode)?.name ?? row.indicatorCode, achievementPercent: row.achievementPercent }))
        .sort((a, b) => (a.achievementPercent ?? Number.POSITIVE_INFINITY) - (b.achievementPercent ?? Number.POSITIVE_INFINITY))
        .slice(0, TOP_ATTENTION_INDICATORS),
    ]),
  )
  const { units, topGroupBy, directMembers } = collectUnits(scope, resolved, subject)
  return {
    performances,
    attentionIndicators,
    units: units.map((bucket) => ({ bucket, summary: summarizeGroup(dataset, bucket) })),
    topGroupBy,
    directMemberCount: directMembers.length,
    filterOptions: buildFilterOptions(resolved.members, dataset),
  }
}

/**
 * Aba Equipe/Estrutura: "quem compõe minha estrutura e onde preciso atuar". Para uma equipe de
 * Supervisor (ou estrutura sem gestor intermediário) mostra os membros direto; acima disso mostra
 * primeiro as unidades subordinadas (o nível de gestão mais alto presente abaixo da âncora) —
 * nunca centenas de operadores de uma vez.
 */
export async function buildTeamOverview(repository: AnalyticsReadRepository, scope: ViewerScope, subject: StructureAnchor, period: string): Promise<TeamOverview> {
  const resolved = resolveSubject(scope, subject)
  const context = await loadMemberContext(repository, scope, subject, resolved, period)
  const performances = resolved.members.map((member) => context.base.performances.get(member.id)!)
  const units = context.base.units.map((unit) => summarizeUnit(context, unit.bucket, unit.summary))

  return {
    subject: resolved.descriptor,
    breadcrumb: buildBreadcrumb(scope, subject),
    period,
    periodLabel: longPeriodLabel(period),
    summary: summarizeCounts(performances, context),
    units,
    unitsGroupBy: context.base.topGroupBy,
    showsMembersDirectly: units.length === 0,
    directMemberCount: units.length === 0 ? 0 : context.base.directMemberCount,
    filterOptions: context.base.filterOptions,
  }
}

/**
 * Unidades subordinadas em CASCATA: começa pelo nível de gestão mais alto permitido; quem não
 * cai em nenhuma unidade desse nível é repartido pelo nível seguinte, e assim por diante. Sobram
 * só os operadores ligados diretamente à âncora (sem gestor intermediário) — esses são listados
 * como membros, nunca escondidos nem duplicados numa "unidade" fantasma.
 */
export function collectUnits(scope: ViewerScope, resolved: ResolvedSubject, subject: StructureAnchor): { units: GroupBucket[]; topGroupBy: GroupingDimension | null; directMembers: PersonNode[] } {
  const options = buildIndicatorViewCapabilities(scope.role, subject.kind).groupingOptions.filter(isHierarchyRole)
  const units: GroupBucket[] = []
  let topGroupBy: GroupingDimension | null = null
  let remaining = resolved.members
  for (const groupBy of options) {
    if (remaining.length === 0) break
    const buckets = splitIntoGroups(scope, resolved, groupBy, remaining)
    const found = buckets.filter((bucket) => bucket.subject !== null)
    if (found.length === 0) continue
    if (!topGroupBy) topGroupBy = groupBy
    units.push(...found)
    remaining = buckets.find((bucket) => bucket.subject === null)?.members ?? []
  }
  return { units, topGroupBy, directMembers: remaining }
}

/** Operador "direto" = nenhum gestor intermediário entre ele e a âncora do sujeito. */
export function isDirectMember(scope: ViewerScope, anchorId: string | null, member: PersonNode): boolean {
  let cursor = member.reportsToId
  while (cursor && cursor !== anchorId && cursor !== scope.viewer.id) {
    const node = scope.nodes.get(cursor)
    if (!node) break
    if (isHierarchyRole(node.role)) return false
    cursor = node.reportsToId
  }
  return true
}

function summarizeUnit(context: MemberContext, bucket: GroupBucket, base: StructureGroupSummary): StructureUnitSummary {
  return {
    ...base,
    subject: bucket.subject!,
    leader: bucket.leader ? { personId: bucket.leader.id, name: bucket.leader.name, avatarUrl: bucket.leader.avatarUrl, role: bucket.leader.role } : null,
    pendingReviews: bucket.members.reduce((sum, member) => sum + (context.pendingReviews.get(member.id) ?? 0), 0),
  }
}

function summarizeCounts(performances: MemberPerformance[], context: MemberContext): TeamSummaryCounts {
  const count = (situation: MemberSituation) => performances.filter((performance) => performance.situation === situation).length
  return {
    memberCount: performances.length,
    withinReference: count("WITHIN_REFERENCE"),
    belowReference: count("BELOW_REFERENCE"),
    improving: count("IMPROVING"),
    noData: count("NO_DATA"),
    unacknowledgedFollowUps: performances.reduce((sum, performance) => sum + (context.followUps.get(performance.personId)?.unacknowledged ?? 0), 0),
    pendingReviews: performances.reduce((sum, performance) => sum + (context.pendingReviews.get(performance.personId) ?? 0), 0),
  }
}

function buildFilterOptions(members: PersonNode[], dataset: PerformanceDataset): TeamOverview["filterOptions"] {
  const teams = new Map<string, string>()
  const subteams = new Map<string, { name: string; teamId: string }>()
  for (const member of members) {
    if (member.teamId && member.teamName) teams.set(member.teamId, member.teamName)
    if (member.subteamId && member.subteamName && member.teamId) subteams.set(member.subteamId, { name: member.subteamName, teamId: member.teamId })
  }
  const codes = indicatorCodesWithData(dataset, members.map((member) => member.id), dataset.period)
  return {
    teams: [...teams].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    subteams: [...subteams].map(([id, entry]) => ({ id, name: entry.name, teamId: entry.teamId })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    indicators: codes.map((code) => ({ code, name: dataset.definitions.get(code)?.name ?? code })),
  }
}

export type TeamMembersQuery = {
  search?: string | undefined
  teamId?: string | undefined
  subteamId?: string | undefined
  situation?: MemberSituation | undefined
  /** Só quem está abaixo da referência NESTE indicador. */
  attentionIndicatorCode?: string | undefined
  /** Só quem tem acompanhamento sem ciência ou revisão pendente. */
  pendingOnly?: boolean | undefined
  /** Só operadores ligados diretamente à âncora (sem gestor intermediário) — complemento das unidades. */
  directOnly?: boolean | undefined
  sort: "name" | "achievement" | "prv" | "delta" | "situation"
  order: "asc" | "desc"
  page: number
  pageSize: number
}

const SITUATION_RANK: Record<MemberSituation, number> = { BELOW_REFERENCE: 0, NO_DATA: 1, IMPROVING: 2, WITHIN_REFERENCE: 3 }

export async function buildTeamMembersPage(repository: AnalyticsReadRepository, scope: ViewerScope, subject: StructureAnchor, period: string, query: TeamMembersQuery): Promise<TeamMembersPage> {
  const resolved = resolveSubject(scope, subject)
  const context = await loadMemberContext(repository, scope, subject, resolved, period)
  const term = query.search?.trim().toLocaleLowerCase("pt-BR")

  const anchorId = resolved.anchor?.id ?? null
  const rows = resolved.members
    .filter((member) => !query.directOnly || isDirectMember(scope, anchorId, member))
    .filter((member) => !term || member.name.toLocaleLowerCase("pt-BR").includes(term))
    .filter((member) => !query.teamId || member.teamId === query.teamId)
    .filter((member) => !query.subteamId || member.subteamId === query.subteamId)
    .map((member) => toMemberSummary(member, context.base.performances.get(member.id)!, context))
    .filter((row) => !query.situation || row.situation === query.situation)
    // Todos os indicadores abaixo da referência — não só os 3 piores mostrados na linha (quem tem o indicador pedido como 4º pior também entra).
    .filter((row) => !query.attentionIndicatorCode || context.base.performances.get(row.personId)!.belowTargetRows.some((belowRow) => belowRow.indicatorCode === query.attentionIndicatorCode))
    .filter((row) => !query.pendingOnly || row.followUps.unacknowledged > 0 || row.pendingReviews > 0)

  rows.sort((a, b) => compareMembers(a, b, query.sort, query.order))
  const start = (query.page - 1) * query.pageSize
  return { items: rows.slice(start, start + query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize }
}

function toMemberSummary(member: PersonNode, performance: MemberPerformance, context: MemberContext): TeamMemberSummary {
  return {
    personId: member.id,
    name: member.name,
    avatarUrl: member.avatarUrl,
    jobTitle: member.jobTitle,
    teamId: member.teamId,
    teamName: member.teamName,
    subteamId: member.subteamId,
    subteamName: member.subteamName,
    situation: performance.situation,
    prvAchievementPercent: performance.prvAchievementPercent,
    prvQuartile: performance.prvQuartile,
    averageAchievementPercent: performance.averageAchievementPercent,
    deltaPp: performance.deltaPp,
    trend: performance.trend,
    indicatorsWithData: performance.indicatorsWithData,
    indicatorsBelowTarget: performance.indicatorsBelowTarget,
    attentionIndicators: context.base.attentionIndicators.get(member.id)!,
    followUps: context.followUps.get(member.id) ?? { total: 0, unacknowledged: 0 },
    pendingReviews: context.pendingReviews.get(member.id) ?? 0,
  }
}

function compareMembers(a: TeamMemberSummary, b: TeamMemberSummary, sort: TeamMembersQuery["sort"], order: TeamMembersQuery["order"]): number {
  const direction = order === "asc" ? 1 : -1
  const byName = a.name.localeCompare(b.name, "pt-BR")
  if (sort === "name") return direction * byName
  if (sort === "situation") return direction * (SITUATION_RANK[a.situation] - SITUATION_RANK[b.situation]) || byName
  const pick = (row: TeamMemberSummary) => (sort === "prv" ? row.prvAchievementPercent : sort === "delta" ? row.deltaPp : row.averageAchievementPercent)
  const left = pick(a)
  const right = pick(b)
  if (left === null && right === null) return byName
  if (left === null) return 1
  if (right === null) return -1
  return direction * (left - right) || byName
}
