import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessRepository, AccountSummary, AssignmentRecord, VisibilityFilter } from "../application/access-repository.js"
import type { AccessAssignment, AccessContext } from "../domain/access-decision.js"
import type { AccessScope } from "../domain/access-scope.js"

type Queryable = Pick<Database, "query">
type AssignmentRow = { id: string; user_account_id: string; role_code: string; scope_type: AccessScope["type"]; team_id: string | null; subteam_id: string | null; subteam_team_id: string | null; team_name: string | null; subteam_name: string | null; source: string; granted_at: Date; granted_by_name: string | null; revoked_at: Date | null }
const toScope = (row: Pick<AssignmentRow, "scope_type" | "team_id" | "subteam_id" | "subteam_team_id">): AccessScope =>
  row.scope_type === "GROUP" ? { type: "GROUP", teamId: row.team_id! } : row.scope_type === "SUBGROUP" ? { type: "SUBGROUP", subteamId: row.subteam_id!, teamId: row.subteam_team_id! } : { type: row.scope_type }
const scopeLabel = (row: AssignmentRow) => (row.scope_type === "ORGANIZATION" ? "Toda a organização" : row.scope_type === "MY_STRUCTURE" ? "Estrutura da pessoa (quem está abaixo dela)" : row.scope_type === "GROUP" ? `Grupo ${row.team_name ?? ""}`.trim() : `Subgrupo ${row.subteam_name ?? ""}`.trim())
const ASSIGNMENT_SELECT = `select a.id, a.user_account_id, a.role_code, a.scope_type, a.team_id, a.subteam_id, st.team_id subteam_team_id, t.name team_name, st.name subteam_name, a.source, a.granted_at, gp.name granted_by_name, a.revoked_at
  from access_role_assignments a
  left join teams t on t.id = a.team_id
  left join subteams st on st.id = a.subteam_id
  left join user_accounts ga on ga.id = a.granted_by_account_id
  left join people gp on gp.id = ga.person_id`
/** Filtro de visibilidade sobre um colaborador `p` (parâmetros: organização inteira, grupos, subgrupos). */
const visibilitySql = (offset: number) => `($${offset}::boolean or p.team_id = any($${offset + 1}::uuid[]) or p.subteam_id = any($${offset + 2}::uuid[]))`
const visibilityParams = (visibility: VisibilityFilter) => [visibility.organizationWide, visibility.teamIds, visibility.subteamIds]
const audit = (db: Queryable, organizationId: string, actorPersonId: string, action: string, entityId: string, payload: Record<string, unknown>) =>
  db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'access_role_assignment', $4, $5)`, [organizationId, actorPersonId, action, entityId, JSON.stringify(payload)])

type AccountRow = { account_id: string; email: string; account_active: boolean; last_login_at: Date | null; person_id: string; name: string; job_title: string | null; level: string; person_active: boolean; team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null; total?: string }
const ACCOUNT_SELECT = `select ua.id account_id, ua.email, ua.active account_active, ua.last_login_at, p.id person_id, p.name, p.job_title, p.role level, p.active person_active, t.id team_id, t.name team_name, st.id subteam_id, st.name subteam_name
  from user_accounts ua join people p on p.id = ua.person_id and p.organization_id = ua.organization_id
  left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id`
const toAccount = (row: AccountRow): AccountSummary => ({
  accountId: row.account_id, email: row.email, active: row.account_active, lastLoginAt: row.last_login_at,
  collaborator: { personId: row.person_id, name: row.name, jobTitle: row.job_title, level: row.level, active: row.person_active, team: row.team_id ? { id: row.team_id, name: row.team_name! } : null, subteam: row.subteam_id ? { id: row.subteam_id, name: row.subteam_name! } : null },
})

/**
 * `loadContext` de várias contas em duas consultas (ex.: os destinatários de um report), com a MESMA regra: só conta ATIVA de
 * pessoa ATIVA tem atribuições; as outras recebem o contexto vazio. Uma entrada por conta pedida.
 */
export async function loadAccessContexts(db: Queryable, organizationId: string, accountIds: readonly string[]): Promise<Map<string, AccessContext>> {
  const ids = [...new Set(accountIds)]
  const contexts = new Map<string, AccessContext>(ids.map((accountId) => [accountId, { organizationId, accountId, personId: "", assignments: [] }]))
  if (ids.length === 0) return contexts
  const accounts = await db.query<{ id: string; person_id: string }>(`select ua.id, ua.person_id from user_accounts ua join people p on p.id = ua.person_id where ua.organization_id = $1 and ua.id = any($2::uuid[]) and ua.active and p.active`, [organizationId, ids])
  if (accounts.rows.length === 0) return contexts
  const assignments = await db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} where a.organization_id = $1 and a.user_account_id = any($2::uuid[]) and a.revoked_at is null order by a.granted_at`, [organizationId, accounts.rows.map((row) => row.id)])
  const byAccount = new Map<string, AccessAssignment[]>(accounts.rows.map((row) => [row.id, []]))
  for (const entry of assignments.rows) byAccount.get(entry.user_account_id)?.push({ id: entry.id, roleCode: entry.role_code, scope: toScope(entry) })
  for (const row of accounts.rows) contexts.set(row.id, { organizationId, accountId: row.id, personId: row.person_id, assignments: byAccount.get(row.id)! })
  return contexts
}

