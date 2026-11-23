import { linkReaches, sortLinks, type ScopeLink, type ScopePosition } from "./scope-links.js"

/**
 * ALCANCE DE UM RECURSO CONFIGURÁVEL (Agente, Orquestrador, Workflow — migration 249; Indicador e Produto — 250), 23/11/2026:
 *
 *   ALL_TEAMS → todos os Grupos e Subgrupos (do universo do recurso, quando ele tem universo: os consumidores aplicam o universo por
 *               cima, como sempre), inclusive os criados depois. Nunca é "sem vínculo".
 *   GROUPS    → só os vínculos: cada um é um Grupo inteiro ou UM Subgrupo (com o Grupo-pai real). Subgrupo não leva os irmãos.
 *
 * Formato legado (TEAM/SUBTEAM + `teamId`/`subteamId`) ainda aparece em snapshots de versão e rascunhos anteriores à 249; `resourceScopeOf`
 * o converte com o mesmo alcance (SUBTEAM sem Grupo-pai conhecido continua sem alcance — nunca vira global).
 */
export type ResourceScope = { scopeType: "ALL_TEAMS"; links: [] } | { scopeType: "GROUPS"; links: ScopeLink[] }

export const ALL_TEAMS_SCOPE: ResourceScope = { scopeType: "ALL_TEAMS", links: [] }

type ScopeLike = { scopeType?: string | null; teamId?: string | null; subteamId?: string | null; scopeLinks?: readonly { teamId?: string | null; subteamId?: string | null }[] | null; links?: readonly { teamId?: string | null; subteamId?: string | null }[] | null }

/** Qualquer formato (novo ou legado, de coluna ou de JSON) → alcance. `parentOf` resolve o Grupo-pai de um SUBTEAM legado sem `teamId`. */
export function resourceScopeOf(input: ScopeLike | null | undefined, parentOf?: (subteamId: string) => string | null | undefined): ResourceScope {
  if (!input || input.scopeType === "ALL_TEAMS") return ALL_TEAMS_SCOPE
  if (input.scopeType === "TEAM") return input.teamId ? { scopeType: "GROUPS", links: [{ teamId: input.teamId, subteamId: null }] } : { scopeType: "GROUPS", links: [] }
  if (input.scopeType === "SUBTEAM") {
    const teamId = input.teamId ?? (input.subteamId ? parentOf?.(input.subteamId) : null) ?? null
    return input.subteamId && teamId ? { scopeType: "GROUPS", links: [{ teamId, subteamId: input.subteamId }] } : { scopeType: "GROUPS", links: [] }
  }
  const raw = input.scopeLinks ?? input.links ?? []
  return { scopeType: "GROUPS", links: sortLinks(raw.flatMap((link) => (link.teamId ? [{ teamId: link.teamId, subteamId: link.subteamId ?? null }] : []))) }
}

/** O recurso alcança a pessoa (pelo cadastro dela)? ALL_TEAMS = sim (o universo é aplicado por quem consome). */
export function resourceScopeReaches(scope: ResourceScope, position: ScopePosition): boolean {
  return scope.scopeType === "ALL_TEAMS" || scope.links.some((link) => linkReaches(link, position))
}

/**
 * Especificidade do alcance PARA AQUELA PESSOA: 2 = um Subgrupo dela, 1 = o Grupo dela inteiro, 0 = todos os Grupos, null = não alcança.
 * Com vários vínculos, a precedência entre recursos (ex.: o Orquestrador mais específico vence) usa o vínculo que alcança a pessoa.
 */
export function resourceScopeSpecificity(scope: ResourceScope, position: ScopePosition): 0 | 1 | 2 | null {
  if (scope.scopeType === "ALL_TEAMS") return 0
  if (scope.links.some((link) => link.subteamId !== null && linkReaches(link, position))) return 2
  if (scope.links.some((link) => link.subteamId === null && linkReaches(link, position))) return 1
  return null
}

/** Formato do JSON de rascunho/snapshot (o mesmo campo `scopeLinks` em todos). */
export function resourceScopeJson(scope: ResourceScope) {
  return { scopeType: scope.scopeType, teamId: null, subteamId: null, scopeLinks: scope.links.map((link) => ({ teamId: link.teamId, subteamId: link.subteamId })) }
}

/**
 * SQL: o recurso alcança a pessoa? Um `exists` — o mesmo recurso alcançado por dois vínculos conta uma vez.
 *   scopeTypeExpr: coluna `scope_type` do recurso; ownerIdExpr: id do recurso; teamExpr/subteamExpr: Grupo e Subgrupo da pessoa.
 */
export function resourceScopeReachSql(options: { linksTable: ResourceScopeLinksTable; ownerIdExpr: string; scopeTypeExpr: string; teamExpr: string; subteamExpr: string }): string {
  const { table, ownerColumn } = RESOURCE_SCOPE_LINK_TABLES[options.linksTable]
  return `(${options.scopeTypeExpr} = 'ALL_TEAMS' or exists (select 1 from ${table} rsl where rsl.${ownerColumn} = ${options.ownerIdExpr} and ((rsl.subteam_id is null and rsl.team_id = ${options.teamExpr}) or rsl.subteam_id = ${options.subteamExpr})))`
}

/** Especificidade em SQL (2 Subgrupo, 1 Grupo inteiro, 0 todos, null não alcança) — para ordenar candidatos. */
export function resourceScopeSpecificitySql(options: { linksTable: ResourceScopeLinksTable; ownerIdExpr: string; scopeTypeExpr: string; teamExpr: string; subteamExpr: string }): string {
  const { table, ownerColumn } = RESOURCE_SCOPE_LINK_TABLES[options.linksTable]
  return `(case when ${options.scopeTypeExpr} = 'ALL_TEAMS' then 0
    when exists (select 1 from ${table} rsl where rsl.${ownerColumn} = ${options.ownerIdExpr} and rsl.subteam_id = ${options.subteamExpr}) then 2
    when exists (select 1 from ${table} rsl where rsl.${ownerColumn} = ${options.ownerIdExpr} and rsl.subteam_id is null and rsl.team_id = ${options.teamExpr}) then 1
    else null end)`
}

/** Vínculos em JSON agregados (para devolver junto da linha): `[{teamId, teamName, subteamId, subteamName}]`, ordem estável. */
export function resourceScopeLinksJsonSql(linksTable: ResourceScopeLinksTable, ownerIdExpr: string): string {
  const { table, ownerColumn } = RESOURCE_SCOPE_LINK_TABLES[linksTable]
  return `coalesce((select json_agg(json_build_object('teamId', rsl.team_id, 'teamName', t.name, 'subteamId', rsl.subteam_id, 'subteamName', st.name) order by t.name, rsl.team_id, st.name nulls first)
      from ${table} rsl join teams t on t.id = rsl.team_id left join subteams st on st.id = rsl.subteam_id where rsl.${ownerColumn} = ${ownerIdExpr}), '[]'::json)`
}

export const RESOURCE_SCOPE_LINK_TABLES = {
  AGENT: { table: "agent_scope_links", ownerColumn: "agent_id" },
  ORCHESTRATOR: { table: "assistant_orchestrator_scope_links", ownerColumn: "orchestrator_id" },
  WORKFLOW: { table: "workflow_scope_links", ownerColumn: "workflow_id" },
  INDICATOR: { table: "indicator_scope_links", ownerColumn: "indicator_id" },
  PRODUCT: { table: "product_operational_scope_links", ownerColumn: "product_node_id" },
} as const
export type ResourceScopeLinksTable = keyof typeof RESOURCE_SCOPE_LINK_TABLES
