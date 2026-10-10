import type { Database } from "../../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { aiUsageSql } from "../../../ai-management/application/usage-analytics-reader.js"
import { conversationsSql } from "../../../assistant/application/usage-analytics-reader.js"
import { workflowOutputsSql } from "../../../conversational-delivery/application/usage-analytics-reader.js"
import { publishedFeedbackSourcesSql } from "../../../feedbacks/application/usage-analytics-reader.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { childEnrollmentsSql, enrollmentFailuresSql, enrollmentStartSql, feedbackEmissionsSql, humanReviewsSql, manualRunsSql, rootEnrollmentsSql, WORKFLOW_ORIGIN_LABELS, workflowsSql, type WorkflowOrigin } from "../../../workflows/application/usage-analytics-reader.js"
import { rate } from "../../domain/metric-value.js"
import { scopeCtes } from "./activity-sql.js"
import { loadFreshness, loadCoverageState, metaOf, officialCoverage, structureBasisFor, STRUCTURE_BASIS_LABELS, type UsabilityContext } from "./usability-context.js"

/**
 * WORKFLOWS — "qual workflow é mais disparado?" = execuções RAIZ efetivamente criadas no período (filhos de fan-out,
 * tentativas e retries não são disparos). Coorte = raízes criadas no período, com o estado NO CORTE (agora): falha entre
 * estados terminais, pendentes à parte; durações só de raízes concluídas (abertas aparecem como idade). "Conclusões ocorridas
 * no período" é fluxo separado (pode incluir raízes criadas antes). Escopo: o sujeito analisado precisa estar no alcance;
 * Workflow consolidado (sujeito = estrutura) só aparece para quem vê a organização inteira. QA Lab não persiste matrículas.
 */
type Queryable = Pick<Database, "query">

function baseCtes(p: SqlParams, ctx: UsabilityContext): string {
  const org = p.typed(ctx.organizationId, "uuid")
  const f = ctx.filters
  const filters: string[] = []
  if (f.workflowId) filters.push(`r.workflow_id = ${p.typed(f.workflowId, "uuid")}`)
  if (f.workflowVersionId) filters.push(`r.version_id = ${p.typed(f.workflowVersionId, "uuid")}`)
  return `with ${scopeCtes(p, ctx)},
    roots_all as (select r.* from (${rootEnrollmentsSql(org)}) r where (r.subject_person_id in (select person_id from scope_official)) or (r.structure_subject and ${p.add(ctx.can.organizationWide)}::boolean)),
    roots as (select r.* from roots_all r where r.created_at >= ${p.typed(ctx.period.start, "timestamptz")} and r.created_at < ${p.typed(ctx.period.end, "timestamptz")}${filters.map((clause) => ` and ${clause}`).join("")}),
    children as (select c.* from (${childEnrollmentsSql(org)}) c where c.root_id in (select root_id from roots)),
    members as (select root_id, root_id enrollment_id from roots union all select root_id, child_id from children),
    emissions as (select em.* from (${feedbackEmissionsSql(org)}) em where em.root_id in (select root_id from roots)),
    emitted as (select em.root_id, em.feedback_id, em.recipient_person_id, fs.acknowledged_at,
        exists (select 1 from usage_events ue where ue.organization_id = ${org} and ue.entity_type = 'PUBLISHED_FEEDBACK' and ue.entity_id = em.feedback_id and ue.actor_person_id = em.recipient_person_id and ue.event_name = 'screen.viewed' and ue.screen_key in ('feedback.detail', 'feedback.session')) opened
      from emissions em left join (${publishedFeedbackSourcesSql(p, ctx.organizationId)}) fs on fs.source_id = em.feedback_id where em.feedback_id is not null),
    outs as (select o.*, m.root_id from (${workflowOutputsSql(org)}) o join members m on m.enrollment_id = o.enrollment_id),
    out_consumed as (select o.root_id, o.output_id, o.surface, o.delivery_status, (o.surface = 'AVATAR' and o.delivery_status = 'DELIVERED') or (o.surface = 'CHAT' and cv.owner_seen_at is not null) consumed
      from outs o left join (${conversationsSql(org)}) cv on cv.conversation_id = o.conversation_id)`
}

