import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { ratingsHistorySql } from "../../../feedback-rating/application/usage-analytics-reader.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { DIFFICULTY_RULES, DIFFICULTY_SIGNAL_LABELS, FUNNEL_DEFINITION_VERSION, FUNNELS } from "../../domain/journeys.js"
import { rate } from "../../domain/metric-value.js"
import { ELEMENT_BY_KEY, USAGE_ELEMENTS } from "../../domain/usage-elements.js"
import { activePeopleSql, scopeCtes, windowsOf } from "./activity-sql.js"
import { funnelEntitySql } from "./journey-funnels-sql.js"
import { familyCoverage, loadCoverageState, loadFreshness, metaOf, type UsabilityContext } from "./usability-context.js"

/**
 * JORNADAS E DIFICULDADES — funis (mesma entidade em todas as etapas, janela de conversão, pendente ≠ desistência) e sinais
 * de dificuldade como heurísticas observacionais, cada um com contagem, base, comparação e o recorte para conferir.
 */
type Queryable = Pick<Database, "query">

const sec = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value)))

export async function journeysQuery(db: Queryable, ctx: UsabilityContext) {
  const coverageState = await loadCoverageState(db, ctx.organizationId, ctx.now)
  const measuredSince = (() => {
    const coverage = familyCoverage(coverageState, ["ELEMENT", "NAVIGATION"], ctx.period.start, ctx.period.end)
    return coverage.from ? new Date(coverage.from) : null
  })()
  const funnels = await Promise.all(
    FUNNELS.map(async (funnel) => {
      const p = new SqlParams()
      const steps = funnel.steps.length
      const now = p.typed(ctx.now, "timestamptz")
      const t = (index: number) => `t${index}`
      const columns: string[] = []
      for (let index = 1; index <= steps; index += 1) {
        columns.push(`count(*) filter (where ${t(index)} is not null)::int s${index}`)
        if (index > 1) {
          columns.push(`count(*) filter (where ${t(index - 1)} is not null and ${t(index)} is null and deadline > ${now})::int pending${index}`)
          columns.push(`percentile_cont(0.5) within group (order by extract(epoch from ${t(index)} - t1)) filter (where ${t(index)} is not null) p50_${index}`)
          columns.push(`percentile_cont(0.95) within group (order by extract(epoch from ${t(index)} - t1)) filter (where ${t(index)} is not null) p95_${index}`)
        }
      }
      const result = await db.query<Record<string, number | null>>(`with ${scopeCtes(p, ctx)} select ${columns.join(", ")} from (${funnelEntitySql(p, ctx, funnel.key, measuredSince)}) f`, p.values)
      const row = result.rows[0] ?? {}
      const first = Number(row.s1 ?? 0)
      return {
        key: funnel.key,
        label: funnel.label,
        correlation: funnel.correlation,
        windowLabel: funnel.windowLabel.replace(/\bN dias\b/g, `${ctx.filters.cohortWindow} dia(s)`),
        steps: funnel.steps.map((step, index) => {
          const position = index + 1
          const reached = Number(row[`s${position}`] ?? 0)
          const previous = position === 1 ? reached : Number(row[`s${position - 1}`] ?? 0)
          return {
            key: step.key,
            label: step.label,
            source: step.source,
            reached,
            conversionFromPrevious: position === 1 ? null : rate(reached, previous),
            conversionFromStart: position === 1 ? null : rate(reached, first),
            pending: position === 1 ? 0 : Number(row[`pending${position}`] ?? 0),
            stopped: position === steps ? null : reached - Number(row[`s${position + 1}`] ?? 0) - Number(row[`pending${position + 1}`] ?? 0),
            timeFromStart: position === 1 ? null : { median: sec(row[`p50_${position}`]), p95: sec(row[`p95_${position}`]) },
          }
        }),
      }
    }),
  )

  const signals = await difficultySignals(db, ctx)
  let stoppedCases: Record<string, unknown>[] | null = null
  const stoppedFilter = ctx.filters.segment ? /^([A-Z_]+)_S(\d)$/.exec(ctx.filters.segment) : null
  if (ctx.filters.segment && !stoppedFilter) throw new DomainError("Segmento inválido.", "USABILITY_SEGMENT_INVALID", 400)
  if (stoppedFilter && ctx.can.people) {
    const [, funnelKey, stepText] = stoppedFilter as unknown as [string, string, string]
    const funnel = FUNNELS.find((item) => item.key === funnelKey)
    const step = Number(stepText)
    if (!funnel || step < 1 || step >= funnel.steps.length) throw new DomainError("Etapa de funil inválida.", "USABILITY_SEGMENT_INVALID", 400)
    const p = new SqlParams()
    const rows = await db.query<Record<string, unknown>>(
      `with ${scopeCtes(p, ctx)} select f.entity_id, f.person_id, pop.name, f.t1, f.t${step} reached_at, f.deadline from (${funnelEntitySql(p, ctx, funnel.key, measuredSince)}) f
       join (${populationSql(p, ctx.organizationId)}) pop on pop.person_id = f.person_id
       where f.t${step} is not null and f.t${step + 1} is null and f.deadline <= ${p.typed(ctx.now, "timestamptz")}
       order by f.t1 desc, f.entity_id, f.person_id limit ${p.add(ctx.filters.pageSize)} offset ${p.add((ctx.filters.page - 1) * ctx.filters.pageSize)}`,
      p.values,
    )
    stoppedCases = rows.rows.map((row) => ({ entityId: row.entity_id, personId: row.person_id, personName: row.name, startedAt: (row.t1 as Date).toISOString(), lastStepAt: (row.reached_at as Date).toISOString(), stoppedAfter: funnel.steps[step - 1]!.label }))
  }
  const freshness = await loadFreshness(db, ctx.organizationId, ctx.now)
  return {
    meta: metaOf(ctx, freshness, { coverage: { navigation: familyCoverage(coverageState, ["NAVIGATION"], ctx.period.start, ctx.period.end), voice: familyCoverage(coverageState, ["VOICE"], ctx.period.start, ctx.period.end) }, funnelVersion: FUNNEL_DEFINITION_VERSION, difficultyVersion: DIFFICULTY_RULES.version, cohortWindowDays: ctx.filters.cohortWindow }),
    funnels,
    signals,
    stoppedCases,
    identified: ctx.can.people,
  }
}

