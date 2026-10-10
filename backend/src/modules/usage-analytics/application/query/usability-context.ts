import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { canAnywhere, canOrganizationWide, scopesWithPermission, type AccessContext } from "../../../access/domain/access-decision.js"
import { scopeCovers, type AccessScope } from "../../../access/domain/access-scope.js"
import { scopedPeopleSql } from "../../../access/application/scope-people-reader.js"
import { descendantsSql, populationSql } from "../../../people/application/usage-analytics-reader.js"
import { USABILITY_DEFINITIONS_VERSION } from "../../domain/metric-dictionary.js"
import { coverageOf, type Coverage } from "../../domain/metric-value.js"
import { ADMIN_AREAS } from "../../domain/usage-screens.js"
import { comparisonPeriodOf, describePeriod, PeriodError, resolvePeriod, type ComparisonPeriod, type ResolvedPeriod } from "../../domain/usage-time.js"
import { loadUsageSettings, type UsageSettings } from "../usage-settings.js"
import { describeAppliedFilters, parseUsabilityFilters, type UsabilityFilters, type UsabilityTab } from "./usability-filters.js"

/**
 * CONTEXTO de uma consulta da monitoria: quem pergunta (permissões efetivas lidas a cada request), o recorte temporal
 * resolvido no fuso da organização, os filtros validados para a aba e os fragmentos SQL que aplicam o ESCOPO antes de
 * qualquer total, ranking, lista de opções ou exportação.
 */
type Queryable = Pick<Database, "query">

export type UsabilityContext = {
  tab: UsabilityTab
  organizationId: string
  viewerPersonId: string
  viewerAccountId: string
  can: { view: boolean; people: boolean; export: boolean; comments: boolean; manage: boolean; organizationWide: boolean; readConversations: boolean }
  settings: UsageSettings
  now: Date
  period: ResolvedPeriod
  comparison: ComparisonPeriod | null
  filters: UsabilityFilters
}

/**
 * As listas IDENTIFICADAS (pessoas, avaliações, exportação) usam o recorte de `usability.view`; ver nomes exige
 * `usability.users.view`. Se o escopo desta for MENOR (ex.: Leitor na organização + Analista num Subgrupo), as listas
 * mostrariam nomes fora do escopo concedido (achado I-F8) — então só identificam quando `users.view` cobre todo o recorte.
 * O detalhe de uma pessoa (person-query) já aplica o escopo de `users.view` e continua disponível.
 */
export function identifiedScopeCoversView(access: AccessContext): boolean {
  const covers = (outer: AccessScope, inner: AccessScope) => scopeCovers(outer, inner) || (outer.type === "MY_STRUCTURE" && inner.type === "MY_STRUCTURE")
  const identified = scopesWithPermission(access, "usability.users.view")
  return scopesWithPermission(access, "usability.view").every((viewScope) => identified.some((scope) => covers(scope, viewScope)))
}

export async function buildUsabilityContext(db: Queryable, input: { access: AccessContext; personId: string; tab: UsabilityTab; query: Record<string, unknown>; now?: Date }): Promise<UsabilityContext> {
  const now = input.now ?? new Date()
  const filters = parseUsabilityFilters(input.tab, input.query)
  const access = input.access
  const can = {
    view: canAnywhere(access, "usability.view"),
    people: canAnywhere(access, "usability.users.view") && identifiedScopeCoversView(access),
    export: canAnywhere(access, "usability.export"),
    comments: canAnywhere(access, "usability.comments.view"),
    manage: canOrganizationWide(access, "usability.manage"),
    organizationWide: canOrganizationWide(access, "usability.view"),
    readConversations: canAnywhere(access, "assistant_conversations.view"),
  }
  if (!can.view) throw new DomainError("Você não tem permissão para este recurso.", "FORBIDDEN", 403)
  // Filtrar por uma pessoa (ou liderança) revelaria dado individual: só para quem pode ver pessoas identificadas.
  if ((filters.personId || filters.leaderId) && !can.people) throw new DomainError("Filtrar por pessoa exige permissão para ver pessoas identificadas.", "USABILITY_PEOPLE_FORBIDDEN", 403)
  const settings = await loadUsageSettings(db, access.organizationId, now)
  let period: ResolvedPeriod
  try {
    period = resolvePeriod({ preset: filters.period, from: filters.from, to: filters.to }, now, settings.timezone)
  } catch (error) {
    if (error instanceof PeriodError) throw new DomainError(error.message, "USABILITY_PERIOD_INVALID", 400)
    throw error
  }
  return { tab: input.tab, organizationId: access.organizationId, viewerPersonId: input.personId, viewerAccountId: access.accountId, can, settings, now, period, comparison: filters.compare ? comparisonPeriodOf(period) : null, filters }
}

