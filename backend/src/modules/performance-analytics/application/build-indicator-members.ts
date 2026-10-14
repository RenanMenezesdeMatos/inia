import { DomainError } from "../../../shared/domain/domain-error.js"
import type { StructureAnchor } from "../../workflows/domain/structure-anchor-schema.js"
import type { IndicatorMemberRow, IndicatorMembersPage } from "../domain/view-models.js"
import type { AnalyticsReadRepository, IndicatorDefinitionRow, PersonNode } from "./analytics-read-repository.js"
import { cachedOfficial } from "./official-analytics-cache.js"
import { isWithinReference } from "./member-performance.js"
import { comparison, indicatorRowOf, loadPerformanceDataset } from "./performance-dataset.js"
import { resolveSubject, type ViewerScope } from "./viewer-scope.js"

export type IndicatorMembersQuery = {
  search?: string | undefined
  sort: "achievement" | "name" | "delta"
  order: "asc" | "desc"
  page: number
  pageSize: number
}

/** Membros da estrutura em UM indicador — ordenação/busca/paginação no backend, nunca "manda
 * todo mundo e o React filtra". */
export async function buildIndicatorMembers(
  repository: AnalyticsReadRepository,
  scope: ViewerScope,
  subject: StructureAnchor,
  period: string,
  code: string,
  query: IndicatorMembersQuery,
): Promise<IndicatorMembersPage> {
  const resolved = resolveSubject(scope, subject)
  const memberIds = resolved.members.map((member) => member.id)
  // Linhas de TODOS os membros (cache da camada oficial); busca, ordenação e página sobre uma cópia, a cada request.
  const { definition, rows: allRows } = await cachedOfficial(repository, scope, ["indicator-members", subject, period, code], memberIds.length, () => buildIndicatorMemberRows(repository, scope, resolved.members, period, code))
  const term = query.search?.trim().toLocaleLowerCase("pt-BR")
  const rows = allRows.filter((row) => !term || row.name.toLocaleLowerCase("pt-BR").includes(term))

  rows.sort((a, b) => compareRows(a, b, query.sort, query.order))
  const start = (query.page - 1) * query.pageSize
  return {
    indicator: { code, name: definition.name, unit: definition.unit, direction: definition.direction, capabilities: definition.capabilities },
    period,
    items: rows.slice(start, start + query.pageSize),
    total: rows.length,
    page: query.page,
    pageSize: query.pageSize,
  }
}

async function buildIndicatorMemberRows(repository: AnalyticsReadRepository, scope: ViewerScope, members: PersonNode[], period: string, code: string): Promise<{ definition: IndicatorDefinitionRow; rows: IndicatorMemberRow[] }> {
  const dataset = await loadPerformanceDataset(repository, scope.organizationId, members.map((member) => member.id), period)
  const definition = dataset.definitions.get(code)
  if (!definition) throw new DomainError("Indicador inexistente.", "INDICATOR_NOT_FOUND", 404)
  const rows: IndicatorMemberRow[] = members
    .map((member) => {
      const current = indicatorRowOf(dataset, member.id, period, code)
      const previous = indicatorRowOf(dataset, member.id, dataset.previousPeriod, code)
      const { deltaPp, trend } = comparison(current?.achievementPercent ?? null, previous?.achievementPercent ?? null)
      return {
        personId: member.id,
        name: member.name,
        avatarUrl: member.avatarUrl,
        jobTitle: member.jobTitle,
        teamName: member.teamName,
        subteamName: member.subteamName,
        value: current?.value ?? null,
        targetValue: current?.targetValue ?? null,
        achievementPercent: current?.achievementPercent ?? null,
        quartile: current?.quartile ?? null,
        withinTarget: current ? isWithinReference(current, definition.direction) : null,
        deltaPp,
        trend,
      }
    })
  return { definition, rows }
}

/** SEM DADOS vai sempre pro fim, independente da direção da ordenação — nunca "vale zero". */
function compareRows(a: IndicatorMemberRow, b: IndicatorMemberRow, sort: IndicatorMembersQuery["sort"], order: IndicatorMembersQuery["order"]): number {
  const direction = order === "asc" ? 1 : -1
  if (sort === "name") return direction * a.name.localeCompare(b.name, "pt-BR")
  const left = sort === "delta" ? a.deltaPp : a.achievementPercent
  const right = sort === "delta" ? b.deltaPp : b.achievementPercent
  if (left === null && right === null) return a.name.localeCompare(b.name, "pt-BR")
  if (left === null) return 1
  if (right === null) return -1
  return direction * (left - right) || a.name.localeCompare(b.name, "pt-BR")
}
