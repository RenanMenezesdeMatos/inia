import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { attendanceIndicators, operationIndicators, type AttendanceIndicators, type AttendanceRecord, type OperationIndicators } from "../domain/attendance-indicators.js"
import { CONNECTION_EVENT_CAUSES, PRESENCE_STATUS_CAUSES, type AttendanceEndCause, type ClassificationReason, type LostCause, type PauseReason, type Pertinence, type PresenceStatus, type RequestEndCause, type RequestStatus } from "../domain/catalogs.js"
import { journeyByDay, journeySummary, onlineBase, sumDurations, type ConnectionMark, type JourneyDay, type JourneyDayResult, type StatusMark } from "../domain/journey.js"
import { reachableAnjos } from "./coordination-service.js"
import { assertPanelPeriod, coordinatorScopesOf, coverageClause, periodBounds } from "./coverage.js"
import type { Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"
import { humanSupportStats } from "./runtime-stats.js"

/**
 * HISTÓRICO DA OPERAÇÃO DO ANJO (migration 191; pedido do responsável em 2026-11-11): jornada (`domain/journey.ts`) e indicadores de
 * atendimento (`domain/attendance-indicators.ts`) por Anjo, no fuso da organização, por dia e no período.
 *  - COORDENAÇÃO (`human_support.coordinate`): os Anjos que quem lê alcança (D11; o Administrador geral, todos), filtráveis por
 *    Grupo/Subgrupo e por Anjo, mais o consolidado e os números da operação (pedidos do alcance). Grava o registro LGPD de quem viu.
 *  - O PRÓPRIO ANJO (`human_support.attend`): só o próprio histórico, sem o consolidado.
 * Cobertura: a base (eventos de presença, atendimentos, pedidos) existe desde a migration 182; a sessão encerrada, a causa da
 * interrupção, o "sem Anjo logado" e a pertinência, desde a 191 — as datas em que cada uma foi aplicada neste banco vão na resposta.
 * Indisponível e offline são o mesmo estado (fora do tempo online).
 */
export type HistoryQuery = { from: string; to: string; teamId?: string | undefined; subteamId?: string | undefined; anjoPersonId?: string | undefined }

type JourneyView = { days: (JourneyDayResult & { baseMs: number })[]; summary: ReturnType<typeof journeySummary> }
/** Cargos da linha de chefia usados nos filtros da tabela "Por Anjo". */
export const LEADER_ROLES = ["SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER"] as const
export type LeaderRole = (typeof LEADER_ROLES)[number]
type Ref = { id: string; name: string } | null
/**
 * Onde o Anjo está na estrutura ATUAL (cadastro): Grupo, Subgrupo e o líder mais próximo de cada cargo subindo por `reports_to_id`
 * (a própria pessoa, se ela tem o cargo) — a mesma regra do ranking de uso de IA (`ai-usage-ranking.ts`). Só para os filtros.
 */
export type AnjoStructure = { team: Ref; subteam: Ref; leaders: Record<LeaderRole, Ref> }
export type AnjoHistory = { personId: string; name: string; avatarUrl: string | null; structure: AnjoStructure | null; journey: JourneyView; attendance: AttendanceIndicators }
export type OperationHistory = {
  period: { from: string; to: string }
  serverTime: string
  coverage: { baseSince: string | null; connectionSince: string | null }
  days: string[]
  anjos: AnjoHistory[]
  consolidated: { journey: ReturnType<typeof journeySummary>; attendance: AttendanceIndicators; operation: OperationIndicators } | null
}

const notFound = () => new DomainError("Registro não encontrado.", "HUMAN_SUPPORT_NOT_FOUND", 404)

export async function operationHistory(db: Queryable, viewer: Viewer, query: HistoryQuery, mode: "COORDINATION" | "SELF"): Promise<OperationHistory> {
  assertPanelPeriod(query)
  let ids: string[]
  if (mode === "SELF") ids = [viewer.personId]
  else {
    const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
    ids = (await reachableAnjos(db, viewer, coverage, { teamId: query.teamId, subteamId: query.subteamId })).map(([personId]) => personId)
    if (query.anjoPersonId) {
      if (!ids.includes(query.anjoPersonId)) throw notFound()
      ids = [query.anjoPersonId]
    }
  }

  const [dayRows, coverageRows] = await Promise.all([
    db.query<{ day: string; start: Date; end: Date; now: Date }>(
      `select to_char(g::date, 'YYYY-MM-DD') "day", (g::date)::timestamp at time zone analytics_org_timezone($1) start,
              (g::date + 1)::timestamp at time zone analytics_org_timezone($1) "end", statement_timestamp() now
         from generate_series($2::date, $3::date, interval '1 day') g order by g`,
      [viewer.organizationId, query.from, query.to],
    ),
    db.query<{ name: string; applied_at: Date }>(`select name, applied_at from schema_migrations where name in ('182_human_support.sql', '191_human_support_operation_history.sql')`),
  ])
  const now = dayRows.rows[0]?.now.getTime() ?? Date.now()
  const days: JourneyDay[] = dayRows.rows.flatMap((row) => (row.start.getTime() >= now ? [] : [{ day: row.day, start: row.start.getTime(), end: Math.min(row.end.getTime(), now) }]))
  const appliedAt = (name: string) => coverageRows.rows.find((row) => row.name === name)?.applied_at ?? null
  const connectionSince = appliedAt("191_human_support_operation_history.sql")
  const rangeStart = new Date(dayRows.rows[0]?.start ?? new Date(now))
  const rangeEnd = new Date(Math.min(dayRows.rows.at(-1)?.end.getTime() ?? now, now))

  const [names, journeys, records, structures] = await Promise.all([
    loadPersonPresentations(db, viewer.organizationId, ids),
    loadJourneys(db, viewer.organizationId, ids, days, rangeStart, rangeEnd),
    loadAttendanceRecords(db, viewer.organizationId, ids, query),
    mode === "COORDINATION" ? loadStructures(db, viewer.organizationId, ids) : Promise.resolve(new Map<string, AnjoStructure>()),
  ])
  const anjos: AnjoHistory[] = ids.map((personId) => {
    const own = journeys.get(personId) ?? []
    return {
      personId,
      name: names.get(personId)?.displayName ?? "Anjo",
      avatarUrl: names.get(personId)?.avatarUrl ?? null,
      structure: structures.get(personId) ?? null,
      journey: { days: own.map((day) => ({ ...day, baseMs: onlineBase(day) })), summary: journeySummary(own) },
      attendance: attendanceIndicators(records.filter((record) => record.anjoPersonId === personId)),
    }
  })
  anjos.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))

  let consolidated: OperationHistory["consolidated"] = null
  if (mode === "COORDINATION") {
    // Consolidado por dia somando os Anjos (a média diária conta os dias em que ALGUM Anjo esteve online).
    const byDay = days.map((day) => ({ day: day.day, ...sumDurations(anjos.flatMap((anjo) => anjo.journey.days.filter((item) => item.day === day.day))) }))
    consolidated = { journey: journeySummary(byDay), attendance: attendanceIndicators(records), operation: operationIndicators(await loadRequestRecords(db, viewer, query)) }
    for (const personId of ids) {
      const ok = await recordPersonalDataAccess(db, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, subjectPersonId: personId, dataKind: "HUMAN_SUPPORT_PRESENCE", resourceId: null })
      if (!ok) humanSupportStats.personalDataLogFailures += 1
    }
  }
  return {
    period: { from: query.from, to: query.to },
    serverTime: new Date(now).toISOString(),
    coverage: { baseSince: appliedAt("182_human_support.sql")?.toISOString() ?? null, connectionSince: connectionSince?.toISOString() ?? null },
    days: days.map((day) => day.day),
    anjos,
    consolidated,
  }
}

