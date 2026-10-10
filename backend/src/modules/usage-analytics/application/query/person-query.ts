import type { Database } from "../../../../infrastructure/database/pool.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { SqlParams } from "../../../../shared/infrastructure/sql-params.js"
import { activeAccountRolesSql, scopedPeopleSql } from "../../../access/application/scope-people-reader.js"
import { conversationMessagesSql } from "../../../assistant/application/usage-analytics-reader.js"
import { readConfirmationEventsSql } from "../../../feedback-application/application/usage-analytics-reader.js"
import { DISLIKE_REASON_LABELS, ratingsHistorySql } from "../../../feedback-rating/application/usage-analytics-reader.js"
import { populationSql } from "../../../people/application/usage-analytics-reader.js"
import { manualRunsSql } from "../../../workflows/application/usage-analytics-reader.js"
import { distribution } from "../../domain/metric-value.js"
import { ELEMENT_BY_KEY } from "../../domain/usage-elements.js"
import { EVENT_BY_NAME, USAGE_ACTION_LABELS } from "../../domain/usage-events.js"
import { SCREEN_BY_KEY } from "../../domain/usage-screens.js"
import { DOMAIN_ACTION_LABELS, domainActionsSql } from "./domain-actions.js"
import { familyCoverage, loadCoverageState, loadFreshness, metaOf, type UsabilityContext } from "./usability-context.js"

/**
 * DETALHE INDIVIDUAL de uso — só com `usability.users.view` e com a pessoa no alcance DESSA permissão (fora = 404, sem
 * distinguir de inexistente). Toda consulta individual é auditada (quem, quando, qual pessoa e recorte — nunca os dados).
 * Mostra fatos; não existe score de produtividade, nem leitura de conteúdo (mensagens, comentários e transcrições ficam nas
 * telas de origem, com as permissões delas).
 */
type Queryable = Pick<Database, "query">

async function requirePersonInScope(db: Queryable, ctx: UsabilityContext, personId: string) {
  if (!ctx.can.people) throw new DomainError("Você não tem permissão para ver pessoas identificadas.", "USABILITY_PEOPLE_FORBIDDEN", 403)
  const p = new SqlParams()
  const scope = scopedPeopleSql(p, { organizationId: ctx.organizationId, viewerPersonId: ctx.viewerPersonId, permission: "usability.users.view" })
  const result = await db.query<Record<string, unknown>>(
    `select pop.*, coalesce((select array_agg(distinct r.role_code) from (${activeAccountRolesSql(p, ctx.organizationId)}) r where r.account_id = pop.account_id), '{}') role_codes
     from (${populationSql(p, ctx.organizationId)}) pop where pop.person_id = ${p.typed(personId, "uuid")} and pop.person_id in (${scope})`,
    p.values,
  )
  const row = result.rows[0]
  if (!row) throw new DomainError("Pessoa não encontrada.", "USABILITY_PERSON_NOT_FOUND", 404)
  return row
}

