import { assignmentScopesOf, permissionHoldersWithSituation, personIdsWithPermission } from "../../access/application/permission-holders.js"
import type { AccessScope } from "../../access/domain/access-scope.js"
import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import type { AttendanceEndCause, ClassificationOutcome, ClassificationReason, EvaluationResolved, PauseReason, PresenceStatus, RequestEndCause, RequestOrigin, RequestStatus } from "../domain/catalogs.js"
import { MIN_SAMPLE, presenceHours, type PresenceEvent, type PresenceState } from "../domain/metrics-definitions.js"
import { operationalStatusOf } from "../domain/anjo-now.js"
import { effectiveCapacity } from "../domain/presence.js"
import { nearestRank } from "../domain/queue-history.js"
import type { AnjoActivity, AnjoNowItem, AnjoScopeView, AnjosNow, PresenceTimeline, RequestDetail, RequestListItem, SharedContext, UnavailableAttempt } from "../domain/views.js"
import { assertPanelPeriod, coordinatorScopesOf, coverageClause, coversRecord, decodeListCursor, encodeListCursor, periodBounds, reachesAnjo, type CoordinatorScopes } from "./coverage.js"
import { loadSettings } from "./eligibility.js"
import type { Queryable } from "./locks.js"
import { loadMessageViews } from "./request-views.js"
import type { Viewer } from "./request-service.js"
import { humanSupportStats } from "./runtime-stats.js"

/**
 * PAINEL DO APOIO — Coordenador de Anjos e Administrador geral (design_draft.md seções 5, 13 e 14): pedidos (lista e detalhe com a
 * conversa), tentativas sem Anjo em serviço (D4) e a atividade dos Anjos (M18). Fora do alcance = 404. Abrir um pedido grava o
 * registro LGPD para o operador e para cada Anjo dele; abrir a presença de Anjos, uma linha por Anjo exibido — sempre depois de ler.
 */
export type PanelQuery = { from: string; to: string; teamId?: string | undefined; subteamId?: string | undefined }
type ListQuery = PanelQuery & { search?: string | undefined; status?: string | undefined; origin?: string | undefined; cursor?: string | undefined; limit?: number | undefined }

const notFound = () => new DomainError("Registro não encontrado.", "HUMAN_SUPPORT_NOT_FOUND", 404)
const pageSize = (limit: number | undefined) => Math.min(Math.max(limit ?? 30, 1), 50)

async function logAccess(db: Queryable, viewer: Viewer, subjects: Iterable<string>, dataKind: "HUMAN_SUPPORT_CONVERSATION" | "HUMAN_SUPPORT_PRESENCE", resourceId: string | null) {
  for (const subject of new Set(subjects)) {
    const ok = await recordPersonalDataAccess(db, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, subjectPersonId: subject, dataKind, resourceId })
    if (!ok) humanSupportStats.personalDataLogFailures += 1
  }
}

type ListRow = {
  id: string
  protocol: string
  operator_person_id: string
  team_name: string | null
  subteam_name: string | null
  origin: RequestOrigin
  status: RequestStatus
  end_cause: RequestEndCause | null
  created_at: Date
  ended_at: Date | null
  team_id: string | null
  subteam_id: string | null
  anjo_ids: string[] | null
  first_response_seconds: number | null
  message_count: number
  classification_reason: ClassificationReason | null
  outcome: ClassificationOutcome | null
  resolved: EvaluationResolved | null
  stars: number | null
}

const LIST_SELECT = `
  select r.id, r.protocol, r.operator_person_id, t.name team_name, st.name subteam_name, r.origin, r.status, r.end_cause, r.created_at, r.ended_at, r.team_id, r.subteam_id,
         (select array_agg(a.anjo_person_id order by a.started_at) from human_support_attendances a where a.request_id = r.id) anjo_ids,
         (select min(extract(epoch from a.first_anjo_message_at - a.started_at))::float8 from human_support_attendances a where a.request_id = r.id and a.first_anjo_message_at is not null) first_response_seconds,
         (select count(*)::int from human_support_messages m where m.request_id = r.id and m.author_kind <> 'SYSTEM') message_count,
         last.reason classification_reason, last.outcome, last.resolved, last.stars
    from human_support_requests r
    left join teams t on t.id = r.team_id
    left join subteams st on st.id = r.subteam_id
    left join lateral (
      select c.reason, c.outcome, e.resolved, e.stars
        from human_support_attendances a
        left join human_support_classifications c on c.attendance_id = a.id
        left join human_support_evaluations e on e.attendance_id = a.id and e.superseded_at is null
       where a.request_id = r.id order by a.started_at desc limit 1
    ) last on true`

