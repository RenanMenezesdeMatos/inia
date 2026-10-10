import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccountAccessRepository, CredentialTargetRecord, IdentifiedUser } from "../application/account-access-repository.js"
import type { VisibilityFilter } from "../application/access-repository.js"
import type { AccessScope } from "../domain/access-scope.js"

type Queryable = Pick<Database, "query">

/** Situação do acesso em SQL — a MESMA regra de `accountAccessStatusOf` (domain/account-access-status.ts). */
const ACCESS_STATUS_SQL = `case when ua.id is null or not ua.active then 'DISABLED' when ua.password_change_required then 'PENDING_PASSWORD_CHANGE' else 'ACTIVE' end`

type ListRow = {
  total: string
  person_id: string; name: string; matricula: string | null; job_title: string | null; level: string; person_active: boolean
  team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null
  account_id: string | null; email: string | null; account_active: boolean | null; last_login_at: Date | null; password_change_required: boolean | null
  temporary_password_issued_at: Date | null; temporary_password_expires_at: Date | null; access_disabled_at: Date | null; role_codes: string[] | null
}
type TargetRow = { person_id: string; name: string; person_active: boolean; team_id: string | null; subteam_id: string | null; account_id: string | null; email: string | null; active: boolean | null; session_version: number | null; password_change_required: boolean | null; led_placements?: { teamId: string | null; subteamId: string | null }[] | null }
type AssignmentRow = { role_code: string; scope_type: AccessScope["type"]; team_id: string | null; subteam_id: string | null; subteam_team_id: string | null }

const toScope = (row: AssignmentRow): AccessScope =>
  row.scope_type === "GROUP" ? { type: "GROUP", teamId: row.team_id! } : row.scope_type === "SUBGROUP" ? { type: "SUBGROUP", subteamId: row.subteam_id!, teamId: row.subteam_team_id! } : { type: row.scope_type }

const uniqueViolation = (error: unknown) => {
  const detail = error as { code?: string; constraint?: string }
  return detail.code === "23505" ? (detail.constraint === "user_accounts_person_id_key" ? "ALREADY_LINKED" : "EMAIL_IN_USE") : null
}

/** Auditoria na MESMA instrução da escrita (só grava se a escrita aconteceu). Payload sem senha nem hash. */
const AUDITED = (action: string) => `audited as (
  insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at)
  select ua.organization_id, $AUDIT_ACTOR::uuid, '${action}', 'user_account', ua.id, $AUDIT_PAYLOAD::jsonb, $AUDIT_AT::timestamptz from changed ua
)`
const withAudit = (sql: string, action: string, params: unknown[], audit: { actorPersonId: string | null; payload: Record<string, unknown>; at: Date }) => {
  const base = params.length
  return {
    // Substituição por FUNÇÃO: num texto de substituição, "$7" teria significado especial.
    text: sql.replace("$AUDITED", () => AUDITED(action)).replaceAll("$AUDIT_ACTOR", () => `$${base + 1}`).replaceAll("$AUDIT_PAYLOAD", () => `$${base + 2}`).replaceAll("$AUDIT_AT", () => `$${base + 3}`),
    values: [...params, audit.actorPersonId, JSON.stringify(audit.payload), audit.at],
  }
}

