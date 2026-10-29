import type { Database } from "../../../infrastructure/database/pool.js"
import type { SqlFilter } from "../../../shared/presentation/list-query.js"
import { scopesWithPermission } from "../../access/domain/access-decision.js"
import type { Permission } from "../../access/domain/permissions.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"

export type ManageableScopes =
  | { unrestricted: true }
  | { unrestricted: false; allTeams: boolean; teamIds: Set<string>; subteamIds: Set<string> }

export type ScopedTarget = { scopeType: string; teamId: string | null; subteamId: string | null }

/**
 * V1.5.7 — escopos em que a CONTA da sessão tem uma permissão administrativa, derivados das ATRIBUIÇÕES DE PAPEL
 * (`access_role_assignments`, modules/access). Deny by default: sem atribuição com a permissão = nenhum escopo (o antigo
 * "pessoa sem atribuição = admin irrestrito" acabou; os admins legados viraram papéis explícitos na migration 081).
 * Organização → `allTeams`; Grupo → o Grupo e os Subgrupos dele; Subgrupo → só ele.
 */
export async function getManageableScopes(db: Database, user: { organizationId: string; sub: string }, permission: Permission): Promise<ManageableScopes> {
  const access = await createPostgresAccessRepository(db).loadContext(user.organizationId, user.sub)
  const scopes = scopesWithPermission(access, permission)
  const allTeams = scopes.some((scope) => scope.type === "ORGANIZATION")
  const teamIds = new Set(scopes.flatMap((scope) => (scope.type === "GROUP" ? [scope.teamId] : [])))
  const subteamIds = new Set(scopes.flatMap((scope) => (scope.type === "SUBGROUP" ? [scope.subteamId] : [])))
  if (!allTeams && teamIds.size > 0) {
    const childSubteams = await db.query<{ id: string }>(`select id from subteams where team_id = any($1::uuid[])`, [[...teamIds]])
    for (const row of childSubteams.rows) subteamIds.add(row.id)
  }
  return { unrestricted: false, allTeams, teamIds, subteamIds }
}

/** Escopo que cobre a organização inteira para a permissão pedida (ex.: recursos do tenant). */
export function coversOrganization(scopes: ManageableScopes): boolean {
  return scopes.unrestricted || scopes.allTeams
}

export function canManageScope(scopes: ManageableScopes, target: ScopedTarget): boolean {
  if (scopes.unrestricted || scopes.allTeams) return true
  if (target.scopeType === "ALL_TEAMS") return false
  if (target.scopeType === "TEAM") return target.teamId !== null && scopes.teamIds.has(target.teamId)
  if (target.scopeType === "SUBTEAM") return target.subteamId !== null && scopes.subteamIds.has(target.subteamId)
  return false
}

/**
 * Escopo-alvo de uma ESCRITA, normalizado antes de `canManageScope`: Subgrupo sempre com o Grupo-pai REAL (na organização
 * da sessão), TEAM sem Subgrupo, ALL_TEAMS sem ids. `null` = Subgrupo inexistente ou `teamId` enviado que não é o pai — sem
 * isso `canManageScope` autoriza pelo Subgrupo e o `team_id` de outro Grupo gravado passa a decidir o Grupo do recurso.
 */
export async function normalizeScopedTarget(db: Pick<Database, "query">, organizationId: string, target: ScopedTarget): Promise<ScopedTarget | null> {
  if (target.scopeType === "ALL_TEAMS") return { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }
  if (target.scopeType === "TEAM") return { scopeType: "TEAM", teamId: target.teamId, subteamId: null }
  if (target.scopeType !== "SUBTEAM" || !target.subteamId) return null
  const parent = await db.query<{ team_id: string }>(`select team_id from subteams where id = $1 and organization_id = $2`, [target.subteamId, organizationId])
  const teamId = parent.rows[0]?.team_id
  if (!teamId || (target.teamId !== null && target.teamId !== teamId)) return null
  return { scopeType: "SUBTEAM", teamId, subteamId: target.subteamId }
}

async function effectiveTeamId(db: Database, target: ScopedTarget): Promise<string | null> {
  if (target.scopeType === "TEAM") return target.teamId
  if (target.scopeType === "SUBTEAM") {
    if (!target.subteamId) return null
    const result = await db.query<{ team_id: string }>(`select team_id from subteams where id = $1`, [target.subteamId])
    return result.rows[0]?.team_id ?? null
  }
  return null // ALL_TEAMS não tem time efetivo — tratado à parte em scopesAreCompatible.
}

/**
 * Um recurso B (`referenced` — ex.: um Orchestrator) só pode ser referenciado por um recurso A
 * (`referencer` — ex.: o Workflow que o chama num node) se isso nunca puder vazar dado/ação
 * entre grupos: B global (ALL_TEAMS) sempre serve; A global só pode referenciar B também global
 * (senão o Workflow dispararia pra gente de fora do grupo de B); fora isso, os dois precisam
 * resolver pro MESMO time efetivo (SUBTEAM resolve pro time-pai) — nunca comparamos apenas o
 * `scopeType`, sempre o grupo real por trás dele. Mesma função serve tanto pra validar o publish
 * de um Workflow (Orchestrator referenciado) quanto os especialistas de um Orchestrator (Agent
 * referenciado) e a troca de Abrangência de um Workflow existente.
 */
export async function scopesAreCompatible(db: Database, referencer: ScopedTarget, referenced: ScopedTarget): Promise<boolean> {
  if (referenced.scopeType === "ALL_TEAMS") return true
  if (referencer.scopeType === "ALL_TEAMS") return false
  const [referencerTeam, referencedTeam] = await Promise.all([effectiveTeamId(db, referencer), effectiveTeamId(db, referenced)])
  return referencerTeam !== null && referencerTeam === referencedTeam
}

// Mesma regra de canManageScope, mas dentro do WHERE — a listagem paginada precisa filtrar no
// banco para o total e as páginas baterem, em vez de cortar em memória depois.
export function applyManageableScopeFilter(scopes: ManageableScopes, filter: SqlFilter, alias = "q") {
  if (scopes.unrestricted || scopes.allTeams) return
  const teamIds = filter.param([...scopes.teamIds])
  const subteamIds = filter.param([...scopes.subteamIds])
  filter.add(
    `((${alias}."scopeType" = 'TEAM' and ${alias}."teamId" = any(${teamIds}::uuid[])) or (${alias}."scopeType" = 'SUBTEAM' and ${alias}."subteamId" = any(${subteamIds}::uuid[])))`,
  )
}
