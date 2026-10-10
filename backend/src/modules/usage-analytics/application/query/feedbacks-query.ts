import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { readConfirmationEventsSql } from "../../../feedback-application/application/usage-analytics-reader.js"
import { DISLIKE_REASON_LABELS, ratingsHistorySql } from "../../../feedback-rating/application/usage-analytics-reader.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { rate } from "../../domain/metric-value.js"
import { scopeCtes } from "./activity-sql.js"
import { FEEDBACK_SEGMENT_LABELS, FEEDBACK_SEGMENTS, feedbackCohortSql, feedbackSegmentColumn, type FeedbackSegment } from "./feedback-cohort-sql.js"
import { familyCoverage, loadCoverageState, loadFreshness, metaOf, officialCoverage, structureBasisFor, STRUCTURE_BASIS_LABELS, type UsabilityContext } from "./usability-context.js"

/**
 * FEEDBACKS E CIÊNCIA — volume no período (independe da data de publicação) e COORTE de entrega (avanço depois da entrega, em
 * controles separados). Expor, abrir, ouvir, avaliar, confirmar ciência e cumprir a orientação são fatos diferentes; a pessoa
 * pode avaliar sem aplicar e confirmar ciência direto no Acompanhamento — os ramos aparecem separados, sem sequência imposta.
 */
type Queryable = Pick<Database, "query">
export const ABANDONMENT_WINDOW_MINUTES = 30
export const PENDING_ACK_BUCKETS = [{ key: "UP_TO_1", label: "Até 1 dia", from: 0, to: 1 }, { key: "2_3", label: "2–3 dias", from: 1, to: 3 }, { key: "4_7", label: "4–7 dias", from: 3, to: 7 }, { key: "8_14", label: "8–14 dias", from: 7, to: 14 }, { key: "OVER_14", label: "Mais de 14 dias", from: 14, to: null }] as const

const seconds = (value: number | string | null) => (value === null ? null : Math.round(Number(value)))