/** Estado no início do período (último evento antes dele) e os eventos dentro dele; atendimentos que tocam o período. */
async function loadJourneys(db: Queryable, organizationId: string, ids: string[], days: JourneyDay[], start: Date, end: Date): Promise<Map<string, JourneyDayResult[]>> {
  const result = new Map<string, JourneyDayResult[]>()
  if (ids.length === 0 || days.length === 0) return result
  type EventRow = { person_id: string; occurred_at: Date; to_status: PresenceStatus; pause_reason: PauseReason | null; cause: string }
  const [initialStatus, initialConnection, events, spans] = await Promise.all([
    db.query<EventRow>(
      `select distinct on (person_id) person_id, occurred_at, to_status, pause_reason, cause from human_support_presence_events
        where organization_id = $1 and person_id = any($2::uuid[]) and cause = any($4::text[]) and occurred_at < $3 order by person_id, occurred_at desc, id desc`,
      [organizationId, ids, start, PRESENCE_STATUS_CAUSES],
    ),
    db.query<EventRow>(
      `select distinct on (person_id) person_id, occurred_at, to_status, pause_reason, cause from human_support_presence_events
        where organization_id = $1 and person_id = any($2::uuid[]) and cause = any($4::text[]) and occurred_at < $3 order by person_id, occurred_at desc, id desc`,
      [organizationId, ids, start, [...CONNECTION_EVENT_CAUSES, "ANJO"]],
    ),
    db.query<EventRow>(
      `select person_id, occurred_at, to_status, pause_reason, cause from human_support_presence_events
        where organization_id = $1 and person_id = any($2::uuid[]) and occurred_at >= $3 and occurred_at < $4 order by occurred_at, id`,
      [organizationId, ids, start, end],
    ),
    db.query<{ anjo_person_id: string; started_at: Date; ended_at: Date | null }>(
      `select anjo_person_id, started_at, ended_at from human_support_attendances
        where organization_id = $1 and anjo_person_id = any($2::uuid[]) and started_at < $4 and (ended_at is null or ended_at > $3)`,
      [organizationId, ids, start, end],
    ),
  ])
  const statusOf = (row: EventRow): StatusMark => ({ at: row.occurred_at.getTime(), status: row.to_status, pauseReason: row.pause_reason })
  const connectionOf = (row: EventRow): ConnectionMark => ({ at: row.occurred_at.getTime(), connected: row.cause === "CONNECTION_RESTORED" || row.cause === "ANJO" })
  for (const personId of ids) {
    const own = events.rows.filter((row) => row.person_id === personId)
    const initial = initialStatus.rows.find((row) => row.person_id === personId)
    const initialConnected = initialConnection.rows.find((row) => row.person_id === personId)
    result.set(
      personId,
      journeyByDay({
        days,
        initialStatus: initial ? { status: initial.to_status, pauseReason: initial.pause_reason } : { status: "OFFLINE", pauseReason: null },
        statusMarks: own.filter((row) => (PRESENCE_STATUS_CAUSES as readonly string[]).includes(row.cause)).map(statusOf),
        initialConnected: initialConnected ? connectionOf(initialConnected).connected : false,
        // Mudar o estado pela área (causa ANJO) só acontece com a área aberta: também conta como sinal de conexão.
        connectionMarks: own.filter((row) => (CONNECTION_EVENT_CAUSES as readonly string[]).includes(row.cause) || row.cause === "ANJO").map(connectionOf),
        attendances: spans.rows.filter((row) => row.anjo_person_id === personId).map((row) => ({ start: row.started_at.getTime(), end: row.ended_at?.getTime() ?? null })),
      }),
    )
  }
  return result
}