/** Modelo de acesso (migration 081). */
export function createPostgresAccessRepository(db: Queryable): AccessRepository {
  const contextFor = async (organizationId: string, where: string, value: string): Promise<AccessContext> => {
    // Conta ATIVA de pessoa ATIVA na organização: fora disso, nenhuma atribuição vale (nada é apagado — só não se aplica).
    const account = await db.query<{ id: string; person_id: string }>(`select ua.id, ua.person_id from user_accounts ua join people p on p.id = ua.person_id where ua.organization_id = $1 and ${where} = $2 and ua.active and p.active`, [organizationId, value])
    const row = account.rows[0]
    if (!row) return { organizationId, accountId: where === "ua.id" ? value : "", personId: where === "ua.person_id" ? value : "", assignments: [] }
    const assignments = await db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} where a.organization_id = $1 and a.user_account_id = $2 and a.revoked_at is null order by a.granted_at`, [organizationId, row.id])
    return { organizationId, accountId: row.id, personId: row.person_id, assignments: assignments.rows.map((entry): AccessAssignment => ({ id: entry.id, roleCode: entry.role_code, scope: toScope(entry) })) }
  }
  return {
    loadContext: (organizationId, accountId) => contextFor(organizationId, "ua.id", accountId),
    loadContextByPerson: (organizationId, personId) => contextFor(organizationId, "ua.person_id", personId),

    async collaborator(organizationId, personId) {
      const result = await db.query<{ id: string; team_id: string | null; subteam_id: string | null }>(`select id, team_id, subteam_id from people where organization_id = $1 and id = $2`, [organizationId, personId])
      const row = result.rows[0]
      return row ? { personId: row.id, teamId: row.team_id, subteamId: row.subteam_id } : null
    },
    async account(organizationId, accountId) {
      const result = await db.query<{ id: string; person_id: string; active: boolean }>(`select id, person_id, active from user_accounts where organization_id = $1 and id = $2`, [organizationId, accountId])
      const row = result.rows[0]
      return row ? { accountId: row.id, personId: row.person_id, active: row.active } : null
    },
    async isInStructure(organizationId, managerPersonId, personId) {
      const result = await db.query(
        `with recursive subordinates as (
           select id from people where organization_id = $1 and reports_to_id = $2
           union
           select p.id from people p join subordinates s on p.reports_to_id = s.id
         ) select 1 from subordinates where id = $3`,
        [organizationId, managerPersonId, personId],
      )
      return (result.rowCount ?? 0) > 0
    },
    async resolveScope(organizationId, input) {
      if (input.type === "ORGANIZATION" || input.type === "MY_STRUCTURE") return input.teamId || input.subteamId ? null : { type: input.type }
      if (input.type === "GROUP") {
        if (!input.teamId || input.subteamId) return null
        const found = await db.query(`select 1 from teams where organization_id = $1 and id = $2`, [organizationId, input.teamId])
        return found.rowCount ? { type: "GROUP", teamId: input.teamId } : null
      }
      if (!input.subteamId || input.teamId) return null
      const found = await db.query<{ team_id: string }>(`select st.team_id from subteams st join teams t on t.id = st.team_id where t.organization_id = $1 and st.id = $2`, [organizationId, input.subteamId])
      return found.rows[0] ? { type: "SUBGROUP", subteamId: input.subteamId, teamId: found.rows[0].team_id } : null
    },

    async listAccounts(organizationId, visibility, filters) {
      const params: unknown[] = [organizationId, ...visibilityParams(visibility)]
      let where = `ua.organization_id = $1 and ${visibilitySql(2)}`
      if (filters.search) { params.push(filters.search); where += ` and (position(lower($${params.length}) in lower(p.name)) > 0 or position(lower($${params.length}) in lower(ua.email)) > 0)` }
      params.push(filters.pageSize, (filters.page - 1) * filters.pageSize)
      const result = await db.query<AccountRow>(`${ACCOUNT_SELECT.replace("select ua.id", "select count(*) over() total, ua.id")} where ${where} order by p.name, ua.id limit $${params.length - 1} offset $${params.length}`, params)
      return { items: result.rows.map(toAccount), total: Number(result.rows[0]?.total ?? 0) }
    },
    async getAccount(organizationId, accountId) {
      const result = await db.query<AccountRow>(`${ACCOUNT_SELECT} where ua.organization_id = $1 and ua.id = $2`, [organizationId, accountId])
      return result.rows[0] ? toAccount(result.rows[0]) : null
    },
    async listAssignments(organizationId, accountId) {
      const result = await db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} where a.organization_id = $1 and a.user_account_id = $2 and a.revoked_at is null order by a.granted_at`, [organizationId, accountId])
      return result.rows.map((row): AssignmentRecord => ({ id: row.id, accountId: row.user_account_id, roleCode: row.role_code, scope: toScope(row), scopeLabel: scopeLabel(row), source: row.source, grantedAt: row.granted_at, grantedByName: row.granted_by_name }))
    },
    async findAssignment(organizationId, assignmentId) {
      const result = await db.query<AssignmentRow>(`${ASSIGNMENT_SELECT} where a.organization_id = $1 and a.id = $2`, [organizationId, assignmentId])
      const row = result.rows[0]
      return row ? { id: row.id, accountId: row.user_account_id, roleCode: row.role_code, scope: toScope(row), revoked: row.revoked_at !== null } : null
    },
    async listLeaderAccounts(organizationId, visibility) {
      const result = await db.query<{ account_id: string; person_id: string; team_id: string | null; subteam_id: string | null }>(
        `select ua.id account_id, p.id person_id, p.team_id, p.subteam_id from user_accounts ua join people p on p.id = ua.person_id and p.organization_id = ua.organization_id
         where ua.organization_id = $1 and ua.active and p.active and ${visibilitySql(2)}
           and exists (select 1 from people sub where sub.organization_id = p.organization_id and sub.reports_to_id = p.id and sub.active)
         order by p.name`,
        [organizationId, ...visibilityParams(visibility)],
      )
      return result.rows.map((row) => ({ accountId: row.account_id, personId: row.person_id, teamId: row.team_id, subteamId: row.subteam_id }))
    },
    async scopeOptions(organizationId, visibility) {
      const [teams, subteams] = await Promise.all([
        db.query<{ id: string; name: string }>(`select t.id, t.name from teams t where t.organization_id = $1 and ($2::boolean or t.id = any($3::uuid[])) order by t.name`, [organizationId, visibility.organizationWide, visibility.teamIds]),
        db.query<{ id: string; name: string; team_id: string; team_name: string }>(
          `select st.id, st.name, st.team_id, t.name team_name from subteams st join teams t on t.id = st.team_id where t.organization_id = $1 and ($2::boolean or st.team_id = any($3::uuid[]) or st.id = any($4::uuid[])) order by t.name, st.name`,
          [organizationId, visibility.organizationWide, visibility.teamIds, visibility.subteamIds],
        ),
      ])
      return { teams: teams.rows, subteams: subteams.rows.map((row) => ({ id: row.id, name: row.name, teamId: row.team_id, teamName: row.team_name })) }
    },

    async createAssignment({ organizationId, accountId, roleCode, scope, grantedByAccountId, actorPersonId, permissions, at }) {
      const created = await db.query<{ id: string }>(
        `insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, subteam_id, source, granted_by_account_id, granted_at)
         values ($1, $2, $3, $4, $5, $6, 'MANUAL', $7, $8) on conflict do nothing returning id`,
        [organizationId, accountId, roleCode, scope.type, scope.type === "GROUP" ? scope.teamId : null, scope.type === "SUBGROUP" ? scope.subteamId : null, grantedByAccountId, at],
      )
      const id = created.rows[0]?.id
      if (!id) return { ok: false, error: "ALREADY_ASSIGNED" }
      await audit(db, organizationId, actorPersonId, "ACCESS_ROLE_GRANTED", id, { recipientAccountId: accountId, grantedByAccountId, roleCode, permissions, scope })
      return { ok: true, id }
    },
    async revokeAssignment({ organizationId, assignmentId, revokedByAccountId, actorPersonId, reason, at }) {
      const result = await db.query<{ user_account_id: string; role_code: string; scope_type: string; team_id: string | null; subteam_id: string | null }>(
        `update access_role_assignments set revoked_at = $3, revoked_by_account_id = $4, revocation_reason = $5 where organization_id = $1 and id = $2 and revoked_at is null returning user_account_id, role_code, scope_type, team_id, subteam_id`,
        [organizationId, assignmentId, at, revokedByAccountId, reason],
      )
      const row = result.rows[0]
      if (!row) return false
      await audit(db, organizationId, actorPersonId, "ACCESS_ROLE_REVOKED", assignmentId, { recipientAccountId: row.user_account_id, revokedByAccountId, roleCode: row.role_code, scope: { type: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id }, reason })
      return true
    },
    async countActiveHolders(organizationId, roleCode, options = {}) {
      const result = await db.query<{ n: number }>(
        `select count(distinct a.user_account_id)::int n from access_role_assignments a join user_accounts ua on ua.id = a.user_account_id join people p on p.id = ua.person_id
         where a.organization_id = $1 and a.role_code = $2 and a.revoked_at is null and ua.active and p.active
           and ($3::uuid is null or a.id <> $3) and ($4::uuid is null or a.user_account_id <> $4)`,
        [organizationId, roleCode, options.excludingAssignmentId ?? null, options.excludingAccountId ?? null],
      )
      return result.rows[0]?.n ?? 0
    },
  }
}