export async function feedbacksQuery(db: Queryable, ctx: UsabilityContext, options: { listAll?: boolean } = {}) {
  const segment = (ctx.filters.segment ?? "AVAILABLE") as FeedbackSegment
  if (!FEEDBACK_SEGMENTS.includes(segment)) throw new DomainError("Segmento inválido.", "USABILITY_SEGMENT_INVALID", 400)
  const coverageState = await loadCoverageState(db, ctx.organizationId, ctx.now)
  const exposureCoverage = familyCoverage(coverageState, ["ELEMENT", "NAVIGATION"], ctx.period.start, ctx.period.end)
  const measuredSince = exposureCoverage.from ? new Date(exposureCoverage.from) : null
  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    return (await db.query<T>(build(p), p.values)).rows
  }

  const [summaryRows, timeRows, agingRows, kindRows] = await Promise.all([
    run<Record<string, number>>((p) => `select ${FEEDBACK_SEGMENTS.map((value) => `count(*) filter (where ${feedbackSegmentColumn(value)})::int ${feedbackSegmentColumn(value)}`).join(", ")},
        count(*) filter (where not mature)::int immature, count(*) filter (where current_value = 'UP')::int up, count(*) filter (where current_value = 'DOWN')::int down,
        count(*) filter (where current_value = 'NONE')::int withdrawn, count(*) filter (where rating_rows > 1)::int changed,
        count(distinct recipient_person_id)::int recipients, count(distinct recipient_person_id) filter (where current_value in ('UP', 'DOWN'))::int raters,
        count(*) filter (where exposure_measured and opened_at is not null)::int opened_measured, count(*) filter (where exposure_measured)::int measured,
        count(*) filter (where exposure_measured and exposed_at is not null and opened_at is not null)::int opened_among_exposed, count(*) filter (where exposure_measured and exposed_at is not null)::int exposed_measured,
        count(*) filter (where opened_at is not null and current_value in ('UP', 'DOWN'))::int rated_among_opened
      from (${feedbackCohortSql(p, ctx, measuredSince)}) x`),
    run<Record<string, number | null>>((p) => `select
        percentile_cont(0.5) within group (order by extract(epoch from opened_at - available_at)) filter (where opened_at is not null) open_p50,
        percentile_cont(0.95) within group (order by extract(epoch from opened_at - available_at)) filter (where opened_at is not null) open_p95,
        percentile_cont(0.5) within group (order by extract(epoch from first_rated_at - available_at)) filter (where first_rated_at is not null) rating_p50,
        percentile_cont(0.95) within group (order by extract(epoch from first_rated_at - available_at)) filter (where first_rated_at is not null) rating_p95,
        percentile_cont(0.5) within group (order by extract(epoch from application_started_at - available_at)) filter (where application_started_at is not null) application_p50,
        percentile_cont(0.95) within group (order by extract(epoch from application_started_at - available_at)) filter (where application_started_at is not null) application_p95,
        percentile_cont(0.5) within group (order by extract(epoch from acknowledged_at - available_at)) filter (where acknowledged_at is not null) ack_p50,
        percentile_cont(0.95) within group (order by extract(epoch from acknowledged_at - available_at)) filter (where acknowledged_at is not null) ack_p95
      from (${feedbackCohortSql(p, ctx, measuredSince)}) x`),
    run<{ bucket: string; n: number }>((p) => `select case
        ${PENDING_ACK_BUCKETS.map((bucket) => `when ${p.typed(ctx.now, "timestamptz")} - available_at ${bucket.to === null ? `> interval '${bucket.from} days'` : `<= interval '${bucket.to} days'`} then '${bucket.key}'`).join(" ")} end bucket, count(*)::int n
      from (${feedbackCohortSql(p, ctx, measuredSince)}) x where acknowledged_at is null group by 1`),
    run<{ feedback_kind: string; team_name: string | null; up: number; down: number; available: number; acked: number }>((p) => `select x.feedback_kind, pop.team_name, count(*) filter (where x.current_value = 'UP')::int up, count(*) filter (where x.current_value = 'DOWN')::int down,
        count(*)::int available, count(*) filter (where x.acknowledged_at is not null)::int acked
      from (${feedbackCohortSql(p, ctx, measuredSince)}) x join (${populationSql(p, ctx.organizationId)}) pop on pop.person_id = x.recipient_person_id group by 1, 2 order by 1, 2`),
  ])
  const s = summaryRows[0] ?? {}
  const t = timeRows[0] ?? {}
  const n = (key: string) => Number(s[key] ?? 0)
  const count = (value: FeedbackSegment) => n(feedbackSegmentColumn(value))

  // Volume no período (qualquer data de publicação): fatos ocorridos dentro de [início, fim).
  const volume = await run<Record<string, number>>((p) => {
    const org = p.typed(ctx.organizationId, "uuid")
    const start = p.typed(ctx.period.start, "timestamptz")
    const end = p.typed(ctx.period.end, "timestamptz")
    return `with ${scopeCtes(p, ctx)}
      select
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'element.exposed' and e.element_key = 'feedback.card' and e.actor_person_id = e.subject_person_id and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) exposures,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'screen.viewed' and e.screen_key in ('feedback.detail', 'feedback.session') and e.actor_person_id = e.subject_person_id and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) openings,
        (select count(*)::int from (${ratingsHistorySql(org)}) r where r.created_at >= ${start} and r.created_at < ${end} and r.person_id in (select person_id from scope_official)) rating_changes,
        (select count(*)::int from (${ratingsHistorySql(org)}) r where r.created_at >= ${start} and r.created_at < ${end} and r.value = 'UP' and r.person_id in (select person_id from scope_official)) rating_up,
        (select count(*)::int from (${ratingsHistorySql(org)}) r where r.created_at >= ${start} and r.created_at < ${end} and r.value = 'DOWN' and r.person_id in (select person_id from scope_official)) rating_down,
        (select count(*)::int from (${ratingsHistorySql(org)}) r where r.created_at >= ${start} and r.created_at < ${end} and r.value = 'NONE' and r.person_id in (select person_id from scope_official)) rating_withdrawn,
        (select count(*)::int from (${readConfirmationEventsSql(org)}) c where c.event = 'CONFIRMED' and not c.already_confirmed and c.occurred_at >= ${start} and c.occurred_at < ${end} and c.person_id in (select person_id from scope_official)) confirmations,
        (select count(*)::int from (${readConfirmationEventsSql(org)}) c where c.event = 'CONFIRMED' and c.already_confirmed and c.occurred_at >= ${start} and c.occurred_at < ${end} and c.person_id in (select person_id from scope_official)) repeated_confirmations,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.lifecycle' and e.properties->>'stage' = 'STARTED' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) applications_started,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.lifecycle' and e.properties->>'stage' = 'RESUMED' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) applications_resumed,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.lifecycle' and e.properties->>'stage' = 'PAUSED' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) applications_paused,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.presentation' and e.properties->>'stage' = 'STARTED' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) presentations_started,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.presentation' and e.properties->>'stage' = 'COMPLETED' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) presentations_completed,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.presentation' and e.properties->>'stage' = 'INTERRUPTED' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) presentations_interrupted,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.invite' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.properties->>'decision' = 'OFFER' and e.actor_person_id in (select person_id from scope_official)) invites_offered,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.invite' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.properties->>'decision' = 'ACCEPT' and e.actor_person_id in (select person_id from scope_official)) invites_accepted,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.invite' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.properties->>'decision' = 'SNOOZE' and e.actor_person_id in (select person_id from scope_official)) invites_snoozed,
        (select count(*)::int from usage_events e where e.organization_id = ${org} and e.event_name = 'element.activated' and e.element_key = 'feedback.material.open' and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.actor_person_id in (select person_id from scope_official)) materials_opened`
  })

  const reasons = await run<{ reason: string; n: number }>((p) => {
    const org = p.typed(ctx.organizationId, "uuid")
    return `with ${scopeCtes(p, ctx)} select r.reason, count(*)::int n from (${ratingsHistorySql(org)}) r
      where r.value = 'DOWN' and r.created_at >= ${p.typed(ctx.period.start, "timestamptz")} and r.created_at < ${p.typed(ctx.period.end, "timestamptz")} and r.person_id in (select person_id from scope_official) group by 1 order by 2 desc`
  })
  const reasonsPrevious = ctx.comparison
    ? await run<{ reason: string; n: number }>((p) => {
        const org = p.typed(ctx.organizationId, "uuid")
        return `with ${scopeCtes(p, ctx)} select r.reason, count(*)::int n from (${ratingsHistorySql(org)}) r
          where r.value = 'DOWN' and r.created_at >= ${p.typed(ctx.comparison!.start, "timestamptz")} and r.created_at < ${p.typed(ctx.comparison!.end, "timestamptz")} and r.person_id in (select person_id from scope_official) group by 1`
      })
    : []

  const confirmation = await confirmationBlock(db, ctx)
  let comments: { ratingId: string; reason: string; reasonLabel: string; comment: string; createdAt: string; sourceKind: string; sourceId: string; personId: string | null; personName: string | null }[] | null = null
  if (ctx.can.comments) {
    comments = (
      await run<{ rating_id: string; reason: string; comment: string; created_at: Date; source_kind: string; source_id: string; person_id: string; name: string }>((p) => {
        const org = p.typed(ctx.organizationId, "uuid")
        return `with ${scopeCtes(p, ctx)} select r.rating_id, r.reason, r.comment, r.created_at, r.source_kind, r.source_id, r.person_id, pop.name
          from (${ratingsHistorySql(org, { withComment: true })}) r join (${populationSql(p, ctx.organizationId)}) pop on pop.person_id = r.person_id
          where r.value = 'DOWN' and r.created_at >= ${p.typed(ctx.period.start, "timestamptz")} and r.created_at < ${p.typed(ctx.period.end, "timestamptz")} and r.person_id in (select person_id from scope_official)
          order by r.created_at desc limit 200`
      })
    ).map((row) => ({ ratingId: row.rating_id, reason: row.reason, reasonLabel: DISLIKE_REASON_LABELS[row.reason] ?? row.reason, comment: row.comment, createdAt: row.created_at.toISOString(), sourceKind: row.source_kind, sourceId: row.source_id, personId: ctx.can.people ? row.person_id : null, personName: ctx.can.people ? row.name : null }))
  }

  let items: Record<string, unknown>[] | null = null
  if (ctx.can.people) {
    items = (
      await run<Record<string, unknown> & { recipient_person_id: string }>((p) => {
        const base = feedbackCohortSql(p, ctx, measuredSince)
        const limit = options.listAll ? "" : ` limit ${p.add(ctx.filters.pageSize)} offset ${p.add((ctx.filters.page - 1) * ctx.filters.pageSize)}`
        return `select x.*, pop.name recipient_name, pop.team_name from (${base}) x join (${populationSql(p, ctx.organizationId)}) pop on pop.person_id = x.recipient_person_id
          where x.${feedbackSegmentColumn(segment)} order by x.available_at desc, x.source_id${limit}`
      })
    ).map((row) => ({
      sourceKind: row.source_kind, sourceId: row.source_id, recipientPersonId: row.recipient_person_id, recipientName: row.recipient_name, teamName: row.team_name, feedbackKind: row.feedback_kind,
      availableAt: iso(row.available_at), mature: row.mature, exposureMeasured: row.exposure_measured, exposedAt: iso(row.exposed_at), openedAt: iso(row.opened_at), openCount: row.open_count,
      currentRating: row.current_value ?? null, firstRatedAt: iso(row.first_rated_at), acknowledgedAt: iso(row.acknowledged_at), applicationStartedAt: iso(row.application_started_at), applicationCompletedAt: iso(row.application_completed_at), caseId: row.case_id ?? null,
    }))
  }

  const freshness = await loadFreshness(db, ctx.organizationId, ctx.now)
  const available = count("AVAILABLE")
  const measured = n("measured")
  return {
    meta: metaOf(ctx, freshness, {
      coverage: {
        exposure: exposureCoverage,
        publishedFeedback: officialCoverage(coverageState, "PUBLISHED_FEEDBACK", ctx.period.start, ctx.period.end),
        deliveries: officialCoverage(coverageState, "INTERACTION_FEEDBACK_DELIVERY", ctx.period.start, ctx.period.end),
        ratings: officialCoverage(coverageState, "RATINGS", ctx.period.start, ctx.period.end),
        confirmations: officialCoverage(coverageState, "READ_CONFIRMATIONS", ctx.period.start, ctx.period.end),
        applications: officialCoverage(coverageState, "APPLICATIONS", ctx.period.start, ctx.period.end),
      },
      structureBasis: { value: structureBasisFor(ctx, false), label: STRUCTURE_BASIS_LABELS[structureBasisFor(ctx, false)] },
      cohort: { window: ctx.filters.cohortWindow, mode: ctx.filters.conversionMode, immature: n("immature"), label: ctx.filters.conversionMode === "WINDOW" ? `Conversão até ${ctx.filters.cohortWindow} dia(s) após a entrega` : "Conversão até a data de corte (tempo de observação varia por item)" },
    }),
    cohort: {
      available,
      recipients: n("recipients"),
      counts: Object.fromEntries(FEEDBACK_SEGMENTS.map((value) => [value, count(value)])) as Record<FeedbackSegment, number>,
      exposureNotMeasured: count("EXPOSURE_NOT_MEASURED"),
      rates: {
        exposure: { numerator: n("exposed_measured"), denominator: measured, value: rate(n("exposed_measured"), measured) },
        open: { numerator: n("opened_measured"), denominator: measured, value: rate(n("opened_measured"), measured) },
        openAmongExposed: { numerator: n("opened_among_exposed"), denominator: n("exposed_measured"), value: rate(n("opened_among_exposed"), n("exposed_measured")) },
        ratingAmongOpened: { numerator: n("rated_among_opened"), denominator: count("OPENED"), value: rate(n("rated_among_opened"), count("OPENED")) },
        ratingParticipation: { numerator: n("raters"), denominator: n("recipients"), value: rate(n("raters"), n("recipients")) },
        useful: { numerator: n("up"), denominator: n("up") + n("down"), value: rate(n("up"), n("up") + n("down")) },
        ack: { numerator: count("ACKED"), denominator: available, value: rate(count("ACKED"), available) },
        applicationStarted: { numerator: count("APPLICATION_STARTED"), denominator: available, value: rate(count("APPLICATION_STARTED"), available) },
        applicationCompletion: { numerator: count("APPLICATION_COMPLETED"), denominator: count("APPLICATION_STARTED"), value: rate(count("APPLICATION_COMPLETED"), count("APPLICATION_STARTED")) },
      },
      ratings: { up: n("up"), down: n("down"), withdrawn: n("withdrawn"), notRated: count("NOT_RATED"), changed: n("changed"), changeRate: rate(n("changed"), count("RATED") + n("withdrawn")) },
      timeTo: {
        open: { median: seconds(t.open_p50 ?? null), p95: seconds(t.open_p95 ?? null), pending: available - count("OPENED") },
        rating: { median: seconds(t.rating_p50 ?? null), p95: seconds(t.rating_p95 ?? null), pending: count("NOT_RATED") },
        application: { median: seconds(t.application_p50 ?? null), p95: seconds(t.application_p95 ?? null), pending: available - count("APPLICATION_STARTED") },
        ack: { median: seconds(t.ack_p50 ?? null), p95: seconds(t.ack_p95 ?? null), pending: count("PENDING_ACK") },
      },
      pendingAckAging: PENDING_ACK_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label, count: agingRows.find((row) => row.bucket === bucket.key)?.n ?? 0 })),
      byKindAndTeam: kindRows.map((row) => ({ feedbackKind: row.feedback_kind, teamName: row.team_name, available: row.available, acked: row.acked, up: row.up, down: row.down, useful: rate(row.up, row.up + row.down) })),
    },
    volume: volume[0] ?? {},
    reasons: reasons.map((row) => ({ reason: row.reason, label: DISLIKE_REASON_LABELS[row.reason] ?? row.reason, count: row.n, previous: ctx.comparison ? (reasonsPrevious.find((item) => item.reason === row.reason)?.n ?? 0) : null })),
    confirmation,
    comments,
    segment,
    segmentLabel: FEEDBACK_SEGMENT_LABELS[segment],
    total: count(segment),
    page: ctx.filters.page,
    pageSize: ctx.filters.pageSize,
    identified: ctx.can.people,
    items,
  }
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null)

