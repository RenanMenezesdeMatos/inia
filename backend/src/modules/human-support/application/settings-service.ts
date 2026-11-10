import { assignmentScopesOf, personIdsWithPermission } from "../../access/application/permission-holders.js"
import type { AccessScope } from "../../access/domain/access-scope.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { TransactionSource } from "../../../shared/infrastructure/database/transaction.js"
import { loadPersonPresentations } from "../../profile-preferences/application/person-presentation-loader.js"
import { HUMAN_SUPPORT_LIMITS, type PresenceStatus } from "../domain/catalogs.js"
import { effectiveGroup, effectiveSubgroup, type ScopeState } from "../domain/enablement.js"
import { canReceiveAssignment, effectiveCapacity, notEligibleReason } from "../domain/presence.js"
import type { AnjoRow, AnjoScopeView, ScopeNode, SettingsView } from "../domain/views.js"
import { recordHumanSupportAudit } from "./audit.js"
import { dispatchAfterCommand } from "./dispatch.js"
import { enabledWith, loadScopeStates, loadSettings } from "./eligibility.js"
import { bumpInboxVersions } from "./inbox-versions.js"
import { withOrganizationLock, type Queryable } from "./locks.js"
import type { Viewer } from "./request-service.js"
import { endRequest } from "./transitions.js"

/**
 * CONFIGURAÇÃO do Apoio com Anjo pelo Administrador geral (`human_support.manage`, só organização; design_draft.md seções 5 e 14):
 * chave geral e capacidade padrão (versão otimista), estado de cada Grupo/Subgrupo (`INHERIT | ON | OFF`, nunca apagado) e a
 * capacidade de cada Anjo. Desligar cancela, NO MESMO COMANDO, os pedidos da fila cujo escopo ficou desligado; atendimentos em
 * andamento continuam. Tudo com histórico em `human_support_setting_events` e auditoria.
 */
type TeamRow = { id: string; name: string }
type SubteamRow = { id: string; name: string; team_id: string }

async function structureOf(db: Queryable, organizationId: string) {
  const [teams, subteams] = await Promise.all([
    db.query<TeamRow>(`select id, name from teams where organization_id = $1 order by name`, [organizationId]),
    db.query<SubteamRow>(`select st.id, st.name, st.team_id from subteams st join teams t on t.id = st.team_id where t.organization_id = $1 order by st.name`, [organizationId]),
  ])
  return { teams: teams.rows, subteams: subteams.rows }
}

/** Pedidos da fila cujo escopo congelado ficou desligado → Cancelados (SCOPE_DISABLED), na transação do comando. */
async function cancelDisabledWaiting(client: Queryable, organizationId: string): Promise<number> {
  const [settings, states] = await Promise.all([loadSettings(client, organizationId), loadScopeStates(client, organizationId)])
  const waiting = (await client.query<{ id: string; operator_person_id: string; team_id: string | null; subteam_id: string | null }>(`select id, operator_person_id, team_id, subteam_id from human_support_requests where organization_id = $1 and status = 'WAITING' order by queued_at for update`, [organizationId])).rows
  const touched: string[] = []
  for (const request of waiting) {
    if (enabledWith(settings, states, { teamId: request.team_id, subteamId: request.subteam_id })) continue
    await endRequest(client, { id: request.id, organizationId, operatorPersonId: request.operator_person_id }, { from: "WAITING", cause: "SCOPE_DISABLED", actorPersonId: null })
    touched.push(request.operator_person_id)
  }
  await bumpInboxVersions(client, organizationId, touched)
  return touched.length
}

const settingsView = (settings: { enabled: boolean; defaultCapacity: number; version: number }): SettingsView => ({ enabled: settings.enabled, defaultCapacity: settings.defaultCapacity, version: settings.version })

export async function getSettings(db: Queryable, organizationId: string): Promise<SettingsView> {
  return settingsView(await loadSettings(db, organizationId))
}