export type DifficultySignal = { key: string; label: string; heuristic: true; value: number; base: number | null; rate: number | null; previous: number | null; detail: { label: string; count: number }[]; evidence: string; drill: { tab: string; params: Record<string, string> } }

/** Sinais de dificuldade (heurísticas), sempre com base e recorte; nunca score individual. */
export async function difficultySignals(db: Queryable, ctx: UsabilityContext): Promise<DifficultySignal[]> {
  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    return (await db.query<T>(build(p), p.values)).rows
  }
  const { current, previous } = windowsOf(ctx)
  const rules = DIFFICULTY_RULES
  const eventWindow = (p: SqlParams, w = current, alias = "e") => `${alias}.organization_id = ${p.typed(ctx.organizationId, "uuid")} and ${alias}.occurred_at >= ${p.typed(w.start, "timestamptz")} and ${alias}.occurred_at < ${p.typed(w.end, "timestamptz")} and ${alias}.actor_person_id in (select person_id from scope_official)`
  const repeatExpected = USAGE_ELEMENTS.filter((element) => element.repeatExpected).map((element) => element.key)
  const contracted = USAGE_ELEMENTS.filter((element) => element.resultTimeoutMs).map((element) => [element.key, element.resultTimeoutMs!] as const)
  const [rage, noResult, errors, retries, searches, unfinished, voice, ratings, usage] = await Promise.all([
    run<{ element_key: string; incidents: number; people: number }>((p) => `with ${scopeCtes(p, ctx)},
      acts as (select e.element_key, e.screen_instance_id, e.actor_person_id, e.occurred_at, count(*) over (partition by e.screen_instance_id, e.element_key order by e.occurred_at range between interval '${rules.rageClick.windowMs} milliseconds' preceding and current row) burst
        from usage_events e where ${eventWindow(p)} and e.event_name = 'element.activated' and e.element_key <> all(${p.typed(repeatExpected, "text[]")}))
      select element_key, count(distinct screen_instance_id)::int incidents, count(distinct actor_person_id)::int people from acts where burst >= ${rules.rageClick.activations} group by 1 order by incidents desc`),
    run<{ element_key: string; activations: number; without_result: number }>((p) => `with ${scopeCtes(p, ctx)},
      contracts as (select * from unnest(${p.typed(contracted.map(([key]) => key), "text[]")}, ${p.typed(contracted.map(([, ms]) => ms), "int[]")}) as c(element_key, timeout_ms))
      select a.element_key, count(*)::int activations, count(*) filter (where not exists (select 1 from usage_events o where o.organization_id = a.organization_id and o.correlation_id = a.correlation_id and o.event_name like 'action.%'
        and o.occurred_at >= a.occurred_at and o.occurred_at <= a.occurred_at + make_interval(secs => c.timeout_ms / 1000.0)) and a.occurred_at + make_interval(secs => c.timeout_ms / 1000.0) < ${p.typed(ctx.now, "timestamptz")})::int without_result
      from usage_events a join contracts c on c.element_key = a.element_key where ${eventWindow(p, current, "a")} and a.event_name = 'element.activated' and a.correlation_id is not null group by 1`),
    run<{ action_key: string; error_code: string | null; n: number; people: number }>((p) => `with ${scopeCtes(p, ctx)}
      select e.properties->>'actionKey' action_key, e.properties->>'errorCode' error_code, count(*)::int n, count(distinct e.actor_person_id)::int people from usage_events e where ${eventWindow(p)} and e.event_name = 'action.failed' group by 1, 2 order by n desc`),
    run<{ n: number }>((p) => `with ${scopeCtes(p, ctx)},
      outcomes as (select e.actor_person_id, e.properties->>'actionKey' action_key, e.event_name, e.occurred_at from usage_events e where ${eventWindow(p)} and e.event_name in ('action.failed', 'action.succeeded'))
      select count(*)::int n from outcomes s where s.event_name = 'action.succeeded' and (select count(*) from outcomes f where f.actor_person_id = s.actor_person_id and f.action_key = s.action_key and f.event_name = 'action.failed'
        and f.occurred_at < s.occurred_at and f.occurred_at >= s.occurred_at - interval '${rules.retryWindowMinutes} minutes') >= 2`),
    run<{ searches: number; empty: number }>((p) => `with ${scopeCtes(p, ctx)} select count(*)::int searches, count(*) filter (where (e.properties->>'empty')::boolean)::int empty from usage_events e where ${eventWindow(p)} and e.event_name = 'search.performed'`),
    run<{ started: number; unfinished: number }>((p) => `with ${scopeCtes(p, ctx)}
      select count(*)::int started, count(*) filter (where not exists (select 1 from usage_events o where o.organization_id = s.organization_id and o.correlation_id = s.correlation_id and o.event_name in ('action.succeeded', 'action.failed', 'action.cancelled'))
        and s.occurred_at < ${p.typed(ctx.now, "timestamptz")} - interval '${rules.actionOutcomeWindowMinutes} minutes')::int unfinished
      from usage_events s where ${eventWindow(p, current, "s")} and s.event_name = 'action.started' and s.correlation_id is not null`),
    run<{ intents: number; failed: number; denied: number }>((p) => `with ${scopeCtes(p, ctx)}
      select count(distinct e.properties->>'voiceIntentId') filter (where e.event_name = 'voice.connection')::int intents,
        count(distinct e.properties->>'voiceIntentId') filter (where e.event_name = 'voice.connection' and e.properties->>'stage' = 'FAILED')::int failed,
        count(*) filter (where e.event_name = 'voice.mic_permission' and e.properties->>'result' in ('DENIED', 'UNAVAILABLE'))::int denied
      from usage_events e where ${eventWindow(p)} and e.event_name in ('voice.connection', 'voice.mic_permission')`),
    run<{ window: string; up: number; down: number }>((p) => {
      const org = p.typed(ctx.organizationId, "uuid")
      const part = (label: string, w: typeof current) => `select '${label}' as window, count(*) filter (where r.value = 'UP')::int up, count(*) filter (where r.value = 'DOWN')::int down from (${ratingsHistorySql(org)}) r
        where r.created_at >= ${p.typed(w.start, "timestamptz")} and r.created_at < ${p.typed(w.end, "timestamptz")} and r.person_id in (select person_id from scope_official)`
      return `with ${scopeCtes(p, ctx)} ${part("CURRENT", current)}${previous ? ` union all ${part("PREVIOUS", previous)}` : ""}`
    }),
    run<{ window: string; n: number }>((p) => `with ${scopeCtes(p, ctx)} select 'CURRENT' as window, count(*)::int n from (${activePeopleSql(p, ctx, current)}) a${previous ? ` union all select 'PREVIOUS', count(*)::int from (${activePeopleSql(p, ctx, previous)}) b` : ""}`),
  ])

  const signals: DifficultySignal[] = []
  const add = (signal: Omit<DifficultySignal, "label" | "heuristic">) => signals.push({ ...signal, label: DIFFICULTY_SIGNAL_LABELS[signal.key] ?? signal.key, heuristic: true })
  const rageTotal = rage.reduce((sum, row) => sum + row.incidents, 0)
  if (rageTotal > 0) add({ key: "RAGE_CLICK", value: rageTotal, base: null, rate: null, previous: null, detail: rage.slice(0, 5).map((row) => ({ label: ELEMENT_BY_KEY.get(row.element_key)?.label ?? row.element_key, count: row.incidents })), evidence: `${rules.rageClick.activations}+ acionamentos do mesmo elemento em até ${rules.rageClick.windowMs / 1000} s (controles de repetição esperada excluídos).`, drill: { tab: "screens", params: {} } })
  const noResultTotal = noResult.reduce((sum, row) => sum + row.without_result, 0)
  const contractedActivations = noResult.reduce((sum, row) => sum + row.activations, 0)
  if (noResultTotal > 0) add({ key: "NO_RESULT", value: noResultTotal, base: contractedActivations, rate: rate(noResultTotal, contractedActivations), previous: null, detail: noResult.filter((row) => row.without_result > 0).map((row) => ({ label: ELEMENT_BY_KEY.get(row.element_key)?.label ?? row.element_key, count: row.without_result })), evidence: "Elemento com contrato de resultado acionado sem início, sucesso ou erro observável no prazo do contrato.", drill: { tab: "screens", params: {} } })
  const errorTotal = errors.reduce((sum, row) => sum + row.n, 0)
  if (errorTotal > 0) add({ key: "ACTION_ERRORS", value: errorTotal, base: null, rate: null, previous: null, detail: errors.slice(0, 6).map((row) => ({ label: `${row.action_key}${row.error_code ? ` · ${row.error_code}` : ""}`, count: row.n })), evidence: "Falhas devolvidas às ações de interface (erro funcional ou de rede).", drill: { tab: "screens", params: {} } })
  const validation = errors.filter((row) => row.error_code?.startsWith("VALIDATION")).reduce((sum, row) => sum + row.n, 0)
  if (validation > 0) add({ key: "VALIDATION_ERRORS", value: validation, base: errorTotal, rate: rate(validation, errorTotal), previous: null, detail: [], evidence: "Ações recusadas por validação.", drill: { tab: "screens", params: {} } })
  const retriesTotal = retries[0]?.n ?? 0
  if (retriesTotal > 0) add({ key: "REPEATED_ATTEMPTS", value: retriesTotal, base: null, rate: null, previous: null, detail: [], evidence: `Sucessos precedidos de 2+ falhas da mesma ação em até ${rules.retryWindowMinutes} min.`, drill: { tab: "screens", params: {} } })
  const search = searches[0] ?? { searches: 0, empty: 0 }
  if (search.empty > 0) add({ key: "EMPTY_SEARCH", value: search.empty, base: search.searches, rate: rate(search.empty, search.searches), previous: null, detail: [], evidence: "Buscas sem resultado (a consulta digitada não é guardada).", drill: { tab: "screens", params: {} } })
  const pendingOps = unfinished[0] ?? { started: 0, unfinished: 0 }
  if (pendingOps.unfinished > 0) add({ key: "UNFINISHED_OPERATIONS", value: pendingOps.unfinished, base: pendingOps.started, rate: rate(pendingOps.unfinished, pendingOps.started), previous: null, detail: [], evidence: `Ações iniciadas sem sucesso, erro ou cancelamento observado em ${rules.actionOutcomeWindowMinutes} min (ausência de evento ≠ falha).`, drill: { tab: "screens", params: {} } })
  const voiceRow = voice[0] ?? { intents: 0, failed: 0, denied: 0 }
  if (voiceRow.intents >= rules.voiceFailure.minIntents && (rate(voiceRow.failed, voiceRow.intents) ?? 0) >= rules.voiceFailure.failurePercent) add({ key: "VOICE_FAILURES", value: voiceRow.failed, base: voiceRow.intents, rate: rate(voiceRow.failed, voiceRow.intents), previous: null, detail: [{ label: "Microfone negado/indisponível", count: voiceRow.denied }], evidence: `Falhas de conexão de voz ≥ ${rules.voiceFailure.failurePercent}% das intenções (mínimo ${rules.voiceFailure.minIntents}).`, drill: { tab: "conversations", params: {} } })
  const cur = ratings.find((row) => row.window === "CURRENT") ?? { up: 0, down: 0 }
  const prev = ratings.find((row) => row.window === "PREVIOUS")
  const totalRatings = cur.up + cur.down
  if (totalRatings >= rules.lowUtility.minRatings && (rate(cur.down, totalRatings) ?? 0) >= rules.lowUtility.downShare) add({ key: "LOW_UTILITY", value: cur.down, base: totalRatings, rate: rate(cur.down, totalRatings), previous: prev ? rate(prev.down, prev.up + prev.down) : null, detail: [], evidence: `Avaliações "não foi útil" ≥ ${rules.lowUtility.downShare}% (mínimo ${rules.lowUtility.minRatings} avaliações) — compare com o período anterior.`, drill: { tab: "feedbacks", params: {} } })
  const activeNow = usage.find((row) => row.window === "CURRENT")?.n ?? 0
  const activeBefore = usage.find((row) => row.window === "PREVIOUS")?.n ?? null
  if (activeBefore !== null && activeBefore >= rules.usageDrop.minBase && activeNow < activeBefore * (1 - rules.usageDrop.dropPercent / 100)) add({ key: "USAGE_DROP", value: activeNow, base: activeBefore, rate: rate(activeBefore - activeNow, activeBefore), previous: activeBefore, detail: [], evidence: `Pessoas ativas caíram ${rules.usageDrop.dropPercent}%+ frente ao período anterior de mesma duração (base mínima ${rules.usageDrop.minBase}). Verifique a cobertura antes de concluir.`, drill: { tab: "people", params: { segment: "ACTIVE" } } })
  return signals
}
