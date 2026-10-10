import type { Database } from "../../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { ELEMENT_BY_KEY, FEATURE_BY_KEY, USAGE_CONTENTS, USAGE_SEARCH_SURFACES } from "../../domain/usage-elements.js"
import { ACTION_FEATURE, USAGE_ACTION_LABELS } from "../../domain/usage-events.js"
import { SCREEN_BY_KEY, USAGE_SCREENS } from "../../domain/usage-screens.js"
import { scopeCtes, windowsOf, type Window } from "./activity-sql.js"
import { allowedClasses, areaSql, factStructureSql, familyCoverage, loadCoverageState, loadFreshness, metaOf, type UsabilityContext } from "./usability-context.js"

/**
 * TELAS E CLIQUES — sempre sobre os EVENTOS BRUTOS do navegador (catálogo fechado), dentro da retenção. Visualização canônica =
 * `screen.viewed` (nunca somada a outro evento). Elementos centrais têm exposição medida e taxa de acionamento = pessoas que
 * acionaram ÷ pessoas expostas; elemento sem exposição medida mostra só a contagem. Saída sem `screen.left` é INFERIDA.
 * O próprio painel e a Administração só entram com "Incluir uso da Administração".
 */
type Queryable = Pick<Database, "query">

function rawWhere(p: SqlParams, ctx: UsabilityContext, w: Window, alias = "e"): string {
  const f = ctx.filters
  const clauses = [
    `${alias}.organization_id = ${p.typed(ctx.organizationId, "uuid")}`,
    `${alias}.source = 'CLIENT'`,
    `${alias}.occurred_at >= ${p.typed(w.start, "timestamptz")} and ${alias}.occurred_at < ${p.typed(w.end, "timestamptz")}`,
    `${alias}.actor_person_id in (select person_id from scope_fact)`,
    `${alias}.population_class = any(${p.typed(allowedClasses(f), "text[]")})`,
    factStructureSql(p, ctx, alias),
    areaSql(ctx, `${alias}.screen_key`, `${alias}.area`),
  ]
  if (f.screenKey) clauses.push(`${alias}.screen_key = ${p.add(f.screenKey)}`)
  if (f.featureKey) clauses.push(`${alias}.feature_key = ${p.add(f.featureKey)}`)
  if (f.device) clauses.push(`${alias}.device = ${p.add(f.device)}`)
  if (f.appVersion) clauses.push(`${alias}.app_version = ${p.add(f.appVersion)}`)
  if (f.environment) clauses.push(`${alias}.environment = ${p.add(f.environment)}`)
  return clauses.join(" and ")
}

/**
 * Tempo ativo por (tela, pessoa) — união dos intervalos de atividade. Sem recorte que só o evento bruto tem (dispositivo,
 * versão, ambiente), vem da PROJEÇÃO pessoa × dia × tela (a mesma união por dia, já dividida na meia-noite; dias são
 * disjuntos, então a soma por dia = a união no período); com esse recorte, recalcula dos heartbeats brutos.
 */
function personTimeSql(p: SqlParams, ctx: UsabilityContext, w: Window): string {
  const f = ctx.filters
  if (f.device || f.appVersion || f.environment) {
    return `select screen_key, actor_person_id, (select coalesce(sum(extract(epoch from upper(x) - lower(x))), 0) from unnest(range_agg(r)) x) seconds
      from (select e.screen_key, e.actor_person_id, tstzrange((e.properties->>'spanStart')::timestamptz, (e.properties->>'spanEnd')::timestamptz) r
        from usage_events e where ${rawWhere(p, ctx, w)} and e.event_name = 'activity.heartbeat') spans group by screen_key, actor_person_id`
  }
  const screenFilter = f.screenKey ? ` and sp.screen_key = ${p.add(f.screenKey)}` : ""
  const featureFilter = f.featureKey ? ` and sp.screen_key = any(${p.typed(USAGE_SCREENS.filter((screen) => screen.feature === f.featureKey).map((screen) => screen.key), "text[]")})` : ""
  return `select sp.screen_key, sp.person_id actor_person_id, sum(sp.active_seconds) seconds from usage_screen_person_days sp
    where sp.organization_id = ${p.typed(ctx.organizationId, "uuid")} and sp.local_date between ${p.typed(w.fromDate, "date")} and ${p.typed(w.toDate, "date")}
      and sp.person_id in (select person_id from scope_fact) and sp.population_class = any(${p.typed(allowedClasses(f), "text[]")}) and ${factStructureSql(p, ctx, "sp")}
      and ${areaSql(ctx, "sp.screen_key", "sp.area")}${screenFilter}${featureFilter}
    group by sp.screen_key, sp.person_id having sum(sp.active_seconds) > 0`
}

