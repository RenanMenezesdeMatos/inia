import { personIdsWithPermissionCovering } from "../../access/application/permission-holders.js"
import type { AccessScope } from "../../access/domain/access-scope.js"
import { availabilityOf } from "../domain/availability.js"
import { HUMAN_SUPPORT_LIMITS, type PauseReason, type PresenceStatus } from "../domain/catalogs.js"
import { effectiveGroup, effectiveSubgroup, supportEnabledFor, type ScopeState } from "../domain/enablement.js"
import { canReceiveAssignment, effectiveCapacity, inService, type AnjoSituation } from "../domain/presence.js"
import { estimateWait, queueDeadline, referencePopulation, type QueueDeadline, type QueueSample } from "../domain/queue-history.js"
import type { Availability } from "../domain/views.js"
import type { Queryable } from "./locks.js"

/**
 * LUGAR DA PESSOA, LIGA/DESLIGA, ANJOS EM SERVIÇO E DISPONIBILIDADE (design_draft.md seções 5, 6 e 9). Lê só `people`, `teams`,
 * `subteams` (estrutura atual) e as tabelas do próprio módulo; quem tem o papel vem de `access/application/permission-holders.ts`.
 * Prazos e conexão sempre contra o relógio do banco (`statement_timestamp()`).
 */
export type PersonPlace = { personId: string; active: boolean; teamId: string | null; subteamId: string | null; teamName: string | null; subteamName: string | null }

/** Grupo e Subgrupo ATUAIS de cada pessoa (quem está num Subgrupo pertence ao Grupo dele). */
export async function loadPlaces(db: Queryable, organizationId: string, personIds: readonly string[]): Promise<Map<string, PersonPlace>> {
  const ids = [...new Set(personIds)]
  if (ids.length === 0) return new Map()
  const result = await db.query<{ id: string; active: boolean; team_id: string | null; subteam_id: string | null; team_name: string | null; subteam_name: string | null }>(
    `select p.id, p.active, coalesce(p.team_id, st.team_id) team_id, p.subteam_id, t.name team_name, st.name subteam_name
       from people p
       left join subteams st on st.id = p.subteam_id
       left join teams t on t.id = coalesce(p.team_id, st.team_id)
      where p.organization_id = $1 and p.id = any($2::uuid[])`,
    [organizationId, ids],
  )
  return new Map(result.rows.map((row) => [row.id, { personId: row.id, active: row.active, teamId: row.team_id, subteamId: row.subteam_id, teamName: row.team_name, subteamName: row.subteam_name }]))
}

export async function loadPlace(db: Queryable, organizationId: string, personId: string): Promise<PersonPlace | null> {
  return (await loadPlaces(db, organizationId, [personId])).get(personId) ?? null
}

export type SupportSettings = { enabled: boolean; defaultCapacity: number; version: number }

export async function loadSettings(db: Queryable, organizationId: string): Promise<SupportSettings> {
  const row = (await db.query<{ enabled: boolean; default_capacity: number; version: number }>(`select enabled, default_capacity, version from human_support_settings where organization_id = $1`, [organizationId])).rows[0]
  return row ? { enabled: row.enabled, defaultCapacity: Number(row.default_capacity), version: Number(row.version) } : { enabled: false, defaultCapacity: HUMAN_SUPPORT_LIMITS.defaultCapacity, version: 0 }
}

export type ScopeStates = { groups: Map<string, ScopeState>; subgroups: Map<string, ScopeState> }

export async function loadScopeStates(db: Queryable, organizationId: string): Promise<ScopeStates> {
  const result = await db.query<{ scope_type: "GROUP" | "SUBGROUP"; team_id: string | null; subteam_id: string | null; state: ScopeState }>(
    `select scope_type, team_id, subteam_id, state from human_support_scope_settings where organization_id = $1`,
    [organizationId],
  )
  const states: ScopeStates = { groups: new Map(), subgroups: new Map() }
  for (const row of result.rows) {
    if (row.scope_type === "GROUP" && row.team_id) states.groups.set(row.team_id, row.state)
    if (row.scope_type === "SUBGROUP" && row.subteam_id) states.subgroups.set(row.subteam_id, row.state)
  }
  return states
}

