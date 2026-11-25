import { unitFilterSql } from "../../../shared/infrastructure/database/unit-filter.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { ACCESS_DISABLED_REASONS, type AccessDisabledReason, type AccountAccessRepository, type CredentialTargetRecord, type IdentifiedUser } from "../application/account-access-repository.js"
import type { VisibilityFilter } from "../application/access-repository.js"
import { foldedLikeWords, foldSql } from "../../../shared/infrastructure/database/text-search.js"
import type { AccessScope } from "../domain/access-scope.js"
import type { NetworkAccessIssue } from "../domain/network-access.js"

type Queryable = Pick<Database, "query">

/** Situação do acesso em SQL — a MESMA regra de `accountAccessStatusOf` (domain/account-access-status.ts). */
const ACCESS_STATUS_SQL = `case when ua.id is null or not ua.active then 'DISABLED' when ua.password_change_required and not (org.network_login_enabled and not ua.emergency_local_access) then 'PENDING_PASSWORD_CHANGE' else 'ACTIVE' end`
/** Quem gerencia a senha em SQL — a MESMA regra de `credentialProviderOf` (domain/account-access-status.ts) e do login. */
const NETWORK_MANAGED_SQL = `(select o.network_login_enabled from organizations o where o.id = ua.organization_id) and not ua.emergency_local_access`
/** Outra conta que também pode entrar pela rede com a mesma matrícula — a MESMA comparação do login (`findByNetworkLogin`). */
const matriculaDuplicatedSql = (matricula: string, personId: string | null) => `exists (
  select 1 from people twin
    join user_accounts twin_account on twin_account.person_id = twin.id and twin_account.active
    join organizations twin_org on twin_org.id = twin_account.organization_id and twin_org.network_login_enabled
   where twin.matricula is not null and upper(btrim(twin.matricula)) = upper(btrim(${matricula}))${personId ? ` and twin.id <> ${personId}` : ""} and twin.active)`
/** O que impede a entrada pela rede, sobre uma linha da lista — a MESMA regra de `networkAccessIssueOf` (domain/network-access.ts). */
const networkIssueSql = (row: string) => `case when not ${row}.enable_by_network then null
  when not ${row}.person_active then 'PERSON_INACTIVE'
  when ${row}.matricula is null or btrim(${row}.matricula) = '' then 'MATRICULA_MISSING'
  when upper(btrim(${row}.matricula)) !~ '^[A-Z0-9][A-Z0-9._-]{1,63}$' then 'MATRICULA_INVALID'
  when ${matriculaDuplicatedSql(`${row}.matricula`, `${row}.person_id`)} then 'MATRICULA_DUPLICATED' end`
/** Só os números, sem zeros à esquerda: `G0055350` e `0055350` (prefixo que faltou, zero que o Excel comeu) são "parecidas". */
const DIGITS_SQL = (expression: string) => `ltrim(regexp_replace(${expression}, '\\D', '', 'g'), '0')`