export async function updateSettings(db: TransactionSource & Queryable, viewer: Viewer, input: SettingsView): Promise<SettingsView> {
  const result = await withOrganizationLock(db, viewer.organizationId, async (client) => {
    await client.query(`insert into human_support_settings (organization_id) values ($1) on conflict (organization_id) do nothing`, [viewer.organizationId])
    const current = (await client.query<{ enabled: boolean; default_capacity: number; version: number }>(`select enabled, default_capacity, version from human_support_settings where organization_id = $1 for update`, [viewer.organizationId])).rows[0]!
    if (Number(current.version) !== input.version) throw new DomainError("A configuração mudou enquanto você editava. Recarregue e tente de novo.", "HUMAN_SUPPORT_CONCURRENT_CHANGE", 409, { current: settingsView({ enabled: current.enabled, defaultCapacity: Number(current.default_capacity), version: Number(current.version) }) })
    const updated = (
      await client.query<{ enabled: boolean; default_capacity: number; version: number }>(
        `update human_support_settings set enabled = $2, default_capacity = $3, version = version + 1, updated_by_person_id = $4, updated_at = statement_timestamp() where organization_id = $1 returning enabled, default_capacity, version`,
        [viewer.organizationId, input.enabled, input.defaultCapacity, viewer.personId],
      )
    ).rows[0]!
    const changes: { field: "ENABLED" | "DEFAULT_CAPACITY"; from: string; to: string }[] = []
    if (current.enabled !== input.enabled) changes.push({ field: "ENABLED", from: String(current.enabled), to: String(input.enabled) })
    if (Number(current.default_capacity) !== input.defaultCapacity) changes.push({ field: "DEFAULT_CAPACITY", from: String(current.default_capacity), to: String(input.defaultCapacity) })
    for (const change of changes) {
      await client.query(`insert into human_support_setting_events (organization_id, target_type, field, from_value, to_value, actor_person_id, occurred_at) values ($1, 'ORGANIZATION', $2, $3, $4, $5, statement_timestamp())`, [viewer.organizationId, change.field, change.from, change.to, viewer.personId])
    }
    if (changes.length > 0) await recordHumanSupportAudit(client, { organizationId: viewer.organizationId, actorPersonId: viewer.personId, action: "HUMAN_SUPPORT_SETTINGS_CHANGED", entityType: "organization", entityId: viewer.organizationId, payload: { changes } })
    await cancelDisabledWaiting(client, viewer.organizationId)
    return settingsView({ enabled: updated.enabled, defaultCapacity: Number(updated.default_capacity), version: Number(updated.version) })
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  return result
}

/** Todos os Anjos (papel em algum escopo), com os escopos de cada um. */
async function anjoScopes(db: Queryable, organizationId: string): Promise<Map<string, AccessScope[]>> {
  return assignmentScopesOf(db, organizationId, "human_support.attend", await personIdsWithPermission(db, organizationId, "human_support.attend"))
}

const coversGroup = (scope: AccessScope, teamId: string) => scope.type === "ORGANIZATION" || (scope.type === "GROUP" && scope.teamId === teamId)
const coversSubgroup = (scope: AccessScope, subteam: SubteamRow) => coversGroup(scope, subteam.team_id) || (scope.type === "SUBGROUP" && scope.subteamId === subteam.id)

/** Árvore Grupo › Subgrupos com estado gravado, efetivo, de onde ele vem e quantos Anjos atendem cada nó. */
export async function listScopes(db: Queryable, organizationId: string): Promise<ScopeNode[]> {
  const [settings, states, structure, scopes] = await Promise.all([loadSettings(db, organizationId), loadScopeStates(db, organizationId), structureOf(db, organizationId), anjoScopes(db, organizationId)])
  const anjos = [...scopes.values()]
  return structure.teams.map((team) => {
    const groupState = states.groups.get(team.id) ?? null
    const group = effectiveGroup({ master: settings.enabled, own: groupState })
    const groupAnjos = anjos.filter((list) => list.some((scope) => coversGroup(scope, team.id))).length
    const children = structure.subteams
      .filter((subteam) => subteam.team_id === team.id)
      .map((subteam): ScopeNode => {
        const own = states.subgroups.get(subteam.id) ?? null
        const effective = effectiveSubgroup({ master: settings.enabled, own, group: groupState })
        const anjoCount = anjos.filter((list) => list.some((scope) => coversSubgroup(scope, subteam))).length
        return { type: "SUBGROUP", id: subteam.id, name: subteam.name, state: own ?? "INHERIT", effective: effective.effective, effectiveSource: effective.source, anjoCount, warnings: effective.effective && anjoCount === 0 ? ["ENABLED_WITHOUT_ANJO"] : [] }
      })
    return { type: "GROUP", id: team.id, name: team.name, state: groupState ?? "INHERIT", effective: group.effective, effectiveSource: group.source, anjoCount: groupAnjos, warnings: group.effective && groupAnjos === 0 ? ["ENABLED_WITHOUT_ANJO"] : [], children }
  })
}

export async function updateScopeState(db: TransactionSource & Queryable, viewer: Viewer, input: { scopeType: "GROUP" | "SUBGROUP"; id: string; state: ScopeState }): Promise<ScopeNode> {
  const structure = await structureOf(db, viewer.organizationId)
  const subteam = input.scopeType === "SUBGROUP" ? structure.subteams.find((row) => row.id === input.id) : null
  const exists = input.scopeType === "GROUP" ? structure.teams.some((row) => row.id === input.id) : Boolean(subteam)
  if (!exists) throw new DomainError(input.scopeType === "GROUP" ? "Grupo não encontrado." : "Subgrupo não encontrado.", "HUMAN_SUPPORT_SCOPE_NOT_FOUND", 404)
  await withOrganizationLock(db, viewer.organizationId, async (client) => {
    const previous = (
      await client.query<{ state: ScopeState }>(
        input.scopeType === "GROUP"
          ? `select state from human_support_scope_settings where organization_id = $1 and scope_type = 'GROUP' and team_id = $2`
          : `select state from human_support_scope_settings where organization_id = $1 and scope_type = 'SUBGROUP' and subteam_id = $2`,
        [viewer.organizationId, input.id],
      )
    ).rows[0]?.state ?? "INHERIT"
    if (previous === input.state) return
    if (input.scopeType === "GROUP") {
      await client.query(
        `insert into human_support_scope_settings (organization_id, scope_type, team_id, state, updated_by_person_id, updated_at) values ($1, 'GROUP', $2, $3, $4, statement_timestamp())
         on conflict (organization_id, team_id) where scope_type = 'GROUP' do update set state = excluded.state, updated_by_person_id = excluded.updated_by_person_id, updated_at = excluded.updated_at`,
        [viewer.organizationId, input.id, input.state, viewer.personId],
      )
    } else {
      await client.query(
        `insert into human_support_scope_settings (organization_id, scope_type, team_id, subteam_id, state, updated_by_person_id, updated_at) values ($1, 'SUBGROUP', $2, $3, $4, $5, statement_timestamp())
         on conflict (organization_id, subteam_id) where scope_type = 'SUBGROUP' do update set state = excluded.state, updated_by_person_id = excluded.updated_by_person_id, updated_at = excluded.updated_at`,
        [viewer.organizationId, subteam!.team_id, input.id, input.state, viewer.personId],
      )
    }
    await client.query(
      `insert into human_support_setting_events (organization_id, target_type, team_id, subteam_id, field, from_value, to_value, actor_person_id, occurred_at) values ($1, $2, $3, $4, 'STATE', $5, $6, $7, statement_timestamp())`,
      [viewer.organizationId, input.scopeType, input.scopeType === "GROUP" ? input.id : subteam!.team_id, input.scopeType === "SUBGROUP" ? input.id : null, previous, input.state, viewer.personId],
    )
    await recordHumanSupportAudit(client, { organizationId: viewer.organizationId, actorPersonId: viewer.personId, action: "HUMAN_SUPPORT_SCOPE_STATE_CHANGED", entityType: input.scopeType === "GROUP" ? "team" : "subteam", entityId: input.id, payload: { from: previous, to: input.state } })
    await cancelDisabledWaiting(client, viewer.organizationId)
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  const tree = await listScopes(db, viewer.organizationId)
  const node = input.scopeType === "GROUP" ? tree.find((group) => group.id === input.id) : tree.flatMap((group) => group.children ?? []).find((child) => child.id === input.id)
  return node!
}

/** Anjos a partir das atribuições, com escopos, capacidade e situação agora. Com filtro de Grupo/Subgrupo: quem atende aquele escopo e, para quem não pode receber atribuição agora, o motivo. */
export async function listAnjos(db: Queryable, organizationId: string, filter: { teamId?: string | null | undefined; subteamId?: string | null | undefined } = {}): Promise<AnjoRow[]> {
  const [settings, scopes, structure] = await Promise.all([loadSettings(db, organizationId), anjoScopes(db, organizationId), structureOf(db, organizationId)])
  const ids = [...scopes.keys()]
  if (ids.length === 0) return []
  const [presence, names] = await Promise.all([
    db.query<{ person_id: string; status: PresenceStatus | null; connected: boolean | null; max_concurrent: number | null; active_count: number }>(
      `select ids.person_id, p.status, p.lease_until > statement_timestamp() connected, p.max_concurrent,
              (select count(*)::int from human_support_attendances a where a.organization_id = $1 and a.anjo_person_id = ids.person_id and a.status = 'ACTIVE') active_count
         from unnest($2::uuid[]) as ids(person_id)
         left join human_support_agent_presence p on p.organization_id = $1 and p.person_id = ids.person_id`,
      [organizationId, ids],
    ),
    loadPersonPresentations(db, organizationId, ids),
  ])
  const teamName = new Map(structure.teams.map((team) => [team.id, team.name]))
  const subteamById = new Map(structure.subteams.map((subteam) => [subteam.id, subteam]))
  const filterTeam = filter.subteamId ? (subteamById.get(filter.subteamId)?.team_id ?? null) : (filter.teamId ?? null)
  const filtered = Boolean(filter.teamId || filter.subteamId)
  const coversFilter = (list: AccessScope[]) =>
    list.some((scope) => scope.type === "ORGANIZATION" || (scope.type === "GROUP" && scope.teamId === filterTeam) || (scope.type === "SUBGROUP" && Boolean(filter.subteamId) && scope.subteamId === filter.subteamId))
  const rows = presence.rows.map((row): AnjoRow => {
    const list = scopes.get(row.person_id) ?? []
    const capacity = effectiveCapacity(row.max_concurrent === null ? null : Number(row.max_concurrent), settings.defaultCapacity)
    const situation = { coversScope: filtered ? coversFilter(list) : true, active: true, status: row.status ?? "OFFLINE", connected: row.connected === true, activeAttendances: row.active_count, capacity, isOperator: false }
    const scopeViews: AnjoScopeView[] = list.map((scope) =>
      scope.type === "ORGANIZATION" ? { type: "ORGANIZATION", id: null, name: "Toda a organização" } : scope.type === "GROUP" ? { type: "GROUP", id: scope.teamId, name: teamName.get(scope.teamId) ?? "Grupo" } : { type: "SUBGROUP", id: scope.type === "SUBGROUP" ? scope.subteamId : null, name: scope.type === "SUBGROUP" ? (subteamById.get(scope.subteamId)?.name ?? "Subgrupo") : "" },
    )
    return {
      personId: row.person_id,
      name: names.get(row.person_id)?.displayName ?? "Anjo",
      scopes: scopeViews,
      maxConcurrent: row.max_concurrent === null ? null : Number(row.max_concurrent),
      effectiveCapacity: capacity,
      status: situation.status,
      connected: situation.connected,
      used: row.active_count,
      canReceiveAssignment: filtered ? canReceiveAssignment(situation) : null,
      reasonNotEligible: filtered ? notEligibleReason(situation) : null,
    }
  })
  return (filtered ? rows.filter((row) => row.reasonNotEligible !== "SCOPE_NOT_COVERED") : rows).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
}

/** Capacidade de um Anjo (1–5; null = a padrão da organização). Reduzir abaixo do que está em uso não corta nada. */
export async function updateAnjoCapacity(db: TransactionSource & Queryable, viewer: Viewer, personId: string, maxConcurrent: number | null): Promise<AnjoRow> {
  if (maxConcurrent !== null && (maxConcurrent < HUMAN_SUPPORT_LIMITS.capacityMin || maxConcurrent > HUMAN_SUPPORT_LIMITS.capacityMax)) throw new DomainError("A capacidade vai de 1 a 5 atendimentos.", "VALIDATION_ERROR", 400)
  const scopes = await assignmentScopesOf(db, viewer.organizationId, "human_support.attend", [personId])
  if (!scopes.has(personId)) throw new DomainError("Esta pessoa não tem o papel de Anjo.", "HUMAN_SUPPORT_ANJO_NOT_FOUND", 404)
  await withOrganizationLock(db, viewer.organizationId, async (client) => {
    await client.query(`insert into human_support_agent_presence (organization_id, person_id) values ($1, $2) on conflict (organization_id, person_id) do nothing`, [viewer.organizationId, personId])
    const previous = (await client.query<{ max_concurrent: number | null }>(`select max_concurrent from human_support_agent_presence where organization_id = $1 and person_id = $2 for update`, [viewer.organizationId, personId])).rows[0]!.max_concurrent
    if ((previous === null ? null : Number(previous)) === maxConcurrent) return
    await client.query(`update human_support_agent_presence set max_concurrent = $3, version = version + 1 where organization_id = $1 and person_id = $2`, [viewer.organizationId, personId, maxConcurrent])
    await client.query(
      `insert into human_support_setting_events (organization_id, target_type, subject_person_id, field, from_value, to_value, actor_person_id, occurred_at) values ($1, 'ANJO', $2, 'ANJO_CAPACITY', $3, $4, $5, statement_timestamp())`,
      [viewer.organizationId, personId, previous === null ? null : String(previous), maxConcurrent === null ? null : String(maxConcurrent), viewer.personId],
    )
    await recordHumanSupportAudit(client, { organizationId: viewer.organizationId, actorPersonId: viewer.personId, action: "HUMAN_SUPPORT_CAPACITY_CHANGED", entityType: "person", entityId: personId, payload: { from: previous, to: maxConcurrent } })
    await bumpInboxVersions(client, viewer.organizationId, [personId])
  })
  await dispatchAfterCommand(db, viewer.organizationId)
  return (await listAnjos(db, viewer.organizationId)).find((row) => row.personId === personId)!
}
