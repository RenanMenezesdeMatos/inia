import type { Database } from "../../../../infrastructure/database/pool.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { aiUsageSql, CONVERSATIONAL_USE_CASES } from "../../../ai-management/application/usage-analytics-reader.js"
import { conversationMessagesSql } from "../../../assistant/application/usage-analytics-reader.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { distribution, rate } from "../../domain/metric-value.js"
import { scopeCtes } from "./activity-sql.js"
import { familyCoverage, loadCoverageState, loadFreshness, metaOf, officialCoverage, structureBasisFor, STRUCTURE_BASIS_LABELS, type UsabilityContext } from "./usability-context.js"

/**
 * INIA: VOZ E TEXTO — conversas e mensagens PERSISTIDAS são a fonte oficial (entrada humana por texto × voz, saída da INIA
 * por texto × áudio, origem da conversa). O navegador complementa o que não vira mensagem: abertura do painel, tentativa,
 * falha e cancelamento do envio, conexão técnica de voz (intenção ≠ conexão ≠ conversa), microfone, reprodução e latência.
 * Microfone aberto não é fala; reconexão não cria conversa; mensagem proativa da INIA não é participação humana; LEGACY não
 * fabrica conversa. Não há cópia de conteúdo: ler a conversa exige `assistant_conversations.view`.
 */
type Queryable = Pick<Database, "query">
export const RESPONSE_WINDOW_MINUTES = 5