/** Classificações EXCLUÍDAS (padrão: todas; o leitor inclui explicitamente). */
export function excludedClasses(filters: UsabilityFilters): string[] {
  const excluded: string[] = []
  if (!filters.includeTest) excluded.push("TEST", "AUTOMATION")
  if (!filters.includeDemo) excluded.push("DEMO")
  return excluded
}
export const allowedClasses = (filters: UsabilityFilters) => ["REAL", "TEST", "DEMO", "AUTOMATION"].filter((value) => !excludedClasses(filters).includes(value))

/**
 * Pessoas do recorte: ALCANCE do observador (estrutura atual) ∩ filtros de população. `currentStructure` aplica Grupo/Subgrupo
 * pela estrutura ATUAL — usado no modo "estrutura atual" e nas fontes oficiais que não guardam vínculo histórico.
 * Devolve um SELECT de `person_id`.
 */
export function scopePeopleSql(p: SqlParams, ctx: UsabilityContext, options: { currentStructure: boolean }): string {
  const f = ctx.filters
  const clauses: string[] = []
  if (f.personId) clauses.push(`pop.person_id = ${p.typed(f.personId, "uuid")}`)
  if (f.leaderId) clauses.push(`pop.person_id in (${descendantsSql(p, ctx.organizationId, f.leaderId)})`)
  if (options.currentStructure && f.teamId) clauses.push(`pop.team_id = ${p.typed(f.teamId, "uuid")}`)
  if (options.currentStructure && f.subteamId) clauses.push(`pop.subteam_id = ${p.typed(f.subteamId, "uuid")}`)
  if (f.jobTitle) clauses.push(`pop.job_title = ${p.add(f.jobTitle)}`)
  if (f.personStatus === "ACTIVE") clauses.push(`pop.person_active and pop.employment_status in ('EM_PRODUCAO', 'ACTIVE')`)
  if (f.personStatus === "AWAY") clauses.push(`pop.person_active and pop.employment_status not in ('EM_PRODUCAO', 'ACTIVE')`)
  if (f.personStatus === "TERMINATED") clauses.push(`not pop.person_active`)
  if (f.accountStatus === "ENABLED") clauses.push(`pop.account_active is true`)
  if (f.accountStatus === "DISABLED") clauses.push(`pop.account_active is false`)
  if (f.accountStatus === "NONE") clauses.push(`pop.account_id is null`)
  if (f.accessRole) clauses.push(`exists (select 1 from access_role_assignments ra where ra.user_account_id = pop.account_id and ra.revoked_at is null and ra.role_code = ${p.add(f.accessRole)})`)
  const excluded = excludedClasses(f)
  if (excluded.length > 0) clauses.push(`not exists (select 1 from usage_population_classifications uc where uc.organization_id = ${p.typed(ctx.organizationId, "uuid")} and uc.person_id = pop.person_id and uc.removed_at is null and uc.classification = any(${p.typed(excluded, "text[]")}))`)
  const scope = scopedPeopleSql(p, { organizationId: ctx.organizationId, viewerPersonId: ctx.viewerPersonId, permission: "usability.view" })
  // O alcance vem PRIMEIRO e a população é lida pela chave (pessoa): com `pop.person_id in (alcance)` o planejador comparava
  // cada pessoa com a lista inteira (≈ 100 ms com 2 mil pessoas, em toda consulta).
  return `select pop.person_id from (${scope}) sc join (${populationSql(p, ctx.organizationId)}) pop on pop.person_id = sc.person_id where true${clauses.map((clause) => ` and ${clause}`).join("")}`
}

/** Estrutura NO MOMENTO DO FATO (snapshot) — só no modo AT_FACT e só para fatos que guardam o vínculo. */
export function factStructureSql(p: SqlParams, ctx: UsabilityContext, alias: string): string {
  if (ctx.filters.structureMode !== "AT_FACT") return "true"
  const clauses = ["true"]
  if (ctx.filters.teamId) clauses.push(`${alias}.team_id = ${p.typed(ctx.filters.teamId, "uuid")}`)
  if (ctx.filters.subteamId) clauses.push(`${alias}.subteam_id = ${p.typed(ctx.filters.subteamId, "uuid")}`)
  return clauses.join(" and ")
}