/** Atendimentos ACOLHIDOS no período (início no período), com a classificação, o autor da última mensagem humana e se foi o primeiro do pedido. */
async function loadAttendanceRecords(db: Queryable, organizationId: string, ids: string[], query: HistoryQuery): Promise<AttendanceRecord[]> {
  if (ids.length === 0) return []
  const bounds = periodBounds("$1", "$3", "$4")
  const rows = (
    await db.query<{ id: string; anjo_person_id: string; request_id: string; started_at: Date; ended_at: Date | null; end_cause: AttendanceEndCause | null; lost_cause: LostCause | null; first_anjo_message_at: Date | null; reason: ClassificationReason | null; pertinence: Pertinence | null; first_of_request: boolean; request_created_at: Date; last_author: "ANJO" | "OPERATOR" | null; stars: number | null }>(
      `select a.id, a.anjo_person_id, a.request_id, a.started_at, a.ended_at, a.end_cause, a.lost_cause, a.first_anjo_message_at, c.reason, c.pertinence, r.created_at request_created_at,
              not exists (select 1 from human_support_attendances p where p.request_id = a.request_id and (p.started_at, p.id) < (a.started_at, a.id)) first_of_request,
              (select m.author_kind from human_support_messages m where m.request_id = a.request_id and m.attendance_id = a.id and m.author_kind in ('ANJO', 'OPERATOR') order by m.seq desc limit 1) last_author,
              (select e.stars from human_support_evaluations e where e.attendance_id = a.id and e.superseded_at is null order by e.id desc limit 1) stars
         from human_support_attendances a
         join human_support_requests r on r.id = a.request_id
         left join human_support_classifications c on c.attendance_id = a.id
        where a.organization_id = $1 and a.anjo_person_id = any($2::uuid[]) and a.started_at >= ${bounds.start} and a.started_at < ${bounds.end}`,
      [organizationId, ids, query.from, query.to],
    )
  ).rows
  return rows.map((row) => ({
    anjoPersonId: row.anjo_person_id,
    requestId: row.request_id,
    startedAt: row.started_at.getTime(),
    endedAt: row.ended_at?.getTime() ?? null,
    endCause: row.end_cause,
    lostCause: row.lost_cause,
    firstAnjoMessageAt: row.first_anjo_message_at?.getTime() ?? null,
    lastHumanAuthor: row.last_author,
    classification: row.reason ? { reason: row.reason, pertinence: row.pertinence } : null,
    firstOfRequest: row.first_of_request,
    stars: row.stars === null ? null : Number(row.stars),
    requestCreatedAt: row.request_created_at.getTime(),
  }))
}