export async function workflowsQuery(db: Queryable, ctx: UsabilityContext, options: { listAll?: boolean } = {}) {
  const org = ctx.organizationId
  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    return (await db.query<T>(build(p), p.values)).rows
  }
  const coverageState = await loadCoverageState(db, org, ctx.now)

  const [ranking, versions, series, failures, reviews, flow, manual, idle, cost, starts] = await Promise.all([
    run<Record<string, unknown> & { workflow_id: string }>((p) => `${baseCtes(p, ctx)}
      select w.workflow_id, w.name, w.active, w.trigger_kind, w.consolidated,
        count(r.root_id)::int roots,
        count(r.root_id) filter (where r.origin = 'MANUAL')::int origin_manual, count(r.root_id) filter (where r.origin = 'INTERACTION')::int origin_interaction,
        count(r.root_id) filter (where r.origin = 'INDICATOR')::int origin_indicator, count(r.root_id) filter (where r.origin = 'SCHEDULE')::int origin_schedule,
        (select count(*)::int from children c where c.root_id in (select x.root_id from roots x where x.workflow_id = w.workflow_id)) children,
        (select count(distinct s.subject_person_id)::int from (select x.subject_person_id from roots x where x.workflow_id = w.workflow_id union all select c.subject_person_id from children c join roots x on x.root_id = c.root_id where x.workflow_id = w.workflow_id) s where s.subject_person_id is not null) people_reached,
        count(r.root_id) filter (where r.status = 'completed')::int completed, count(r.root_id) filter (where r.status in ('failed', 'dead'))::int failed,
        count(r.root_id) filter (where r.status = 'waiting')::int waiting, count(r.root_id) filter (where r.status = 'active')::int running,
        percentile_cont(0.5) within group (order by extract(epoch from r.updated_at - r.created_at)) filter (where r.status = 'completed') duration_p50,
        percentile_cont(0.95) within group (order by extract(epoch from r.updated_at - r.created_at)) filter (where r.status = 'completed') duration_p95,
        max(extract(epoch from ${p.typed(ctx.now, "timestamptz")} - r.created_at)) filter (where r.status in ('active', 'waiting')) oldest_open_seconds,
        (select count(*)::int from emitted e join roots x on x.root_id = e.root_id where x.workflow_id = w.workflow_id) feedbacks_delivered,
        (select count(*)::int from emitted e join roots x on x.root_id = e.root_id where x.workflow_id = w.workflow_id and e.opened) feedbacks_opened,
        (select count(*)::int from emitted e join roots x on x.root_id = e.root_id where x.workflow_id = w.workflow_id and e.acknowledged_at is not null) feedbacks_acked,
        (select count(*)::int from out_consumed o join roots x on x.root_id = o.root_id where x.workflow_id = w.workflow_id and o.delivery_status = 'DELIVERED') outputs_delivered,
        (select count(*)::int from out_consumed o join roots x on x.root_id = o.root_id where x.workflow_id = w.workflow_id and o.consumed) outputs_consumed
      from (${workflowsSql(p.typed(org, "uuid"))}) w join roots r on r.workflow_id = w.workflow_id
      group by w.workflow_id, w.name, w.active, w.trigger_kind, w.consolidated order by roots desc, w.name`),
    run<{ workflow_id: string; version_id: string | null; roots: number; completed: number; failed: number }>((p) => `${baseCtes(p, ctx)}
      select r.workflow_id, r.version_id, count(*)::int roots, count(*) filter (where r.status = 'completed')::int completed, count(*) filter (where r.status in ('failed', 'dead'))::int failed
      from roots r group by 1, 2 order by 3 desc`),
    run<{ day: string; workflow_id: string; roots: number; completed_in_day: number }>((p) => `${baseCtes(p, ctx)}
      select to_char((r.created_at at time zone ${p.add(ctx.settings.timezone)})::date, 'YYYY-MM-DD') as day, r.workflow_id, count(*)::int roots, count(*) filter (where r.status = 'completed')::int completed_in_day
      from roots r group by 1, 2 order by 1`),
    run<{ node_id: string | null; error_code: string; error_category: string | null; events: number; roots_affected: number }>((p) => `${baseCtes(p, ctx)}
      select f.node_id, f.error_code, max(f.error_category) error_category, count(*)::int events, count(distinct f.root_id)::int roots_affected
      from (${enrollmentFailuresSql(p.typed(org, "uuid"))}) f where f.root_id in (select root_id from roots) group by 1, 2 order by roots_affected desc, events desc limit 50`),
    run<Record<string, number | null>>((p) => `${baseCtes(p, ctx)},
      reviews as (select h.* from (${humanReviewsSql(p.typed(org, "uuid"))}) h where h.root_id in (select root_id from roots))
      select count(*)::int requested, count(*) filter (where decided_at is null)::int pending, count(*) filter (where decided_at is not null)::int decided,
        percentile_cont(0.5) within group (order by extract(epoch from decided_at - requested_at)) filter (where decided_at is not null) wait_p50,
        percentile_cont(0.95) within group (order by extract(epoch from decided_at - requested_at)) filter (where decided_at is not null) wait_p95,
        max(extract(epoch from ${p.typed(ctx.now, "timestamptz")} - requested_at)) filter (where decided_at is null) oldest_pending_seconds
      from reviews`),
    run<{ completed: number; failed: number }>((p) => `${baseCtes(p, ctx)}
      select count(*) filter (where r.status = 'completed')::int completed, count(*) filter (where r.status in ('failed', 'dead'))::int failed from roots_all r
      where r.updated_at >= ${p.typed(ctx.period.start, "timestamptz")} and r.updated_at < ${p.typed(ctx.period.end, "timestamptz")} and r.status in ('completed', 'failed', 'dead')`),
    run<{ requested_by: string; name: string; workflow_id: string; runs: number }>((p) => `${baseCtes(p, ctx)}
      select r.manual_requested_by requested_by, pop.name, r.workflow_id, count(*)::int runs from roots r join (${populationSql(p, org)}) pop on pop.person_id = r.manual_requested_by
      where r.origin = 'MANUAL' group by 1, 2, 3 order by runs desc`),
    run<{ workflow_id: string; name: string; active: boolean; trigger_kind: string | null; published: boolean }>((p) => `${baseCtes(p, ctx)}
      select w.workflow_id, w.name, w.active, w.trigger_kind, (w.active_version_id is not null) published from (${workflowsSql(p.typed(org, "uuid"))}) w
      where not exists (select 1 from roots r where r.workflow_id = w.workflow_id) order by w.active desc, w.name`),
    run<{ workflow_id: string; currency: string | null; cost: string | null; tokens: number | null; unknown: number }>((p) => `${baseCtes(p, ctx)}
      select r.workflow_id, u.currency, sum(u.cost)::text cost, sum(u.total_tokens)::bigint tokens, count(*) filter (where u.cost_status <> 'ESTIMATED')::int unknown
      from (${aiUsageSql(p.typed(org, "uuid"))}) u join roots r on r.root_id = u.root_enrollment_id group by 1, 2`),
    run<Record<string, number | null>>((p) => `${baseCtes(p, ctx)}
      select percentile_cont(0.5) within group (order by extract(epoch from s.first_event_at - r.created_at)) start_p50, percentile_cont(0.95) within group (order by extract(epoch from s.first_event_at - r.created_at)) start_p95,
        percentile_cont(0.5) within group (order by extract(epoch from r.created_at - mr.requested_at)) filter (where mr.requested_at is not null) manual_accept_p50
      from roots r join (${enrollmentStartSql(p.typed(org, "uuid"))}) s on s.enrollment_id = r.root_id left join (${manualRunsSql(p.typed(org, "uuid"))}) mr on mr.manual_run_id = r.manual_run_id`),
  ])

  const totalRoots = ranking.reduce((sum, row) => sum + Number(row.roots), 0)
  let items: Record<string, unknown>[] | null = null
  if (ctx.can.people) {
    items = (
      await run<Record<string, unknown>>((p) => `${baseCtes(p, ctx)}
        select r.root_id, r.workflow_id, w.name workflow_name, r.version_id, r.origin, r.status, r.created_at, r.updated_at, r.subject_person_id, subj.name subject_name,
          r.manual_requested_by, req.name requester_name, r.structure_subject,
          (select count(*)::int from children c where c.root_id = r.root_id) children,
          (select count(*)::int from emitted e where e.root_id = r.root_id) feedbacks, (select count(*)::int from emitted e where e.root_id = r.root_id and e.opened) feedbacks_opened,
          (select array_agg(distinct e.recipient_person_id) from emitted e where e.root_id = r.root_id) recipients,
          (select count(*)::int from out_consumed o where o.root_id = r.root_id) outputs, (select count(*)::int from out_consumed o where o.root_id = r.root_id and o.consumed) outputs_consumed
        from roots r join (${workflowsSql(p.typed(org, "uuid"))}) w on w.workflow_id = r.workflow_id
        left join (${populationSql(p, org)}) subj on subj.person_id = r.subject_person_id
        left join (${populationSql(p, org)}) req on req.person_id = r.manual_requested_by
        order by r.created_at desc, r.root_id ${options.listAll ? "" : `limit ${p.add(ctx.filters.pageSize)} offset ${p.add((ctx.filters.page - 1) * ctx.filters.pageSize)}`}`)
    ).map((row) => ({
      rootId: row.root_id, workflowId: row.workflow_id, workflowName: row.workflow_name, versionId: row.version_id, origin: row.origin, originLabel: WORKFLOW_ORIGIN_LABELS[row.origin as WorkflowOrigin], status: row.status,
      createdAt: (row.created_at as Date).toISOString(), updatedAt: (row.updated_at as Date).toISOString(), subjectPersonId: row.subject_person_id, subjectName: row.structure_subject ? "Estrutura (consolidado)" : row.subject_name,
      requesterPersonId: row.manual_requested_by, requesterName: row.requester_name, children: row.children, feedbacks: row.feedbacks, feedbacksOpened: row.feedbacks_opened, recipients: row.recipients ?? [], outputs: row.outputs, outputsConsumed: row.outputs_consumed,
    }))
  }

  const reviewRow = reviews[0] ?? {}
  const startRow = starts[0] ?? {}
  const sec = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value)))
  const freshness = await loadFreshness(db, org, ctx.now)
  return {
    meta: metaOf(ctx, freshness, {
      coverage: { enrollments: officialCoverage(coverageState, "WORKFLOWS", ctx.period.start, ctx.period.end), manualRuns: officialCoverage(coverageState, "MANUAL_RUNS", ctx.period.start, ctx.period.end), cost: officialCoverage(coverageState, "AI_USAGE_CORRELATION", ctx.period.start, ctx.period.end) },
      structureBasis: { value: structureBasisFor(ctx, false), label: STRUCTURE_BASIS_LABELS[structureBasisFor(ctx, false)] },
      stateMapping: { completed: "Sucesso", failed: "Falha", dead: "Falha (esgotou tentativas)", waiting: "Aguardando (não é sucesso)", active: "Em andamento" },
    }),
    totalRoots,
    ranking: ranking.map((row) => {
      const terminal = Number(row.completed) + Number(row.failed)
      const costs = cost.filter((item) => item.workflow_id === row.workflow_id)
      const delivered = Number(row.feedbacks_delivered) + Number(row.outputs_delivered)
      return {
        workflowId: row.workflow_id, name: row.name, active: row.active, triggerKind: row.trigger_kind, consolidated: row.consolidated,
        roots: Number(row.roots), sharePercent: totalRoots > 0 ? Math.round((Number(row.roots) / totalRoots) * 1000) / 10 : null,
        byOrigin: { MANUAL: Number(row.origin_manual), INTERACTION: Number(row.origin_interaction), INDICATOR: Number(row.origin_indicator), SCHEDULE: Number(row.origin_schedule) },
        children: Number(row.children), peopleReached: Number(row.people_reached),
        completed: Number(row.completed), failed: Number(row.failed), waiting: Number(row.waiting), running: Number(row.running),
        failureRate: { numerator: Number(row.failed), denominator: terminal, value: rate(Number(row.failed), terminal), pending: Number(row.waiting) + Number(row.running) },
        duration: { median: sec(row.duration_p50), p95: sec(row.duration_p95), oldestOpenSeconds: sec(row.oldest_open_seconds) },
        results: { feedbacksDelivered: Number(row.feedbacks_delivered), feedbacksOpened: Number(row.feedbacks_opened), feedbacksAcked: Number(row.feedbacks_acked), outputsDelivered: Number(row.outputs_delivered), outputsConsumed: Number(row.outputs_consumed), delivered },
        cost: costs.map((item) => ({ currency: item.currency, total: item.cost, tokens: item.tokens === null ? null : Number(item.tokens), unknownCostEvents: item.unknown, perRoot: item.cost === null || Number(row.roots) === 0 ? null : (Number(item.cost) / Number(row.roots)).toFixed(6), perDeliveredResult: item.cost === null || delivered === 0 ? null : (Number(item.cost) / delivered).toFixed(6) })),
        manualRequesters: ctx.can.people ? manual.filter((item) => item.workflow_id === row.workflow_id).map((item) => ({ personId: item.requested_by, name: item.name, runs: item.runs })) : null,
      }
    }),
    versions: versions.map((row) => ({ workflowId: row.workflow_id, versionId: row.version_id, roots: row.roots, completed: row.completed, failed: row.failed, failureRate: rate(row.failed, row.completed + row.failed) })),
    series: series.map((row) => ({ day: row.day, workflowId: row.workflow_id, roots: row.roots, completedInDay: row.completed_in_day })),
    failures: failures.map((row) => ({ nodeId: row.node_id, errorCode: row.error_code, errorCategory: row.error_category, events: row.events, rootsAffected: row.roots_affected })),
    humanReviews: { requested: Number(reviewRow.requested ?? 0), pending: Number(reviewRow.pending ?? 0), decided: Number(reviewRow.decided ?? 0), waitMedian: sec(reviewRow.wait_p50), waitP95: sec(reviewRow.wait_p95), oldestPendingSeconds: sec(reviewRow.oldest_pending_seconds) },
    timing: { timeToStartMedian: sec(startRow.start_p50), timeToStartP95: sec(startRow.start_p95), manualAcceptMedian: sec(startRow.manual_accept_p50) },
    completionsInPeriod: flow[0] ?? { completed: 0, failed: 0 },
    withoutExecution: idle.map((row) => ({ workflowId: row.workflow_id, name: row.name, active: row.active, published: row.published, triggerKind: row.trigger_kind })),
    page: ctx.filters.page,
    pageSize: ctx.filters.pageSize,
    identified: ctx.can.people,
    items,
  }
}