async function toListItems(db: Queryable, organizationId: string, rows: ListRow[]): Promise<RequestListItem[]> {
  const names = await loadPersonPresentations(db, organizationId, rows.flatMap((row) => [row.operator_person_id, ...(row.anjo_ids ?? [])]))
  const nameOf = (id: string) => names.get(id)?.displayName ?? "Pessoa"
  return rows.map((row) => ({
    id: row.id,
    protocol: row.protocol,
    operatorName: nameOf(row.operator_person_id),
    operatorAvatarUrl: names.get(row.operator_person_id)?.avatarUrl ?? null,
    teamName: row.team_name,
    subteamName: row.subteam_name,
    origin: row.origin,
    status: row.status,
    endCause: row.end_cause,
    createdAt: row.created_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    anjoNames: [...new Set((row.anjo_ids ?? []).map(nameOf))],
    firstResponseSeconds: row.first_response_seconds === null ? null : Math.round(Number(row.first_response_seconds)),
    messageCount: Number(row.message_count ?? 0),
    classificationReason: row.classification_reason,
    outcome: row.outcome,
    resolved: row.resolved,
    stars: row.stars === null ? null : Number(row.stars),
  }))
}

/** `%`, `_` e `\` digitados na busca valem como texto, não como curinga do `ilike`. */
const likePattern = (text: string) => `%${text.replace(/[%_\\]/g, (char) => `\\${char}`)}%`

/**
 * Pedidos do período, mais novos primeiro (cursor). A busca olha o protocolo e o nome do operador (cadastral ou preferido), nunca o
 * conteúdo da conversa. `total` só na primeira página (sem cursor): quantos pedidos atendem aos filtros, para o cabeçalho da tela.
 */
export async function listRequests(db: Queryable, viewer: Viewer, query: ListQuery): Promise<{ items: RequestListItem[]; nextCursor: string | null; total: number | null }> {
  assertPanelPeriod(query)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const params: unknown[] = [viewer.organizationId, query.from, query.to]
  const bounds = periodBounds("$1", "$2", "$3")
  const where = [`r.organization_id = $1`, `r.created_at >= ${bounds.start}`, `r.created_at < ${bounds.end}`, coverageClause(coverage, "r", params, query)]
  if (query.status) where.push(`r.status = $${params.push(query.status)}`)
  if (query.origin) where.push(`r.origin = $${params.push(query.origin)}`)
  const search = query.search?.trim()
  if (search) {
    const pattern = `$${params.push(likePattern(search))}`
    where.push(
      `(r.protocol ilike ${pattern} or exists (select 1 from people p left join person_profile_preferences pp on pp.organization_id = p.organization_id and pp.person_id = p.id
         where p.id = r.operator_person_id and (p.name ilike ${pattern} or pp.preferred_name ilike ${pattern})))`,
    )
  }
  const filters = [...where]
  const filterParams = [...params]
  const cursor = decodeListCursor(query.cursor)
  if (cursor) where.push(`(r.created_at, r.id) < ($${params.push(cursor.at)}::timestamptz, $${params.push(cursor.id)}::uuid)`)
  const limit = pageSize(query.limit)
  const rows = (await db.query<ListRow>(`${LIST_SELECT} where ${where.join(" and ")} order by r.created_at desc, r.id desc limit ${limit + 1}`, params)).rows
  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const total = cursor
    ? null
    : rows.length <= limit
      ? page.length
      : ((await db.query<{ total: number }>(`select count(*)::int total from human_support_requests r where ${filters.join(" and ")}`, filterParams)).rows[0]?.total ?? page.length)
  return { items: await toListItems(db, viewer.organizationId, page), nextCursor: rows.length > limit && last ? encodeListCursor(last.created_at, last.id) : null, total }
}