export function createPostgresAccountAccessRepository(db: Queryable): AccountAccessRepository {
  const assignmentsOf = async (organizationId: string, accountId: string) => {
    const result = await db.query<AssignmentRow>(
      `select a.role_code, a.scope_type, a.team_id, a.subteam_id, st.team_id subteam_team_id
       from access_role_assignments a left join subteams st on st.id = a.subteam_id
       where a.organization_id = $1 and a.user_account_id = $2 and a.revoked_at is null`,
      [organizationId, accountId],
    )
    return result.rows.map((row) => ({ roleCode: row.role_code, scope: toScope(row) }))
  }
  const toTarget = async (organizationId: string, row: TargetRow | undefined): Promise<CredentialTargetRecord | null> => {
    if (!row) return null
    return {
      personId: row.person_id, name: row.name, personActive: row.person_active, teamId: row.team_id, subteamId: row.subteam_id, ledPlacements: row.led_placements ?? [],
      account: row.account_id ? { accountId: row.account_id, email: row.email!, active: row.active === true, sessionVersion: row.session_version ?? 0, passwordChangeRequired: row.password_change_required === true, assignments: await assignmentsOf(organizationId, row.account_id) } : null,
    }
  }
  // Subárvore liderada (reports_to, qualquer profundidade, só ativos; profundidade limitada contra ciclo no cadastro).
  const TARGET_SELECT = `select p.id person_id, p.name, p.active person_active, p.team_id, p.subteam_id, ua.id account_id, ua.email, ua.active, ua.session_version, ua.password_change_required,
      coalesce((
        with recursive tree as (
          select c.id, c.team_id, c.subteam_id, c.active, 1 depth from people c where c.reports_to_id = p.id and c.organization_id = p.organization_id
          union all
          select c.id, c.team_id, c.subteam_id, c.active, tree.depth + 1 from people c join tree on c.reports_to_id = tree.id where tree.depth < 50 and c.organization_id = p.organization_id
        )
        select json_agg(distinct jsonb_build_object('teamId', tree.team_id, 'subteamId', tree.subteam_id)) from tree where tree.active
      ), '[]') led_placements
    from people p left join user_accounts ua on ua.person_id = p.id and ua.organization_id = p.organization_id`
  const write = async (query: { text: string; values: unknown[] }) => {
    const result = await db.query<{ id: string }>(query.text, query.values)
    return result.rows[0]?.id ?? null
  }

  return {
    async listIdentifiedUsers(organizationId, visibility: VisibilityFilter, filters) {
      const params: unknown[] = [organizationId, visibility.organizationWide, visibility.teamIds, visibility.subteamIds]
      const conditions: string[] = []
      if (filters.search) {
        params.push(filters.search)
        const term = `lower($${params.length})`
        conditions.push(`(position(${term} in lower(q.name)) > 0 or position(${term} in lower(coalesce(q.email, ''))) > 0 or position(${term} in lower(coalesce(q.matricula, ''))) > 0)`)
      }
      if (filters.status) { params.push(filters.status); conditions.push(`q.access_status = $${params.length}`) }
      params.push(filters.pageSize, (filters.page - 1) * filters.pageSize)
      const result = await db.query<ListRow>(
        `with q as (
           select p.id person_id, p.name, p.matricula, p.job_title, p.role level, p.active person_active,
                  t.id team_id, t.name team_name, st.id subteam_id, st.name subteam_name,
                  ua.id account_id, ua.email, ua.active account_active, ua.last_login_at, ua.password_change_required,
                  ua.temporary_password_issued_at, ua.temporary_password_expires_at, ua.access_disabled_at,
                  ${ACCESS_STATUS_SQL} access_status
           from people p
           left join user_accounts ua on ua.person_id = p.id and ua.organization_id = p.organization_id
           left join teams t on t.id = p.team_id
           left join subteams st on st.id = p.subteam_id
           where p.organization_id = $1 and ($2::boolean or p.team_id = any($3::uuid[]) or p.subteam_id = any($4::uuid[]))
         )
         select count(*) over() total, q.*,
                (select array_agg(a.role_code order by a.granted_at) from access_role_assignments a where a.user_account_id = q.account_id and a.revoked_at is null) role_codes
         from q
         ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
         order by q.name, q.person_id
         limit $${params.length - 1} offset $${params.length}`,
        params,
      )
      const items = result.rows.map((row): IdentifiedUser => ({
        personId: row.person_id, name: row.name, matricula: row.matricula, jobTitle: row.job_title, level: row.level, personActive: row.person_active,
        team: row.team_id ? { id: row.team_id, name: row.team_name! } : null,
        subteam: row.subteam_id ? { id: row.subteam_id, name: row.subteam_name! } : null,
        account: row.account_id
          ? {
              accountId: row.account_id, email: row.email!, active: row.account_active === true, lastLoginAt: row.last_login_at, passwordChangeRequired: row.password_change_required === true,
              temporaryPasswordIssuedAt: row.temporary_password_issued_at, temporaryPasswordExpiresAt: row.temporary_password_expires_at, accessDisabledAt: row.access_disabled_at, roleCodes: row.role_codes ?? [],
            }
          : null,
      }))
      return { items, total: Number(result.rows[0]?.total ?? 0) }
    },

    async targetByPerson(organizationId, personId) {
      const result = await db.query<TargetRow>(`${TARGET_SELECT} where p.organization_id = $1 and p.id = $2`, [organizationId, personId])
      return toTarget(organizationId, result.rows[0])
    },
    async targetByAccount(organizationId, accountId) {
      const result = await db.query<TargetRow>(`${TARGET_SELECT} where p.organization_id = $1 and ua.id = $2`, [organizationId, accountId])
      return toTarget(organizationId, result.rows[0])
    },

    async createWithTemporaryPassword(input) {
      try {
        const id = await write(withAudit(
          `with changed as (
             insert into user_accounts (organization_id, person_id, email, password_hash, password_change_required, temporary_password_issued_at, temporary_password_expires_at, created_at, updated_at)
             select p.organization_id, p.id, $3::text, $4::text, true, $5::timestamptz, $6::timestamptz, $5::timestamptz, $5::timestamptz from people p where p.organization_id = $1 and p.id = $2
             returning id, organization_id
           ), $AUDITED
           select id from changed`,
          "ACCESS_ENABLED",
          [input.organizationId, input.personId, input.email, input.passwordHash, input.issuedAt, input.expiresAt],
          { actorPersonId: input.actorPersonId, at: input.issuedAt, payload: { personId: input.personId, email: input.email, accountCreated: true, temporaryPasswordExpiresAt: input.expiresAt.toISOString(), actorAccountId: input.actorAccountId } },
        ))
        return id ? { ok: true, accountId: id } : { ok: false, error: "CONFLICT" }
      } catch (error) {
        const violation = uniqueViolation(error)
        if (violation) return { ok: false, error: violation }
        throw error
      }
    },

    async enableWithTemporaryPassword(input) {
      try {
        const id = await write(withAudit(
          `with changed as (
             update user_accounts
                set active = true, email = coalesce($4, email), password_hash = $5, password_change_required = true,
                    temporary_password_issued_at = $6, temporary_password_expires_at = $7, access_disabled_at = null,
                    session_version = session_version + 1, updated_at = $6
              where organization_id = $1 and id = $2 and not active and session_version = $3
              returning id, organization_id
           ), $AUDITED
           select id from changed`,
          "ACCESS_ENABLED",
          [input.organizationId, input.accountId, input.expectedSessionVersion, input.email, input.passwordHash, input.issuedAt, input.expiresAt],
          { actorPersonId: input.actorPersonId, at: input.issuedAt, payload: { personId: input.personId, ...(input.email ? { email: input.email } : {}), accountCreated: false, temporaryPasswordExpiresAt: input.expiresAt.toISOString(), sessionsRevoked: true, actorAccountId: input.actorAccountId } },
        ))
        return id ? { ok: true, accountId: id } : { ok: false, error: "CONFLICT" }
      } catch (error) {
        if (uniqueViolation(error)) return { ok: false, error: "EMAIL_IN_USE" }
        throw error
      }
    },

    async issueTemporaryPassword(input) {
      const id = await write(withAudit(
        `with changed as (
           update user_accounts
              set password_hash = $4, password_change_required = true, temporary_password_issued_at = $5, temporary_password_expires_at = $6,
                  session_version = session_version + 1, updated_at = $5
            where organization_id = $1 and id = $2 and active and session_version = $3
            returning id, organization_id
         ), $AUDITED
         select id from changed`,
        "ACCESS_TEMPORARY_PASSWORD_ISSUED",
        [input.organizationId, input.accountId, input.expectedSessionVersion, input.passwordHash, input.issuedAt, input.expiresAt],
        { actorPersonId: input.actorPersonId, at: input.issuedAt, payload: { personId: input.personId, temporaryPasswordExpiresAt: input.expiresAt.toISOString(), sessionsRevoked: true, actorAccountId: input.actorAccountId } },
      ))
      return id ? { ok: true, accountId: id } : { ok: false, error: "CONFLICT" }
    },

    async disable(input) {
      const id = await write(withAudit(
        `with changed as (
           update user_accounts
              set active = false, access_disabled_at = $4, password_change_required = false, temporary_password_issued_at = null, temporary_password_expires_at = null,
                  session_version = session_version + 1, updated_at = $4
            where organization_id = $1 and id = $2 and active and session_version = $3
            returning id, organization_id
         ), $AUDITED
         select id from changed`,
        "ACCESS_DISABLED",
        [input.organizationId, input.accountId, input.expectedSessionVersion, input.at],
        { actorPersonId: input.actorPersonId, at: input.at, payload: { personId: input.personId, sessionsRevoked: true, actorAccountId: input.actorAccountId } },
      ))
      return id ? { ok: true, accountId: id } : { ok: false, error: "CONFLICT" }
    },
  }
}
