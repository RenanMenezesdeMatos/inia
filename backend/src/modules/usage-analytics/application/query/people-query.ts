import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { activeAccountRolesSql } from "../../../access/application/scope-people-reader.js"
import { SENSITIVE_LEAVE_STATUSES } from "../../../org-structure/domain/management-metrics.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { addDays } from "../../domain/usage-time.js"
import { domainActionsSql } from "./domain-actions.js"
import { activeDaysWhere, activePeopleSql, activeSecondsByPersonSql, eligiblePeopleSql, engagedPeopleSql, scopeCtes, sessionsStartedWhere, windowsOf } from "./activity-sql.js"
import { familyCoverage, loadCoverageState, loadFreshness, metaOf, type UsabilityContext } from "./usability-context.js"

/**
 * PESSOAS E ACESSOS — população, atividade e frequência por pessoa. Cada SEGMENTO é um predicado único sobre a mesma base por
 * pessoa: a contagem do card, a lista do drill-down e o CSV usam exatamente o mesmo `where`.
 *
 * "Nunca acessou" só existe quando há evidência desde a habilitação (conta criada depois do início da coleta e nenhum acesso
 * observado desde então). Quem já existia antes da coleta e não aparece é "sem registro desde o início da coleta" — histórico
 * anterior desconhecido (o último login conhecido, quando existe, é mostrado à parte e prova só aquele login).
 */
type Queryable = Pick<Database, "query">

export const PEOPLE_SEGMENTS = [
  "ALL", "ELIGIBLE", "ACTIVE", "ENGAGED", "ELIGIBLE_INACTIVE", "FIRST_ACCESS", "NEVER_SINCE_ENABLED", "NO_RECORD_SINCE_COLLECTION",
  "NO_ACCOUNT", "ACCOUNT_DISABLED", "AWAY", "TERMINATED", "RETURNED_7", "RETURNED_14", "RETURNED_30", "INACTIVE_3", "INACTIVE_7", "INACTIVE_14", "INACTIVE_30",
] as const
export type PeopleSegment = (typeof PEOPLE_SEGMENTS)[number]
export const PEOPLE_SEGMENT_LABELS: Record<PeopleSegment, string> = {
  ALL: "Todas as pessoas do recorte",
  ELIGIBLE: "Elegíveis no período",
  ACTIVE: "Com atividade observada no período",
  ENGAGED: "Engajadas (ação de domínio)",
  ELIGIBLE_INACTIVE: "Elegíveis sem atividade observada",
  FIRST_ACCESS: "Primeiro acesso observado no período",
  NEVER_SINCE_ENABLED: "Sem acesso desde a habilitação",
  NO_RECORD_SINCE_COLLECTION: "Sem registro desde o início da coleta (histórico anterior desconhecido)",
  NO_ACCOUNT: "Sem conta (barreira de provisionamento)",
  ACCOUNT_DISABLED: "Conta desabilitada",
  AWAY: "Afastadas",
  TERMINATED: "Desligadas",
  RETURNED_7: "Retornaram após 7+ dias sem atividade",
  RETURNED_14: "Retornaram após 14+ dias sem atividade",
  RETURNED_30: "Retornaram após 30+ dias sem atividade",
  INACTIVE_3: "Sem atividade há 3+ dias",
  INACTIVE_7: "Sem atividade há 7+ dias",
  INACTIVE_14: "Sem atividade há 14+ dias",
  INACTIVE_30: "Sem atividade há 30+ dias",
}

const SORTS: Record<string, string> = {
  name: "b.name",
  activeDays: "b.active_days",
  sessions: "b.sessions",
  activeSeconds: "b.active_seconds",
  lastActivity: "b.last_observed_at",
  sessionsPerDay: "b.sessions_per_active_day",
}