/** Detalhe do pedido com a cópia, a conversa inteira, os atendimentos, a classificação e a avaliação vigente. */
export async function requestDetail(db: Queryable, viewer: Viewer, requestId: string): Promise<RequestDetail> {
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const row = (await db.query<ListRow & { shared_context: SharedContext }>(`${LIST_SELECT.replace("select r.id,", "select r.shared_context, r.id,")} where r.organization_id = $1 and r.id = $2`, [viewer.organizationId, requestId])).rows[0]
  if (!row || !coversRecord(coverage, { teamId: row.team_id, subteamId: row.subteam_id })) throw notFound()
  const [item] = await toListItems(db, viewer.organizationId, [row])
  const messages = []
  for (let after = 0, more = true; more && messages.length < 2_000; ) {
    const page = await loadMessageViews(db, viewer.organizationId, requestId, "OBSERVER", { after, limit: 50 })
    messages.push(...page.messages)
    more = page.hasMore
    after = page.messages.at(-1)?.seq ?? after
  }
  const attendances = (await db.query<{ id: string; anjo_person_id: string; started_at: Date; first_anjo_message_at: Date | null; ended_at: Date | null; end_cause: AttendanceEndCause | null }>(`select id, anjo_person_id, started_at, first_anjo_message_at, ended_at, end_cause from human_support_attendances where request_id = $1 order by started_at`, [requestId])).rows
  const classification = (await db.query<{ reason: ClassificationReason; reference_title: string | null; reference_url: string | null; other_description: string | null; outcome: ClassificationOutcome }>(`select c.reason, c.reference_title, c.reference_url, c.other_description, c.outcome from human_support_classifications c join human_support_attendances a on a.id = c.attendance_id where a.request_id = $1 order by a.started_at desc limit 1`, [requestId])).rows[0]
  const names = await loadPersonPresentations(db, viewer.organizationId, attendances.map((attendance) => attendance.anjo_person_id))
  await logAccess(db, viewer, [row.operator_person_id, ...attendances.map((attendance) => attendance.anjo_person_id)], "HUMAN_SUPPORT_CONVERSATION", requestId)
  return {
    ...item!,
    sharedContext: row.shared_context,
    messages,
    attendances: attendances.map((attendance) => ({ id: attendance.id, anjoName: names.get(attendance.anjo_person_id)?.displayName ?? "Anjo", startedAt: attendance.started_at.toISOString(), firstAnjoMessageAt: attendance.first_anjo_message_at?.toISOString() ?? null, endedAt: attendance.ended_at?.toISOString() ?? null, endCause: attendance.end_cause })),
    classification: classification ? { reason: classification.reason, referenceTitle: classification.reference_title, referenceUrl: classification.reference_url, otherDescription: classification.other_description, outcome: classification.outcome } : null,
  }
}

/** Tentativas sem Anjo em serviço (D4): quando, quem, Grupo/Subgrupo congelados no evento, origem. */
export async function listUnavailableAttempts(db: Queryable, viewer: Viewer, query: PanelQuery & { cursor?: string | undefined; limit?: number | undefined }): Promise<{ items: UnavailableAttempt[]; nextCursor: string | null }> {
  assertPanelPeriod(query)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const params: unknown[] = [viewer.organizationId, query.from, query.to]
  const bounds = periodBounds("$1", "$2", "$3")
  const where = [`e.organization_id = $1`, `e.kind = 'NO_ANJO_IN_SERVICE'`, `e.occurred_at >= ${bounds.start}`, `e.occurred_at < ${bounds.end}`, coverageClause(coverage, "e", params, query)]
  const cursor = decodeListCursor(query.cursor)
  if (cursor) where.push(`(e.occurred_at, e.id::text) < ($${params.push(cursor.at)}::timestamptz, $${params.push(cursor.id)})`)
  const limit = pageSize(query.limit)
  const rows = (
    await db.query<{ id: string; occurred_at: Date; person_id: string; team_name: string | null; subteam_name: string | null; origin: RequestOrigin | null }>(
      `select e.id::text id, e.occurred_at, e.person_id, t.name team_name, st.name subteam_name, e.origin
         from human_support_entry_events e left join teams t on t.id = e.team_id left join subteams st on st.id = e.subteam_id
        where ${where.join(" and ")} order by e.occurred_at desc, e.id::text desc limit ${limit + 1}`,
      params,
    )
  ).rows
  const page = rows.slice(0, limit)
  const names = await loadPersonPresentations(db, viewer.organizationId, page.map((row) => row.person_id))
  const last = page.at(-1)
  return {
    items: page.map((row) => ({ occurredAt: row.occurred_at.toISOString(), personName: names.get(row.person_id)?.displayName ?? "Pessoa", teamName: row.team_name, subteamName: row.subteam_name, origin: row.origin })),
    nextCursor: rows.length > limit && last ? encodeListCursor(last.occurred_at, last.id) : null,
  }
}