/** Pedidos criados no período, no alcance de quem lê e no filtro de Grupo/Subgrupo (números da operação, sem atribuição individual). */
async function loadRequestRecords(db: Queryable, viewer: Viewer, query: HistoryQuery) {
  const coverage = await coordinatorScopesOf(db, viewer.organizationId, viewer.personId)
  const params: unknown[] = [viewer.organizationId, query.from, query.to]
  const bounds = periodBounds("$1", "$2", "$3")
  const where = coverageClause(coverage, "r", params, { teamId: query.teamId, subteamId: query.subteamId }, "operator_person_id")
  const rows = (
    await db.query<{ status: RequestStatus; end_cause: RequestEndCause | null; had_attendance: boolean; anjos_in_service_at_end: number | null }>(
      `select r.status, r.end_cause, r.anjos_in_service_at_end, exists (select 1 from human_support_attendances a where a.request_id = r.id) had_attendance
         from human_support_requests r where r.organization_id = $1 and r.created_at >= ${bounds.start} and r.created_at < ${bounds.end} and ${where}`,
      params,
    )
  ).rows
  return rows.map((row) => ({ status: row.status, endCause: row.end_cause, hadAttendance: row.had_attendance, anjosInServiceAtEnd: row.anjos_in_service_at_end === null ? null : Number(row.anjos_in_service_at_end) }))
}

/** Grupo, Subgrupo e a linha de chefia atual de cada Anjo (até 12 níveis acima; ciclo no cadastro não trava a consulta). */
async function loadStructures(db: Queryable, organizationId: string, ids: string[]): Promise<Map<string, AnjoStructure>> {
  const result = new Map<string, AnjoStructure>()
  if (ids.length === 0) return result
  const [places, leaders] = await Promise.all([
    db.query<{ id: string; team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null }>(
      `select p.id, p.team_id, t.name team_name, p.subteam_id, st.name subteam_name
         from people p left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id
        where p.organization_id = $1 and p.id = any($2::uuid[])`,
      [organizationId, ids],
    ),
    db.query<{ anjo_id: string; role: LeaderRole; person_id: string }>(
      `with recursive line as (
         select p.id anjo_id, p.id person_id, p.role, p.reports_to_id, 0 depth from people p where p.organization_id = $1 and p.id = any($2::uuid[])
         union all
         select l.anjo_id, q.id, q.role, q.reports_to_id, l.depth + 1 from line l join people q on q.id = l.reports_to_id and q.organization_id = $1 where l.depth < 12
       )
       select distinct on (anjo_id, role) anjo_id, role, person_id from line where role = any($3::text[]) order by anjo_id, role, depth`,
      [organizationId, ids, LEADER_ROLES],
    ),
  ])
  const names = await loadPersonPresentations(db, organizationId, leaders.rows.map((row) => row.person_id))
  for (const row of places.rows) {
    const own = leaders.rows.filter((leader) => leader.anjo_id === row.id)
    const leaderOf = (role: LeaderRole): Ref => {
      const found = own.find((leader) => leader.role === role)
      return found ? { id: found.person_id, name: names.get(found.person_id)?.displayName ?? "—" } : null
    }
    result.set(row.id, {
      team: row.team_id ? { id: row.team_id, name: row.team_name ?? "Grupo" } : null,
      subteam: row.subteam_id ? { id: row.subteam_id, name: row.subteam_name ?? "Subgrupo" } : null,
      leaders: { SUPERVISOR: leaderOf("SUPERVISOR"), COORDINATOR: leaderOf("COORDINATOR"), MANAGER: leaderOf("MANAGER"), SENIOR_MANAGER: leaderOf("SENIOR_MANAGER") },
    })
  }
  return result
}