/** Base por pessoa com uma coluna booleana por segmento (SELECT completo, com CTEs). */
function peopleBaseSql(p: SqlParams, ctx: UsabilityContext, coverageStart: Date | null): string {
  const { current } = windowsOf(ctx)
  const org = p.typed(ctx.organizationId, "uuid")
  const from = p.typed(current.fromDate, "date")
  const end = p.typed(current.end, "timestamptz")
  const start = p.typed(current.start, "timestamptz")
  const coverage = p.typed(coverageStart, "timestamptz")
  const flag = (days: number) => p.typed(addDays(current.fromDate, -days), "date")
  const inactiveSince = (days: number) => p.typed(new Date(current.end.getTime() - days * 86_400_000), "timestamptz")
  return `with ${scopeCtes(p, ctx)},
    active as (${activePeopleSql(p, ctx, current)}),
    engaged as (${engagedPeopleSql(p, ctx, current)}),
    eligible as (${eligiblePeopleSql(p, ctx, current)}),
    days as (select pd.person_id, count(*)::int active_days, min(pd.local_date) first_day from usage_person_days pd where ${activeDaysWhere(p, ctx, current)} group by pd.person_id),
    sess as (select s.person_id, count(*)::int sessions from usage_sessions s where ${sessionsStartedWhere(p, ctx, current)} group by s.person_id),
    secs as (${activeSecondsByPersonSql(p, ctx, current)}),
    before as (select pd.person_id, max(pd.local_date) last_before from usage_person_days pd
      where pd.organization_id = ${org} and pd.local_date < ${from} and (pd.active_product or (${p.add(ctx.filters.includeAdmin)}::boolean and pd.active_admin)) group by pd.person_id),
    roles as (select r.account_id, array_agg(distinct r.role_code order by r.role_code) role_codes from (${activeAccountRolesSql(p, ctx.organizationId)}) r group by r.account_id),
    open_eligibility as (select ep.person_id, ep.eligible_from, ep.opened_basis from usage_eligibility_periods ep where ep.organization_id = ${org} and ep.eligible_until is null),
    action_bounds as (select da.person_id, min(da.occurred_at) first_at, max(da.occurred_at) last_at from (${domainActionsSql(org)}) da where da.occurred_at < ${end} group by da.person_id),
    base as (
      select pop.person_id, pop.name, pop.matricula, pop.job_title, pop.level, pop.team_id, pop.team_name, pop.subteam_id, pop.subteam_name,
        pop.person_active, pop.employment_status, pop.account_id, pop.account_active, pop.last_login_at, coalesce(ro.role_codes, '{}') role_codes,
        -- Acesso comprovado = marco observado pela monitoria (atividade/login) OU ação de domínio na fonte oficial.
        least(m.first_observed_at, ab.first_at) first_observed_at, greatest(m.last_observed_at, ab.last_at) last_observed_at, m.legacy_last_login_at, oe.eligible_from, oe.opened_basis,
        coalesce(d.active_days, 0) active_days, coalesce(se.sessions, 0) sessions, coalesce(sc.seconds, 0)::bigint active_seconds,
        case when coalesce(d.active_days, 0) > 0 then round(coalesce(se.sessions, 0)::numeric / d.active_days, 2) end sessions_per_active_day,
        d.first_day, bf.last_before,
        (pop.person_id in (select person_id from active)) is_active,
        (pop.person_id in (select person_id from engaged)) is_engaged,
        (pop.person_id in (select person_id from eligible)) is_eligible
      from (${populationSql(p, ctx.organizationId)}) pop
      left join usage_person_milestones m on m.organization_id = ${org} and m.person_id = pop.person_id
      left join action_bounds ab on ab.person_id = pop.person_id
      left join open_eligibility oe on oe.person_id = pop.person_id
      left join days d on d.person_id = pop.person_id
      left join sess se on se.person_id = pop.person_id
      left join secs sc on sc.person_id = pop.person_id
      left join before bf on bf.person_id = pop.person_id
      left join roles ro on ro.account_id = pop.account_id
      where pop.person_id in (select person_id from scope_official) or pop.person_id in (select person_id from active)
    )
    select b.*,
      true seg_all,
      b.is_eligible seg_eligible,
      b.is_active seg_active,
      b.is_engaged seg_engaged,
      (b.is_eligible and not b.is_active) seg_eligible_inactive,
      (b.first_observed_at >= ${start} and b.first_observed_at < ${end} and b.legacy_last_login_at is null) seg_first_access,
      (b.opened_basis = 'ACCOUNT_CREATED' and b.first_observed_at is null and ${coverage} is not null and ${coverage} <= b.eligible_from) seg_never_since_enabled,
      (b.opened_basis in ('COLLECTION_START', 'STATE_CHANGE_OBSERVED') and b.first_observed_at is null) seg_no_record_since_collection,
      (b.person_active and b.account_id is null) seg_no_account,
      (b.person_active and b.account_active is false) seg_account_disabled,
      (b.person_active and b.employment_status not in ('EM_PRODUCAO', 'ACTIVE')) seg_away,
      (not b.person_active) seg_terminated,
      (b.is_active and b.last_before is not null and b.first_day - b.last_before >= 7 and ${coverage} <= ${flag(7)}::timestamptz) seg_returned_7,
      (b.is_active and b.last_before is not null and b.first_day - b.last_before >= 14 and ${coverage} <= ${flag(14)}::timestamptz) seg_returned_14,
      (b.is_active and b.last_before is not null and b.first_day - b.last_before >= 30 and ${coverage} <= ${flag(30)}::timestamptz) seg_returned_30,
      (b.eligible_from is not null and (b.last_observed_at is not null or ${coverage} is not null) and coalesce(b.last_observed_at, greatest(b.eligible_from, ${coverage})) <= ${inactiveSince(3)}) seg_inactive_3,
      (b.eligible_from is not null and (b.last_observed_at is not null or ${coverage} is not null) and coalesce(b.last_observed_at, greatest(b.eligible_from, ${coverage})) <= ${inactiveSince(7)}) seg_inactive_7,
      (b.eligible_from is not null and (b.last_observed_at is not null or ${coverage} is not null) and coalesce(b.last_observed_at, greatest(b.eligible_from, ${coverage})) <= ${inactiveSince(14)}) seg_inactive_14,
      (b.eligible_from is not null and (b.last_observed_at is not null or ${coverage} is not null) and coalesce(b.last_observed_at, greatest(b.eligible_from, ${coverage})) <= ${inactiveSince(30)}) seg_inactive_30
    from base b`
}

