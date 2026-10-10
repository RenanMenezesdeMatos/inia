import type { Database } from "../../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { conversationMessagesSql } from "../../../assistant/application/usage-analytics-reader.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { rootEnrollmentsSql } from "../../../workflows/application/usage-analytics-reader.js"
import { countMetric, distribution, rateMetric, valueMetric, type Coverage, type MetricValue } from "../../domain/metric-value.js"
import { FEATURE_BY_KEY } from "../../domain/usage-elements.js"
import { SCREEN_BY_KEY } from "../../domain/usage-screens.js"
import { addDays, startOfLocalDate } from "../../domain/usage-time.js"
import { activeDaysWhere, activePeopleSql, activeSecondsByPersonSql, eligiblePeopleSql, engagedPeopleSql, scopeCtes, sessionsStartedWhere, windowsOf, type Window } from "./activity-sql.js"
import { domainActionsSql } from "./domain-actions.js"
import { feedbackCohortSql } from "./feedback-cohort-sql.js"
import { difficultySignals } from "./journeys-query.js"
import { allowedClasses, areaSql, factStructureSql, familyCoverage, loadCoverageState, loadFreshness, metaOf, officialCoverage, type CoverageState, type UsabilityContext } from "./usability-context.js"

/**
 * VISÃO GERAL — adoção, frequência, uso das funcionalidades, evolução e principais dificuldades, com comparação ao período
 * anterior de mesma duração. Pessoas únicas são contadas no intervalo INTEIRO (nunca soma de ativos diários); DAU/WAU/MAU por
 * dia usam janelas móveis rotuladas; dia sem cobertura sai como "histórico não medido" (nunca zero).
 */
type Queryable = Pick<Database, "query">

async function windowCounts(db: Queryable, ctx: UsabilityContext, w: Window) {
  const p = new SqlParams()
  const result = await db.query<Record<string, number>>(
    `with ${scopeCtes(p, ctx)}, active as (${activePeopleSql(p, ctx, w)}), engaged as (${engagedPeopleSql(p, ctx, w)}), eligible as (${eligiblePeopleSql(p, ctx, w)})
     select (select count(*)::int from active) active, (select count(*)::int from engaged) engaged, (select count(*)::int from eligible) eligible,
       (select count(*)::int from active a where a.person_id in (select person_id from eligible)) active_eligible,
       (select count(*)::int from usage_sessions s where ${sessionsStartedWhere(p, ctx, w)}) sessions,
       (select count(*)::int from (select distinct pd.person_id, pd.local_date from usage_person_days pd where ${activeDaysWhere(p, ctx, w)}) d) active_person_days,
       (select count(*)::int from usage_events e where e.organization_id = ${p.typed(ctx.organizationId, "uuid")} and e.event_name = 'auth.login_succeeded'
          and e.occurred_at >= ${p.typed(w.start, "timestamptz")} and e.occurred_at < ${p.typed(w.end, "timestamptz")} and e.actor_person_id in (select person_id from scope_official)) logins`,
    p.values,
  )
  return result.rows[0]!
}