/** Tentativas de confirmação de ciência (fonte oficial `feedback_read_confirmation_events`). Motivos detalhados só com permissão de pessoas. */
async function confirmationBlock(db: Queryable, ctx: UsabilityContext) {
  const p = new SqlParams()
  const org = p.typed(ctx.organizationId, "uuid")
  const start = p.typed(ctx.period.start, "timestamptz")
  const end = p.typed(ctx.period.end, "timestamptz")
  const now = p.typed(ctx.now, "timestamptz")
  const rows = await db.query<Record<string, number | null>>(
    `with ${scopeCtes(p, ctx)},
      events as (select * from (${readConfirmationEventsSql(org)}) c where c.person_id in (select person_id from scope_official)),
      attempts as (
        select a.attempt_id, min(a.occurred_at) filter (where a.event = 'OPENED') opened_at,
          min(a.occurred_at) filter (where a.event in ('FAILED', 'CONFIRMED')) first_submit_at,
          min(a.occurred_at) filter (where a.event = 'CONFIRMED') confirmed_at,
          bool_or(a.event = 'CANCELLED') cancelled, count(*) filter (where a.event = 'FAILED') failures,
          bool_or(a.event = 'CONFIRMED' and a.already_confirmed) idempotent, bool_or(a.event = 'CONFIRMED' and a.completed_application) completed_application,
          max(a.occurred_at) last_at, max(a.entry_point) entry_point, max(a.device) device
        from events a group by a.attempt_id
      ),
      cohort as (select * from attempts where coalesce(opened_at, first_submit_at) >= ${start} and coalesce(opened_at, first_submit_at) < ${end})
    select count(*)::int attempts, count(*) filter (where opened_at is not null)::int opened, count(*) filter (where first_submit_at is not null)::int submitted,
      coalesce(sum(failures), 0)::int failures, count(*) filter (where failures > 0)::int with_failure, count(*) filter (where failures > 0 and confirmed_at is not null)::int recovered,
      count(*) filter (where cancelled and confirmed_at is null)::int cancelled, count(*) filter (where confirmed_at is not null and not idempotent)::int confirmed_new,
      count(*) filter (where idempotent)::int confirmed_idempotent, count(*) filter (where completed_application)::int completed_application,
      count(*) filter (where confirmed_at is null and not cancelled and last_at > ${now} - interval '${ABANDONMENT_WINDOW_MINUTES} minutes')::int pending,
      count(*) filter (where confirmed_at is null and not cancelled and last_at <= ${now} - interval '${ABANDONMENT_WINDOW_MINUTES} minutes')::int possible_abandonment,
      percentile_cont(0.5) within group (order by extract(epoch from first_submit_at - opened_at)) filter (where opened_at is not null and first_submit_at is not null) submit_p50,
      percentile_cont(0.95) within group (order by extract(epoch from first_submit_at - opened_at)) filter (where opened_at is not null and first_submit_at is not null) submit_p95,
      percentile_cont(0.5) within group (order by extract(epoch from confirmed_at - opened_at)) filter (where opened_at is not null and confirmed_at is not null) confirm_p50,
      percentile_cont(0.95) within group (order by extract(epoch from confirmed_at - opened_at)) filter (where opened_at is not null and confirmed_at is not null) confirm_p95,
      count(*) filter (where entry_point = 'FOLLOW_UP_FEED')::int via_feed, count(*) filter (where entry_point = 'FEEDBACK_SESSION')::int via_session,
      count(*) filter (where entry_point = 'FOLLOW_UP_FEED' and confirmed_at is not null and not idempotent)::int confirmed_via_feed,
      count(*) filter (where entry_point = 'FEEDBACK_SESSION' and confirmed_at is not null and not idempotent)::int confirmed_via_session,
      count(*) filter (where device = 'MOBILE')::int mobile, count(*) filter (where device = 'DESKTOP')::int desktop
    from cohort`,
    p.values,
  )
  const row = rows.rows[0] ?? {}
  let failureReasons: { reason: string; count: number }[] | null = null
  if (ctx.can.people) {
    const reasonParams = new SqlParams()
    const reasonOrg = reasonParams.typed(ctx.organizationId, "uuid")
    const reasonRows = await db.query<{ failure_reason: string; n: number }>(
      `with ${scopeCtes(reasonParams, ctx)} select c.failure_reason, count(*)::int n from (${readConfirmationEventsSql(reasonOrg)}) c
       where c.event = 'FAILED' and c.occurred_at >= ${reasonParams.typed(ctx.period.start, "timestamptz")} and c.occurred_at < ${reasonParams.typed(ctx.period.end, "timestamptz")} and c.person_id in (select person_id from scope_official) group by 1`,
      reasonParams.values,
    )
    failureReasons = reasonRows.rows.map((item) => ({ reason: item.failure_reason, count: item.n }))
  }
  const number = (key: string) => Number(row[key] ?? 0)
  return {
    attempts: number("attempts"), opened: number("opened"), submitted: number("submitted"), failures: number("failures"), withFailure: number("with_failure"), recovered: number("recovered"),
    cancelled: number("cancelled"), confirmedNew: number("confirmed_new"), confirmedIdempotent: number("confirmed_idempotent"), completedApplication: number("completed_application"),
    pending: number("pending"), possibleAbandonment: number("possible_abandonment"), abandonmentWindowMinutes: ABANDONMENT_WINDOW_MINUTES,
    timeToFirstSubmit: { median: seconds(row.submit_p50 ?? null), p95: seconds(row.submit_p95 ?? null) },
    timeToConfirm: { median: seconds(row.confirm_p50 ?? null), p95: seconds(row.confirm_p95 ?? null) },
    byEntryPoint: { FOLLOW_UP_FEED: { attempts: number("via_feed"), confirmed: number("confirmed_via_feed") }, FEEDBACK_SESSION: { attempts: number("via_session"), confirmed: number("confirmed_via_session") } },
    byDevice: { MOBILE: number("mobile"), DESKTOP: number("desktop") },
    failureReasons,
  }
}
