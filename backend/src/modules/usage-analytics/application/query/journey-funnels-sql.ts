import type { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { conversationMessagesSql, conversationsSql } from "../../../assistant/application/usage-analytics-reader.js"
import { workflowOutputsSql } from "../../../conversational-delivery/application/usage-analytics-reader.js"
import { applicationConversationsSql, applicationsSql } from "../../../feedback-application/application/usage-analytics-reader.js"
import { ratingsHistorySql } from "../../../feedback-rating/application/usage-analytics-reader.js"
import { publishedFeedbackSourcesSql } from "../../../feedbacks/application/usage-analytics-reader.js"
import { deliveredInteractionFeedbackSourcesSql } from "../feedback-sources.js"
import { alertsSql } from "../../../notifications/application/usage-analytics-reader.js"
import { feedbackEmissionsSql, manualRunsSql, rootEnrollmentsSql } from "../../../workflows/application/usage-analytics-reader.js"
import { DIFFICULTY_RULES } from "../../domain/journeys.js"
import { feedbackCohortSql } from "./feedback-cohort-sql.js"
import { sessionsStartedWhere, windowsOf } from "./activity-sql.js"
import type { UsabilityContext } from "./usability-context.js"

/**
 * SQL por ENTIDADE de cada funil: uma linha por entidade correlacionada, com o instante de cada etapa (t1..tn) — a etapa k
 * só existe se a k−1 existe e veio antes — e `deadline` (fim da janela de conversão; depois dele, quem parou PAROU; antes,
 * está pendente). Colunas comuns: entity_id, person_id, t1..t5, deadline.
 */
export function funnelEntitySql(p: SqlParams, ctx: UsabilityContext, key: string, measuredSince: Date | null): string {
  // Marcadores criados SOB DEMANDA: parâmetro declarado e não usado quebra o bind no Postgres.
  const lazy = (make: () => string) => {
    let value: string | null = null
    return { toString: () => (value ??= make()) }
  }
  const org = lazy(() => p.typed(ctx.organizationId, "uuid")) as unknown as string
  const start = lazy(() => p.typed(ctx.period.start, "timestamptz"))
  const end = lazy(() => p.typed(ctx.period.end, "timestamptz"))
  const days = lazy(() => p.add(ctx.filters.cohortWindow))
  const inScope = (column: string) => `${column} in (select person_id from scope_official)`
  switch (key) {
    case "ENTRY_TO_RATING": {
      const { current } = windowsOf(ctx)
      return `select s.id entity_id, s.person_id, s.started_at t1, fu.t2, op.t3, rt.t4, null::timestamptz t5,
          case when s.end_reason = 'OPEN' then 'infinity'::timestamptz else coalesce(op.t3 + make_interval(days => ${days}::int), s.ended_at) end deadline
        from usage_sessions s
        left join lateral (select min(e.occurred_at) t2 from usage_events e where e.organization_id = ${org} and e.usage_session_id = s.usage_session_id and e.event_name = 'screen.viewed'
          and e.screen_key like '%.followup' and e.occurred_at >= s.started_at and e.occurred_at <= s.ended_at + interval '1 minute') fu on true
        left join lateral (select e.occurred_at t3, e.entity_type, e.entity_id from usage_events e where fu.t2 is not null and e.organization_id = ${org} and e.usage_session_id = s.usage_session_id
          and e.event_name = 'screen.viewed' and e.screen_key in ('feedback.detail', 'feedback.session') and e.actor_person_id = e.subject_person_id and e.occurred_at >= fu.t2 and e.occurred_at <= s.ended_at + interval '1 minute'
          order by e.occurred_at limit 1) op on true
        left join lateral (select min(r.created_at) t4 from (${ratingsHistorySql(org)}) r where op.t3 is not null and r.person_id = s.person_id and r.source_kind = op.entity_type and r.source_id = op.entity_id
          and r.value in ('UP', 'DOWN') and r.created_at >= op.t3 and r.created_at < op.t3 + make_interval(days => ${days}::int)) rt on true
        where ${sessionsStartedWhere(p, ctx, current)}`
    }
    case "FEEDBACK_ACK":
      return `select x.source_id entity_id, x.recipient_person_id person_id, x.available_at t1, x.exposed_at t2, case when x.exposed_at is not null then x.opened_at end t3,
          case when x.opened_at is not null and x.exposed_at is not null then x.acknowledged_at end t4, null::timestamptz t5, x.cut deadline
        from (${feedbackCohortSql(p, ctx, measuredSince)}) x where x.exposure_measured`
    case "INVITE_TO_ACK":
      return `select o.source_id entity_id, o.person_id, o.t1, acc.t2, st.t3, q.t4, ak.t5, o.t1 + make_interval(days => ${days}::int) deadline
        from (select e.entity_id source_id, e.entity_type source_kind, e.actor_person_id person_id, min(e.occurred_at) t1 from usage_events e
              where e.organization_id = ${org} and e.event_name = 'feedback_application.invite' and e.properties->>'decision' = 'OFFER' and e.occurred_at >= ${start} and e.occurred_at < ${end} and ${inScope("e.actor_person_id")}
              group by 1, 2, 3) o
        left join lateral (select min(e.occurred_at) t2 from usage_events e where e.organization_id = ${org} and e.event_name = 'feedback_application.invite' and e.properties->>'decision' = 'ACCEPT'
          and e.entity_id = o.source_id and e.actor_person_id = o.person_id and e.occurred_at >= o.t1) acc on true
        left join lateral (select a.application_id, a.started_at t3 from (${applicationsSql(org)}) a where acc.t2 is not null and a.source_id = o.source_id and a.started_at >= acc.t2 limit 1) st on true
        left join lateral (select min(m.occurred_at) t4 from (${conversationMessagesSql(org)}) m where st.t3 is not null and m.role = 'user' and m.occurred_at >= st.t3
          and m.conversation_id in (select ac.conversation_id from (${applicationConversationsSql(org)}) ac where ac.application_id = st.application_id)) q on true
        left join lateral (select x.acknowledged_at t5 from (select src.acknowledged_at from (${publishedFeedbackSourcesSql(p, ctx.organizationId)} union all ${deliveredInteractionFeedbackSourcesSql(p, ctx.organizationId)}) src where src.source_id = o.source_id) x where q.t4 is not null and x.acknowledged_at >= q.t4 limit 1) ak on true`
    case "CHAT":
      return `select pa.screen_instance_id entity_id, pa.actor_person_id person_id, pa.occurred_at t1, sent.t2, ans.t3, null::timestamptz t4, null::timestamptz t5,
          pa.occurred_at + interval '35 minutes' deadline
        from usage_events pa
        left join lateral (select e.occurred_at t2, e.correlation_id from usage_events e where e.organization_id = ${org} and e.screen_instance_id = pa.screen_instance_id and e.event_name = 'action.succeeded'
          and e.properties->>'actionKey' = 'chat.send_message' and e.occurred_at >= pa.occurred_at and e.occurred_at < pa.occurred_at + interval '30 minutes' order by e.occurred_at limit 1) sent on true
        left join lateral (select min(e.occurred_at) t3 from usage_events e where sent.t2 is not null and e.organization_id = ${org} and e.correlation_id = sent.correlation_id
          and e.event_name = 'latency.measured' and e.properties->>'metric' = 'CHAT_FIRST_TEXT' and e.properties->>'outcome' = 'OK') ans on true
        where pa.organization_id = ${org} and pa.event_name = 'screen.viewed' and pa.screen_key = 'followup.chat_panel' and pa.occurred_at >= ${start} and pa.occurred_at < ${end} and ${inScope("pa.actor_person_id")}`
    case "VOICE":
      return `select i.intent entity_id, i.person_id, i.t1, pm.t2, cn.t3, sp.t4, au.t5, coalesce(i.ended_at, 'infinity'::timestamptz) deadline
        from (select e.properties->>'voiceIntentId' intent, e.actor_person_id person_id, min(e.occurred_at) filter (where e.properties->>'stage' = 'REQUESTED') t1,
                max(e.occurred_at) filter (where e.properties->>'stage' in ('CLOSED', 'FAILED')) ended_at
              from usage_events e where e.organization_id = ${org} and e.event_name = 'voice.connection' and e.occurred_at >= ${start} and e.occurred_at < ${end} and ${inScope("e.actor_person_id")}
              group by 1, 2 having min(e.occurred_at) filter (where e.properties->>'stage' = 'REQUESTED') is not null) i
        left join lateral (select min(e.occurred_at) t2 from usage_events e where e.organization_id = ${org} and e.event_name = 'voice.mic_permission' and e.properties->>'voiceIntentId' = i.intent and e.properties->>'result' = 'GRANTED') pm on true
        left join lateral (select min(e.occurred_at) t3 from usage_events e where pm.t2 is not null and e.organization_id = ${org} and e.event_name = 'voice.connection' and e.properties->>'voiceIntentId' = i.intent and e.properties->>'stage' = 'ESTABLISHED') cn on true
        left join lateral (select min(m.occurred_at) t4 from (${conversationMessagesSql(org)}) m where cn.t3 is not null and m.owner_person_id = i.person_id and m.role = 'user' and m.channel = 'voice'
          and m.occurred_at >= cn.t3 and m.occurred_at <= coalesce(i.ended_at, cn.t3 + interval '2 hours')) sp on true
        left join lateral (select min(e.occurred_at) t5 from usage_events e where sp.t4 is not null and e.organization_id = ${org} and e.event_name = 'voice.playback' and e.properties->>'stage' = 'STARTED'
          and e.properties->>'context' = 'CONVERSATION' and e.properties->>'voiceIntentId' = i.intent and e.occurred_at >= sp.t4) au on true`
    case "MANUAL_WORKFLOW":
      return `select mr.manual_run_id entity_id, mr.requested_by person_id, mr.requested_at t1, r.created_at t2,
          case when r.status in ('completed', 'failed', 'dead') then r.updated_at end t3, dl.t4, op.t5, mr.requested_at + make_interval(days => ${days}::int) deadline
        from (${manualRunsSql(org)}) mr
        left join (${rootEnrollmentsSql(org)}) r on r.manual_run_id = mr.manual_run_id
        left join lateral (select least((select min(em.created_at) from (${feedbackEmissionsSql(org)}) em where em.root_id = r.root_id), (select min(o.delivered_at) from (${workflowOutputsSql(org)}) o where o.enrollment_id = r.root_id)) t4) dl on r.status in ('completed', 'failed', 'dead')
        left join lateral (select least(
            (select min(e.occurred_at) from (${feedbackEmissionsSql(org)}) em join usage_events e on e.organization_id = ${org} and e.entity_type = 'PUBLISHED_FEEDBACK' and e.entity_id = em.feedback_id and e.actor_person_id = em.recipient_person_id and e.event_name = 'screen.viewed' where em.root_id = r.root_id),
            (select min(cv.owner_seen_at) from (${workflowOutputsSql(org)}) o join (${conversationsSql(org)}) cv on cv.conversation_id = o.conversation_id where o.enrollment_id = r.root_id),
            (select min(o.delivered_at) from (${workflowOutputsSql(org)}) o where o.enrollment_id = r.root_id and o.surface = 'AVATAR')) t5) op on dl.t4 is not null
        where mr.requested_at >= ${start} and mr.requested_at < ${end} and ${inScope("mr.requested_by")}`
    case "NOTIFICATION":
      return `select ex.alert_id entity_id, ex.person_id, ex.t1, ac.t2, ds.t3, rd.t4, null::timestamptz t5, ex.t1 + make_interval(days => ${days}::int) deadline
        from (select e.entity_id alert_id, e.actor_person_id person_id, min(e.occurred_at) t1 from usage_events e where e.organization_id = ${org} and e.event_name = 'element.exposed'
              and e.element_key = 'notifications.item' and e.occurred_at >= ${start} and e.occurred_at < ${end} and ${inScope("e.actor_person_id")} group by 1, 2) ex
        left join lateral (select e.occurred_at t2, e.tab_id from usage_events e where e.organization_id = ${org} and e.event_name = 'element.activated' and e.element_key = 'notifications.item'
          and e.entity_id = ex.alert_id and e.actor_person_id = ex.person_id and e.occurred_at >= ex.t1 order by e.occurred_at limit 1) ac on true
        left join lateral (select min(e.occurred_at) t3 from usage_events e where ac.t2 is not null and e.organization_id = ${org} and e.tab_id = ac.tab_id and e.event_name = 'screen.viewed'
          and e.screen_key <> 'notifications.panel' and e.occurred_at >= ac.t2 and e.occurred_at <= ac.t2 + interval '${DIFFICULTY_RULES.notificationDestinationSeconds} seconds') ds on true
        left join lateral (select a.read_at t4 from (${alertsSql(org)}) a where ds.t3 is not null and a.alert_id = ex.alert_id and a.read_at is not null) rd on true`
    default:
      throw new Error(`Funil desconhecido: ${key}`)
  }
}
