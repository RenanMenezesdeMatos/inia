import type { SqlParams } from "../../../shared/infrastructure/sql-params.js"
import type { Permission } from "../domain/permissions.js"
import { rolesWithPermission } from "../domain/roles.js"

/**
 * ALCANCE de uma permissão em PESSOAS — projeção explícita do módulo de acesso para consultas analíticas (Monitoria de
 * usabilidade). Mesma regra das demais telas: UNIÃO das atribuições ATIVAS da conta com a permissão — organização inteira,
 * Grupo, Subgrupo ou "Minha estrutura" (subárvore por reports_to). Cargo nunca entra. Conta/pessoa inativa = nada.
 * O recorte é sempre pela estrutura ATUAL de cada pessoa (escopo vigente do observador).
 *
 * `scopedPeopleSql` devolve um SELECT de uma coluna `person_id` (inclui pessoas inativas do alcance — o chamador decide).
 */
export function scopedPeopleSql(p: SqlParams, input: { organizationId: string; viewerPersonId: string; permission: Permission }): string {
  const org = p.typed(input.organizationId, "uuid")
  const viewer = p.typed(input.viewerPersonId, "uuid")
  const roles = p.typed(rolesWithPermission(input.permission), "text[]")
  const assignment = (scopeClause: string) => `exists (select 1 from access_role_assignments a join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
        join people gp on gp.id = ua.person_id and gp.active
        where a.organization_id = ${org} and ua.person_id = ${viewer} and a.revoked_at is null and a.role_code = any(${roles}) and ${scopeClause})`
  // UNIÃO de dois ramos (nunca `OR` com a subárvore): com o OR o planejador estimava a subárvore recursiva por linha e escolhia
  // planos quadráticos. O ramo "Minha estrutura" só é calculado se existir a atribuição (filtro avaliado uma vez).
  return `select pe.id person_id from people pe
    where pe.organization_id = ${org}
      and ${assignment(`(a.scope_type = 'ORGANIZATION' or (a.scope_type = 'GROUP' and a.team_id = pe.team_id) or (a.scope_type = 'SUBGROUP' and a.subteam_id = pe.subteam_id))`)}
    union
    select sub.id from (with recursive sub(id, depth) as (
        select x.id, 1 from people x where x.organization_id = ${org} and x.reports_to_id = ${viewer}
        union select x.id, s.depth + 1 from people x join sub s on x.reports_to_id = s.id where s.depth < 32
      ) select id from sub) sub
    where ${assignment(`a.scope_type = 'MY_STRUCTURE'`)}`
}

/** Papéis de acesso VIGENTES por conta (perfil de acesso ≠ cargo) — colunas account_id, role_code. */
export function activeAccountRolesSql(p: SqlParams, organizationId: string): string {
  return `select a.user_account_id account_id, a.role_code from access_role_assignments a where a.organization_id = ${p.typed(organizationId, "uuid")} and a.revoked_at is null`
}