export async function overviewQuery(db: Queryable, ctx: UsabilityContext) {
  const coverageState = await loadCoverageState(db, ctx.organizationId, ctx.now)
  const { current, previous } = windowsOf(ctx)
  const activityCoverage = (w: Window) => familyCoverage(coverageState, ["NAVIGATION", "SESSION"], w.start, w.end)
  const eligibilityCoverage = (w: Window): Coverage => (coverageState.eligibilityStart ? familyCoverageFromDate(coverageState.eligibilityStart, w) : { status: "NONE", from: null, note: "Registro de elegibilidade ainda não iniciado." })
  // Engajamento soma ações de várias fontes oficiais: a cobertura é a da fonte que começou por último.
  const engagedCoverage = (w: Window) => worst(...(["CONVERSATIONS", "RATINGS", "READ_CONFIRMATIONS", "APPLICATIONS", "MANUAL_RUNS"] as const).map((source) => officialCoverage(coverageState, source, w.start, w.end)))
  const [now, before] = await Promise.all([windowCounts(db, ctx, current), previous ? windowCounts(db, ctx, previous) : Promise.resolve(null)])
  const prev = <T>(build: (row: Record<string, number>, w: Window) => T) => (before && previous ? build(before, previous) : null)
  const cov = activityCoverage(current)
  const adoptionCoverage = worst(cov, eligibilityCoverage(current))

  const kpis: MetricValue[] = [
    countMetric("activity.active_people", now.active ?? 0, cov, prev((row, w) => ({ value: row.active ?? 0, coverage: activityCoverage(w) }))),
    rateMetric("activity.adoption_rate", now.active_eligible ?? 0, now.eligible ?? 0, adoptionCoverage, prev((row, w) => ({ numerator: row.active_eligible ?? 0, denominator: row.eligible ?? 0, coverage: worst(activityCoverage(w), eligibilityCoverage(w)) }))),
    countMetric("activity.eligible_inactive", Math.max(0, (now.eligible ?? 0) - (now.active_eligible ?? 0)), adoptionCoverage, prev((row, w) => ({ value: Math.max(0, (row.eligible ?? 0) - (row.active_eligible ?? 0)), coverage: worst(activityCoverage(w), eligibilityCoverage(w)) }))),
    countMetric("population.eligible_period", now.eligible ?? 0, eligibilityCoverage(current), prev((row, w) => ({ value: row.eligible ?? 0, coverage: eligibilityCoverage(w) }))),
    countMetric("activity.engaged_people", now.engaged ?? 0, engagedCoverage(current), prev((row, w) => ({ value: row.engaged ?? 0, coverage: engagedCoverage(w) }))),
    countMetric("sessions.started", now.sessions ?? 0, cov, prev((row, w) => ({ value: row.sessions ?? 0, coverage: activityCoverage(w) }))),
    valueMetric("sessions.per_active_person", (now.active ?? 0) > 0 ? Math.round(((now.sessions ?? 0) / now.active!) * 100) / 100 : null, cov, prev((row, w) => ({ value: (row.active ?? 0) > 0 ? Math.round(((row.sessions ?? 0) / row.active!) * 100) / 100 : null, coverage: activityCoverage(w) }))),
    countMetric("auth.logins", now.logins ?? 0, familyCoverage(coverageState, ["AUTH"], current.start, current.end), prev((row, w) => ({ value: row.logins ?? 0, coverage: familyCoverage(coverageState, ["AUTH"], w.start, w.end) }))),
  ]

  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    return (await db.query<T>(build(p), p.values)).rows
  }
  const tz = ctx.settings.timezone
  const seriesWindow: Window = { start: startOfLocalDate(addDays(current.fromDate, -29), tz), end: current.end, fromDate: addDays(current.fromDate, -29), toDate: current.toDate, cut: null }
  const [durations, activeSeconds, activeDays, series, heatmap, screens, summary] = await Promise.all([
    run<{ seconds: number }>((p) => `with ${scopeCtes(p, ctx)} select extract(epoch from s.ended_at - s.started_at)::int seconds from usage_sessions s where ${sessionsStartedWhere(p, ctx, current)} and s.end_reason <> 'OPEN'`),
    run<{ seconds: number }>((p) => `with ${scopeCtes(p, ctx)} select seconds::int from (${activeSecondsByPersonSql(p, ctx, current)}) x where seconds > 0`),
    run<{ days: number }>((p) => `with ${scopeCtes(p, ctx)} select count(*)::int days from usage_person_days pd where ${activeDaysWhere(p, ctx, current)} group by pd.person_id`),
    run<{ local_date: string; dau: number; wau: number; mau: number; sessions: number; active_seconds: number }>((p) => {
      const org = p.typed(ctx.organizationId, "uuid")
      return `with ${scopeCtes(p, ctx)},
        act_days as (select pd.person_id, pd.local_date from usage_person_days pd where ${activeDaysWhere(p, ctx, seriesWindow)}
          union select da.person_id, (da.occurred_at at time zone ${p.add(tz)})::date from (${domainActionsSql(org)}) da
            where da.occurred_at >= ${p.typed(seriesWindow.start, "timestamptz")} and da.occurred_at < ${p.typed(current.end, "timestamptz")} and da.person_id in (select person_id from scope_official)),
        days as (select d::date local_date from generate_series(${p.typed(current.fromDate, "date")}, ${p.typed(current.toDate, "date")}, interval '1 day') d)
        select to_char(days.local_date, 'YYYY-MM-DD') local_date,
          (select count(distinct a.person_id)::int from act_days a where a.local_date = days.local_date) dau,
          (select count(distinct a.person_id)::int from act_days a where a.local_date between days.local_date - 6 and days.local_date) wau,
          (select count(distinct a.person_id)::int from act_days a where a.local_date between days.local_date - 29 and days.local_date) mau,
          (select count(*)::int from usage_sessions s where s.organization_id = ${org} and s.started_local_date = days.local_date and s.person_id in (select person_id from scope_fact)
             and s.population_class = any(${p.typed(allowedClasses(ctx.filters), "text[]")}) and ${factStructureSql(p, ctx, "s")} and (${p.add(ctx.filters.includeAdmin)}::boolean or s.has_product_activity)) sessions,
          (select coalesce(sum(case when ${p.add(ctx.filters.includeAdmin)}::boolean then pd.active_seconds else pd.active_seconds_product end), 0)::int from usage_person_days pd
             where pd.organization_id = ${org} and pd.local_date = days.local_date and pd.person_id in (select person_id from scope_fact) and pd.population_class = any(${p.typed(allowedClasses(ctx.filters), "text[]")}) and ${factStructureSql(p, ctx, "pd")}) active_seconds
        from days order by days.local_date`
    }),
    run<{ weekday: number; hour: number; sessions: number }>((p) => `with ${scopeCtes(p, ctx)} select extract(isodow from s.started_at at time zone ${p.add(tz)})::int weekday, extract(hour from s.started_at at time zone ${p.add(tz)})::int as hour, count(*)::int sessions
      from usage_sessions s where ${sessionsStartedWhere(p, ctx, current)} group by 1, 2`),
    run<{ screen_key: string; views: number; people: number }>((p) => `with ${scopeCtes(p, ctx)} select sp.screen_key, sum(sp.views)::int views, count(distinct sp.person_id)::int people from usage_screen_person_days sp
      where sp.organization_id = ${p.typed(ctx.organizationId, "uuid")} and sp.local_date between ${p.typed(current.fromDate, "date")} and ${p.typed(current.toDate, "date")} and sp.person_id in (select person_id from scope_fact)
        and sp.population_class = any(${p.typed(allowedClasses(ctx.filters), "text[]")}) and ${factStructureSql(p, ctx, "sp")} and ${areaSql(ctx, "sp.screen_key", "sp.area")} group by 1 order by views desc`),
    run<Record<string, number>>((p) => {
      const org = p.typed(ctx.organizationId, "uuid")
      return `with ${scopeCtes(p, ctx)}
        select (select count(*)::int from (${feedbackCohortSql(p, ctx, null)}) x) feedback_available,
          (select count(*)::int from (${feedbackCohortSql(p, ctx, null)}) x where x.acknowledged_at is not null) feedback_acked,
          (select count(distinct m.owner_person_id)::int from (${conversationMessagesSql(org)}) m where m.role = 'user' and m.occurred_at >= ${p.typed(current.start, "timestamptz")} and m.occurred_at < ${p.typed(current.end, "timestamptz")} and m.owner_person_id in (select person_id from scope_official)) chat_people,
          (select count(*)::int from (${rootEnrollmentsSql(org)}) r where r.created_at >= ${p.typed(current.start, "timestamptz")} and r.created_at < ${p.typed(current.end, "timestamptz")}
             and (r.subject_person_id in (select person_id from scope_official) or (r.structure_subject and ${p.add(ctx.can.organizationWide)}::boolean))) workflow_roots`
    }),
  ])

  const population = await populationBlock(db, ctx)
  const signals = await difficultySignals(db, ctx)
  const coverageFrom = cov.from ? new Date(cov.from) : null
  const referenceDate = ctx.filters.referenceDate && ctx.filters.referenceDate >= current.fromDate && ctx.filters.referenceDate <= current.toDate ? ctx.filters.referenceDate : current.toDate
  const measured = (date: string) => coverageFrom !== null && startOfLocalDate(addDays(date, 1), tz) > coverageFrom
  const fullyMeasured = (date: string, days: number) => coverageFrom !== null && startOfLocalDate(addDays(date, -(days - 1)), tz) >= coverageFrom
  const seriesOut = series.map((row) => ({
    date: row.local_date,
    measured: measured(row.local_date),
    dau: measured(row.local_date) ? row.dau : null,
    wau: measured(row.local_date) ? row.wau : null,
    wauFullCoverage: fullyMeasured(row.local_date, 7),
    mau: measured(row.local_date) ? row.mau : null,
    mauFullCoverage: fullyMeasured(row.local_date, 30),
    sessions: measured(row.local_date) ? row.sessions : null,
    activeSeconds: measured(row.local_date) ? row.active_seconds : null,
  }))
  const reference = seriesOut.find((row) => row.date === referenceDate) ?? null
  const totalViews = screens.reduce((sum, row) => sum + row.views, 0)
  const features = new Map<string, { views: number }>()
  for (const row of screens) {
    const feature = SCREEN_BY_KEY.get(row.screen_key)?.feature ?? "navigation"
    features.set(feature, { views: (features.get(feature)?.views ?? 0) + row.views })
  }
  const freshness = await loadFreshness(db, ctx.organizationId, ctx.now)
  const s = summary[0] ?? {}
  return {
    meta: metaOf(ctx, freshness, { coverage: { activity: cov, eligibility: eligibilityCoverage(current), adoption: adoptionCoverage }, referenceDate, referenceIsPartial: referenceDate === current.toDate && ctx.period.includesPartialToday }),
    kpis,
    reference: reference
      ? { date: reference.date, dau: reference.dau, wau: reference.wau, mau: reference.mau, dauMau: reference.dau !== null && reference.mau ? Math.round((reference.dau / reference.mau) * 1000) / 10 : null, wauFullCoverage: reference.wauFullCoverage, mauFullCoverage: reference.mauFullCoverage }
      : null,
    distributions: {
      sessionDurationSeconds: distribution(durations.map((row) => row.seconds)),
      activeSecondsPerPerson: distribution(activeSeconds.map((row) => row.seconds)),
      activeDaysPerPerson: distribution(activeDays.map((row) => row.days)),
      sessionsPerActivePersonDay: (now.active_person_days ?? 0) > 0 ? Math.round(((now.sessions ?? 0) / now.active_person_days!) * 100) / 100 : null,
    },
    series: seriesOut,
    heatmap: heatmap.map((row) => ({ weekday: row.weekday, hour: row.hour, sessions: row.sessions })),
    topScreens: screens.slice(0, 8).map((row) => ({ screenKey: row.screen_key, label: SCREEN_BY_KEY.get(row.screen_key)?.label ?? row.screen_key, views: row.views, people: row.people, sharePercent: totalViews > 0 ? Math.round((row.views / totalViews) * 1000) / 10 : null })),
    topFeatures: [...features].sort((a, b) => b[1].views - a[1].views).slice(0, 8).map(([key, value]) => ({ featureKey: key, label: FEATURE_BY_KEY.get(key)?.label ?? key, views: value.views })),
    summary: { feedbackAvailable: s.feedback_available ?? 0, feedbackAcked: s.feedback_acked ?? 0, chatPeople: s.chat_people ?? 0, workflowRoots: s.workflow_roots ?? 0 },
    population,
    signals: signals.slice(0, 6),
  }
}