type PanelScopeFilter = { teamId?: string | undefined; subteamId?: string | undefined }

/** O Anjo atende o Grupo/Subgrupo do filtro do painel (sem filtro = todos). */
async function panelFilterCovers(db: Queryable, filter: PanelScopeFilter): Promise<(list: AccessScope[]) => boolean> {
  const subteamTeam = filter.subteamId ? ((await db.query<{ team_id: string }>(`select team_id from subteams where id = $1`, [filter.subteamId])).rows[0]?.team_id ?? null) : null
  const teamId = filter.teamId ?? subteamTeam
  if (!teamId && !filter.subteamId) return () => true
  return (list) => list.some((scope) => scope.type === "ORGANIZATION" || (scope.type === "GROUP" && scope.teamId === teamId) || (scope.type === "SUBGROUP" && Boolean(filter.subteamId) && scope.subteamId === filter.subteamId))
}

/** Anjos que quem lê alcança (D11), filtrados pelo escopo que atendem, quando há filtro. */
async function reachableAnjos(db: Queryable, viewer: Viewer, coverage: CoordinatorScopes, filter: PanelScopeFilter) {
  const scopes = await assignmentScopesOf(db, viewer.organizationId, "human_support.attend", await personIdsWithPermission(db, viewer.organizationId, "human_support.attend"))
  const covers = await panelFilterCovers(db, filter)
  return [...scopes.entries()].filter(([, list]) => reachesAnjo(coverage, list) && covers(list))
}

/**
 * SITUAÇÃO DOS ANJOS AGORA (aba Anjos): todos os titulares do papel que quem lê alcança — inclusive os inativos, marcados como tal —,
 * com o status operacional e desde quando (regra em `domain/anjo-now.ts`), a conexão e os atendimentos em andamento. Não depende do
 * período do painel. Mostrar a presença de Anjos grava o registro LGPD (o registro já evita repetir a mesma linha por 10 min, então a
 * atualização automática da tela não multiplica linhas).
 */