const segmentColumn = (segment: PeopleSegment) => `seg_${segment.toLowerCase()}`

export type PeopleRow = {
  personId: string
  name: string
  matricula: string | null
  jobTitle: string | null
  level: string
  teamName: string | null
  subteamName: string | null
  personActive: boolean
  employmentStatus: string
  accountStatus: "ENABLED" | "DISABLED" | "NONE"
  roles: string[]
  eligibleNow: boolean
  eligibleFrom: string | null
  eligibilityBasis: string | null
  activeInPeriod: boolean
  engagedInPeriod: boolean
  activeDays: number
  sessions: number
  sessionsPerActiveDay: number | null
  activeSeconds: number
  firstObservedAt: string | null
  lastObservedAt: string | null
  legacyLastLoginAt: string | null
  lastLoginAt: string | null
}

type BaseRow = {
  person_id: string; name: string; matricula: string | null; job_title: string | null; level: string; team_name: string | null; subteam_name: string | null
  person_active: boolean; employment_status: string; account_id: string | null; account_active: boolean | null; last_login_at: Date | null; role_codes: string[]
  first_observed_at: Date | null; last_observed_at: Date | null; legacy_last_login_at: Date | null; eligible_from: Date | null; opened_basis: string | null
  active_days: number; sessions: number; active_seconds: string | number; sessions_per_active_day: string | null; is_active: boolean; is_engaged: boolean
}

/** Situação que a monitoria de uso mostra: afastamento sensível (INSS, maternidade, paternidade) sai como `AFASTAMENTO_PROTEGIDO` na
 * lista, no detalhe e no CSV — o painel só precisa saber que a pessoa está afastada; o tipo exato fica na tela de situação funcional
 * (`people.manage`). O código bruto continua só nos filtros internos (achado C04 da 4ª auditoria). */
export const usabilityEmploymentStatus = (status: string): string => ((SENSITIVE_LEAVE_STATUSES as readonly string[]).includes(status) ? "AFASTAMENTO_PROTEGIDO" : status)

