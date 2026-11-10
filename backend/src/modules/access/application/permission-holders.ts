import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessScope } from "../domain/access-scope.js"
import type { Permission } from "../domain/permissions.js"
import { rolesWithPermission, systemRoleCatalog, type RoleCatalog } from "../domain/roles.js"

/**
 * V1.5.8 — DESTINATÁRIOS de um aviso administrativo da organização inteira: as pessoas cuja CONTA ATIVA tem a permissão
 * com escopo ORGANIZATION (atribuição ativa, pessoa ativa). Substitui "quem tem people.role = ADMIN": o nível hierárquico
 * nunca decide quem recebe informação administrativa. Ordenado por id (determinístico, dedupe estável).
 */
export async function personIdsWithOrganizationWidePermission(db: Pick<Database, "query">, organizationId: string, permission: Permission, catalog: RoleCatalog = systemRoleCatalog): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `select distinct p.id from access_role_assignments a
     join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
     join people p on p.id = ua.person_id and p.active
     where a.organization_id = $1 and a.revoked_at is null and a.scope_type = 'ORGANIZATION' and a.role_code = any($2::text[])
     order by p.id`,
    [organizationId, rolesWithPermission(permission, catalog)],
  )
  return result.rows.map((row) => row.id)
}

/**
 * Quem tem a permissão COBRINDO o lugar de uma pessoa (o Grupo e o Subgrupo dela): organização cobre todos; Grupo cobre o próprio
 * Grupo e todos os Subgrupos dele; Subgrupo só a si; "Minha estrutura" nunca (é relativa a quem recebe). Pessoa sem Subgrupo é coberta
 * por organização ou pelo Grupo dela; sem Grupo, só por organização. `teamId` = o Grupo da pessoa (o do Subgrupo dela, quando há).
 * Atribuição ativa, conta e pessoa ativas. Quem chama exclui a própria pessoa quando precisar (Apoio com Anjo: o operador).
 */
export async function personIdsWithPermissionCovering(
  db: Pick<Database, "query">,
  organizationId: string,
  permission: Permission,
  place: { teamId: string | null; subteamId: string | null },
  catalog: RoleCatalog = systemRoleCatalog,
): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `select distinct p.id from access_role_assignments a
     join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
     join people p on p.id = ua.person_id and p.active
     where a.organization_id = $1 and a.revoked_at is null and a.role_code = any($2::text[])
       and (a.scope_type = 'ORGANIZATION'
            or (a.scope_type = 'GROUP' and $3::uuid is not null and a.team_id = $3::uuid)
            or (a.scope_type = 'SUBGROUP' and $4::uuid is not null and a.subteam_id = $4::uuid))
     order by p.id`,
    [organizationId, rolesWithPermission(permission, catalog), place.teamId, place.subteamId],
  )
  return result.rows.map((row) => row.id)
}

/**
 * Os escopos em que cada pessoa tem a permissão (atribuições ativas, conta e pessoa ativas), sem "Minha estrutura". Pessoa sem
 * nenhum = ausente do mapa. Usado pelo Apoio com Anjo para saber quem um Anjo atende e o alcance do Coordenador sobre ele (D11).
 */
