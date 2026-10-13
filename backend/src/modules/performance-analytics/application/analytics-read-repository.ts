import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveFeedbackViewsForViewer } from "../../reliable-feedback/application/feedback-view-access.js"
import { loadLegacyFeedbackHeadings } from "../../feedbacks/infrastructure/legacy-feedback-headings.js"
import { loadFeedbackOrigins } from "../../feedbacks/infrastructure/feedback-origins.js"
import { loadFeedbackSupportMaterials } from "../../feedbacks/application/feedback-support-materials.js"
import { PgPendingActionsRepository } from "../../pending-actions/application/pending-actions-repository.js"
import { quartileSchema, type Quartile } from "../../indicators/domain/employee-performance-schema.js"
import type { IndicatorDirection } from "../../indicators/domain/evaluate-attainment.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import type { EmploymentStatusView, FollowUpItem, OperationalStructureSummary, OperationalTrendView, PersistedInsight } from "../domain/view-models.js"
import { EMPLOYMENT_STATUS_LABELS, STATUS_BASIS_LABELS } from "../../people/domain/employment-status.js"
import { loadEmploymentStatusHistory, resolveEmployeeStatusAt } from "../../people/application/employment-status-service.js"
import { loadWorkScheduleSummary } from "../../people/application/work-schedule-service.js"
import { findBrazilianCapital } from "../../people/domain/brazilian-capitals.js"
import { describeStatusSource, resolveEmploymentStatusFreshness } from "../../people/application/employment-status-freshness.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import type { OperationalComparison } from "../domain/operational-comparison.js"
import { buildEmployeeOperationalTrends, buildStructureOperationalSummary } from "./operational-trend.js"
import type { VisibilityFilter } from "../../access/application/access-repository.js"
import { visibilityOf } from "../../access/application/access-service.js"
import type { Permission } from "../../access/domain/permissions.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"
import { visibleInFollowUpSql } from "../../feedbacks/application/follow-up-visibility.js"
import { recadoAlertCoveredByFollowUpSql } from "../../conversational-delivery/application/recado-follow-up-invite.js"

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
  page: number
  pageSize: number
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
  loadFollowUpCounts(personIds: string[]): Promise<Map<string, FollowUpCounts>>
  /** Revisões humanas que AINDA exigem decisão do viewer, por operador — mesma definição de
   * "pendente" do módulo pending-actions (execução em espera no node), nunca o alerta solto. */
  loadPendingReviewCounts(organizationId: string, viewerId: string, personIds: string[]): Promise<Map<string, number>>
  /** Total de pendências acionáveis do viewer — decide se a aba Pendências aparece para quem
   * normalmente não a tem (Operador). */
  countPendingActions(organizationId: string, viewerId: string): Promise<number>
  loadPersistedIndicatorInsights(personId: string, indicatorNames: string[]): Promise<PersistedInsight[]>
  loadFollowUpFeed(query: FollowUpFeedQuery): Promise<{ items: FollowUpItem[]; total: number }>
  /** Acompanhamento operacional (camada 1, resolvedor único de medições) de um colaborador, por indicador diário. */
  loadEmployeeOperationalTrends(organizationId: string, personId: string, now: Date, comparison: OperationalComparison, relevantCodes?: string[]): Promise<Map<string, OperationalTrendView>>
  /** Resumo operacional pooled de uma estrutura (membros), por indicador diário. */
  loadStructureOperationalSummary(organizationId: string, personIds: string[], now: Date, comparison: OperationalComparison): Promise<OperationalStructureSummary | null>
  /** Situação funcional atual (people.current_employment_status + período vigente). */
  loadEmploymentStatus(organizationId: string, personId: string, now: Date): Promise<EmploymentStatusView>
}

const PERSON_SELECT = `p.id, p.name, p.role, p.reports_to_id "reportsToId", p.team_id "teamId", t.name "teamName",
       p.subteam_id "subteamId", st.name "subteamName", p.avatar_url "avatarUrl", p.job_title "jobTitle", p.operational_capital_code "operationalCapitalCode", p.active`
const PERSON_JOINS = `left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id`

const toNumber = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))

export class PgAnalyticsReadRepository implements AnalyticsReadRepository {
  private readonly pendingActions: PgPendingActionsRepository
  constructor(private readonly db: Database) {
    this.pendingActions = new PgPendingActionsRepository(db)
  }

  async loadPerson(organizationId: string, personId: string): Promise<PersonNode | null> {
    const result = await this.db.query<PersonNode>(`select ${PERSON_SELECT} from people p ${PERSON_JOINS} where p.organization_id = $1 and p.id = $2`, [organizationId, personId])
    return result.rows[0] ?? null
  }

