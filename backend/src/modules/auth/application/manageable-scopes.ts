import type { Database } from "../../../infrastructure/database/pool.js"
import type { SqlFilter } from "../../../shared/presentation/list-query.js"
import { scopesWithPermission } from "../../access/domain/access-decision.js"
import type { Permission } from "../../access/domain/permissions.js"
import { scopeLinkProblems, sortLinks, type ScopeLink } from "../../../shared/domain/scope-links/scope-links.js"
import { createPostgresAccessRepository } from "../../access/infrastructure/postgres-access-repository.js"

export type ManageableScopes =
  | { unrestricted: true }
  | { unrestricted: false; allTeams: boolean; teamIds: Set<string>; subteamIds: Set<string> }

/**
 * Alcance de um recurso: `ALL_TEAMS` (todos os Grupos e Subgrupos — do universo do recurso, quando ele tem universo), o legado de
 * vínculo único `TEAM`/`SUBTEAM` e `GROUPS` = vários vínculos (`links`, Grupo inteiro ou Subgrupo — 23/11/2026, Agentes, Orquestradores
 * e Workflows). Em `GROUPS`, `teamId`/`subteamId` ficam nulos: a verdade são os vínculos.
 */
export type ScopedTarget = { scopeType: string; teamId: string | null; subteamId: string | null; links?: readonly ScopeLink[] | undefined }

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
  if (target.scopeType === "GROUPS") return canManageAllLinks(scopes, target.links ?? [])
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
  if (target.scopeType === "GROUPS") {
    const links = await normalizeScopeLinks(db, organizationId, target.links ?? [])
    if (!links || links.length === 0 || scopeLinkProblems(links).length > 0) return null
    return { scopeType: "GROUPS", teamId: null, subteamId: null, links: sortLinks(links) }
  }
  if (target.scopeType !== "SUBTEAM" || !target.subteamId) return null
  const parent = await db.query<{ team_id: string }>(`select team_id from subteams where id = $1 and organization_id = $2`, [target.subteamId, organizationId])
  const teamId = parent.rows[0]?.team_id
  if (!teamId || (target.teamId !== null && target.teamId !== teamId)) return null
  return { scopeType: "SUBTEAM", teamId, subteamId: target.subteamId }
}

/** Grupos efetivos do alcance (Subgrupo → Grupo-pai). ALL_TEAMS não tem Grupo efetivo — tratado à parte em scopesAreCompatible. */
async function effectiveTeamIds(db: Pick<Database, "query">, target: ScopedTarget): Promise<string[]> {
  if (target.scopeType === "GROUPS") return [...new Set((target.links ?? []).map((link) => link.teamId))]
  if (target.scopeType === "TEAM") return target.teamId ? [target.teamId] : []
  if (target.scopeType === "SUBTEAM") {
    if (!target.subteamId) return []
    const result = await db.query<{ team_id: string }>(`select team_id from subteams where id = $1`, [target.subteamId])
    return result.rows[0]?.team_id ? [result.rows[0].team_id] : []
  }
  return []
}

/**
 * Um recurso B (`referenced` — ex.: um Orchestrator) só pode ser referenciado por um recurso A
 * (`referencer` — ex.: o Workflow que o chama num node) se isso nunca puder vazar dado/ação
 * entre grupos: B global (ALL_TEAMS) sempre serve; A global só pode referenciar B também global
 * (senão o Workflow dispararia pra gente de fora do grupo de B); fora isso, os dois precisam
 * resolver pro MESMO time efetivo (SUBTEAM resolve pro time-pai) — nunca comparamos apenas o
 * `scopeType`, sempre o grupo real por trás dele. Com vários vínculos (`GROUPS`), cada Grupo efetivo de A precisa estar entre os de B
 * (A nunca alcança um Grupo que B não atende). Mesma função serve tanto pra validar o publish
 * de um Workflow (Orchestrator referenciado) quanto os especialistas de um Orchestrator (Agent
 * referenciado) e a troca de Abrangência de um Workflow existente.
 */
