import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveFeedbackViewsForViewer } from "../../reliable-feedback/application/feedback-view-access.js"
import { loadLegacyFeedbackHeadings } from "../../feedbacks/infrastructure/legacy-feedback-headings.js"
import { loadFeedbackOrigins } from "../../feedbacks/infrastructure/feedback-origins.js"
import { loadFeedbackSupportMaterials } from "../../feedbacks/application/feedback-support-materials.js"
import { encodeFollowUpCursor, followUpCursorAtSql, type FollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"
import { PgPendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { quartileSchema, type Quartile } from "../../indicators/domain/employee-performance-schema.js"
import type { IndicatorDirection } from "../../indicators/domain/evaluate-attainment.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import type { EmploymentStatusView, FollowUpFeed, FollowUpItem, OperationalStructureSummary, OperationalTrendView, PersistedInsight } from "../domain/view-models.js"
import { EMPLOYMENT_STATUS_LABELS, STATUS_BASIS_LABELS } from "../../people/domain/employment-status.js"
import { loadEmploymentStatusHistory, resolveEmployeeStatusAt } from "../../people/application/employment-status-service.js"
import { loadWorkScheduleSummary } from "../../people/application/work-schedule-service.js"
import { findBrazilianCapital } from "../../people/domain/brazilian-capitals.js"
import { describeStatusSource, resolveEmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import type { OperationalComparison } from "../domain/operational-comparison.js"
import { buildEmployeeOperationalTrends, buildStructureOperationalSummary, type StructureSummaryObservation } from "./operational-trend.js"
import { AnalyticsCache, membersFingerprint } from "../infrastructure/analytics-cache.js"
import { loadAnalyticsVersions, type AnalyticsVersions } from "../infrastructure/analytics-versions.js"
import type { VisibilityFilter } from "../../access/application/access-repository.js"
import { visibilityOf } from "../../access/application/access-service.js"
import type { Permission } from "../../access/domain/permissions.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { recadoAlertCoveredByFollowUpSql } from "../../conversational-delivery/application/recado-follow-up-invite.js"
import { descendantsOf, organizationPeopleGraphCache, PERSON_NODE_JOINS, PERSON_NODE_SELECT, type OrganizationPeopleGraphCache } from "../infrastructure/organization-people-graph.js"

/**
 * Porta de leitura da área de analytics — tudo em lote (N pessoas × M competências numa ida ao
 * banco), nunca "pra cada pessoa → query". Os builders dependem só desta interface, o que
 * permite testá-los com uma implementação em memória e trocar a implementação Postgres por uma
 * agregação em SQL sem tocar em regra nenhuma.
 */

export type PersonNode = {
  id: string
  name: string
  role: string
  reportsToId: string | null
  teamId: string | null
  teamName: string | null
  subteamId: string | null
  subteamName: string | null
  avatarUrl: string | null
  jobTitle: string | null
  /** Capital operacional informada pela empresa (migration 065) — só apresentação na Estrutura. */
  operationalCapitalCode: string | null
  active: boolean
}

/** Capacidades do catálogo (migration 055) — a UI descreve QUALQUER indicador por unidade, direção
 * e capacidades, nunca por componente específico de um código. */
export type IndicatorCapabilities = { operationalEnabled: boolean; operationalAggregation: string; officialClosureSupported: boolean }
export type IndicatorDefinitionRow = { id: string; code: string; name: string; unit: string; direction: IndicatorDirection; capabilities: IndicatorCapabilities }

export type IndicatorPerformanceRow = {
  personId: string
  indicatorCode: string
  referencePeriod: string
  value: number
  targetValue: number | null
  achievementPercent: number | null
  weightPercent: number | null
  quartile: Quartile | null
  /**
   * Componentes do valor oficial como a fonte mandou (contrato OFFICIAL_INDICATOR_PERFORMANCE@2, migration
   * 147): só quando a estratégia do indicador define o valor por numerador ÷ denominador (Taxa, Média
   * ponderada). null = a fonte não informou — nunca desempenho ruim. Servem para agregar uma estrutura em
   * valor (Σ numerador ÷ Σ denominador × `componentValueScale` da ESTRATÉGIA) e para a participação de cada
   * unidade; nenhum número oficial (atingimento, PRV, quartil, peso) é recalculado a partir deles.
   */
  numerator: number | null
  denominator: number | null
  source: string
}

export type PrvPerformanceRow = { personId: string; referencePeriod: string; achievementPercent: number; quartile: Quartile; source: string }

export type FollowUpCounts = { total: number; unacknowledged: number }

export type FollowUpFeedQuery = {
  organizationId: string
  viewerId: string
  /** Operadores cujos feedbacks entram no feed (o próprio, ou os membros da estrutura). */
  operatorIds: string[]
  /** Inclui alertas endereçados ao viewer (outputs/revisões/escalonamentos de workflow). */
  includeViewerAlerts: boolean
  /** Só feedbacks ainda sem ciência do colaborador (o atalho "aguardando ciência" da Equipe). */
  unacknowledgedOnly: boolean
  /** Itens por página. */
  limit: number
  /** Último item da página anterior (keyset); null = primeira página. */
  before: FollowUpCursor | null
}

export interface AnalyticsReadRepository {
  loadPerson(organizationId: string, personId: string): Promise<PersonNode | null>
  /** Todos os descendentes (ativos ou não) da pessoa, em qualquer profundidade — sem a própria. */
  loadDescendants(organizationId: string, anchorId: string): Promise<PersonNode[]>
  /**
   * V1.5.8 — onde a CONTA tem a permissão (atribuições ativas de papéis): organização inteira ou Grupos/Subgrupos. Nunca o
   * cargo/nível hierárquico. Vazio = só a visão operacional da própria estrutura (reports_to).
   */
  loadAccessVisibility(organizationId: string, accountId: string, permission: Permission): Promise<VisibilityFilter>
  /** Pessoas (ativas ou não) cobertas por uma visibilidade de acesso: organização inteira, Grupo (inclui seus Subgrupos) ou Subgrupo. */
  loadPeopleInVisibility(organizationId: string, visibility: VisibilityFilter): Promise<PersonNode[]>
  /** Subordinados DIRETOS (ativos ou não) de uma pessoa — usado pela Estrutura quando a focal é um
   * ANCESTRAL do viewer (fora da subárvore carregada): uma consulta, nunca a subárvore inteira. */
  loadDirectReports(organizationId: string, personId: string): Promise<PersonNode[]>
  /** Quantos subordinados diretos ATIVOS cada pessoa tem — em lote (uma consulta para N pessoas). */
  countActiveDirectReports(organizationId: string, personIds: string[]): Promise<Map<string, number>>
  loadIndicatorDefinitions(organizationId: string): Promise<IndicatorDefinitionRow[]>
  loadIndicatorPerformance(organizationId: string, personIds: string[], periods: string[]): Promise<IndicatorPerformanceRow[]>
  loadPrvPerformance(organizationId: string, personIds: string[], periods: string[]): Promise<PrvPerformanceRow[]>
  /** Competências com dado oficial no escopo, limitadas ao último fechamento possível (guard central). */
  loadAvailablePeriods(organizationId: string, personIds: string[], lastClosedPeriod: string): Promise<string[]>
  /** Quantas pessoas distintas têm alguma linha oficial em cada competência (mais recente primeiro, até `limit`) — cobertura do fechamento. */
  loadPeriodCoverage(organizationId: string, personIds: string[], lastClosedPeriod: string, limit: number): Promise<{ period: string; people: number }[]>
  loadFollowUpCounts(personIds: string[]): Promise<Map<string, FollowUpCounts>>
  /** Revisões humanas que AINDA exigem decisão do viewer, por operador — mesma definição de
   * "pendente" do módulo pending-actions (execução em espera no node), nunca o alerta solto. */
  loadPendingReviewCounts(organizationId: string, viewerId: string, personIds: string[]): Promise<Map<string, number>>
  /** Total de pendências acionáveis do viewer — decide se a aba Pendências aparece para quem
   * normalmente não a tem (Operador). */
  countPendingActions(organizationId: string, viewerId: string): Promise<number>
  loadPersistedIndicatorInsights(personId: string, indicatorNames: string[]): Promise<PersistedInsight[]>
  loadFollowUpFeed(query: FollowUpFeedQuery): Promise<FollowUpFeed>
  /** Acompanhamento operacional (camada 1, resolvedor único de medições) de um colaborador, por indicador diário. */
  loadEmployeeOperationalTrends(organizationId: string, personId: string, now: Date, comparison: OperationalComparison, relevantCodes?: string[]): Promise<Map<string, OperationalTrendView>>
  /** Resumo operacional pooled de uma estrutura (membros), por indicador diário. */
  loadStructureOperationalSummary(organizationId: string, personIds: string[], now: Date, comparison: OperationalComparison): Promise<OperationalStructureSummary | null>
  /** Situação funcional atual (people.current_employment_status + período vigente). */
  loadEmploymentStatus(organizationId: string, personId: string, now: Date): Promise<EmploymentStatusView>
  /** Versões da organização que invalidam os caches da camada oficial (migration 128); ausente/null = sem cache. */
  loadCacheVersions?(organizationId: string): Promise<AnalyticsVersions | null>
}


const toNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

export type PgAnalyticsReadRepositoryOptions = {
  /**
   * De onde vêm as pessoas (escopo, organograma, Equipe): `graph` (padrão) = grafo da organização em memória, invalidado
   * pela versão STRUCTURE (infrastructure/organization-people-graph.ts); `sql` = as consultas originais, uma por leitura —
   * a REFERÊNCIA que a prova de igualdade compara com o grafo.
   */
  peopleSource?: "graph" | "sql"
  peopleGraphCache?: OrganizationPeopleGraphCache
  /**
   * Resumo operacional da estrutura: `read-model` (padrão) = infrastructure/operational-read-model.ts com cache curto;
   * `raw` = o caminho original, consultas por indicador — a referência da prova.
   */
  operationalSource?: "read-model" | "raw"
  operationalSummaryCache?: AnalyticsCache<OperationalStructureSummary | null>
  /** `false` desliga o cache da camada oficial (official-analytics-cache.ts) — a referência da prova. */
  officialCache?: boolean
}

/** Um cache por processo do resumo operacional da estrutura (60 s, 200 estruturas). */
export const operationalSummaryCache = new AnalyticsCache<OperationalStructureSummary | null>(200, 60_000)

export class PgAnalyticsReadRepository implements AnalyticsReadRepository {
  private readonly pendingActions: PgPendingActionsRepository
  private readonly peopleSource: "graph" | "sql"
  private readonly peopleGraphCache: OrganizationPeopleGraphCache
  private readonly operationalSource: "read-model" | "raw"
  private readonly operationalSummaryCache: AnalyticsCache<OperationalStructureSummary | null>
  private readonly officialCache: boolean
  constructor(
    private readonly db: Database,
    options: PgAnalyticsReadRepositoryOptions = {},
  ) {
    this.pendingActions = new PgPendingActionsRepository(db)
    this.peopleSource = options.peopleSource ?? "graph"
    this.peopleGraphCache = options.peopleGraphCache ?? organizationPeopleGraphCache
    this.operationalSource = options.operationalSource ?? "read-model"
    this.operationalSummaryCache = options.operationalSummaryCache ?? operationalSummaryCache
    this.officialCache = options.officialCache ?? true
  }

  async loadCacheVersions(organizationId: string): Promise<AnalyticsVersions | null> {
    return this.officialCache ? loadAnalyticsVersions(this.db, organizationId) : null
  }

  private graph(organizationId: string) {
    return this.peopleGraphCache.get(this.db, organizationId)
  }

  async loadPerson(organizationId: string, personId: string): Promise<PersonNode | null> {
    if (this.peopleSource === "graph") return (await this.graph(organizationId)).byId.get(personId) ?? null
    const result = await this.db.query<PersonNode>(`select ${PERSON_NODE_SELECT} from people p ${PERSON_NODE_JOINS} where p.organization_id = $1 and p.id = $2`, [organizationId, personId])
    return result.rows[0] ?? null
  }

  async loadDescendants(organizationId: string, anchorId: string): Promise<PersonNode[]> {
    if (this.peopleSource === "graph") return descendantsOf(await this.graph(organizationId), anchorId)
    const result = await this.db.query<PersonNode>(
      // `union` (não `union all`): a CTE recursiva só segue para ids ainda não vistos, então um
      // ciclo em reports_to_id (A → B → A, ou A → A) termina em vez de travar o request — a
      // mesma defesa do leitor de hierarquia do Workflow Engine. Para dados válidos (árvore) o
      // resultado é idêntico: nenhum id se repete.
      `with recursive subordinates as (
         select id from people where organization_id = $1 and reports_to_id = $2
         union
         select p.id from people p join subordinates s on p.reports_to_id = s.id
       )
       select ${PERSON_NODE_SELECT} from people p ${PERSON_NODE_JOINS} where p.id in (select id from subordinates) order by p.name, p.id`,
      [organizationId, anchorId],
    )
    return result.rows
  }

  async loadAccessVisibility(organizationId: string, accountId: string, permission: Permission): Promise<VisibilityFilter> {
    return visibilityOf(await createPostgresAccessRepository(this.db).loadContext(organizationId, accountId), permission)
  }

  async loadPeopleInVisibility(organizationId: string, visibility: VisibilityFilter): Promise<PersonNode[]> {
    if (!visibility.organizationWide && visibility.teamIds.length === 0 && visibility.subteamIds.length === 0) return []
    if (this.peopleSource === "graph") {
      const graph = await this.graph(organizationId)
      return graph.people.filter((person) => visibility.organizationWide || (person.teamId !== null && visibility.teamIds.includes(person.teamId)) || (person.subteamId !== null && visibility.subteamIds.includes(person.subteamId)))
    }
    const result = await this.db.query<PersonNode>(
      `select ${PERSON_NODE_SELECT} from people p ${PERSON_NODE_JOINS}
       where p.organization_id = $1 and ($2::boolean or p.team_id = any($3::uuid[]) or p.subteam_id = any($4::uuid[]))
       order by p.name, p.id`,
      [organizationId, visibility.organizationWide, visibility.teamIds, visibility.subteamIds],
    )
    return result.rows
  }

  async loadDirectReports(organizationId: string, personId: string): Promise<PersonNode[]> {
    if (this.peopleSource === "graph") return [...((await this.graph(organizationId)).childrenOf.get(personId) ?? [])]
    const result = await this.db.query<PersonNode>(`select ${PERSON_NODE_SELECT} from people p ${PERSON_NODE_JOINS} where p.organization_id = $1 and p.reports_to_id = $2 order by p.name, p.id`, [organizationId, personId])
    return result.rows
  }

  async countActiveDirectReports(organizationId: string, personIds: string[]): Promise<Map<string, number>> {
    if (personIds.length === 0) return new Map()
    if (this.peopleSource === "graph") {
      const graph = await this.graph(organizationId)
      const counts = new Map<string, number>()
      for (const personId of new Set(personIds)) {
        const total = (graph.childrenOf.get(personId) ?? []).filter((child) => child.active).length
        if (total > 0) counts.set(personId, total)
      }
      return counts
    }
    const result = await this.db.query<{ managerId: string; total: string }>(
      `select reports_to_id "managerId", count(*)::text total from people where organization_id = $1 and active and reports_to_id = any($2::uuid[]) group by reports_to_id`,
      [organizationId, personIds],
    )
    return new Map(result.rows.map((row) => [row.managerId, Number(row.total)]))
  }

  async loadIndicatorDefinitions(organizationId: string): Promise<IndicatorDefinitionRow[]> {
    const result = await this.db.query<IndicatorDefinitionRow>(
      `select id, code, name, unit, desired_direction direction,
              json_build_object('operationalEnabled', daily_supported, 'operationalAggregation', operational_aggregation, 'officialClosureSupported', official_closure_supported) capabilities
         from indicator_definitions where organization_id = $1 and active order by name`,
      [organizationId],
    )
    return result.rows
  }

  async loadIndicatorPerformance(organizationId: string, personIds: string[], periods: string[]): Promise<IndicatorPerformanceRow[]> {
    if (personIds.length === 0 || periods.length === 0) return []
    const result = await this.db.query<Record<string, unknown>>(
      `select eip.person_id "personId", idef.code "indicatorCode", eip.reference_period "referencePeriod", eip.value, eip.target_value "targetValue",
              eip.achievement_percent "achievementPercent", eip.weight_percent "weightPercent", eip.quartile, eip.numerator, eip.denominator, eip.source
       from employee_indicator_performance eip
       join indicator_definitions idef on idef.id = eip.indicator_definition_id
       where eip.organization_id = $1 and eip.person_id = any($2::uuid[]) and eip.reference_period = any($3::text[])`,
      [organizationId, personIds, periods],
    )
    return result.rows.map((row) => ({
      personId: String(row.personId),
      indicatorCode: String(row.indicatorCode),
      referencePeriod: String(row.referencePeriod),
      value: Number(row.value),
      targetValue: toNumber(row.targetValue),
      achievementPercent: toNumber(row.achievementPercent),
      weightPercent: toNumber(row.weightPercent),
      quartile: row.quartile ? quartileSchema.parse(row.quartile) : null,
      numerator: toNumber(row.numerator),
      denominator: toNumber(row.denominator),
      source: String(row.source),
    }))
  }

  async loadPrvPerformance(organizationId: string, personIds: string[], periods: string[]): Promise<PrvPerformanceRow[]> {
    if (personIds.length === 0 || periods.length === 0) return []
    const result = await this.db.query<Record<string, unknown>>(
      `select person_id "personId", reference_period "referencePeriod", achievement_percent "achievementPercent", quartile, source
       from employee_prv_performance
       where organization_id = $1 and person_id = any($2::uuid[]) and reference_period = any($3::text[])`,
      [organizationId, personIds, periods],
    )
    return result.rows.map((row) => ({
      personId: String(row.personId),
      referencePeriod: String(row.referencePeriod),
      achievementPercent: Number(row.achievementPercent),
      quartile: quartileSchema.parse(row.quartile),
      source: String(row.source),
    }))
  }

  async loadAvailablePeriods(organizationId: string, personIds: string[], lastClosedPeriod: string): Promise<string[]> {
    if (personIds.length === 0) return []
    const result = await this.db.query<{ period: string }>(
      `select distinct reference_period period from (
         select reference_period from employee_indicator_performance where organization_id = $1 and person_id = any($2::uuid[]) and reference_period <= $3
         union all
         select reference_period from employee_prv_performance where organization_id = $1 and person_id = any($2::uuid[]) and reference_period <= $3
       ) periods order by period desc`,
      [organizationId, personIds, lastClosedPeriod],
    )
    return result.rows.map((row) => row.period)
  }

  async loadPeriodCoverage(organizationId: string, personIds: string[], lastClosedPeriod: string, limit: number): Promise<{ period: string; people: number }[]> {
    if (personIds.length === 0) return []
    const result = await this.db.query<{ period: string; people: string }>(
      `select reference_period period, count(distinct person_id) people from (
         select reference_period, person_id from employee_indicator_performance where organization_id = $1 and person_id = any($2::uuid[]) and reference_period <= $3
         union all
         select reference_period, person_id from employee_prv_performance where organization_id = $1 and person_id = any($2::uuid[]) and reference_period <= $3
       ) rows group by reference_period order by reference_period desc limit $4`,
      [organizationId, personIds, lastClosedPeriod, limit],
    )
    return result.rows.map((row) => ({ period: row.period, people: Number(row.people) }))
  }

  async loadFollowUpCounts(personIds: string[]): Promise<Map<string, FollowUpCounts>> {
    const counts = new Map<string, FollowUpCounts>()
    if (personIds.length === 0) return counts
    const result = await this.db.query<{ operator_id: string; total: string; unacknowledged: string }>(
      `select operator_id, count(*)::int total, count(*) filter (where acknowledged_at is null)::int unacknowledged
       from feedbacks f where f.status = 'PUBLISHED' and f.operator_id = any($1::uuid[]) and ${visibleInFollowUpSql("f")} group by operator_id`,
      [personIds],
    )
    for (const row of result.rows) counts.set(row.operator_id, { total: Number(row.total), unacknowledged: Number(row.unacknowledged) })
    return counts
  }

  async loadPendingReviewCounts(organizationId: string, viewerId: string, personIds: string[]): Promise<Map<string, number>> {
    return this.pendingActions.countPendingByOperator(viewerId, organizationId, personIds)
  }

  async countPendingActions(organizationId: string, viewerId: string): Promise<number> {
    return this.pendingActions.countPending(viewerId, organizationId)
  }

  async loadPersistedIndicatorInsights(personId: string, indicatorNames: string[]): Promise<PersistedInsight[]> {
    if (indicatorNames.length === 0) return []
    const result = await this.db.query<{ id: string; impacted_indicator: string; observed_behavior: string; recommendation: string; published_at: string | null; created_at: string }>(
      `select id, impacted_indicator, observed_behavior, recommendation, published_at, created_at
       from feedbacks f
       where f.operator_id = $1 and f.feedback_kind = 'INDICATOR' and f.status = 'PUBLISHED' and f.impacted_indicator = any($2::text[]) and ${visibleInFollowUpSql("f")}
       order by coalesce(published_at, created_at) desc`,
      [personId, indicatorNames],
    )
    return result.rows.map((row) => ({
      id: row.id,
      indicatorName: row.impacted_indicator,
      summary: row.observed_behavior,
      recommendation: row.recommendation,
      publishedAt: String(row.published_at ?? row.created_at),
      source: "FEEDBACK",
    }))
  }

  async loadEmployeeOperationalTrends(organizationId: string, personId: string, now: Date, comparison: OperationalComparison, relevantCodes?: string[]): Promise<Map<string, OperationalTrendView>> {
    const timeZone = await resolveOrganizationTimezone(this.db, organizationId)
    return buildEmployeeOperationalTrends(this.db, { organizationId, personIds: [personId], personId, now, timeZone, comparison, relevantCodes })
  }

  async loadStructureOperationalSummary(organizationId: string, personIds: string[], now: Date, comparison: OperationalComparison): Promise<OperationalStructureSummary | null> {
    const timeZone = await resolveOrganizationTimezone(this.db, organizationId)
    const input = { organizationId, personIds, now, timeZone, comparison }
    if (this.operationalSource === "raw") return buildStructureOperationalSummary(this.db, input, { source: "raw" })
    // Cache curto: a chave leva a geração do read model e a última marca pendente da organização — qualquer escrita que
    // mude o cálculo muda a chave. Só entra no cache o que veio inteiro do read model, e só até a primeira medição futura.
    const state = await this.db.query<{ generation: string | null; dirty: string | null }>(
      `select (select generation::text from analytics_rollup_state where organization_id = $1) generation, (select max(id)::text from analytics_operational_dirty where organization_id = $1) dirty`,
      [organizationId],
    )
    const key = JSON.stringify([organizationId, comparison, localDateOf(now, timeZone), state.rows[0]?.generation ?? null, state.rows[0]?.dirty ?? null, membersFingerprint(personIds)])
    let observation: StructureSummaryObservation | null = null
    return this.operationalSummaryCache.getOrCompute(
      key,
      () => buildStructureOperationalSummary(this.db, input, { source: "read-model", observe: (value) => (observation = value) }),
      () => (observation?.source === "read-model" && observation.liveMembers === 0 ? (observation.validUntilMs ?? Number.POSITIVE_INFINITY) : false),
    )
  }

  async loadEmploymentStatus(organizationId: string, personId: string, now: Date): Promise<EmploymentStatusView> {
    const timeZone = await resolveOrganizationTimezone(this.db, organizationId)
    const today = localDateOf(now, timeZone)
    // Resposta TEMPORAL canônica (períodos + base), não a coluna denormalizada; a confiança vem da
    // metadata da Central (feeds de situação funcional) — nunca de um terceiro cálculo.
    const [resolved, freshness, history, schedule, capitalRow] = await Promise.all([
      resolveEmployeeStatusAt(this.db, personId, today),
      resolveEmploymentStatusFreshness(this.db, organizationId, now, timeZone),
      loadEmploymentStatusHistory(this.db, personId),
      loadWorkScheduleSummary(this.db, organizationId, personId, today, now, timeZone),
      this.db.query<{ operational_capital_code: string | null }>(`select operational_capital_code from people where id = $1`, [personId]),
    ])
    const capital = findBrazilianCapital(capitalRow.rows[0]?.operational_capital_code)
    const period = resolved.period
    const consideredFeed = freshness.feeds.find((feed) => freshness.consideredFeedIds.includes(feed.feedId)) ?? null
    return {
      status: resolved.status,
      label: EMPLOYMENT_STATUS_LABELS[resolved.status],
      since: period?.effectiveFrom ?? null,
      sinceInferred: period?.effectiveFromInferred ?? false,
      until: period?.effectiveTo ?? null,
      source: period?.source ?? null,
      basis: resolved.basis,
      basisLabel: STATUS_BASIS_LABELS[resolved.basis],
      periodId: period?.id ?? null,
      origin: describeStatusSource(freshness, period?.source ?? null),
      freshness: { state: freshness.state, lastSuccessAt: freshness.lastSuccessAt, cadenceLabel: consideredFeed?.cadenceLabel ?? null, sourceName: consideredFeed?.sourceName ?? null, feedName: consideredFeed?.feedName ?? null },
      history: [...history].reverse().slice(0, 12).map((entry) => ({ periodId: entry.id, status: entry.status, label: EMPLOYMENT_STATUS_LABELS[entry.status], from: entry.effectiveFrom, to: entry.effectiveTo, fromInferred: entry.effectiveFromInferred, source: entry.source, rawStatus: entry.rawStatus })),
      schedule: {
        scheduleType: schedule.scheduleType,
        scheduleTypeLabel: schedule.scheduleTypeLabel,
        basis: schedule.basis,
        basisLabel: schedule.basisLabel,
        nextDayOff: schedule.nextDayOff,
        knownDaysAhead: schedule.knownDaysAhead,
        freshness: schedule.freshness,
        origin: schedule.origin,
        knownUntil: schedule.knownUntil,
        upcomingExceptions: schedule.upcomingExceptions,
        todayException: schedule.todayException,
      },
      operationalCapital: capital ? { code: capital.code, name: capital.name, stateCode: capital.stateCode, label: `${capital.name} / ${capital.stateCode}` } : null,
    }
  }

  async loadFollowUpFeed(query: FollowUpFeedQuery): Promise<FollowUpFeed> {
    // Feedbacks publicados (pro operador) e alertas endereçados ao viewer viram um único feed
    // ordenado por data — sem tabela nova, sem duplicar armazenamento: cada item aponta pra sua
    // linha de origem. A página é escolhida só por (tipo, id, instante) — pelo índice parcial
    // `idx_feedbacks_operator_feed` (migration 130) — e o conteúdo (view, JSON do feedback) é
    // montado DEPOIS do LIMIT, só para os itens da página. Paginada por keyset, como o
    // Acompanhamento do colaborador: o cursor (instante, id) do último item filtra os dois ramos
    // ANTES da ordenação e `limit + 1` diz se há página seguinte — sem `count(*)` sobre o
    // histórico da estrutura e sem OFFSET, que crescia com a profundidade da página. O item
    // extra só conta (`hasMore`): o conteúdo é montado para os `limit` exibidos.
    const params: unknown[] = [query.organizationId, query.operatorIds, query.includeViewerAlerts && !query.unacknowledgedOnly, query.viewerId, query.limit, query.unacknowledgedOnly]
    const before = query.before ? (params.push(query.before.at, query.before.id), { feedback: `and (coalesce(f.published_at, f.created_at), f.id) < ($7::timestamptz, $8::uuid)`, alert: `and (a.created_at, a.id) < ($7::timestamptz, $8::uuid)`, report: `and (r.created_at, r.delivery_id) < ($7::timestamptz, $8::uuid)` }) : { feedback: "", alert: "", report: "" }
    const result = await this.db.query<Record<string, unknown>>(
      `with feed as (
         select f.id, 'FEEDBACK' kind, coalesce(f.published_at, f.created_at) "createdAt"
         from feedbacks f
         where f.organization_id = $1 and f.status = 'PUBLISHED' and f.operator_id = any($2::uuid[])
           and (not $6::boolean or f.acknowledged_at is null)
           and ${visibleInFollowUpSql("f")} ${before.feedback}
         union all
         select a.id, 'ALERT', a.created_at
         from alerts a
         where $3::boolean and a.organization_id = $1 and a.recipient_id = $4
           -- Intervenção: resolver a PENDÊNCIA (aceitar, aprovar) não apaga o registro do Acompanhamento — o aviso continua
           -- como histórico com o link para o caso. Os demais avisos saem do feed quando resolvidos.
           and (a.status in ('OPEN', 'SEEN', 'ACKNOWLEDGED') or (a.status = 'RESOLVED' and left(a.alert_type, 13) = 'INTERVENTION_'))
           and not ${recadoAlertCoveredByFollowUpSql("a")} ${before.alert}
         union all
         -- Reports recorrentes: entregas e avisos de "não encaminhado" endereçados a QUEM LÊ (cada um com a versão do escopo dele).
         select r.delivery_id, 'REPORT', r.created_at
         from report_delivery_recipients r
         where $3::boolean and r.organization_id = $1 and r.recipient_person_id = $4 ${before.report}
       ), probe as (
         select id, kind, "createdAt" from feed order by "createdAt" desc, id desc limit $5 + 1
       ), page as (
         select id, kind, "createdAt" from probe order by "createdAt" desc, id desc limit $5
       )
       select page.id::text id, page.kind, page."createdAt", ${followUpCursorAtSql('page."createdAt"')} "cursorAt", (select count(*) from probe) > $5 "hasMore",
              case when page.kind = 'REPORT' then case when rd.kind = 'DELIVERY' then 'REPORT' else 'REPORT_NOT_FORWARDED' end else coalesce(f.feedback_kind::text, a.alert_type) end category,
              case when page.kind = 'FEEDBACK' then coalesce(f.context_snapshot#>>'{feedbackEngine,feedbackView,heading,title}', f.context_snapshot#>>'{reliableFeedback,feedbackView,heading,title}', f.impacted_indicator) when page.kind = 'REPORT' then rp.name else a.title end title,
              case when page.kind = 'FEEDBACK' then coalesce(f.context_snapshot#>>'{feedbackEngine,feedbackView,heading,subtitle}', f.context_snapshot#>>'{reliableFeedback,feedbackView,heading,subtitle}') when page.kind = 'REPORT' then concat_ws(' · ', rd.structure_label, rd.period_label) end subtitle,
              case when page.kind = 'FEEDBACK' then coalesce(f.context_snapshot#>>'{feedbackEngine,feedbackView,card}', f.context_snapshot#>>'{reliableFeedback,feedbackView,card}', f.observed_behavior) when page.kind = 'REPORT' then coalesce(rd.analysis_text, '') else a.description end summary,
              f.recommendation detail, a.severity, coalesce(f.operator_id, c.operator_id) "operatorId", p.name "operatorName", coalesce(f.case_id, a.case_id)::text "caseId",
              case when page.kind = 'FEEDBACK' then f.acknowledged_at when page.kind = 'REPORT' then rr.read_at else a.read_at end "acknowledgedAt",
              case when page.kind = 'REPORT' then json_build_object('deliveryId', rd.id, 'reportId', rd.report_id, 'kind', rd.kind, 'reason', rd.reason, 'periodLabel', rd.period_label, 'structureLabel', rd.structure_label, 'sources', rd.sources, 'visualization', rd.visualization, 'dataset', rd.dataset, 'comparison', rd.comparison, 'analysisStatus', rd.analysis_status, 'analysisText', rd.analysis_text, 'empty', rd.empty, 'occurrences', rd.occurrences, 'lastCheckedAt', rd.last_checked_at, 'reportActive', rp.deleted_at is null and rp.status = 'ACTIVE') end report,
              case when page.kind = 'FEEDBACK' then json_build_object('evidenceFound', f.evidence_found, 'observedBehavior', f.observed_behavior, 'relatedProcedure', f.related_procedure, 'recommendation', f.recommendation, 'view', coalesce(f.context_snapshot->'feedbackEngine'->'feedbackView', f.context_snapshot->'reliableFeedback'->'feedbackView'), 'supervisorView', case when f.operator_id <> $4 then f.context_snapshot->'reliableFeedback'->'supervisorView' end) end feedback
       from page
       left join feedbacks f on page.kind = 'FEEDBACK' and f.id = page.id
       left join alerts a on page.kind = 'ALERT' and a.id = page.id
       left join report_deliveries rd on page.kind = 'REPORT' and rd.id = page.id
       left join reports rp on rp.id = rd.report_id
       left join report_delivery_recipients rr on page.kind = 'REPORT' and rr.delivery_id = page.id and rr.recipient_person_id = $4
       left join supervision_cases c on c.id = a.case_id
       left join people p on p.id = coalesce(f.operator_id, c.operator_id)
       order by page."createdAt" desc, page.id desc`,
      params,
    )
    const rows = result.rows
    const last = rows.at(-1)
    const nextCursor = last?.hasMore === true ? encodeFollowUpCursor({ at: String(last.cursorAt), id: String(last.id) }) : null
    // Materiais de apoio resolvidos POR VIEWER a cada leitura (feedback-support-materials.ts):
    // fora do alcance/despublicado vira marcador neutro, nunca link — e feedback antigo vem com [].
    const supportMaterials = await loadFeedbackSupportMaterials(this.db, {
      organizationId: query.organizationId,
      viewer: { personId: query.viewerId },
      feedbackIds: rows.filter((row) => row.kind === "FEEDBACK").map((row) => String(row.id)),
    })
    // Feedback por Flag V2 — view model publicado com os links resolvidos para quem lê (null = feedback anterior).
    const views = await resolveFeedbackViewsForViewer(this.db, { organizationId: query.organizationId, viewer: { personId: query.viewerId }, views: rows.map((row) => (row.feedback as { view?: unknown } | null)?.view ?? null) })
    // Feedback de atendimento sem view model: o título gravado era o nome da base/agente — a leitura usa o assunto da interação vinculada.
    const legacyHeadings = await loadLegacyFeedbackHeadings(this.db, { organizationId: query.organizationId, feedbackIds: rows.filter((row) => row.kind === "FEEDBACK").map((row) => String(row.id)) })
    // Motivo do feedback (o mesmo selo e ícone do cabeçalho do Acompanhamento do colaborador), em uma consulta para a página.
    const origins = await loadFeedbackOrigins(this.db, { organizationId: query.organizationId, feedbackIds: rows.filter((row) => row.kind === "FEEDBACK").map((row) => String(row.id)) })
    return {
      nextCursor,
      items: rows.map((row, index) => ({
        id: String(row.id),
        kind: row.kind === "FEEDBACK" ? "FEEDBACK" : row.kind === "REPORT" ? "REPORT" : "ALERT",
        category: normalizeCategory(String(row.category)),
        title: legacyHeadings.get(String(row.id))?.title ?? String(row.title),
        // Cabeçalho do feedback (`FEEDBACK_HEADING_V1`): o MESMO título/subtítulo do Acompanhamento do colaborador.
        subtitle: legacyHeadings.has(String(row.id)) ? legacyHeadings.get(String(row.id))!.subtitle : typeof row.subtitle === "string" ? row.subtitle : null,
        summary: String(row.summary ?? ""),
        detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
        severity: (row.severity as FollowUpItem["severity"]) ?? null,
        operator: row.operatorId ? { personId: String(row.operatorId), name: String(row.operatorName ?? "") } : null,
        caseId: row.caseId === null || row.caseId === undefined ? null : String(row.caseId),
        createdAt: new Date(String(row.createdAt)).toISOString(),
        acknowledgedAt: row.acknowledgedAt ? new Date(String(row.acknowledgedAt)).toISOString() : null,
        origin: row.kind === "FEEDBACK" ? (origins.get(String(row.id)) ?? null) : null,
        feedback: row.feedback ? { ...(row.feedback as NonNullable<FollowUpItem["feedback"]>), view: views[index] ?? null, supportMaterials: supportMaterials.get(String(row.id)) ?? [] } : null,
        ...(row.kind === "REPORT" && row.report ? { report: { ...(row.report as NonNullable<FollowUpItem["report"]>), lastCheckedAt: new Date(String((row.report as { lastCheckedAt: string }).lastCheckedAt)).toISOString() } } : {}),
      })),
    }
  }
}

function normalizeCategory(value: string): FollowUpItem["category"] {
  switch (value) {
    case "INDICATOR":
    case "MONITORING":
    case "WORKFLOW_OUTPUT":
    case "WORKFLOW_HUMAN_REVIEW":
    case "WORKFLOW_ESCALATION":
    case "REPORT":
    case "REPORT_NOT_FORWARDED":
      return value
    default:
      return value.startsWith("INTERVENTION_") ? "INTERVENTION" : "OTHER"
  }
}
