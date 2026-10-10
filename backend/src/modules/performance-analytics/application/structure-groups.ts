import { structureAnchorPersonId } from "../../workflows/domain/structure-anchor-schema.js"
import { buildAnalyticsSubject, type AnalyticsSubject } from "../domain/analytics-subject.js"
import { GROUPING_LABELS, isHierarchyRole, ROLE_LABELS, STRUCTURE_KIND_BY_ROLE, type GroupingDimension } from "../domain/hierarchy-levels.js"
import type { StructureGroupSummary } from "../domain/view-models.js"
import type { PersonNode } from "./analytics-read-repository.js"
import { buildMemberPerformance } from "./member-performance.js"
import { comparison, consolidatedAchievement, indicatorCodesWithData, indicatorConsolidatedAchievement, type PerformanceDataset } from "./performance-dataset.js"
import { operatorsBelow, type ResolvedSubject, type ViewerScope } from "./viewer-scope.js"
import type { PlatformRole } from "../../auth/infrastructure/jwt.js"

/** Um recorte da estrutura ("Agrupar por"): a unidade (gestor/grupo) e os membros que caem nela. */
export type GroupBucket = {
  key: string
  label: string
  description: string | null
  /** Sujeito navegável (drill-down). `null` pro balde residual "Sem <dimensão>". */
  subject: AnalyticsSubject | null
  leader: PersonNode | null
  members: PersonNode[]
}

/**
 * Divide os membros do sujeito (ou um subconjunto deles) pela dimensão pedida. Por cargo: as pessoas daquele cargo dentro
 * do escopo cujos operadores intersectam os membros (só o nível mais alto daquele cargo, nunca
 * unidades aninhadas duplicando gente); quem não cai em nenhuma unidade vai pro balde "Sem …".
 * Por Grupo/Subgrupo: `team_id`/`subteam_id` do operador.
 */
export function splitIntoGroups(scope: ViewerScope, resolved: ResolvedSubject, groupBy: GroupingDimension, subset: PersonNode[] = resolved.members): GroupBucket[] {
  const memberIds = new Set(subset.map((member) => member.id))
  if (groupBy === "TEAM" || groupBy === "SUBTEAM") return splitByGroup(subset, groupBy)

  const anchorId = resolved.anchor?.id ?? (resolved.descriptor.subject.kind !== "EMPLOYEE" ? structureAnchorPersonId(resolved.descriptor.subject) : null)
  const units = collectUnitsOfRole(scope, anchorId ?? scope.viewer.id, groupBy)
  const assigned = new Set<string>()
  const buckets: GroupBucket[] = []
  for (const unit of units) {
    const members = operatorsBelow(scope, unit.id).filter((operator) => memberIds.has(operator.id) && !assigned.has(operator.id))
    if (members.length === 0) continue
    for (const member of members) assigned.add(member.id)
    buckets.push({
      key: unit.id,
      label: unit.name,
      description: ROLE_LABELS[unit.role as PlatformRole] ?? unit.role,
      subject: isHierarchyRole(unit.role) ? buildAnalyticsSubject(STRUCTURE_KIND_BY_ROLE[unit.role], unit.id) : null,
      leader: unit,
      members,
    })
  }
  const remaining = subset.filter((member) => !assigned.has(member.id))
  if (remaining.length > 0) buckets.push({ key: `none:${groupBy}`, label: `Sem ${GROUPING_LABELS[groupBy].toLowerCase()}`, description: "Ligados diretamente à estrutura", subject: null, leader: null, members: remaining })
  return buckets
}

/** Pessoas do cargo pedido abaixo da âncora — busca em largura que PARA ao encontrar o cargo (não
 * desce dentro de uma unidade já coletada). */
function collectUnitsOfRole(scope: ViewerScope, anchorId: string, role: GroupingDimension): PersonNode[] {
  const units: PersonNode[] = []
  const queue = [...(scope.children.get(anchorId) ?? [])]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const node = queue.shift()!
    if (visited.has(node.id)) continue
    visited.add(node.id)
    if (node.role === role) {
      if (node.active) units.push(node)
      continue
    }
    queue.push(...(scope.children.get(node.id) ?? []))
  }
  return units.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

function splitByGroup(members: PersonNode[], groupBy: "TEAM" | "SUBTEAM"): GroupBucket[] {
  const buckets = new Map<string, GroupBucket>()
  for (const member of members) {
    const id = groupBy === "TEAM" ? member.teamId : member.subteamId
    const name = groupBy === "TEAM" ? member.teamName : member.subteamName
    const key = id ?? `none:${groupBy}`
    const bucket = buckets.get(key) ?? {
      key,
      label: id ? (name ?? GROUPING_LABELS[groupBy]) : `Sem ${GROUPING_LABELS[groupBy].toLowerCase()}`,
      description: id ? (groupBy === "SUBTEAM" ? member.teamName : GROUPING_LABELS[groupBy]) : null,
      subject: id ? buildAnalyticsSubject(groupBy, id) : null,
      leader: null,
      members: [],
    }
    bucket.members.push(member)
    buckets.set(key, bucket)
  }
  return [...buckets.values()].sort((a, b) => Number(a.subject === null) - Number(b.subject === null) || a.label.localeCompare(b.label, "pt-BR"))
}

export const TOP_ATTENTION_INDICATORS = 3

export function summarizeGroup(dataset: PerformanceDataset, bucket: GroupBucket): StructureGroupSummary {
  const ids = bucket.members.map((member) => member.id)
  const performances = ids.map((id) => buildMemberPerformance(dataset, id))
  const current = consolidatedAchievement(dataset, ids, dataset.period)
  const { deltaPp, trend } = comparison(current, consolidatedAchievement(dataset, ids, dataset.previousPeriod))
  const topAttentionIndicators = indicatorCodesWithData(dataset, ids, dataset.period)
    .map((code) => ({ code, name: dataset.definitions.get(code)?.name ?? code, consolidatedAchievementPercent: indicatorConsolidatedAchievement(dataset, ids, code, dataset.period) }))
    .filter((entry): entry is { code: string; name: string; consolidatedAchievementPercent: number } => entry.consolidatedAchievementPercent !== null && entry.consolidatedAchievementPercent < 100)
    .sort((a, b) => a.consolidatedAchievementPercent - b.consolidatedAchievementPercent)
    .slice(0, TOP_ATTENTION_INDICATORS)
  return {
    subject: bucket.subject,
    label: bucket.label,
    description: bucket.description,
    memberCount: ids.length,
    membersWithData: performances.filter((performance) => performance.hasAnyData).length,
    consolidatedAchievementPercent: current,
    deltaPp,
    trend,
    attentionCount: performances.filter((performance) => performance.situation === "BELOW_REFERENCE").length,
    improvingCount: performances.filter((performance) => performance.situation === "IMPROVING").length,
    noDataCount: performances.filter((performance) => performance.situation === "NO_DATA").length,
    topAttentionIndicators,
  }
}