export const toPeopleRow = (row: BaseRow): PeopleRow => ({
  personId: row.person_id,
  name: row.name,
  matricula: row.matricula,
  jobTitle: row.job_title,
  level: row.level,
  teamName: row.team_name,
  subteamName: row.subteam_name,
  personActive: row.person_active,
  employmentStatus: usabilityEmploymentStatus(row.employment_status),
  accountStatus: row.account_id === null ? "NONE" : row.account_active ? "ENABLED" : "DISABLED",
  roles: row.role_codes,
  eligibleNow: row.eligible_from !== null,
  eligibleFrom: row.eligible_from?.toISOString() ?? null,
  eligibilityBasis: row.opened_basis,
  activeInPeriod: row.is_active,
  engagedInPeriod: row.is_engaged,
  activeDays: row.active_days,
  sessions: row.sessions,
  sessionsPerActiveDay: row.sessions_per_active_day === null ? null : Number(row.sessions_per_active_day),
  activeSeconds: Number(row.active_seconds),
  firstObservedAt: row.first_observed_at?.toISOString() ?? null,
  lastObservedAt: row.last_observed_at?.toISOString() ?? null,
  legacyLastLoginAt: row.legacy_last_login_at?.toISOString() ?? null,
  lastLoginAt: row.last_login_at?.toISOString() ?? null,
})

/** Contagem por segmento (sempre) + lista (só com permissão de pessoas identificadas). */
export async function peopleQuery(db: Queryable, ctx: UsabilityContext, options: { all?: boolean } = {}) {
  const segment = (ctx.filters.segment ?? "ALL") as PeopleSegment
  if (!PEOPLE_SEGMENTS.includes(segment)) throw new DomainError("Segmento inválido.", "USABILITY_SEGMENT_INVALID", 400)
  const coverageState = await loadCoverageState(db, ctx.organizationId, ctx.now)
  const activityCoverage = familyCoverage(coverageState, ["NAVIGATION", "SESSION"], ctx.period.start, ctx.period.end)
  const coverageStart = activityCoverage.from ? new Date(activityCoverage.from) : null
  const p = new SqlParams()
  const base = peopleBaseSql(p, ctx, coverageStart)
  const summaryResult = await db.query<Record<string, number>>(`select ${PEOPLE_SEGMENTS.map((value) => `count(*) filter (where ${segmentColumn(value)})::int ${segmentColumn(value)}`).join(", ")} from (${base}) x`, p.values)
  const summaryRow = summaryResult.rows[0] ?? {}
  const counts = Object.fromEntries(PEOPLE_SEGMENTS.map((value) => [value, summaryRow[segmentColumn(value)] ?? 0])) as Record<PeopleSegment, number>
  let items: PeopleRow[] | null = null
  if (ctx.can.people) {
    const [sortKey, direction] = (ctx.filters.sort ?? (segment === "ACTIVE" ? "lastActivity:desc" : "name:asc")).split(":") as [string, string | undefined]
    const order = SORTS[sortKey] ?? "b.name"
    const listParams = new SqlParams()
    const listBase = peopleBaseSql(listParams, ctx, coverageStart)
    const limit = options.all ? "" : ` limit ${listParams.add(ctx.filters.pageSize)} offset ${listParams.add((ctx.filters.page - 1) * ctx.filters.pageSize)}`
    const rows = await db.query<BaseRow>(`select * from (${listBase}) b where ${segmentColumn(segment)} order by ${order} ${direction === "desc" ? "desc nulls last" : "asc nulls last"}, b.person_id${limit}`, listParams.values)
    items = rows.rows.map(toPeopleRow)
  }
  const freshness = await loadFreshness(db, ctx.organizationId, ctx.now)
  return {
    meta: metaOf(ctx, freshness, { coverage: { activity: activityCoverage, eligibilityStart: coverageState.eligibilityStart?.toISOString() ?? null } }),
    segment,
    segmentLabel: PEOPLE_SEGMENT_LABELS[segment],
    counts,
    total: counts[segment],
    page: ctx.filters.page,
    pageSize: ctx.filters.pageSize,
    identified: ctx.can.people,
    items,
  }
}