async function audit(db: Queryable, ctx: UsabilityContext, action: string, personId: string, extra: Record<string, unknown> = {}) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'PERSON', $4, $5)`, [
    ctx.organizationId,
    ctx.viewerPersonId,
    action,
    personId,
    JSON.stringify({ period: { from: ctx.period.fromDate, to: ctx.period.toDate }, ...extra }),
  ])
}

export async function personDetailQuery(db: Queryable, ctx: UsabilityContext, personId: string) {
  const person = await requirePersonInScope(db, ctx, personId)
  const org = ctx.organizationId
  const run = async <T extends Record<string, unknown>>(build: (p: SqlParams) => string) => {
    const p = new SqlParams()
    return (await db.query<T>(build(p), p.values)).rows
  }
  const range = (p: SqlParams, column: string) => `${column} >= ${p.typed(ctx.period.start, "timestamptz")} and ${column} < ${p.typed(ctx.period.end, "timestamptz")}`
  const [days, sessions, screens, actions, eligibility, milestones, feedback, chat] = await Promise.all([
    run<{ local_date: string; active_product: boolean; active_admin: boolean; sessions_started: number; sessions_active: number; active_seconds: number; screen_views: number; activations: number; devices: string[]; active_hours: number[] }>((p) => `
      select to_char(local_date, 'YYYY-MM-DD') local_date, active_product, active_admin, sessions_started, sessions_active, active_seconds, screen_views, activations, devices, active_hours
      from usage_person_days where organization_id = ${p.typed(org, "uuid")} and person_id = ${p.typed(personId, "uuid")} and local_date between ${p.typed(ctx.period.fromDate, "date")} and ${p.typed(ctx.period.toDate, "date")} order by local_date`),
    run<{ started_at: Date; ended_at: Date; end_reason: string; active_seconds: number; device: string | null; activity_count: number; has_admin_activity: boolean }>((p) => `
      select started_at, ended_at, end_reason, active_seconds, device, activity_count, has_admin_activity from usage_sessions
      where organization_id = ${p.typed(org, "uuid")} and person_id = ${p.typed(personId, "uuid")} and ${range(p, "started_at")} order by started_at desc limit 200`),
    run<{ screen_key: string; views: number; active_seconds: number; days: number }>((p) => `
      select screen_key, sum(views)::int views, sum(active_seconds)::int active_seconds, count(distinct local_date)::int days from usage_screen_person_days
      where organization_id = ${p.typed(org, "uuid")} and person_id = ${p.typed(personId, "uuid")} and local_date between ${p.typed(ctx.period.fromDate, "date")} and ${p.typed(ctx.period.toDate, "date")} group by 1 order by views desc`),
    run<{ action: string; n: number }>((p) => `select da.action, count(*)::int n from (${domainActionsSql(p.typed(org, "uuid"))}) da where da.person_id = ${p.typed(personId, "uuid")} and ${range(p, "da.occurred_at")} group by 1`),
    run<{ eligible_from: Date; eligible_until: Date | null; opened_basis: string; closed_basis: string | null }>((p) => `select eligible_from, eligible_until, opened_basis, closed_basis from usage_eligibility_periods where organization_id = ${p.typed(org, "uuid")} and person_id = ${p.typed(personId, "uuid")} order by eligible_from`),
    // Mesma regra da lista de pessoas: acesso comprovado = marco da monitoria (atividade/login) OU ação de domínio na fonte oficial.
    run<{ first_observed_at: Date | null; first_observed_source: string | null; last_observed_at: Date | null; last_observed_source: string | null; legacy_last_login_at: Date | null }>((p) => {
      const o = p.typed(org, "uuid")
      const who = p.typed(personId, "uuid")
      return `with m as (select * from usage_person_milestones where organization_id = ${o} and person_id = ${who}),
        ab as (select min(da.occurred_at) first_at, max(da.occurred_at) last_at from (${domainActionsSql(o)}) da where da.person_id = ${who} and da.occurred_at < ${p.typed(ctx.period.end, "timestamptz")})
        select case when ab.first_at is not null and (m.first_observed_at is null or ab.first_at < m.first_observed_at) then ab.first_at else m.first_observed_at end first_observed_at,
          case when ab.first_at is not null and (m.first_observed_at is null or ab.first_at < m.first_observed_at) then 'DOMAIN_ACTION' else m.first_observed_source end first_observed_source,
          case when ab.last_at is not null and (m.last_observed_at is null or ab.last_at > m.last_observed_at) then ab.last_at else m.last_observed_at end last_observed_at,
          case when ab.last_at is not null and (m.last_observed_at is null or ab.last_at > m.last_observed_at) then 'DOMAIN_ACTION' else m.last_observed_source end last_observed_source,
          m.legacy_last_login_at
        from ab left join m on true`
    }),
    run<Record<string, number>>((p) => {
      const o = p.typed(org, "uuid")
      const who = p.typed(personId, "uuid")
      return `select (select count(*)::int from usage_events e where e.organization_id = ${o} and e.actor_person_id = ${who} and e.subject_person_id = ${who} and e.event_name = 'screen.viewed' and e.screen_key in ('feedback.detail', 'feedback.session') and ${range(p, "e.occurred_at")}) opened,
        (select count(*)::int from (${ratingsHistorySql(o)}) r where r.person_id = ${who} and ${range(p, "r.created_at")}) ratings,
        (select count(*)::int from (${readConfirmationEventsSql(o)}) c where c.person_id = ${who} and c.event = 'CONFIRMED' and not c.already_confirmed and ${range(p, "c.occurred_at")}) acks,
        (select count(*)::int from (${readConfirmationEventsSql(o)}) c where c.person_id = ${who} and c.event = 'FAILED' and ${range(p, "c.occurred_at")}) ack_failures`
    }),
    run<Record<string, number>>((p) => `select count(*) filter (where m.role = 'user' and m.channel = 'chat')::int text, count(*) filter (where m.role = 'user' and m.channel = 'voice')::int voice,
        count(distinct m.conversation_id) filter (where m.role = 'user')::int conversations
      from (${conversationMessagesSql(p.typed(org, "uuid"))}) m where m.owner_person_id = ${p.typed(personId, "uuid")} and ${range(p, "m.occurred_at")}`),
  ])
  await audit(db, ctx, "USABILITY_PERSON_VIEWED", personId)
  const coverageState = await loadCoverageState(db, org, ctx.now)
  const freshness = await loadFreshness(db, org, ctx.now)
  const activeDays = days.filter((day) => day.active_product || (ctx.filters.includeAdmin && day.active_admin))
  const m = milestones[0]
  const hours = new Map<number, number>()
  for (const day of activeDays) for (const hour of day.active_hours) hours.set(hour, (hours.get(hour) ?? 0) + 1)
  return {
    meta: metaOf(ctx, freshness, { coverage: { activity: familyCoverage(coverageState, ["NAVIGATION", "SESSION"], ctx.period.start, ctx.period.end) }, audited: true }),
    person: {
      personId,
      name: person.name,
      matricula: person.matricula,
      jobTitle: person.job_title,
      level: person.level,
      teamName: person.team_name,
      subteamName: person.subteam_name,
      personActive: person.person_active,
      employmentStatus: person.employment_status,
      accountStatus: person.account_id === null ? "NONE" : person.account_active ? "ENABLED" : "DISABLED",
      roles: person.role_codes,
      lastLoginAt: person.last_login_at instanceof Date ? person.last_login_at.toISOString() : null,
    },
    milestones: { firstObservedAt: m?.first_observed_at?.toISOString() ?? null, firstObservedSource: m?.first_observed_source ?? null, lastObservedAt: m?.last_observed_at?.toISOString() ?? null, lastObservedSource: m?.last_observed_source ?? null, legacyLastLoginAt: m?.legacy_last_login_at?.toISOString() ?? null },
    eligibility: eligibility.map((row) => ({ from: row.eligible_from.toISOString(), until: row.eligible_until?.toISOString() ?? null, openedBasis: row.opened_basis, closedBasis: row.closed_basis })),
    calendar: ctx.period.dates.map((date) => {
      const day = days.find((item) => item.local_date === date)
      return { date, active: Boolean(day && (day.active_product || (ctx.filters.includeAdmin && day.active_admin))), sessionsStarted: day?.sessions_started ?? 0, sessionsActive: day?.sessions_active ?? 0, activeSeconds: day?.active_seconds ?? 0, screenViews: day?.screen_views ?? 0, activations: day?.activations ?? 0 }
    }),
    totals: {
      activeDays: activeDays.length,
      sessionsStarted: sessions.length,
      sessionsPerActiveDay: activeDays.length > 0 ? Math.round((sessions.length / activeDays.length) * 100) / 100 : null,
      activeSeconds: activeDays.reduce((sum, day) => sum + day.active_seconds, 0),
      sessionDuration: distribution(sessions.filter((session) => session.end_reason !== "OPEN").map((session) => (session.ended_at.getTime() - session.started_at.getTime()) / 1000)),
      devices: [...new Set(days.flatMap((day) => day.devices))],
    },
    hours: [...hours].sort((a, b) => a[0] - b[0]).map(([hour, count]) => ({ hour, activeDays: count })),
    sessions: sessions.map((session) => ({ startedAt: session.started_at.toISOString(), endedAt: session.ended_at.toISOString(), endReason: session.end_reason, activeSeconds: session.active_seconds, device: session.device, activityCount: session.activity_count, admin: session.has_admin_activity })),
    screens: screens.map((row) => ({ screenKey: row.screen_key, label: SCREEN_BY_KEY.get(row.screen_key)?.label ?? row.screen_key, views: row.views, activeSeconds: row.active_seconds, days: row.days })),
    actions: actions.map((row) => ({ action: row.action, label: DOMAIN_ACTION_LABELS[row.action] ?? row.action, count: row.n })),
    feedback: feedback[0] ?? {},
    chat: chat[0] ?? {},
  }
}

/** Linha do tempo paginada (mais recentes primeiro): eventos de uso + fatos oficiais, sem conteúdo. */
export async function personTimelineQuery(db: Queryable, ctx: UsabilityContext, personId: string) {
  await requirePersonInScope(db, ctx, personId)
  const p = new SqlParams()
  const org = p.typed(ctx.organizationId, "uuid")
  const who = p.typed(personId, "uuid")
  const start = p.typed(ctx.period.start, "timestamptz")
  const end = p.typed(ctx.period.end, "timestamptz")
  const rows = await db.query<{ at: Date; kind: string; source: string; name: string; screen_key: string | null; element_key: string | null; entity_type: string | null; entity_id: string | null; detail: string | null }>(
    `select * from (
       select e.occurred_at at, 'EVENT' kind, e.source, e.event_name name, e.screen_key, e.element_key, e.entity_type, e.entity_id,
         coalesce(e.properties->>'actionKey', e.properties->>'stage', e.properties->>'reason', e.properties->>'decision', e.properties->>'result') detail
       from usage_events e where e.organization_id = ${org} and e.actor_person_id = ${who} and e.occurred_at >= ${start} and e.occurred_at < ${end} and e.event_name <> 'activity.heartbeat'
       union all select m.occurred_at, 'MESSAGE', 'OFFICIAL', case when m.channel = 'voice' then 'MESSAGE_VOICE' else 'MESSAGE_TEXT' end, null, null, 'CONVERSATION', m.conversation_id, m.origin
       from (${conversationMessagesSql(org)}) m where m.owner_person_id = ${who} and m.role = 'user' and m.occurred_at >= ${start} and m.occurred_at < ${end}
       union all select r.created_at, 'RATING', 'OFFICIAL', r.value, null, null, r.source_kind, r.source_id, r.reason
       from (${ratingsHistorySql(org)}) r where r.person_id = ${who} and r.created_at >= ${start} and r.created_at < ${end}
       union all select c.occurred_at, 'READ_CONFIRMATION', 'OFFICIAL', c.event, null, null, c.source_kind, c.source_id, coalesce(c.entry_point || case when c.already_confirmed then ' · já confirmado' else '' end, c.entry_point)
       from (${readConfirmationEventsSql(org)}) c where c.person_id = ${who} and c.occurred_at >= ${start} and c.occurred_at < ${end}
       union all select mr.requested_at, 'MANUAL_RUN', 'OFFICIAL', 'MANUAL_RUN', null, null, 'WORKFLOW', mr.workflow_id, mr.context
       from (${manualRunsSql(org)}) mr where mr.requested_by = ${who} and mr.requested_at >= ${start} and mr.requested_at < ${end}
     ) t order by at desc, kind, name, entity_id nulls last, detail nulls last limit ${p.add(ctx.filters.pageSize + 1)} offset ${p.add((ctx.filters.page - 1) * ctx.filters.pageSize)}`,
    p.values,
  )
  await audit(db, ctx, "USABILITY_PERSON_TIMELINE_VIEWED", personId, { page: ctx.filters.page })
  const hasMore = rows.rows.length > ctx.filters.pageSize
  return {
    page: ctx.filters.page,
    pageSize: ctx.filters.pageSize,
    hasMore,
    items: rows.rows.slice(0, ctx.filters.pageSize).map((row) => ({
      at: row.at.toISOString(),
      kind: row.kind,
      source: row.source,
      label: labelOf(row),
      screenLabel: row.screen_key ? SCREEN_BY_KEY.get(row.screen_key)?.label ?? row.screen_key : null,
      elementLabel: row.element_key ? ELEMENT_BY_KEY.get(row.element_key)?.label ?? row.element_key : null,
      entity: row.entity_type && row.entity_id ? { type: row.entity_type, id: row.entity_id } : null,
      href: row.entity_type === "CONVERSATION" && row.entity_id && ctx.can.readConversations ? `/admin/conversations?conversation=${row.entity_id}` : null,
    })),
  }
}

function labelOf(row: { kind: string; name: string; detail: string | null }): string {
  if (row.kind === "MESSAGE") return row.name === "MESSAGE_VOICE" ? "Turno de voz com a INIA" : "Mensagem de texto à INIA"
  if (row.kind === "RATING") return row.name === "UP" ? "Avaliou: foi útil" : row.name === "DOWN" ? `Avaliou: não foi útil${row.detail ? ` (${DISLIKE_REASON_LABELS[row.detail] ?? row.detail})` : ""}` : "Retirou a avaliação"
  if (row.kind === "READ_CONFIRMATION") return { OPENED: "Abriu a confirmação de ciência", FAILED: "Falha na confirmação de ciência", CONFIRMED: "Confirmou ciência", CANCELLED: "Cancelou a confirmação" }[row.name] ?? row.name
  if (row.kind === "MANUAL_RUN") return "Solicitou execução manual de workflow"
  if (row.name.startsWith("action.") && row.detail) return `${USAGE_ACTION_LABELS[row.detail as keyof typeof USAGE_ACTION_LABELS] ?? row.detail} · ${{ "action.started": "iniciada", "action.succeeded": "confirmada", "action.failed": "falhou", "action.cancelled": "cancelada" }[row.name] ?? ""}`
  const base = EVENT_TIMELINE_LABELS[row.name] ?? EVENT_BY_NAME.get(row.name)?.purpose.split(".")[0] ?? row.name
  const detail = row.detail ? (DETAIL_LABELS[row.detail] ?? row.detail) : null
  return detail ? `${base} · ${detail}` : base
}

/** Rótulo curto de cada evento na linha do tempo (a descrição completa continua no catálogo da aba Qualidade). */
const EVENT_TIMELINE_LABELS: Record<string, string> = {
  "screen.viewed": "Abriu a tela",
  "screen.left": "Saiu da tela",
  "element.activated": "Acionou",
  "element.exposed": "Viu o conteúdo",
  "content.scrolled": "Rolou o conteúdo",
  "search.performed": "Buscou",
  "search.result_opened": "Abriu um resultado da busca",
  "filter.applied": "Usou um filtro",
  "latency.measured": "Tempo até a primeira resposta da INIA",
  "voice.mic_permission": "Permissão do microfone",
  "voice.connection": "Conexão de voz",
  "voice.mic_span": "Microfone ligado",
  "voice.playback": "Fala da INIA",
  "voice.mode_changed": "Mudou o modo da conversa",
  "auth.login_succeeded": "Entrou na INIA",
  "auth.logout": "Saiu da INIA",
  "voice.session_issued": "Sessão de voz iniciada",
  "feedback_application.lifecycle": "Aplicação de feedback",
  "feedback_application.presentation": "Apresentação do feedback",
  "feedback_application.invite": "Convite para ouvir um feedback",
  "notification.read": "Leu uma notificação",
  "usability.export": "Exportou dados da monitoria",
}

const DETAIL_LABELS: Record<string, string> = {
  REQUESTED: "pedida",
  ESTABLISHED: "estabelecida",
  RECONNECTING: "reconectando",
  RECONNECTED: "reconectada",
  CLOSED: "encerrada",
  FAILED: "falhou",
  STARTED: "iniciada",
  COMPLETED: "concluída",
  INTERRUPTED: "interrompida",
  RESUMED: "retomada",
  OPENED: "aberta",
  PAUSED: "pausada",
  GRANTED: "concedida",
  DENIED: "negada",
  UNAVAILABLE: "indisponível",
  OFFER: "oferecido",
  ACCEPT: "aceito",
  READ: "lido",
  SNOOZE: "adiado",
  USER: "pela pessoa",
  IDLE: "por inatividade",
  NETWORK: "por rede",
  SERVER: "pelo servidor",
}
