import type { Database } from "../../../infrastructure/database/pool.js"
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