export const enabledWith = (settings: Pick<SupportSettings, "enabled">, states: ScopeStates, place: { teamId: string | null; subteamId: string | null }) =>
  supportEnabledFor({
    master: settings.enabled,
    groupState: place.teamId ? (states.groups.get(place.teamId) ?? null) : null,
    subgroupState: place.subteamId ? (states.subgroups.get(place.subteamId) ?? null) : null,
    hasGroup: Boolean(place.teamId),
    hasSubgroup: Boolean(place.subteamId),
  })

/** O apoio vale para este lugar (Grupo/Subgrupo) agora? */
export async function enabledForPlace(db: Queryable, organizationId: string, place: { teamId: string | null; subteamId: string | null }): Promise<boolean> {
  const [settings, states] = await Promise.all([loadSettings(db, organizationId), loadScopeStates(db, organizationId)])
  return enabledWith(settings, states, place)
}

export type AnjoCandidate = AnjoSituation & { personId: string; pauseReason: PauseReason | null; lastAssignedAt: Date | null }

/**
 * Os Anjos cujo papel cobre o lugar (organização, o Grupo ou o Subgrupo), com a presença de agora. Sem linha de presença =
 * Indisponível e sem conexão. `excludePersonId` = o operador (nunca atende a si mesmo).
 */
export async function anjosCovering(db: Queryable, organizationId: string, place: { teamId: string | null; subteamId: string | null }, excludePersonId: string | null, defaultCapacity: number): Promise<AnjoCandidate[]> {
  const ids = (await personIdsWithPermissionCovering(db, organizationId, "human_support.attend", place)).filter((id) => id !== excludePersonId)
  if (ids.length === 0) return []
  const result = await db.query<{ person_id: string; status: PresenceStatus | null; pause_reason: PauseReason | null; max_concurrent: number | null; connected: boolean | null; last_assigned_at: Date | null; active_count: number; scheduled: boolean | null }>(
    `select ids.person_id, p.status, p.pause_reason, p.max_concurrent, p.lease_until > statement_timestamp() connected, p.last_assigned_at, p.scheduled_status is not null scheduled,
            (select count(*)::int from human_support_attendances a where a.organization_id = $1 and a.anjo_person_id = ids.person_id and a.status = 'ACTIVE') active_count
       from unnest($2::uuid[]) as ids(person_id)
       left join human_support_agent_presence p on p.organization_id = $1 and p.person_id = ids.person_id`,
    [organizationId, ids],
  )
  return result.rows.map((row) => ({
    personId: row.person_id,
    coversScope: true,
    active: true,
    status: row.status ?? "OFFLINE",
    pauseReason: row.pause_reason,
    connected: row.connected === true,
    activeAttendances: row.active_count,
    capacity: effectiveCapacity(row.max_concurrent === null ? null : Number(row.max_concurrent), defaultCapacity),
    isOperator: false,
    scheduledChange: row.scheduled === true,
    lastAssignedAt: row.last_assigned_at,
  }))
}

/** Pedidos dos últimos 14 dias da organização que entram na população de referência da fila (seção 9). */
export async function loadQueueSamples(db: Queryable, organizationId: string): Promise<QueueSample[]> {
  const result = await db.query<{ team_id: string | null; subteam_id: string | null; assigned: boolean; wait_seconds: number }>(
    `select r.team_id, r.subteam_id, fa.first_assigned_at is not null assigned,
            extract(epoch from coalesce(fa.first_assigned_at, r.ended_at) - r.created_at)::float8 wait_seconds
       from human_support_requests r
       left join lateral (select min(e.occurred_at) first_assigned_at from human_support_request_events e where e.request_id = r.id and e.cause = 'ASSIGNED') fa on true
      where r.organization_id = $1 and r.created_at > statement_timestamp() - make_interval(days => $2::int)
        and not (r.status = 'CANCELLED' and r.end_cause = 'SCOPE_DISABLED')
        and (fa.first_assigned_at is not null or r.ended_at is not null)`,
    [organizationId, HUMAN_SUPPORT_LIMITS.queueHistoryDays],
  )
  return result.rows.map((row) => ({ teamId: row.team_id, subteamId: row.subteam_id, assigned: row.assigned, waitSeconds: Math.max(0, Number(row.wait_seconds)) }))
}