export async function anjosNow(db: Queryable, viewer: Viewer, filter: PanelScopeFilter): Promise<AnjosNow> {
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const [holders, covers, settings, clock] = await Promise.all([
    permissionHoldersWithSituation(db, viewer.organizationId, "human_support.attend"),
    panelFilterCovers(db, filter),
    loadSettings(db, viewer.organizationId),
    db.query<{ now: Date }>("select statement_timestamp() now"),
  ])
  const now = clock.rows[0]?.now ?? new Date()
  const reached = [...holders.entries()].filter(([, holder]) => reachesAnjo(coverage, holder.scopes) && covers(holder.scopes))
  if (reached.length === 0) return { serverTime: now.toISOString(), items: [] }
  const ids = reached.map(([personId]) => personId)
  const [presence, attendances, structure, names] = await Promise.all([
    db.query<{ person_id: string; status: PresenceStatus; pause_reason: PauseReason | null; status_since: Date | null; connected: boolean; connection_lost_at: Date | null; max_concurrent: number | null }>(
      `select person_id, status, pause_reason, status_since, coalesce(lease_until > statement_timestamp(), false) connected, connection_lost_at, max_concurrent
         from human_support_agent_presence where organization_id = $1 and person_id = any($2::uuid[])`,
      [viewer.organizationId, ids],
    ),
    // Atendimentos em andamento e os encerrados nas últimas 24 h (bastam para achar o início da sequência atual e o último fim).
    db.query<{ anjo_person_id: string; started_at: Date; ended_at: Date | null }>(
      `select anjo_person_id, started_at, case when status = 'ACTIVE' then null else ended_at end ended_at
         from human_support_attendances
        where organization_id = $1 and anjo_person_id = any($2::uuid[]) and (status = 'ACTIVE' or ended_at > statement_timestamp() - interval '24 hours')`,
      [viewer.organizationId, ids],
    ),
    db.query<{ kind: "GROUP" | "SUBGROUP"; id: string; name: string }>(
      `select 'GROUP' kind, id, name from teams where organization_id = $1 union all select 'SUBGROUP' kind, id, name from subteams where organization_id = $1`,
      [viewer.organizationId],
    ),
    loadPersonPresentations(db, viewer.organizationId, ids),
  ])
  const nameOf = new Map(structure.rows.map((row) => [`${row.kind}:${row.id}`, row.name]))
  const presenceOf = new Map(presence.rows.map((row) => [row.person_id, row]))
  const items: AnjoNowItem[] = reached.map(([personId, holder]) => {
    const row = presenceOf.get(personId)
    const spans = attendances.rows.filter((span) => span.anjo_person_id === personId).map((span) => ({ startedAt: span.started_at, endedAt: span.ended_at }))
    const operational = operationalStatusOf(row ? { status: row.status, pauseReason: row.pause_reason, statusSince: row.status_since } : null, spans)
    const connected = row?.connected === true
    const scopes: AnjoScopeView[] = holder.scopes.map((scope) =>
      scope.type === "ORGANIZATION" ? { type: "ORGANIZATION", id: null, name: "Toda a organização" } : scope.type === "GROUP" ? { type: "GROUP", id: scope.teamId, name: nameOf.get(`GROUP:${scope.teamId}`) ?? "Grupo" } : scope.type === "SUBGROUP" ? { type: "SUBGROUP", id: scope.subteamId, name: nameOf.get(`SUBGROUP:${scope.subteamId}`) ?? "Subgrupo" } : { type: "SUBGROUP", id: null, name: "Subgrupo" },
    )
    return {
      personId,
      name: names.get(personId)?.displayName ?? "Anjo",
      scopes,
      active: holder.active,
      status: operational.status,
      pauseReason: operational.pauseReason,
      since: operational.since?.toISOString() ?? null,
      connected,
      connectionLostSince: !connected && operational.status !== "UNAVAILABLE" ? (row?.connection_lost_at?.toISOString() ?? null) : null,
      attendances: { active: spans.filter((span) => span.endedAt === null).length, capacity: effectiveCapacity(row?.max_concurrent == null ? null : Number(row.max_concurrent), settings.defaultCapacity) },
    }
  })
  await logAccess(db, viewer, ids, "HUMAN_SUPPORT_PRESENCE", null)
  return { serverTime: now.toISOString(), items: items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }
}

async function presenceStateAt(db: Queryable, organizationId: string, personId: string, at: string): Promise<PresenceState> {
  const status = (await db.query<{ to_status: PresenceStatus; pause_reason: PauseReason | null }>(`select to_status, pause_reason from human_support_presence_events where organization_id = $1 and person_id = $2 and cause in ('ANJO', 'LEASE_EXPIRED', 'ROLE_REVOKED') and occurred_at < $3 order by occurred_at desc, id desc limit 1`, [organizationId, personId, at])).rows[0]
  const connection = (await db.query<{ cause: string }>(`select cause from human_support_presence_events where organization_id = $1 and person_id = $2 and cause in ('CONNECTION_LOST', 'CONNECTION_RESTORED', 'ANJO') and occurred_at < $3 order by occurred_at desc, id desc limit 1`, [organizationId, personId, at])).rows[0]
  return { status: status?.to_status ?? "OFFLINE", pauseReason: status?.pause_reason ?? null, connected: connection ? connection.cause !== "CONNECTION_LOST" : false }
}