function familyCoverageFromDate(since: Date, w: Window): Coverage {
  if (since >= w.end) return { status: "NONE", from: since.toISOString(), note: "Elegibilidade registrada só a partir de depois deste período." }
  if (since > w.start) return { status: "PARTIAL", from: since.toISOString(), note: "Elegibilidade registrada a partir do meio do período." }
  return { status: "FULL", from: since.toISOString(), note: null }
}

/** A cobertura de uma taxa é a PIOR entre as fontes que a compõem. */
function worst(...coverages: Coverage[]): Coverage {
  const order = { NONE: 0, PARTIAL: 1, FULL: 2 } as const
  return [...coverages].sort((a, b) => order[a.status] - order[b.status])[0]!
}

/** População ATUAL (cadastro oficial), no escopo e com os filtros de população. */
async function populationBlock(db: Queryable, ctx: UsabilityContext) {
  const p = new SqlParams()
  const result = await db.query<Record<string, number>>(
    `with ${scopeCtes(p, ctx)} select count(*) filter (where pop.person_active)::int registered, count(*) filter (where pop.person_active and pop.account_id is not null)::int with_account,
       count(*) filter (where pop.person_active and pop.account_active)::int eligible_now, count(*) filter (where pop.person_active and pop.account_id is null)::int no_account,
       count(*) filter (where pop.person_active and pop.account_active is false)::int account_disabled, count(*) filter (where pop.person_active and pop.employment_status not in ('EM_PRODUCAO', 'ACTIVE'))::int away,
       count(*) filter (where not pop.person_active)::int terminated
     from (${populationSql(p, ctx.organizationId)}) pop where pop.person_id in (select person_id from scope_official)`,
    p.values,
  )
  const row = result.rows[0] ?? {}
  return { basis: "CURRENT", registered: row.registered ?? 0, withAccount: row.with_account ?? 0, eligibleNow: row.eligible_now ?? 0, noAccount: row.no_account ?? 0, accountDisabled: row.account_disabled ?? 0, away: row.away ?? 0, terminated: row.terminated ?? 0 }
}

export type { CoverageState }