export async function conversationsQuery(db: Queryable, ctx: UsabilityContext, options: { listAll?: boolean } = {}) {
  const coverageState = await loadCoverageState(db, ctx.organizationId, ctx.now)
  const f = ctx.filters
  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    return (await db.query<T>(build(p), p.values)).rows
  }
  /** Mensagens do recorte (alias m) — escopo pelo dono da conversa, janela do período, origem e canal pedidos. */
  const messagesCte = (p: SqlParams) => {
    const org = p.typed(ctx.organizationId, "uuid")
    const clauses = [`m.owner_person_id in (select person_id from scope_official)`, `m.occurred_at >= ${p.typed(ctx.period.start, "timestamptz")}`, `m.occurred_at < ${p.typed(ctx.period.end, "timestamptz")}`]
    if (f.conversationOrigin) clauses.push(`m.origin = ${p.add(f.conversationOrigin)}`)
    if (f.channel) clauses.push(`m.channel = ${p.add(f.channel === "TEXT" ? "chat" : "voice")}`)
    return `with ${scopeCtes(p, ctx)}, msgs as (select m.* from (${conversationMessagesSql(org)}) m where ${clauses.join(" and ")}),
      human as (select * from msgs where role = 'user'), inia as (select * from msgs where role = 'assistant' and not proactive)`
  }
  const eventsWhere = (p: SqlParams, alias = "e") => `${alias}.organization_id = ${p.typed(ctx.organizationId, "uuid")} and ${alias}.occurred_at >= ${p.typed(ctx.period.start, "timestamptz")} and ${alias}.occurred_at < ${p.typed(ctx.period.end, "timestamptz")}
    and ${alias}.actor_person_id in (select person_id from scope_official)${f.device ? ` and ${alias}.device = ${p.add(f.device)}` : ""}`

  const [people, counts, perConversation, origins, response, chatUi, voice, latency, playback, cost] = await Promise.all([
    run<{ used: number; text: number; voice: number; both: number }>((p) => `${messagesCte(p)}
      select count(distinct owner_person_id)::int used, count(distinct owner_person_id) filter (where channel = 'chat')::int text, count(distinct owner_person_id) filter (where channel = 'voice')::int voice,
        (select count(*)::int from (select owner_person_id from human group by owner_person_id having bool_or(channel = 'chat') and bool_or(channel = 'voice')) x) both
      from human`),
    run<Record<string, number>>((p) => `${messagesCte(p)},
      conv as (select h.conversation_id, bool_or(h.channel = 'chat') has_text, bool_or(h.channel = 'voice') has_voice from human h where h.kind = 'CONVERSATION' group by h.conversation_id)
      select (select count(*)::int from human where channel = 'chat') user_text, (select count(*)::int from human where channel = 'voice') user_voice,
        (select count(*)::int from inia where channel = 'chat') inia_text, (select count(*)::int from inia where channel = 'voice') inia_voice,
        (select count(*)::int from msgs where proactive) proactive,
        (select count(*)::int from conv) conversations_with_human, (select count(*)::int from conv where has_text and not has_voice) text_only,
        (select count(*)::int from conv where has_voice and not has_text) voice_only, (select count(*)::int from conv where has_text and has_voice) mixed,
        (select count(*)::int from human where kind = 'LEGACY_HISTORY') legacy_messages,
        (select count(distinct m.conversation_id)::int from msgs m where m.kind = 'CONVERSATION' and m.conversation_created_at >= ${p.typed(ctx.period.start, "timestamptz")} and m.conversation_created_at < ${p.typed(ctx.period.end, "timestamptz")}) conversations_created,
        (select count(*)::int from (select distinct owner_person_id, (occurred_at at time zone ${p.add(ctx.settings.timezone)})::date from human) d) person_days,
        (select count(*)::int from (select distinct owner_person_id, conversation_id, (occurred_at at time zone ${p.add(ctx.settings.timezone)})::date from human where kind = 'CONVERSATION') d) conversation_person_days`),
    run<{ n: number }>((p) => `${messagesCte(p)} select count(*)::int n from human where kind = 'CONVERSATION' group by conversation_id`),
    run<{ origin: string; kind: string; conversations: number; human_messages: number; inia_messages: number; people: number }>((p) => `${messagesCte(p)}
      select m.origin, m.kind, count(distinct m.conversation_id) filter (where m.role = 'user')::int conversations, count(*) filter (where m.role = 'user')::int human_messages,
        count(*) filter (where m.role = 'assistant')::int inia_messages, count(distinct m.owner_person_id) filter (where m.role = 'user')::int people
      from msgs m group by 1, 2 order by 1, 2`),
    run<{ eligible: number; answered: number; pending: number }>((p) => `${messagesCte(p)}
      select count(*) filter (where h.occurred_at < ${p.typed(ctx.now, "timestamptz")} - interval '${RESPONSE_WINDOW_MINUTES} minutes')::int eligible,
        count(*) filter (where h.occurred_at < ${p.typed(ctx.now, "timestamptz")} - interval '${RESPONSE_WINDOW_MINUTES} minutes' and exists (
          select 1 from (${conversationMessagesSql(p.typed(ctx.organizationId, "uuid"))}) a where a.conversation_id = h.conversation_id and a.role = 'assistant' and not a.proactive and a.occurred_at >= h.occurred_at and a.occurred_at <= h.occurred_at + interval '${RESPONSE_WINDOW_MINUTES} minutes'))::int answered,
        count(*) filter (where h.occurred_at >= ${p.typed(ctx.now, "timestamptz")} - interval '${RESPONSE_WINDOW_MINUTES} minutes')::int pending
      from human h`),
    run<Record<string, number>>((p) => `with ${scopeCtes(p, ctx)},
      panels as (select e.screen_instance_id from usage_events e where ${eventsWhere(p)} and e.event_name = 'screen.viewed' and e.screen_key = 'followup.chat_panel'),
      actions as (select e.event_name, e.screen_instance_id, e.properties from usage_events e where ${eventsWhere(p)} and e.event_name like 'action.%' and e.properties->>'actionKey' = 'chat.send_message')
      select (select count(*)::int from panels) panel_views,
        (select count(*)::int from panels pa where not exists (select 1 from actions a where a.screen_instance_id = pa.screen_instance_id and a.event_name = 'action.started')) opened_without_message,
        (select count(*)::int from actions where event_name = 'action.started') attempted, (select count(*)::int from actions where event_name = 'action.succeeded') persisted_ack,
        (select count(*)::int from actions where event_name = 'action.failed') failed, (select count(*)::int from actions where event_name = 'action.cancelled') cancelled`),
    run<Record<string, number | null>>((p) => `${messagesCte(p)},
      conn as (select e.actor_person_id, e.properties->>'voiceIntentId' intent, e.properties->>'stage' stage, e.properties->>'reason' reason, e.occurred_at from usage_events e where ${eventsWhere(p)} and e.event_name = 'voice.connection'),
      intents as (select actor_person_id, intent, min(occurred_at) filter (where stage = 'REQUESTED') requested_at, min(occurred_at) filter (where stage = 'ESTABLISHED') established_at,
        max(occurred_at) filter (where stage in ('CLOSED', 'FAILED')) ended_at, count(*) filter (where stage = 'RECONNECTED')::int reconnections, bool_or(stage = 'FAILED') failed
        from conn group by 1, 2),
      spoken as (select i.intent, count(h.message_id)::int turns from intents i left join human h on h.owner_person_id = i.actor_person_id and h.channel = 'voice' and i.established_at is not null
        and h.occurred_at >= i.established_at and h.occurred_at <= coalesce(i.ended_at, i.established_at + interval '2 hours') group by i.intent),
      mic as (select e.actor_person_id, tstzrange((e.properties->>'spanStart')::timestamptz, (e.properties->>'spanEnd')::timestamptz) r from usage_events e where ${eventsWhere(p)} and e.event_name = 'voice.mic_span'),
      mic_union as (select actor_person_id, (select coalesce(sum(extract(epoch from upper(x) - lower(x))), 0) from unnest(range_agg(r)) x) seconds from mic group by actor_person_id),
      perm as (select e.properties->>'result' result from usage_events e where ${eventsWhere(p)} and e.event_name = 'voice.mic_permission')
      select (select count(*)::int from usage_events e where ${eventsWhere(p)} and e.event_name = 'voice.session_issued') sessions_issued,
        (select count(*)::int from intents where requested_at is not null) intents, (select count(*)::int from intents where established_at is not null) established,
        (select count(*)::int from intents where reconnections > 0) intents_with_reconnection, (select coalesce(sum(reconnections), 0)::int from intents) reconnections,
        (select count(*)::int from intents where failed) failed, (select count(*)::int from intents where ended_at is not null and not failed) closed,
        (select count(*)::int from intents i join spoken s on s.intent = i.intent where i.established_at is not null and s.turns > 0) with_speech,
        (select count(*)::int from intents i join spoken s on s.intent = i.intent where i.established_at is not null and s.turns = 0) without_speech,
        (select coalesce(sum(extract(epoch from ended_at - established_at)), 0)::bigint from intents where established_at is not null and ended_at is not null) connected_seconds,
        (select coalesce(sum(seconds), 0)::bigint from mic_union) mic_seconds,
        (select count(*)::int from perm where result = 'GRANTED') permission_granted, (select count(*)::int from perm where result = 'DENIED') permission_denied, (select count(*)::int from perm where result = 'UNAVAILABLE') mic_unavailable,
        (select count(*)::int from usage_events e where ${eventsWhere(p)} and e.event_name = 'voice.mode_changed') mode_changes`),
    run<{ metric: string; outcome: string; n: number; p50: number | null; p95: number | null }>((p) => `with ${scopeCtes(p, ctx)}
      select e.properties->>'metric' metric, e.properties->>'outcome' outcome, count(*)::int n,
        percentile_cont(0.5) within group (order by (e.properties->>'ms')::numeric) p50, percentile_cont(0.95) within group (order by (e.properties->>'ms')::numeric) p95
      from usage_events e where ${eventsWhere(p)} and e.event_name = 'latency.measured' group by 1, 2`),
    run<Record<string, number>>((p) => `with ${scopeCtes(p, ctx)},
      pb as (select e.properties->>'stage' stage, e.properties->>'context' context, e.actor_person_id, e.properties->>'spanStart' s, e.properties->>'spanEnd' t from usage_events e where ${eventsWhere(p)} and e.event_name = 'voice.playback'),
      spans as (select actor_person_id, tstzrange(s::timestamptz, t::timestamptz) r from pb where s is not null and t is not null and t::timestamptz > s::timestamptz),
      apps as (select e.properties->>'applicationId' application_id, count(*) filter (where e.properties->>'stage' = 'STARTED') starts from usage_events e where ${eventsWhere(p)} and e.event_name = 'feedback_application.presentation' group by 1)
      select (select count(*)::int from pb where stage = 'STARTED' and context = 'CONVERSATION') conversation_playbacks,
        (select count(*)::int from pb where stage = 'INTERRUPTED' and context = 'CONVERSATION') interruptions,
        (select count(*)::int from pb where stage = 'INTERRUPTED') interruptions_all,
        (select coalesce(sum(greatest(starts - 1, 0)), 0)::int from apps) presentation_repeats,
        (select count(*)::int from usage_events e where ${eventsWhere(p)} and e.event_name = 'feedback_application.lifecycle' and e.properties->>'stage' = 'PAUSED') application_pauses,
        (select count(*)::int from usage_events e where ${eventsWhere(p)} and e.event_name = 'feedback_application.lifecycle' and e.properties->>'stage' = 'RESUMED') application_resumes,
        (select coalesce(sum(x.seconds), 0)::bigint from (select (select coalesce(sum(extract(epoch from upper(y) - lower(y))), 0) from unnest(range_agg(r)) y) seconds from spans group by actor_person_id) x) playback_seconds`),
    run<{ use_case: string; events: number; tokens: number | null; cost: string | null; currency: string | null; unknown_cost: number }>((p) => `select u.use_case, count(*)::int events, sum(u.total_tokens)::bigint tokens, sum(u.cost)::text cost, max(u.currency) currency, count(*) filter (where u.cost_status <> 'ESTIMATED')::int unknown_cost
      from (${aiUsageSql(p.typed(ctx.organizationId, "uuid"))}) u where u.workflow_id is null and u.use_case = any(${p.typed([...CONVERSATIONAL_USE_CASES], "text[]")})
        and u.occurred_at >= ${p.typed(ctx.period.start, "timestamptz")} and u.occurred_at < ${p.typed(ctx.period.end, "timestamptz")} group by 1 order by 2 desc`),
  ])

  let items: Record<string, unknown>[] | null = null
  let itemsTotal: number | null = null
  if (ctx.can.people) {
    const itemRows = await run<Record<string, unknown>>((p) => `${messagesCte(p)}
        select m.conversation_id, m.owner_person_id, pop.name owner_name, m.origin, m.kind, count(*) filter (where m.role = 'user' and m.channel = 'chat')::int user_text,
          count(*) filter (where m.role = 'user' and m.channel = 'voice')::int user_voice, count(*) filter (where m.role = 'assistant')::int inia, min(m.occurred_at) first_at, max(m.occurred_at) last_at, count(*) over ()::int total
        from msgs m join (${populationSql(p, ctx.organizationId)}) pop on pop.person_id = m.owner_person_id
        group by 1, 2, 3, 4, 5 having count(*) filter (where m.role = 'user') > 0 order by max(m.occurred_at) desc, m.conversation_id
        ${options.listAll ? "" : `limit ${p.add(f.pageSize)} offset ${p.add((f.page - 1) * f.pageSize)}`}`)
    itemsTotal = itemRows[0] ? Number(itemRows[0].total) : f.page === 1 ? 0 : null
    items = itemRows.map((row) => ({ conversationId: row.conversation_id, ownerPersonId: row.owner_person_id, ownerName: row.owner_name, origin: row.origin, kind: row.kind, userText: row.user_text, userVoice: row.user_voice, inia: row.inia, firstAt: (row.first_at as Date).toISOString(), lastAt: (row.last_at as Date).toISOString(), contentHref: ctx.can.readConversations ? `/admin/conversations?conversation=${String(row.conversation_id)}` : null }))
  }

  const c = counts[0] ?? {}
  const num = (row: Record<string, unknown> | undefined, key: string) => Number(row?.[key] ?? 0)
  const v = voice[0] ?? {}
  const pb = playback[0] ?? {}
  const ui = chatUi[0] ?? {}
  const r = response[0] ?? { eligible: 0, answered: 0, pending: 0 }
  const latencyOf = (metric: string) => {
    const rows = latency.filter((row) => row.metric === metric)
    const ok = rows.find((row) => row.outcome === "OK")
    return { measured: rows.reduce((sum, row) => sum + row.n, 0), median: ok?.p50 === null || ok?.p50 === undefined ? null : Math.round(Number(ok.p50)), p95: ok?.p95 === null || ok?.p95 === undefined ? null : Math.round(Number(ok.p95)), byOutcome: Object.fromEntries(rows.map((row) => [row.outcome, row.n])) }
  }
  const freshness = await loadFreshness(db, ctx.organizationId, ctx.now)
  return {
    meta: metaOf(ctx, freshness, {
      coverage: { messages: officialCoverage(coverageState, "CONVERSATIONS", ctx.period.start, ctx.period.end), chatUi: familyCoverage(coverageState, ["ACTION", "NAVIGATION"], ctx.period.start, ctx.period.end), voice: familyCoverage(coverageState, ["VOICE"], ctx.period.start, ctx.period.end), latency: familyCoverage(coverageState, ["CHAT"], ctx.period.start, ctx.period.end) },
      structureBasis: { value: structureBasisFor(ctx, false), label: STRUCTURE_BASIS_LABELS[structureBasisFor(ctx, false)] },
    }),
    people: people[0] ?? { used: 0, text: 0, voice: 0, both: 0 },
    messages: { userText: num(c, "user_text"), userVoiceTurns: num(c, "user_voice"), iniaText: num(c, "inia_text"), iniaVoice: num(c, "inia_voice"), proactive: num(c, "proactive"), legacyHumanMessages: num(c, "legacy_messages") },
    conversations: { created: num(c, "conversations_created"), withHumanParticipation: num(c, "conversations_with_human"), textOnly: num(c, "text_only"), voiceOnly: num(c, "voice_only"), mixed: num(c, "mixed"), classificationBasis: "Canal das mensagens da pessoa dentro do período selecionado" },
    perPersonDay: { personDays: num(c, "person_days"), messagesPerPersonDay: num(c, "person_days") > 0 ? Math.round(((num(c, "user_text") + num(c, "user_voice")) / num(c, "person_days")) * 10) / 10 : null, conversationsPerPersonDay: num(c, "person_days") > 0 ? Math.round((num(c, "conversation_person_days") / num(c, "person_days")) * 10) / 10 : null },
    perConversation: distribution(perConversation.map((row) => row.n)),
    origins: origins.map((row) => ({ origin: row.origin, kind: row.kind, conversations: row.kind === "LEGACY_HISTORY" ? null : row.conversations, humanMessages: row.human_messages, iniaMessages: row.inia_messages, people: row.people })),
    responseRate: { eligible: r.eligible, answered: r.answered, pending: r.pending, value: rate(r.answered, r.eligible), windowMinutes: RESPONSE_WINDOW_MINUTES },
    chatUi: { panelViews: num(ui, "panel_views"), openedWithoutMessage: num(ui, "opened_without_message"), attempted: num(ui, "attempted"), persistedAck: num(ui, "persisted_ack"), failed: num(ui, "failed"), cancelled: num(ui, "cancelled"), persistedOfficial: num(c, "user_text") },
    voice: {
      sessionsIssued: num(v, "sessions_issued"), intents: num(v, "intents"), established: num(v, "established"), intentsWithReconnection: num(v, "intents_with_reconnection"), reconnections: num(v, "reconnections"),
      failed: num(v, "failed"), closed: num(v, "closed"), withSpeech: num(v, "with_speech"), withoutSpeech: num(v, "without_speech"),
      connectedSeconds: num(v, "connected_seconds"), micSeconds: num(v, "mic_seconds"), speechSeconds: null, playbackSeconds: num(pb, "playback_seconds"),
      permissionGranted: num(v, "permission_granted"), permissionDenied: num(v, "permission_denied"), micUnavailable: num(v, "mic_unavailable"), modeChanges: num(v, "mode_changes"),
      interruptions: num(pb, "interruptions"), interruptionsAllContexts: num(pb, "interruptions_all"), conversationPlaybacks: num(pb, "conversation_playbacks"), presentationRepeats: num(pb, "presentation_repeats"),
      applicationPauses: num(pb, "application_pauses"), applicationResumes: num(pb, "application_resumes"),
    },
    latency: { chatFirstText: latencyOf("CHAT_FIRST_TEXT"), voiceFirstAudio: latencyOf("VOICE_FIRST_AUDIO") },
    cost: { attribution: "UNATTRIBUTED", note: "O uso de IA de conversas não tem correlação gravada com conversa, origem ou canal: aparece por Use Case, sem atribuição.", byUseCase: cost.map((row) => ({ useCase: row.use_case, events: row.events, tokens: row.tokens === null ? null : Number(row.tokens), cost: row.cost, currency: row.currency, unknownCostEvents: row.unknown_cost })) },
    page: f.page,
    pageSize: f.pageSize,
    total: itemsTotal,
    identified: ctx.can.people,
    items,
  }
}
