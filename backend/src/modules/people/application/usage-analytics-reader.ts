import type { Database } from "../../../infrastructure/database/pool.js"
import type { SqlParams } from "../../../shared/infrastructure/sql-params.js"

/**
 * LEITOR ANALÍTICO do cadastro de pessoas e contas — projeção explícita usada pela Monitoria de usabilidade (o módulo de uso
 * nunca lê `people`/`user_accounts` por conta própria). Estado ATUAL; não existe histórico de vínculo antes da monitoria.
 *
 * Colunas de `populationSql`: person_id, name, matricula, job_title, level, person_active, employment_status, team_id,
 * team_name, subteam_id, subteam_name, reports_to_id, hired_at, person_created_at, account_id, account_active,
 * account_created_at, last_login_at.
 */
type Queryable = Pick<Database, "query">

export function populationSql(p: SqlParams, organizationId: string): string {
  return `select pe.id person_id, pe.name, pe.matricula, pe.job_title, pe.role level, pe.active person_active,
      pe.current_employment_status employment_status, pe.team_id, t.name team_name, pe.subteam_id, st.name subteam_name,
      pe.reports_to_id, pe.hired_at, pe.created_at person_created_at,
      ua.id account_id, ua.active account_active, ua.created_at account_created_at, ua.last_login_at
    from people pe
    left join teams t on t.id = pe.team_id
    left join subteams st on st.id = pe.subteam_id
    left join user_accounts ua on ua.person_id = pe.id and ua.organization_id = pe.organization_id
    where pe.organization_id = ${p.typed(organizationId, "uuid")}`
}

export type PersonPlacement = { personId: string; teamId: string | null; subteamId: string | null; reportsToId: string | null; active: boolean; accountId: string | null }

export async function loadPersonPlacements(db: Queryable, organizationId: string, personIds: readonly string[]): Promise<Map<string, PersonPlacement>> {
  if (personIds.length === 0) return new Map()
  const result = await db.query<{ id: string; team_id: string | null; subteam_id: string | null; reports_to_id: string | null; active: boolean; account_id: string | null }>(
    `select pe.id, pe.team_id, pe.subteam_id, pe.reports_to_id, pe.active, ua.id account_id
     from people pe left join user_accounts ua on ua.person_id = pe.id
     where pe.organization_id = $1 and pe.id = any($2::uuid[])`,
    [organizationId, [...new Set(personIds)]],
  )
  return new Map(result.rows.map((row) => [row.id, { personId: row.id, teamId: row.team_id, subteamId: row.subteam_id, reportsToId: row.reports_to_id, active: row.active, accountId: row.account_id }]))
}

/** Ancestrais (cadeia de gestão por reports_to, com guarda de ciclo) de cada pessoa pedida. */
export async function loadAncestors(db: Queryable, organizationId: string, personIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const unique = [...new Set(personIds)]
  if (unique.length === 0) return new Map()
  const result = await db.query<{ origin: string; ancestor: string }>(
    `with recursive chain(origin, ancestor, depth) as (
       select pe.id, pe.reports_to_id, 1 from people pe where pe.organization_id = $1 and pe.id = any($2::uuid[]) and pe.reports_to_id is not null
       union
       select c.origin, pe.reports_to_id, c.depth + 1 from chain c join people pe on pe.id = c.ancestor
       where pe.reports_to_id is not null and c.depth < 32
     ) select origin, ancestor from chain`,
    [organizationId, unique],
  )
  const map = new Map<string, Set<string>>(unique.map((id) => [id, new Set<string>()]))
  for (const row of result.rows) map.get(row.origin)?.add(row.ancestor)
  return map
}

/** Subárvore (reports_to) abaixo de uma pessoa — inclui inativos no caminho, guarda de ciclo. */
export function descendantsSql(p: SqlParams, organizationId: string, rootPersonId: string): string {
  return `with recursive descendants(id, depth) as (
      select pe.id, 1 from people pe where pe.organization_id = ${p.typed(organizationId, "uuid")} and pe.reports_to_id = ${p.typed(rootPersonId, "uuid")}
      union
      select pe.id, d.depth + 1 from people pe join descendants d on pe.reports_to_id = d.id where d.depth < 32
    ) select id from descendants`
}

/** Organização e pessoa de uma conta (fato de login: a conta vem da resposta do próprio login). */
export async function accountIdentity(db: Queryable, accountId: string): Promise<{ organizationId: string; personId: string } | null> {
  const result = await db.query<{ organization_id: string; person_id: string }>(`select organization_id, person_id from user_accounts where id = $1`, [accountId])
  const row = result.rows[0]
  return row ? { organizationId: row.organization_id, personId: row.person_id } : null
}