export function areaSql(ctx: UsabilityContext, screenColumn: string, areaColumn: string): string {
  const clauses: string[] = []
  if (!ctx.filters.includeAdmin) clauses.push(`coalesce(${areaColumn}, '') not in (${ADMIN_AREAS.map((area) => `'${area}'`).join(", ")})`)
  if (!ctx.filters.includeQa) clauses.push(`coalesce(${screenColumn}, '') not like 'admin.qa_lab%' and coalesce(${screenColumn}, '') <> 'qa_feedbacks'`)
  return clauses.length > 0 ? clauses.join(" and ") : "true"
}

/** Base de estrutura declarada na resposta de cada seção. */
export type StructureBasis = "AT_FACT" | "CURRENT" | "CURRENT_FALLBACK"
export const structureBasisFor = (ctx: UsabilityContext, sourceHasSnapshot: boolean): StructureBasis => (ctx.filters.structureMode === "CURRENT" ? "CURRENT" : sourceHasSnapshot ? "AT_FACT" : "CURRENT_FALLBACK")
export const STRUCTURE_BASIS_LABELS: Record<StructureBasis, string> = {
  AT_FACT: "Estrutura no momento do fato",
  CURRENT: "Estrutura atual (modo escolhido)",
  CURRENT_FALLBACK: "Estrutura atual — esta fonte não guarda o vínculo histórico",
}

// ------------------------------------------------------------------------------------------------ cobertura e atualização

/** Início de cada FONTE OFICIAL = quando a tabela passou a existir (migration aplicada). */
export const OFFICIAL_SOURCE_MIGRATIONS = {
  PUBLISHED_FEEDBACK: "001_initial_schema.sql",
  INTERACTION_FEEDBACK_DELIVERY: "080_interaction_feedback_deliveries.sql",
  RATINGS: "113_feedback_ratings.sql",
  READ_CONFIRMATIONS: "114_feedback_read_confirmations.sql",
  APPLICATIONS: "103_feedback_applications.sql",
  CONVERSATIONS: "094_assistant_conversations.sql",
  WORKFLOWS: "022_workflows.sql",
  MANUAL_RUNS: "100_workflow_manual_runs.sql",
  CONVERSATIONAL_OUTPUTS: "098_workflow_conversational_outputs.sql",
  AI_USAGE_CORRELATION: "084_ai_usage_workflow_correlation.sql",
} as const
export type OfficialSource = keyof typeof OFFICIAL_SOURCE_MIGRATIONS
export const OFFICIAL_SOURCE_LABELS: Record<OfficialSource, string> = {
  PUBLISHED_FEEDBACK: "Feedbacks publicados",
  INTERACTION_FEEDBACK_DELIVERY: "Feedbacks de atendimento entregues",
  RATINGS: "Avaliações de feedback",
  READ_CONFIRMATIONS: "Tentativas de confirmação de ciência",
  APPLICATIONS: "Aplicações de feedback com a INIA",
  CONVERSATIONS: "Conversas com a INIA",
  WORKFLOWS: "Execuções de workflow",
  MANUAL_RUNS: "Execuções manuais",
  CONVERSATIONAL_OUTPUTS: "Entregas de workflow no Chat/Avatar",
  AI_USAGE_CORRELATION: "Uso de IA correlacionado a workflow",
}

export type CoverageState = {
  families: Map<string, { first: Date; last: Date; lastReceived: Date }>
  official: Map<OfficialSource, Date | null>
  eligibilityStart: Date | null
  disabledIntervals: { from: Date; to: Date }[]
}

export async function loadCoverageState(db: Queryable, organizationId: string, now: Date): Promise<CoverageState> {
  const [families, migrations, tracking, toggles] = await Promise.all([
    db.query<{ family: string; first_event_at: Date; last_event_at: Date; last_received_at: Date }>(`select family, first_event_at, last_event_at, last_received_at from usage_coverage where organization_id = $1`, [organizationId]),
    db.query<{ name: string; applied_at: Date }>(`select name, applied_at from schema_migrations where name = any($1::text[])`, [Object.values(OFFICIAL_SOURCE_MIGRATIONS)]),
    db.query<{ started_at: Date }>(`select started_at from usage_eligibility_tracking where organization_id = $1`, [organizationId]),
    db.query<{ enabled: boolean; changed_at: Date }>(`select enabled, changed_at from usage_collection_toggles where organization_id = $1 order by changed_at`, [organizationId]),
  ])
  const applied = new Map(migrations.rows.map((row) => [row.name, row.applied_at]))
  const disabledIntervals: { from: Date; to: Date }[] = []
  let disabledFrom: Date | null = null
  for (const toggle of toggles.rows) {
    if (!toggle.enabled && !disabledFrom) disabledFrom = toggle.changed_at
    if (toggle.enabled && disabledFrom) {
      disabledIntervals.push({ from: disabledFrom, to: toggle.changed_at })
      disabledFrom = null
    }
  }
  if (disabledFrom) disabledIntervals.push({ from: disabledFrom, to: now })
  return {
    families: new Map(families.rows.map((row) => [row.family, { first: row.first_event_at, last: row.last_event_at, lastReceived: row.last_received_at }])),
    official: new Map(Object.entries(OFFICIAL_SOURCE_MIGRATIONS).map(([source, name]) => [source as OfficialSource, applied.get(name) ?? null])),
    eligibilityStart: tracking.rows[0]?.started_at ?? null,
    disabledIntervals,
  }
}