type ListRow = {
  total: string
  person_id: string; name: string; matricula: string | null; job_title: string | null; level: string; person_active: boolean
  team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null
  account_id: string | null; email: string | null; account_active: boolean | null; last_login_at: Date | null; password_change_required: boolean | null
  temporary_password_issued_at: Date | null; temporary_password_expires_at: Date | null; access_disabled_at: Date | null; role_codes: string[] | null
  network_managed: boolean | null; network_issue: NetworkAccessIssue | null; directory_login: string | null; enable_by_network: boolean; disabled_reason: string | null
}
type TargetRow = { person_id: string; name: string; person_active: boolean; matricula: string | null; network_login_enabled: boolean | null; matricula_duplicated: boolean | null; team_id: string | null; subteam_id: string | null; account_id: string | null; email: string | null; active: boolean | null; session_version: number | null; password_change_required: boolean | null; network_managed: boolean | null; led_placements?: { teamId: string | null; subteamId: string | null }[] | null }
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
  const targetOf = (row: TargetRow, assignments: { roleCode: string; scope: AccessScope }[]): CredentialTargetRecord => ({
      personId: row.person_id, name: row.name, personActive: row.person_active, matricula: row.matricula ?? null, networkLoginEnabled: row.network_login_enabled === true, matriculaDuplicated: row.matricula_duplicated === true, teamId: row.team_id, subteamId: row.subteam_id, ledPlacements: row.led_placements ?? [],
      account: row.account_id ? { accountId: row.account_id, email: row.email!, active: row.active === true, sessionVersion: row.session_version ?? 0, passwordChangeRequired: row.password_change_required === true, credentialProvider: row.network_managed ? "NETWORK" : "LOCAL", assignments } : null,
  })
  const toTarget = async (organizationId: string, row: TargetRow | undefined): Promise<CredentialTargetRecord | null> =>
    row ? targetOf(row, row.account_id ? await assignmentsOf(organizationId, row.account_id) : []) : null
  // Subárvore liderada (reports_to, qualquer profundidade, só ativos; profundidade limitada contra ciclo no cadastro).
  const TARGET_SELECT = `select p.id person_id, p.name, p.active person_active, p.matricula, (select o.network_login_enabled from organizations o where o.id = p.organization_id) network_login_enabled, ${matriculaDuplicatedSql("p.matricula", "p.id")} matricula_duplicated, p.team_id, p.subteam_id, ua.id account_id, ua.email, ua.active, ua.session_version, ua.password_change_required,
      case when ua.id is null then null else ${NETWORK_MANAGED_SQL} end network_managed,
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
        const person = foldSql("q.name || ' ' || coalesce(q.email, '') || ' ' || coalesce(q.matricula, '')")
        for (const word of foldedLikeWords(filters.search)) conditions.push(`${person} like $${params.push(word)}`)
      }
      if (filters.status) { params.push(filters.status); conditions.push(`q.access_status = $${params.length}`) }
      if (filters.networkLogin) { params.push(filters.networkLogin); conditions.push(`q.matricula is not null and upper(btrim(q.matricula)) = $${params.length}`) }
      // Quem saiu da empresa e não tem acesso não é impedimento a resolver: inativa só entra no filtro com a conta ainda habilitada.
      if (filters.networkIssue) conditions.push(`(q.person_active or q.account_active) and ${networkIssueSql("q")} is not null`)
      const units = unitFilterSql(filters, (value) => `$${params.push(value)}`, { team: "q.team_id", subteam: "q.subteam_id" })
      if (units) conditions.push(units)
      const people = `with q as (
           select p.id person_id, p.name, p.matricula, p.job_title, p.role level, p.active person_active,
                  t.id team_id, t.name team_name, st.id subteam_id, st.name subteam_name,
                  ua.id account_id, ua.email, ua.active account_active, ua.last_login_at, ua.password_change_required,
                  ua.temporary_password_issued_at, ua.temporary_password_expires_at, ua.access_disabled_at, ua.directory_login,
                  ${ACCESS_STATUS_SQL} access_status, case when ua.id is null then null else org.network_login_enabled and not ua.emergency_local_access end network_managed,
                  org.network_login_enabled and not coalesce(ua.emergency_local_access, false) enable_by_network
           from people p
           join organizations org on org.id = p.organization_id
           left join user_accounts ua on ua.person_id = p.id and ua.organization_id = p.organization_id
           left join teams t on t.id = p.team_id
           left join subteams st on st.id = p.subteam_id
           where p.organization_id = $1 and ($2::boolean or p.team_id = any($3::uuid[]) or p.subteam_id = any($4::uuid[]))
         )`
      const matching = `from q ${conditions.length ? `where ${conditions.join(" and ")}` : ""}`
      const result = await db.query<ListRow>(
        `${people}
         select page.*, ${networkIssueSql("page")} network_issue,
                (select array_agg(a.role_code order by a.granted_at) from access_role_assignments a where a.user_account_id = page.account_id and a.revoked_at is null) role_codes,
                case when page.account_id is not null and not page.account_active then (
                  select log.payload ->> 'reason' from audit_logs log
                   where log.organization_id = $1 and log.entity_type = 'user_account' and log.entity_id = page.account_id and log.action = 'ACCESS_DISABLED'
                   order by log.created_at desc limit 1) end disabled_reason
           from (select count(*) over() total, q.* ${matching} order by q.name, q.person_id limit $${params.length + 1} offset $${params.length + 2}) page
          order by page.name, page.person_id`,
        [...params, filters.pageSize, (filters.page - 1) * filters.pageSize],
      )
      // Página além do fim (a lista encolheu): sem linha não há `count(*) over()`, e o total continua sendo o verdadeiro.
      const total = result.rows[0]
        ? Number(result.rows[0].total)
        : filters.page > 1 ? Number((await db.query<{ total: string }>(`${people} select count(*) total ${matching}`, params)).rows[0]?.total ?? 0) : 0
      const items = result.rows.map((row): IdentifiedUser => ({
        personId: row.person_id, name: row.name, matricula: row.matricula, jobTitle: row.job_title, level: row.level, personActive: row.person_active,
        team: row.team_id ? { id: row.team_id, name: row.team_name! } : null,
        subteam: row.subteam_id ? { id: row.subteam_id, name: row.subteam_name! } : null,
        account: row.account_id
          ? {
              accountId: row.account_id, email: row.email!, active: row.account_active === true, lastLoginAt: row.last_login_at, passwordChangeRequired: row.password_change_required === true,
              temporaryPasswordIssuedAt: row.temporary_password_issued_at, temporaryPasswordExpiresAt: row.temporary_password_expires_at, accessDisabledAt: row.access_disabled_at, roleCodes: row.role_codes ?? [],
              credentialProvider: row.network_managed ? "NETWORK" : "LOCAL",
              disabledReason: (ACCESS_DISABLED_REASONS as readonly string[]).includes(row.disabled_reason ?? "") ? (row.disabled_reason as AccessDisabledReason) : null,
            }
          : null,
        networkIssue: row.network_issue, directoryLogin: row.directory_login ?? null, enableCredential: row.enable_by_network ? "NETWORK" : "LOCAL",
      }))
      return { items, total }
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
                set active = true, email = coalesce($4, email), password_hash = $5, directory_login = null, password_change_required = true,
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
           update user_accounts ua
              set password_hash = $4, password_change_required = true, temporary_password_issued_at = $5, temporary_password_expires_at = $6,
                  session_version = session_version + 1, updated_at = $5
            where organization_id = $1 and id = $2 and active and session_version = $3
              -- Senha gerenciada pelo AD nunca vira temporária da INIA (mesmo que o login pela rede tenha sido ligado agora).
              and not coalesce(${NETWORK_MANAGED_SQL}, false)
            returning id, organization_id
         ), $AUDITED
         select id from changed`,
        "ACCESS_TEMPORARY_PASSWORD_ISSUED",
        [input.organizationId, input.accountId, input.expectedSessionVersion, input.passwordHash, input.issuedAt, input.expiresAt],
        { actorPersonId: input.actorPersonId, at: input.issuedAt, payload: { personId: input.personId, temporaryPasswordExpiresAt: input.expiresAt.toISOString(), sessionsRevoked: true, actorAccountId: input.actorAccountId } },
      ))
      return id ? { ok: true, accountId: id } : { ok: false, error: "CONFLICT" }
    },

    async enableForNetwork(input) {
      const enabled = new Map<string, { accountId: string }>()
      const params = (rows: unknown[][]) => [input.organizationId, input.retiredPasswordHash, input.at, input.actorPersonId, JSON.stringify({ credential: "NETWORK", actorAccountId: input.actorAccountId, ...(input.batchId ? { batchId: input.batchId } : {}) }), ...rows]
      const AUDIT = (accountCreated: boolean) => `audited as (
          insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at)
          select c.organization_id, $4::uuid, 'ACCESS_ENABLED', 'user_account', c.id,
                 jsonb_build_object('personId', c.person_id, 'accountCreated', ${accountCreated}${accountCreated ? ", 'email', c.email" : ", 'sessionsRevoked', true"}) || $5::jsonb, $3::timestamptz
            from changed c
        )`
      if (input.create.length > 0) {
        const created = await db.query<{ id: string; person_id: string }>(
          `with changed as (
             insert into user_accounts (organization_id, person_id, email, password_hash, created_at, updated_at)
             select p.organization_id, p.id, t.email, $2::text, $3::timestamptz, $3::timestamptz
               from unnest($6::uuid[], $7::text[]) t(person_id, email)
               join people p on p.id = t.person_id and p.organization_id = $1 and p.active
               join organizations o on o.id = p.organization_id and o.network_login_enabled
             on conflict do nothing
             returning id, organization_id, person_id, email
           ), ${AUDIT(true)}
           select id, person_id from changed`,
          params([input.create.map((row) => row.personId), input.create.map((row) => row.email)]),
        )
        for (const row of created.rows) enabled.set(row.person_id, { accountId: row.id })
      }
      if (input.reenable.length > 0) {
        const reenabled = await db.query<{ id: string; person_id: string }>(
          `with changed as (
             update user_accounts ua
                set active = true, password_hash = $2::text, directory_login = null, password_change_required = false, temporary_password_issued_at = null, temporary_password_expires_at = null,
                    access_disabled_at = null, session_version = ua.session_version + 1, updated_at = $3::timestamptz
               from unnest($6::uuid[], $7::int[]) t(account_id, session_version), people p, organizations o
              where ua.id = t.account_id and ua.organization_id = $1 and not ua.active and ua.session_version = t.session_version and not ua.emergency_local_access
                and p.id = ua.person_id and p.active and o.id = ua.organization_id and o.network_login_enabled
             returning ua.id, ua.organization_id, ua.person_id
           ), ${AUDIT(false)}
           select id, person_id from changed`,
          params([input.reenable.map((row) => row.accountId), input.reenable.map((row) => row.expectedSessionVersion)]),
        )
        for (const row of reenabled.rows) enabled.set(row.person_id, { accountId: row.id })
      }
      return enabled
    },

    async targetsByNetworkLogin(organizationId, networkLogins) {
      if (networkLogins.length === 0) return []
      const rows = (await db.query<TargetRow>(`${TARGET_SELECT} where p.organization_id = $1 and p.matricula is not null and upper(btrim(p.matricula)) = any($2::text[])`, [organizationId, networkLogins])).rows
      const accountIds = rows.flatMap((row) => (row.account_id ? [row.account_id] : []))
      const assignments = accountIds.length === 0 ? [] : (await db.query<AssignmentRow & { user_account_id: string }>(
        `select a.user_account_id, a.role_code, a.scope_type, a.team_id, a.subteam_id, st.team_id subteam_team_id
           from access_role_assignments a left join subteams st on st.id = a.subteam_id
          where a.organization_id = $1 and a.user_account_id = any($2::uuid[]) and a.revoked_at is null`,
        [organizationId, accountIds],
      )).rows
      const byAccount = new Map<string, { roleCode: string; scope: AccessScope }[]>()
      for (const row of assignments) byAccount.set(row.user_account_id, [...(byAccount.get(row.user_account_id) ?? []), { roleCode: row.role_code, scope: toScope(row) }])
      return rows.map((row) => targetOf(row, row.account_id ? byAccount.get(row.account_id) ?? [] : []))
    },

    async networkLoginTaken(networkLogin) {
      return (await db.query<{ taken: boolean }>(`select ${matriculaDuplicatedSql("$1::text", null)} taken`, [networkLogin])).rows[0]?.taken === true
    },

    async matriculaInOtherOrganization(organizationId, networkLogin) {
      const result = await db.query<{ found: boolean }>(`select exists (select 1 from people p where p.organization_id <> $1 and p.matricula is not null and upper(btrim(p.matricula)) = $2) found`, [organizationId, networkLogin])
      return result.rows[0]?.found === true
    },

    async emailsInUse(emails) {
      if (emails.length === 0) return new Set()
      const result = await db.query<{ email: string }>(`select lower(email) email from user_accounts where lower(email) = any($1::text[])`, [emails])
      return new Set(result.rows.map((row) => row.email))
    },

    async similarMatriculas(organizationId, visibility, networkLogins) {
      if (networkLogins.length === 0) return new Map()
      const result = await db.query<{ wanted: string; matriculas: string[] }>(
        `select t.wanted, (array_agg(distinct btrim(p.matricula) order by btrim(p.matricula)))[1:5] matriculas
           from unnest($5::text[]) t(wanted)
           join people p on p.organization_id = $1 and p.active and p.matricula is not null and ($2::boolean or p.team_id = any($3::uuid[]) or p.subteam_id = any($4::uuid[]))
                        and ${DIGITS_SQL("p.matricula")} = ${DIGITS_SQL("t.wanted")} and upper(btrim(p.matricula)) <> t.wanted
          where length(${DIGITS_SQL("t.wanted")}) >= 3
          group by t.wanted`,
        [organizationId, visibility.organizationWide, visibility.teamIds, visibility.subteamIds, networkLogins],
      )
      return new Map(result.rows.map((row) => [row.wanted, row.matriculas]))
    },

    async disable(input) {
      const id = await write(withAudit(
        `with changed as (
           update user_accounts
              set active = false, access_disabled_at = $4, directory_login = null, password_change_required = false, temporary_password_issued_at = null, temporary_password_expires_at = null,
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
