import type { EmploymentStatusView, FollowUpItem, OperationalStructureSummary, OperationalTrendView, PersistedInsight } from "../domain/view-models.js"
import type {
  AnalyticsReadRepository,
  FollowUpCounts,
  FollowUpFeedQuery,
  IndicatorDefinitionRow,
  IndicatorPerformanceRow,
  PersonNode,
  PrvPerformanceRow,
} from "../application/analytics-read-repository.js"
import type { VisibilityFilter } from "../../access/application/access-repository.js"
import type { Permission } from "../../access/domain/permissions.js"
import { encodeFollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"

/**
 * Implementação em memória da porta de leitura — os testes montam uma organização pequena e
 * exercitam escopo, agregação e view-models sem banco, com os mesmos contratos do Postgres.
 */
export type InMemoryOrg = {
  people: PersonNode[]
  definitions?: IndicatorDefinitionRow[]
  indicatorRows?: IndicatorPerformanceRow[]
  prvRows?: PrvPerformanceRow[]
  followUps?: Record<string, FollowUpCounts>
  pendingReviews?: Record<string, Record<string, number>>
  insights?: PersistedInsight[]
  feed?: FollowUpItem[]
  /** Tendência operacional por colaborador → por indicador (o que o resolvedor devolveria). */
  operationalTrends?: Record<string, Record<string, OperationalTrendView>>
  operationalSummary?: OperationalStructureSummary | null
  employmentStatuses?: Record<string, EmploymentStatusView>
  /** V1.5.8: visibilidade por CONTA (id da sessão, `sub`) × permissão — o que as atribuições de papel dariam. Ausente = nenhuma. */
  access?: Record<string, Partial<Record<Permission, Partial<VisibilityFilter>>>>
}

export const ORG = "00000000-0000-4000-8000-000000000001"

export function person(partial: Partial<PersonNode> & Pick<PersonNode, "id" | "name" | "role">): PersonNode {
  return {
    reportsToId: null,
    teamId: null,
    teamName: null,
    subteamId: null,
    subteamName: null,
    avatarUrl: null,
    jobTitle: null,
    operationalCapitalCode: null,
    active: true,
    ...partial,
  }
}

export function definition(code: string, name: string, unit: string, direction: IndicatorDefinitionRow["direction"] = "HIGHER", capabilities: Partial<IndicatorDefinitionRow["capabilities"]> = {}): IndicatorDefinitionRow {
  return { id: `def-${code}`, code, name, unit, direction, capabilities: { operationalEnabled: true, operationalAggregation: "AVERAGE", officialClosureSupported: true, ...capabilities } }
}

export function indicatorRow(partial: Partial<IndicatorPerformanceRow> & Pick<IndicatorPerformanceRow, "personId" | "indicatorCode" | "referencePeriod" | "value">): IndicatorPerformanceRow {
  return { targetValue: null, achievementPercent: null, weightPercent: null, quartile: null, source: "TEST", ...partial }
}

export function prvRow(personId: string, referencePeriod: string, achievementPercent: number, quartile: PrvPerformanceRow["quartile"]): PrvPerformanceRow {
  return { personId, referencePeriod, achievementPercent, quartile, source: "TEST" }
}

export class InMemoryAnalyticsRepository implements AnalyticsReadRepository {
  readonly calls: string[] = []
  constructor(private readonly org: InMemoryOrg) {}

  async loadPerson(_organizationId: string, personId: string) {
    this.calls.push("loadPerson")
    return this.org.people.find((entry) => entry.id === personId) ?? null
  }

  async loadDescendants(_organizationId: string, anchorId: string) {
    this.calls.push("loadDescendants")
    // Mesma defesa anticiclo do Postgres (`union`): um id nunca entra duas vezes.
    const result: PersonNode[] = []
    const visited = new Set<string>([anchorId])
    const queue = this.org.people.filter((entry) => entry.reportsToId === anchorId)
    while (queue.length > 0) {
      const node = queue.shift()!
      if (visited.has(node.id)) continue
      visited.add(node.id)
      result.push(node)
      queue.push(...this.org.people.filter((entry) => entry.reportsToId === node.id))
    }
    return result
  }

  async loadAccessVisibility(_organizationId: string, accountId: string, permission: Permission): Promise<VisibilityFilter> {
    this.calls.push("loadAccessVisibility")
    const grant = this.org.access?.[accountId]?.[permission]
    return { organizationWide: grant?.organizationWide ?? false, teamIds: grant?.teamIds ?? [], subteamIds: grant?.subteamIds ?? [] }
  }

  async loadPeopleInVisibility(_organizationId: string, visibility: VisibilityFilter) {
    this.calls.push("loadPeopleInVisibility")
    return this.org.people.filter((entry) => visibility.organizationWide || (entry.teamId !== null && visibility.teamIds.includes(entry.teamId)) || (entry.subteamId !== null && visibility.subteamIds.includes(entry.subteamId)))
  }

  async loadDirectReports(_organizationId: string, personId: string) {
    this.calls.push("loadDirectReports")
    return this.org.people.filter((entry) => entry.reportsToId === personId)
  }

  async countActiveDirectReports(_organizationId: string, personIds: string[]) {
    this.calls.push("countActiveDirectReports")
    const counts = new Map<string, number>()
    for (const id of personIds) counts.set(id, this.org.people.filter((entry) => entry.active && entry.reportsToId === id).length)
    return counts
  }

  async loadIndicatorDefinitions() {
    this.calls.push("loadIndicatorDefinitions")
    return this.org.definitions ?? []
  }

  async loadIndicatorPerformance(_organizationId: string, personIds: string[], periods: string[]) {
    this.calls.push("loadIndicatorPerformance")
    return (this.org.indicatorRows ?? []).filter((row) => personIds.includes(row.personId) && periods.includes(row.referencePeriod))
  }

  async loadPrvPerformance(_organizationId: string, personIds: string[], periods: string[]) {
    this.calls.push("loadPrvPerformance")
    return (this.org.prvRows ?? []).filter((row) => personIds.includes(row.personId) && periods.includes(row.referencePeriod))
  }

  async loadAvailablePeriods(_organizationId: string, personIds: string[], lastClosedPeriod: string) {
    const periods = new Set<string>()
    for (const row of this.org.indicatorRows ?? []) if (personIds.includes(row.personId) && row.referencePeriod <= lastClosedPeriod) periods.add(row.referencePeriod)
    for (const row of this.org.prvRows ?? []) if (personIds.includes(row.personId) && row.referencePeriod <= lastClosedPeriod) periods.add(row.referencePeriod)
    return [...periods].sort().reverse()
  }

  async loadFollowUpCounts(personIds: string[]) {
    this.calls.push("loadFollowUpCounts")
    return new Map(personIds.filter((id) => this.org.followUps?.[id]).map((id) => [id, this.org.followUps![id]!]))
  }

  async countPendingActions(_organizationId: string, viewerId: string) {
    const byViewer = this.org.pendingReviews?.[viewerId] ?? {}
    return Object.values(byViewer).reduce((sum, count) => sum + count, 0)
  }

  async loadPendingReviewCounts(_organizationId: string, viewerId: string, personIds: string[]) {
    this.calls.push("loadPendingReviewCounts")
    const byViewer = this.org.pendingReviews?.[viewerId] ?? {}
    return new Map(personIds.filter((id) => byViewer[id]).map((id) => [id, byViewer[id]!]))
  }

  async loadPersistedIndicatorInsights(_personId: string, indicatorNames: string[]) {
    this.calls.push("loadPersistedIndicatorInsights")
    return (this.org.insights ?? []).filter((insight) => indicatorNames.includes(insight.indicatorName))
  }

  async loadEmployeeOperationalTrends(_organizationId: string, personId: string) {
    this.calls.push("loadEmployeeOperationalTrends")
    return new Map(Object.entries(this.org.operationalTrends?.[personId] ?? {}))
  }

  async loadStructureOperationalSummary() {
    this.calls.push("loadStructureOperationalSummary")
    return this.org.operationalSummary ?? null
  }

  async loadEmploymentStatus(_organizationId: string, personId: string): Promise<EmploymentStatusView> {
    this.calls.push("loadEmploymentStatus")
    return (
      this.org.employmentStatuses?.[personId] ?? {
        status: "EM_PRODUCAO",
        label: "EM PRODUÇÃO",
        since: null,
        sinceInferred: false,
        until: null,
        source: null,
        basis: "PRESUMED_NO_HISTORY",
        basisLabel: "Em produção presumido (sem histórico de situação)",
        periodId: null,
        origin: null,
        freshness: { state: "UNKNOWN", lastSuccessAt: null, cadenceLabel: null, sourceName: null, feedName: null },
        history: [],
        schedule: null,
        operationalCapital: null,
      }
    )
  }

  async loadFollowUpFeed(query: FollowUpFeedQuery) {
    this.calls.push("loadFollowUpFeed")
    // Mesma ordem e mesmo cursor do Postgres: (instante em microssegundos, id), mais recente primeiro. A chave tem largura fixa
    // até o "|", então comparar o texto compara (instante, id).
    const key = (at: string, id: string) => `${at}|${id}`
    const atOf = (item: FollowUpItem) => new Date(item.createdAt).toISOString().replace("Z", "000Z")
    const before = query.before ? key(query.before.at, query.before.id) : null
    const items = (this.org.feed ?? [])
      .filter((item) =>
        item.kind === "FEEDBACK"
          ? query.operatorIds.includes(item.operator?.personId ?? "") && (!query.unacknowledgedOnly || item.acknowledgedAt === null)
          : query.includeViewerAlerts && !query.unacknowledgedOnly,
      )
      .filter((item) => before === null || key(atOf(item), item.id) < before)
      .sort((a, b) => key(atOf(b), b.id).localeCompare(key(atOf(a), a.id)))
    const page = items.slice(0, query.limit)
    const last = page.at(-1)
    return { items: page, nextCursor: items.length > query.limit && last ? encodeFollowUpCursor({ at: atOf(last), id: last.id }) : null }
  }
}