/** Cobertura de famílias do NAVEGADOR/SERVIDOR num intervalo, descontando o tempo com a coleta desligada. */
export function familyCoverage(state: CoverageState, families: readonly string[], start: Date, end: Date): Coverage {
  const firsts = families.map((family) => state.families.get(family)?.first ?? null)
  const known = firsts.filter((first): first is Date => first !== null)
  const since = known.length === 0 ? null : new Date(Math.min(...known.map((first) => first.getTime())))
  const base = coverageOf(since, start, end)
  const gap = state.disabledIntervals.find((interval) => interval.from < end && interval.to > start)
  if (base.status === "FULL" && gap) return { status: "PARTIAL", from: base.from, note: "Coleta desligada em parte do período — lacuna, não zero." }
  return base
}

export function officialCoverage(state: CoverageState, source: OfficialSource, start: Date, end: Date): Coverage {
  return coverageOf(state.official.get(source) ?? null, start, end, `Fonte oficial: ${OFFICIAL_SOURCE_LABELS[source]}.`)
}

export type Freshness = { lastEventReceivedAt: string | null; lastProjectionAt: string | null; pendingSince: string | null; lagSeconds: number; dataUpdatedUntil: string }

export async function loadFreshness(db: Queryable, organizationId: string, now: Date): Promise<Freshness> {
  const result = await db.query<{ last_received: Date | null; last_projection: Date | null; pending_since: Date | null }>(
    `select (select max(last_received_at) from usage_coverage where organization_id = $1) last_received,
            (select max(finished_at) from usage_projection_runs where kind = 'ACTIVITY') last_projection,
            (select min(marked_at) from usage_projection_dirty where organization_id = $1) pending_since`,
    [organizationId],
  )
  const row = result.rows[0]!
  const lag = row.pending_since ? Math.max(0, Math.round((now.getTime() - row.pending_since.getTime()) / 1000)) : 0
  return {
    lastEventReceivedAt: row.last_received?.toISOString() ?? null,
    lastProjectionAt: row.last_projection?.toISOString() ?? null,
    pendingSince: row.pending_since?.toISOString() ?? null,
    lagSeconds: lag,
    dataUpdatedUntil: (row.pending_since ?? now).toISOString(),
  }
}

export function metaOf<E extends Record<string, unknown> = Record<never, never>>(ctx: UsabilityContext, freshness: Freshness, extra: E = {} as E) {
  const base = {
    tab: ctx.tab,
    generatedAt: ctx.now.toISOString(),
    timezone: ctx.settings.timezone,
    timezoneSource: ctx.settings.timezoneSource,
    period: { preset: ctx.period.preset, fromDate: ctx.period.fromDate, toDate: ctx.period.toDate, start: ctx.period.start.toISOString(), end: ctx.period.end.toISOString(), includesPartialToday: ctx.period.includesPartialToday, label: describePeriod(ctx.period) },
    comparison: ctx.comparison ? { fromDate: ctx.comparison.fromDate, toDate: ctx.comparison.toDate, start: ctx.comparison.start.toISOString(), end: ctx.comparison.end.toISOString(), partialAligned: ctx.comparison.partialAligned, label: ctx.comparison.label } : null,
    filters: describeAppliedFilters(ctx.filters),
    structureMode: ctx.filters.structureMode,
    definitionsVersion: USABILITY_DEFINITIONS_VERSION,
    freshness,
    can: { people: ctx.can.people, export: ctx.can.export, comments: ctx.can.comments, manage: ctx.can.manage, readConversations: ctx.can.readConversations },
  }
  return { ...base, ...extra }
}