/** M18 — por Anjo: horas disponível, em pausa por motivo e sem conexão; atendimentos; tempo até a primeira resposta; média das notas (≥ 5). */
export async function anjosActivity(db: Queryable, viewer: Viewer, query: PanelQuery): Promise<{ items: AnjoActivity[] }> {
  assertPanelPeriod(query)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const anjos = await reachableAnjos(db, viewer, coverage, query)
  if (anjos.length === 0) return { items: [] }
  const ids = anjos.map(([personId]) => personId)
  const bounds = (await db.query<{ start: Date; end: Date; now: Date }>(`select ${periodBounds("$1", "$2", "$3").start} start, ${periodBounds("$1", "$2", "$3").end} "end", statement_timestamp() now`, [viewer.organizationId, query.from, query.to])).rows[0]!
  const until = new Date(Math.min(bounds.end.getTime(), bounds.now.getTime()))
  const events = (await db.query<{ person_id: string; occurred_at: Date; to_status: PresenceStatus; pause_reason: PauseReason | null; cause: string }>(`select person_id, occurred_at, to_status, pause_reason, cause from human_support_presence_events where organization_id = $1 and person_id = any($2::uuid[]) and occurred_at >= $3 and occurred_at < $4 order by occurred_at, id`, [viewer.organizationId, ids, bounds.start, until])).rows
  const attendances = (await db.query<{ anjo_person_id: string; started_at: Date; first_anjo_message_at: Date | null; status: string; stars: number | null }>(`select a.anjo_person_id, a.started_at, a.first_anjo_message_at, a.status, e.stars from human_support_attendances a left join human_support_evaluations e on e.attendance_id = a.id and e.superseded_at is null where a.organization_id = $1 and a.anjo_person_id = any($2::uuid[]) and a.started_at >= $3 and a.started_at < $4`, [viewer.organizationId, ids, bounds.start, bounds.end])).rows
  const names = await loadPersonPresentations(db, viewer.organizationId, ids)
  const items: AnjoActivity[] = []
  for (const personId of ids) {
    const initial = await presenceStateAt(db, viewer.organizationId, personId, bounds.start.toISOString())
    const own: PresenceEvent[] = events.filter((event) => event.person_id === personId).map((event) => ({ occurredAt: event.occurred_at, toStatus: event.to_status, pauseReason: event.pause_reason, cause: event.cause }))
    const hours = presenceHours(initial, own, bounds.start, until)
    const mine = attendances.filter((row) => row.anjo_person_id === personId)
    const responses = mine.flatMap((row) => (row.first_anjo_message_at ? [(row.first_anjo_message_at.getTime() - row.started_at.getTime()) / 1000] : [])).sort((a, b) => a - b)
    const stars = mine.flatMap((row) => (row.stars === null ? [] : [Number(row.stars)]))
    items.push({
      personId,
      name: names.get(personId)?.displayName ?? "Anjo",
      hoursAvailable: hours.available,
      hoursPaused: hours.paused,
      hoursDisconnected: hours.disconnected,
      attendances: mine.length,
      firstResponse: { p50Seconds: nearestRank(responses, 50), p90Seconds: nearestRank(responses, 90), withoutResponse: mine.filter((row) => row.status === "ENDED" && !row.first_anjo_message_at).length },
      averageStars: stars.length >= MIN_SAMPLE ? Math.round((stars.reduce((sum, value) => sum + value, 0) / stars.length) * 100) / 100 : null,
    })
  }
  await logAccess(db, viewer, ids, "HUMAN_SUPPORT_PRESENCE", null)
  return { items: items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) }
}

/** Linha do tempo da presença de um Anjo no período (fora do alcance = 404). */
export async function presenceTimeline(db: Queryable, viewer: Viewer, personId: string, query: { from: string; to: string }): Promise<PresenceTimeline> {
  assertPanelPeriod(query)
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const scopes = (await assignmentScopesOf(db, viewer.organizationId, "human_support.attend", [personId])).get(personId) ?? []
  if (scopes.length === 0 || !reachesAnjo(coverage, scopes)) throw notFound()
  const bounds = periodBounds("$1", "$3", "$4")
  const rows = (await db.query<{ occurred_at: Date; from_status: PresenceStatus | null; to_status: PresenceStatus; pause_reason: PauseReason | null; cause: string }>(`select occurred_at, from_status, to_status, pause_reason, cause from human_support_presence_events where organization_id = $1 and person_id = $2 and occurred_at >= ${bounds.start} and occurred_at < ${bounds.end} order by occurred_at, id limit 2000`, [viewer.organizationId, personId, query.from, query.to])).rows
  await logAccess(db, viewer, [personId], "HUMAN_SUPPORT_PRESENCE", null)
  return { events: rows.map((row) => ({ occurredAt: row.occurred_at.toISOString(), fromStatus: row.from_status, toStatus: row.to_status, pauseReason: row.pause_reason, cause: row.cause })) }
}