export async function scopesAreCompatible(db: Pick<Database, "query">, referencer: ScopedTarget, referenced: ScopedTarget): Promise<boolean> {
  if (referenced.scopeType === "ALL_TEAMS") return true
  if (referencer.scopeType === "ALL_TEAMS") return false
  const [referencerTeams, referencedTeams] = await Promise.all([effectiveTeamIds(db, referencer), effectiveTeamIds(db, referenced)])
  return referencerTeams.length > 0 && referencerTeams.every((teamId) => referencedTeams.includes(teamId))
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

/**
 * VÍNCULOS DE ALCANCE (multi-grupo, `shared/domain/scope-links`) recebidos numa ESCRITA: cada Subgrupo ganha o Grupo-pai REAL (na
 * organização); Grupo inexistente na organização, Subgrupo inexistente ou `teamId` enviado que não é o pai = `null` (422 no chamador).
 * Uma consulta só, qualquer que seja o número de vínculos.
 */
export async function normalizeScopeLinks(
  db: Pick<Database, "query">,
  organizationId: string,
  links: readonly { teamId?: string | null; subteamId?: string | null }[],
): Promise<{ teamId: string; subteamId: string | null }[] | null> {
  if (links.length === 0) return []
  const teamIds = [...new Set(links.flatMap((link) => (link.teamId ? [link.teamId] : [])))]
  const subteamIds = [...new Set(links.flatMap((link) => (link.subteamId ? [link.subteamId] : [])))]
  const [teams, subteams] = await Promise.all([
    db.query<{ id: string }>(`select id from teams where id = any($1::uuid[]) and organization_id = $2`, [teamIds, organizationId]),
    db.query<{ id: string; team_id: string }>(`select st.id, st.team_id from subteams st join teams t on t.id = st.team_id where st.id = any($1::uuid[]) and t.organization_id = $2`, [subteamIds, organizationId]),
  ])
  const knownTeams = new Set(teams.rows.map((row) => row.id))
  const parentOf = new Map(subteams.rows.map((row) => [row.id, row.team_id]))
  const normalized: { teamId: string; subteamId: string | null }[] = []
  for (const link of links) {
    if (link.subteamId) {
      const parent = parentOf.get(link.subteamId)
      if (!parent || (link.teamId && link.teamId !== parent)) return null
      normalized.push({ teamId: parent, subteamId: link.subteamId })
    } else {
      if (!link.teamId || !knownTeams.has(link.teamId)) return null
      normalized.push({ teamId: link.teamId, subteamId: null })
    }
  }
  return normalized
}

/** O vínculo está no escopo de gestão? Grupo inteiro exige o Grupo; Subgrupo exige o Subgrupo (ou o Grupo dele, que já o inclui). */
export function canManageLink(scopes: ManageableScopes, link: { teamId: string; subteamId: string | null }): boolean {
  return canManageScope(scopes, link.subteamId ? { scopeType: "SUBTEAM", teamId: link.teamId, subteamId: link.subteamId } : { scopeType: "TEAM", teamId: link.teamId, subteamId: null })
}

/**
 * Política de ESCRITA de conteúdo compartilhado (a mesma que a Base de Conhecimento já aplicava — A-F02): alterar texto, publicar ou
 * mexer nos vínculos exige que TODOS os vínculos — os atuais e os novos — estejam no escopo de quem altera. Um gestor de parte dos
 * Grupos não altera conteúdo que também vale para Grupos que ele não administra (nem remove esses vínculos). Sem vínculo nenhum
 * (conteúdo global) = só escopo de organização.
 */
export function canManageAllLinks(scopes: ManageableScopes, links: readonly { teamId: string; subteamId: string | null }[]): boolean {
  if (scopes.unrestricted || scopes.allTeams) return true
  return links.length > 0 && links.every((link) => canManageLink(scopes, link))
}

/**
 * Algum vínculo no escopo (para LER/listar o que também vale para os Grupos de quem administra). `parentTeams` = Grupos-pai dos
 * Subgrupos administrados: o vínculo de Grupo inteiro também vale para eles, então quem administra só o Subgrupo o enxerga (sem editar).
 */
export function canSeeAnyLink(scopes: ManageableScopes, links: readonly { teamId: string; subteamId: string | null }[], parentTeams: ReadonlySet<string> = new Set()): boolean {
  if (scopes.unrestricted || scopes.allTeams) return true
  return links.some((link) => canManageLink(scopes, link) || (link.subteamId === null && parentTeams.has(link.teamId)))
}

export type ScopeLinkWriteFailure = "INVALID" | "DUPLICATE" | "REDUNDANT" | "EMPTY" | "FORBIDDEN"

/**
 * Vínculos de uma ESCRITA, prontos para gravar: Grupo-pai real de cada Subgrupo, sem duplicata, sem Subgrupo de um Grupo que já está
 * inteiro, ao menos um, e todos no escopo de gestão de quem escreve. Mesma validação nas quatro entidades (cada uma traduz a falha no
 * próprio código de erro). Ordem estável (`sortLinks`).
 */
export async function resolveScopeLinksForWrite(
  db: Pick<Database, "query">,
  organizationId: string,
  scopes: ManageableScopes,
  links: readonly { teamId?: string | null; subteamId?: string | null }[],
): Promise<{ ok: true; links: ScopeLink[] } | { ok: false; reason: ScopeLinkWriteFailure }> {
  if (links.length === 0) return { ok: false, reason: "EMPTY" }
  const normalized = await normalizeScopeLinks(db, organizationId, links)
  if (!normalized) return { ok: false, reason: "INVALID" }
  const problems = scopeLinkProblems(normalized)
  if (problems.some((problem) => problem.code === "DUPLICATE")) return { ok: false, reason: "DUPLICATE" }
  if (problems.length > 0) return { ok: false, reason: "REDUNDANT" }
  if (!normalized.every((link) => canManageLink(scopes, link))) return { ok: false, reason: "FORBIDDEN" }
  return { ok: true, links: sortLinks(normalized) }
}

export const SCOPE_LINK_FAILURE_MESSAGE: Record<ScopeLinkWriteFailure, string> = {
  INVALID: "Grupo ou Subgrupo não encontrado (o Subgrupo precisa pertencer ao Grupo informado).",
  DUPLICATE: "O mesmo Grupo/Subgrupo foi informado mais de uma vez.",
  REDUNDANT: "Um Subgrupo foi informado junto com o Grupo inteiro dele: escolha o Grupo inteiro OU os Subgrupos.",
  EMPTY: "Escolha ao menos um Grupo.",
  FORBIDDEN: "Seu escopo de administração não cobre todos os Grupos/Subgrupos escolhidos.",
}