export async function screensQuery(db: Queryable, ctx: UsabilityContext) {
  const { current } = windowsOf(ctx)
  const coverageState = await loadCoverageState(db, ctx.organizationId, ctx.now)
  const retentionStart = new Date(ctx.now.getTime() - ctx.settings.rawRetentionDays * 86_400_000)
  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    const sql = build(p)
    return (await db.query<T>(sql, p.values)).rows
  }
  const head = (p: SqlParams) => `with ${scopeCtes(p, ctx)}`

  const [screens, features, officialActions, elements, interactions, transitions, entries, exits, heat, scroll, search, filters, exports] = await Promise.all([
    run<{ screen_key: string; views: number; people: number; sessions: number; median_seconds: number | null; p95_seconds: number | null }>((p) => `${head(p)},
      views as (select e.screen_key, e.actor_person_id, e.usage_session_id, e.occurred_at from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'screen.viewed'),
      person_time as (${personTimeSql(p, ctx, current)}),
      sessions as (select v.screen_key, count(distinct s.id) n from views v join usage_sessions s on s.organization_id = ${p.typed(ctx.organizationId, "uuid")} and s.usage_session_id = v.usage_session_id and v.occurred_at between s.started_at and s.ended_at group by v.screen_key)
      select v.screen_key, count(*)::int views, count(distinct v.actor_person_id)::int people, coalesce(max(se.n), 0)::int sessions,
        (select percentile_cont(0.5) within group (order by pt.seconds) from person_time pt where pt.screen_key = v.screen_key) median_seconds,
        (select percentile_cont(0.95) within group (order by pt.seconds) from person_time pt where pt.screen_key = v.screen_key) p95_seconds
      from views v left join sessions se on se.screen_key = v.screen_key group by v.screen_key order by views desc`),
    run<{ feature_key: string; people: number; events: number; recurrent_people: number; succeeded: number; failed: number }>((p) => `${head(p)}
      -- Uma passada: pessoas recorrentes = com evento da funcionalidade em 2+ dias locais (mesmo conjunto de eventos de "pessoas").
      select f.feature_key, count(*)::int people, sum(f.events)::int events, count(*) filter (where f.days >= 2)::int recurrent_people,
        sum(f.succeeded)::int succeeded, sum(f.failed)::int failed
      from (select e.feature_key, e.actor_person_id, count(*) events, count(distinct (e.occurred_at at time zone ${p.add(ctx.settings.timezone)})::date) days,
          count(*) filter (where e.event_name = 'action.succeeded') succeeded, count(*) filter (where e.event_name = 'action.failed') failed
        from usage_events e where ${rawWhere(p, ctx, current)} and e.feature_key is not null and e.event_name <> 'activity.heartbeat'
        group by e.feature_key, e.actor_person_id) f
      group by f.feature_key order by people desc, events desc`),
    run<{ action_key: string; succeeded: number; failed: number; cancelled: number; started: number }>((p) => `${head(p)}
      select e.properties->>'actionKey' action_key, count(*) filter (where e.event_name = 'action.started')::int started, count(*) filter (where e.event_name = 'action.succeeded')::int succeeded,
        count(*) filter (where e.event_name = 'action.failed')::int failed, count(*) filter (where e.event_name = 'action.cancelled')::int cancelled
      from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name like 'action.%' group by 1 order by started desc`),
    run<{ element_key: string; screen_key: string; activations: number; people: number; exposed_people: number; activated_exposed_people: number }>((p) => `${head(p)},
      act as (select e.element_key, e.screen_key, e.actor_person_id from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'element.activated'),
      exp as (select e.element_key, e.screen_key, e.actor_person_id from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'element.exposed'),
      -- Por (elemento, tela, pessoa): acionamentos e se foi exposta; depois agrega (sem subconsulta por linha).
      per_person as (select coalesce(a.element_key, x.element_key) element_key, coalesce(a.screen_key, x.screen_key) screen_key, coalesce(a.n, 0) activations, a.n is not null activated, x.actor_person_id is not null exposed
        from (select element_key, screen_key, actor_person_id, count(*) n from act group by 1, 2, 3) a
        full join (select distinct element_key, screen_key, actor_person_id from exp) x on x.element_key = a.element_key and x.screen_key = a.screen_key and x.actor_person_id = a.actor_person_id)
      select element_key, screen_key, sum(activations)::int activations, count(*) filter (where activated)::int people, count(*) filter (where exposed)::int exposed_people,
        count(*) filter (where exposed and activated)::int activated_exposed_people
      from per_person group by 1, 2 order by activations desc`),
    run<{ element_key: string; interaction: string; n: number }>((p) => `${head(p)}
      select e.element_key, e.properties->>'interaction' interaction, count(*)::int n from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'element.activated' group by 1, 2`),
    run<{ from_screen: string; to_screen: string; n: number }>((p) => `${head(p)},
      seq as (select e.tab_id, e.screen_key, lag(e.screen_key) over (partition by e.tab_id order by e.occurred_at, e.id) previous from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'screen.viewed')
      select previous from_screen, screen_key to_screen, count(*)::int n from seq where previous is not null and previous <> screen_key group by 1, 2 order by n desc limit 40`),
    run<{ screen_key: string; n: number }>((p) => `${head(p)}
      select e.screen_key, count(*)::int n from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'screen.viewed' and (e.properties->>'entry')::boolean group by 1 order by n desc`),
    run<{ screen_key: string; observed: number; inferred: number }>((p) => `${head(p)},
      last_view as (select distinct on (e.usage_session_id, e.tab_id) e.usage_session_id, e.tab_id, e.screen_key, e.screen_instance_id from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'screen.viewed' order by e.usage_session_id, e.tab_id, e.occurred_at desc, e.id desc)
      select lv.screen_key, count(*) filter (where exists (select 1 from usage_events l where l.organization_id = ${p.typed(ctx.organizationId, "uuid")} and l.screen_instance_id = lv.screen_instance_id and l.event_name = 'screen.left'))::int observed,
        count(*) filter (where not exists (select 1 from usage_events l where l.organization_id = ${p.typed(ctx.organizationId, "uuid")} and l.screen_instance_id = lv.screen_instance_id and l.event_name = 'screen.left'))::int inferred
      from last_view lv group by 1 order by (count(*)) desc`),
    run<{ screen_key: string; element_key: string; n: number }>((p) => `${head(p)}
      select e.screen_key, e.element_key, count(*)::int n from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'element.activated' group by 1, 2 order by n desc limit 200`),
    run<{ content_key: string; views: number; d25: number; d50: number; d75: number; d100: number; fits: number }>((p) => `${head(p)}
      select e.properties->>'contentKey' content_key, count(distinct e.screen_instance_id)::int views,
        count(distinct e.screen_instance_id) filter (where (e.properties->>'depth')::int >= 25)::int d25, count(distinct e.screen_instance_id) filter (where (e.properties->>'depth')::int >= 50)::int d50,
        count(distinct e.screen_instance_id) filter (where (e.properties->>'depth')::int >= 75)::int d75, count(distinct e.screen_instance_id) filter (where (e.properties->>'depth')::int = 100)::int d100,
        count(distinct e.screen_instance_id) filter (where (e.properties->>'fitsViewport')::boolean)::int fits
      from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'content.scrolled' group by 1`),
    run<{ surface: string; searches: number; empty: number; opened: number; people: number }>((p) => `${head(p)}
      select e.properties->>'surface' surface, count(*) filter (where e.event_name = 'search.performed')::int searches,
        count(*) filter (where e.event_name = 'search.performed' and (e.properties->>'empty')::boolean)::int empty,
        count(*) filter (where e.event_name = 'search.result_opened')::int opened, count(distinct e.actor_person_id)::int people
      from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name in ('search.performed', 'search.result_opened') group by 1`),
    run<{ surface: string; filter_key: string; uses: number; people: number }>((p) => `${head(p)}
      select e.properties->>'surface' surface, e.properties->>'filterKey' filter_key, count(*)::int uses, count(distinct e.actor_person_id)::int people
      from usage_events e where ${rawWhere(p, ctx, current)} and e.event_name = 'filter.applied' group by 1, 2 order by uses desc`),
    run<{ stage: string; n: number }>((p) => `${head(p)}
      select coalesce(e.properties->>'stage', 'REQUESTED') stage, count(*)::int n from usage_events e
      where e.organization_id = ${p.typed(ctx.organizationId, "uuid")} and e.occurred_at >= ${p.typed(current.start, "timestamptz")} and e.occurred_at < ${p.typed(current.end, "timestamptz")}
        and (e.event_name = 'usability.export' or (e.event_name = 'action.started' and e.properties->>'actionKey' = 'usability.export')) group by 1`),
  ])

  const totalViews = screens.reduce((sum, row) => sum + row.views, 0)
  const interactionsByElement = new Map<string, Record<string, number>>()
  for (const row of interactions) interactionsByElement.set(row.element_key, { ...(interactionsByElement.get(row.element_key) ?? {}), [row.interaction]: row.n })
  const coverage = {
    navigation: familyCoverage(coverageState, ["NAVIGATION"], current.start, current.end),
    elements: familyCoverage(coverageState, ["ELEMENT"], current.start, current.end),
    scroll: familyCoverage(coverageState, ["SCROLL"], current.start, current.end),
    search: familyCoverage(coverageState, ["SEARCH"], current.start, current.end),
  }
  const freshness = await loadFreshness(db, ctx.organizationId, ctx.now)
  return {
    meta: metaOf(ctx, freshness, { coverage, retention: { rawRetentionDays: ctx.settings.rawRetentionDays, detailAvailableFrom: retentionStart.toISOString(), periodBeforeRetention: current.start < retentionStart } }),
    screens: screens.map((row) => ({ screenKey: row.screen_key, label: SCREEN_BY_KEY.get(row.screen_key)?.label ?? row.screen_key, area: SCREEN_BY_KEY.get(row.screen_key)?.area ?? null, views: row.views, people: row.people, sessions: row.sessions, medianActiveSeconds: row.median_seconds === null ? null : Math.round(row.median_seconds), p95ActiveSeconds: row.p95_seconds === null ? null : Math.round(row.p95_seconds), sharePercent: totalViews > 0 ? Math.round((row.views / totalViews) * 1000) / 10 : null })),
    totalViews,
    features: features.map((row) => ({ featureKey: row.feature_key, label: FEATURE_BY_KEY.get(row.feature_key)?.label ?? row.feature_key, people: row.people, events: row.events, recurrentPeople: row.recurrent_people, succeeded: row.succeeded, failed: row.failed })),
    actions: officialActions.map((row) => ({ actionKey: row.action_key, label: USAGE_ACTION_LABELS[row.action_key as keyof typeof USAGE_ACTION_LABELS] ?? row.action_key, feature: ACTION_FEATURE[row.action_key as keyof typeof ACTION_FEATURE] ?? null, started: row.started, succeeded: row.succeeded, failed: row.failed, cancelled: row.cancelled })),
    elements: elements.map((row) => {
      const definition = ELEMENT_BY_KEY.get(row.element_key)
      const exposureMeasured = Boolean(definition?.central) && row.exposed_people > 0
      return {
        elementKey: row.element_key,
        label: definition?.label ?? row.element_key,
        screenKey: row.screen_key,
        screenLabel: SCREEN_BY_KEY.get(row.screen_key)?.label ?? row.screen_key,
        activations: row.activations,
        people: row.people,
        interactions: interactionsByElement.get(row.element_key) ?? {},
        exposureMeasured,
        exposedPeople: exposureMeasured ? row.exposed_people : null,
        activationRate: exposureMeasured ? Math.round((row.activated_exposed_people / row.exposed_people) * 1000) / 10 : null,
        activatedAmongExposed: exposureMeasured ? row.activated_exposed_people : null,
      }
    }),
    transitions: transitions.map((row) => ({ from: row.from_screen, fromLabel: SCREEN_BY_KEY.get(row.from_screen)?.label ?? row.from_screen, to: row.to_screen, toLabel: SCREEN_BY_KEY.get(row.to_screen)?.label ?? row.to_screen, count: row.n })),
    entries: entries.map((row) => ({ screenKey: row.screen_key, label: SCREEN_BY_KEY.get(row.screen_key)?.label ?? row.screen_key, count: row.n })),
    exits: exits.map((row) => ({ screenKey: row.screen_key, label: SCREEN_BY_KEY.get(row.screen_key)?.label ?? row.screen_key, observed: row.observed, inferred: row.inferred })),
    heatmap: heat.map((row) => ({ screenKey: row.screen_key, screenLabel: SCREEN_BY_KEY.get(row.screen_key)?.label ?? row.screen_key, elementKey: row.element_key, elementLabel: ELEMENT_BY_KEY.get(row.element_key)?.label ?? row.element_key, count: row.n })),
    scroll: USAGE_CONTENTS.map((content) => {
      const row = scroll.find((item) => item.content_key === content.key)
      return { contentKey: content.key, label: content.label, views: row?.views ?? 0, reached: { 25: row?.d25 ?? 0, 50: row?.d50 ?? 0, 75: row?.d75 ?? 0, 100: row?.d100 ?? 0 }, fitsViewport: row?.fits ?? 0 }
    }),
    search: USAGE_SEARCH_SURFACES.map((surface) => {
      const row = search.find((item) => item.surface === surface.key)
      return { surface: surface.key, label: surface.label, searches: row?.searches ?? 0, empty: row?.empty ?? 0, resultOpened: row?.opened ?? 0, people: row?.people ?? 0 }
    }),
    filters: filters.map((row) => ({ surface: row.surface, filterKey: row.filter_key, uses: row.uses, people: row.people })),
    exports: Object.fromEntries(exports.map((row) => [row.stage, row.n])),
  }
}