  async loadDescendants(organizationId: string, anchorId: string): Promise<PersonNode[]> {
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
       select ${PERSON_SELECT} from people p ${PERSON_JOINS} where p.id in (select id from subordinates) order by p.name`,
      [organizationId, anchorId],
    )
    return result.rows
  }

  async loadAccessVisibility(organizationId: string, accountId: string, permission: Permission): Promise<VisibilityFilter> {
    return visibilityOf(await createPostgresAccessRepository(this.db).loadContext(organizationId, accountId), permission)
  }

  async loadPeopleInVisibility(organizationId: string, visibility: VisibilityFilter): Promise<PersonNode[]> {
    if (!visibility.organizationWide && visibility.teamIds.length === 0 && visibility.subteamIds.length === 0) return []
    const result = await this.db.query<PersonNode>(
      `select ${PERSON_SELECT} from people p ${PERSON_JOINS}
       where p.organization_id = $1 and ($2::boolean or p.team_id = any($3::uuid[]) or p.subteam_id = any($4::uuid[]))
       order by p.name`,
      [organizationId, visibility.organizationWide, visibility.teamIds, visibility.subteamIds],
    )
    return result.rows
  }

  async loadDirectReports(organizationId: string, personId: string): Promise<PersonNode[]> {
    const result = await this.db.query<PersonNode>(`select ${PERSON_SELECT} from people p ${PERSON_JOINS} where p.organization_id = $1 and p.reports_to_id = $2 order by p.name`, [organizationId, personId])
    return result.rows
  }

  async countActiveDirectReports(organizationId: string, personIds: string[]): Promise<Map<string, number>> {
    if (personIds.length === 0) return new Map()
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
              eip.achievement_percent "achievementPercent", eip.weight_percent "weightPercent", eip.quartile, eip.source
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
    return buildStructureOperationalSummary(this.db, { organizationId, personIds, now, timeZone, comparison })
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

  async loadFollowUpFeed(query: FollowUpFeedQuery): Promise<{ items: FollowUpItem[]; total: number }> {
    const offset = (query.page - 1) * query.pageSize
    // Feedbacks publicados (pro operador) e alertas endereçados ao viewer viram um único feed
    // ordenado por data — sem tabela nova, sem duplicar armazenamento: cada item aponta pra sua
    // linha de origem.
    const result = await this.db.query<Record<string, unknown>>(
      `with feed as (
         select f.id::text id, 'FEEDBACK' kind, f.feedback_kind::text category,
                coalesce(f.context_snapshot#>>'{feedbackEngine,feedbackView,heading,title}', f.context_snapshot#>>'{reliableFeedback,feedbackView,heading,title}', f.impacted_indicator) title,
                coalesce(f.context_snapshot#>>'{feedbackEngine,feedbackView,heading,subtitle}', f.context_snapshot#>>'{reliableFeedback,feedbackView,heading,subtitle}') subtitle,
                coalesce(f.context_snapshot#>>'{feedbackEngine,feedbackView,card}', f.context_snapshot#>>'{reliableFeedback,feedbackView,card}', f.observed_behavior) summary,
                f.recommendation detail, null::text severity, f.operator_id "operatorId", p.name "operatorName", f.case_id::text "caseId",
                coalesce(f.published_at, f.created_at) "createdAt", f.acknowledged_at "acknowledgedAt",
                json_build_object('evidenceFound', f.evidence_found, 'observedBehavior', f.observed_behavior, 'relatedProcedure', f.related_procedure, 'recommendation', f.recommendation, 'view', coalesce(f.context_snapshot->'feedbackEngine'->'feedbackView', f.context_snapshot->'reliableFeedback'->'feedbackView'), 'supervisorView', case when f.operator_id <> $4 then f.context_snapshot->'reliableFeedback'->'supervisorView' end) feedback
         from feedbacks f join people p on p.id = f.operator_id
         where f.organization_id = $1 and f.status = 'PUBLISHED' and f.operator_id = any($2::uuid[])
           and (not $7::boolean or f.acknowledged_at is null)
           and ${visibleInFollowUpSql("f")}
         union all
         select a.id::text, 'ALERT', a.alert_type, a.title, null::text, a.description, null, a.severity, c.operator_id, p.name, a.case_id::text,
                a.created_at, a.read_at, null
         from alerts a left join supervision_cases c on c.id = a.case_id left join people p on p.id = c.operator_id
         where $3::boolean and a.organization_id = $1 and a.recipient_id = $4 and a.status in ('OPEN', 'SEEN', 'ACKNOWLEDGED')
           and not ${recadoAlertCoveredByFollowUpSql("a")}
       )
       select *, count(*) over()::int total from feed order by "createdAt" desc limit $5 offset $6`,
      [query.organizationId, query.operatorIds, query.includeViewerAlerts && !query.unacknowledgedOnly, query.viewerId, query.pageSize, offset, query.unacknowledgedOnly],
    )
    const total = result.rows[0] ? Number(result.rows[0].total) : 0
    // Materiais de apoio resolvidos POR VIEWER a cada leitura (feedback-support-materials.ts):
    // fora do alcance/despublicado vira marcador neutro, nunca link — e feedback antigo vem com [].
    const supportMaterials = await loadFeedbackSupportMaterials(this.db, {
      organizationId: query.organizationId,
      viewer: { personId: query.viewerId },
      feedbackIds: result.rows.filter((row) => row.kind === "FEEDBACK").map((row) => String(row.id)),
    })
    // Feedback por Flag V2 — view model publicado com os links resolvidos para quem lê (null = feedback anterior).
    const views = await resolveFeedbackViewsForViewer(this.db, { organizationId: query.organizationId, viewer: { personId: query.viewerId }, views: result.rows.map((row) => (row.feedback as { view?: unknown } | null)?.view ?? null) })
    // Feedback de atendimento sem view model: o título gravado era o nome da base/agente — a leitura usa o assunto da interação vinculada.
    const legacyHeadings = await loadLegacyFeedbackHeadings(this.db, { organizationId: query.organizationId, feedbackIds: result.rows.filter((row) => row.kind === "FEEDBACK").map((row) => String(row.id)) })
    // Motivo do feedback (o mesmo selo e ícone do cabeçalho do Acompanhamento do colaborador), em uma consulta para a página.
    const origins = await loadFeedbackOrigins(this.db, { organizationId: query.organizationId, feedbackIds: result.rows.filter((row) => row.kind === "FEEDBACK").map((row) => String(row.id)) })
    return {
      total,
      items: result.rows.map((row, index) => ({
        id: String(row.id),
        kind: row.kind === "FEEDBACK" ? "FEEDBACK" : "ALERT",
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
      return value
    default:
      return "OTHER"
  }
}