export async function queueDeadlineFor(db: Queryable, organizationId: string, place: { teamId: string | null; subteamId: string | null }): Promise<QueueDeadline> {
  return queueDeadline(referencePopulation(await loadQueueSamples(db, organizationId), place))
}

/**
 * Disponibilidade para o operador (seção 9): status pela primeira regra que valer, a espera estimada (só quando o pedido iria para a
 * fila) e o horário que o pedido teria como prazo se fosse criado agora. Nunca diz quantos Anjos estão em pausa, nem por quê.
 */
export async function availabilityFor(db: Queryable, organizationId: string, place: { teamId: string | null; subteamId: string | null }, operatorPersonId: string): Promise<Availability> {
  const settings = await loadSettings(db, organizationId)
  const enabled = await enabledForPlace(db, organizationId, place)
  if (!enabled) return { status: "DISABLED", estimate: null, queueDeadline: null }
  const anjos = await anjosCovering(db, organizationId, place, operatorPersonId, settings.defaultCapacity)
  const serving = anjos.filter(inService)
  const status = availabilityOf({ enabled, inService: serving.length, canReceiveNow: serving.filter(canReceiveAssignment).length, availableInService: serving.filter((anjo) => anjo.status === "AVAILABLE" && !anjo.scheduledChange).length })
  if (status === "NONE_IN_SERVICE") return { status, estimate: null, queueDeadline: null }
  const population = referencePopulation(await loadQueueSamples(db, organizationId), place)
  const deadline = queueDeadline(population)
  const at = (await db.query<{ deadline_at: Date }>("select statement_timestamp() + make_interval(mins => $1::int) as deadline_at", [deadline.minutes])).rows[0]!.deadline_at
  return { status, estimate: status === "AVAILABLE_NOW" ? null : estimateWait(population), queueDeadline: at.toISOString() }
}

/** O papel do Anjo cobre algum escopo LIGADO agora (exigido para "Ficar disponível")? */
export async function anyEnabledScope(db: Queryable, organizationId: string, scopes: readonly AccessScope[]): Promise<boolean> {
  if (scopes.length === 0) return false
  const [settings, states] = await Promise.all([loadSettings(db, organizationId), loadScopeStates(db, organizationId)])
  if (!settings.enabled) return false
  const subteams = (await db.query<{ id: string; team_id: string }>(`select st.id, st.team_id from subteams st join teams t on t.id = st.team_id where t.organization_id = $1`, [organizationId])).rows
  const teams = (await db.query<{ id: string }>(`select id from teams where organization_id = $1`, [organizationId])).rows.map((row) => row.id)
  const groupOn = (teamId: string) => effectiveGroup({ master: true, own: states.groups.get(teamId) ?? null }).effective
  const subgroupOn = (subteam: { id: string; team_id: string }) => effectiveSubgroup({ master: true, own: states.subgroups.get(subteam.id) ?? null, group: states.groups.get(subteam.team_id) ?? null }).effective
  return scopes.some((scope) => {
    if (scope.type === "ORGANIZATION") return teams.some(groupOn) || subteams.some(subgroupOn)
    if (scope.type === "GROUP") return groupOn(scope.teamId) || subteams.filter((subteam) => subteam.team_id === scope.teamId).some(subgroupOn)
    if (scope.type === "SUBGROUP") return subteams.filter((subteam) => subteam.id === scope.subteamId).some(subgroupOn)
    return false
  })
}