export async function assignmentScopesOf(
  db: Pick<Database, "query">,
  organizationId: string,
  permission: Permission,
  personIds: readonly string[],
  catalog: RoleCatalog = systemRoleCatalog,
): Promise<Map<string, AccessScope[]>> {
  if (personIds.length === 0) return new Map()
  const result = await db.query<{ person_id: string; scope_type: "ORGANIZATION" | "GROUP" | "SUBGROUP"; team_id: string | null; subteam_id: string | null; subteam_team_id: string | null }>(
    `select distinct p.id person_id, a.scope_type, a.team_id, a.subteam_id, st.team_id subteam_team_id
       from access_role_assignments a
       join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
       join people p on p.id = ua.person_id and p.active
       left join subteams st on st.id = a.subteam_id
      where a.organization_id = $1 and a.revoked_at is null and a.role_code = any($2::text[]) and a.scope_type <> 'MY_STRUCTURE'
        and p.id = any($3::uuid[])
      order by p.id, a.scope_type, a.team_id, a.subteam_id`,
    [organizationId, rolesWithPermission(permission, catalog), [...personIds]],
  )
  const scopes = new Map<string, AccessScope[]>()
  for (const row of result.rows) {
    const scope: AccessScope | null =
      row.scope_type === "ORGANIZATION" ? { type: "ORGANIZATION" }
      : row.scope_type === "GROUP" && row.team_id ? { type: "GROUP", teamId: row.team_id }
      : row.scope_type === "SUBGROUP" && row.subteam_id && row.subteam_team_id ? { type: "SUBGROUP", subteamId: row.subteam_id, teamId: row.subteam_team_id }
      : null
    if (!scope) continue
    const list = scopes.get(row.person_id) ?? []
    list.push(scope)
    scopes.set(row.person_id, list)
  }
  return scopes
}

/**
 * Titulares da permissão COM a situação cadastral (para painéis que precisam mostrar também quem está inativo): atribuição não
 * revogada, fora de "Minha estrutura", com os escopos e `active` = pessoa ativa e alguma conta ativa e com acesso liberado. Só para
 * LEITURA de painel — quem decide acesso continua usando os ajudantes acima, que só consideram titulares ativos.
 */
export async function permissionHoldersWithSituation(db: Pick<Database, "query">, organizationId: string, permission: Permission, catalog: RoleCatalog = systemRoleCatalog): Promise<Map<string, { active: boolean; scopes: AccessScope[] }>> {
  const result = await db.query<{ person_id: string; scope_type: "ORGANIZATION" | "GROUP" | "SUBGROUP"; team_id: string | null; subteam_id: string | null; subteam_team_id: string | null; active: boolean }>(
    `select p.id person_id, a.scope_type, a.team_id, a.subteam_id, st.team_id subteam_team_id,
            (p.active and ua.active and ua.access_disabled_at is null) active
       from access_role_assignments a
       join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id
       join people p on p.id = ua.person_id
       left join subteams st on st.id = a.subteam_id
      where a.organization_id = $1 and a.revoked_at is null and a.role_code = any($2::text[]) and a.scope_type <> 'MY_STRUCTURE'
      order by p.id, a.scope_type, a.team_id, a.subteam_id`,
    [organizationId, rolesWithPermission(permission, catalog)],
  )
  const holders = new Map<string, { active: boolean; scopes: AccessScope[] }>()
  for (const row of result.rows) {
    const entry = holders.get(row.person_id) ?? { active: false, scopes: [] }
    entry.active = entry.active || row.active
    const scope: AccessScope | null =
      row.scope_type === "ORGANIZATION" ? { type: "ORGANIZATION" }
      : row.scope_type === "GROUP" && row.team_id ? { type: "GROUP", teamId: row.team_id }
      : row.scope_type === "SUBGROUP" && row.subteam_id && row.subteam_team_id ? { type: "SUBGROUP", subteamId: row.subteam_id, teamId: row.subteam_team_id }
      : null
    const key = (value: AccessScope) => JSON.stringify(value)
    if (scope && !entry.scopes.some((existing) => key(existing) === key(scope))) entry.scopes.push(scope)
    holders.set(row.person_id, entry)
  }
  return holders
}

/** Todas as pessoas com a permissão em algum escopo que não seja "Minha estrutura" (atribuição, conta e pessoa ativas). */
export async function personIdsWithPermission(db: Pick<Database, "query">, organizationId: string, permission: Permission, catalog: RoleCatalog = systemRoleCatalog): Promise<string[]> {
  const result = await db.query<{ id: string }>(
    `select distinct p.id from access_role_assignments a
     join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
     join people p on p.id = ua.person_id and p.active
     where a.organization_id = $1 and a.revoked_at is null and a.scope_type <> 'MY_STRUCTURE' and a.role_code = any($2::text[])
     order by p.id`,
    [organizationId, rolesWithPermission(permission, catalog)],
  )
  return result.rows.map((row) => row.id)
}
