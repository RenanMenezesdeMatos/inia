import { resourceScopeOf, type ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import { linkKey, sortLinks, type ScopeLink } from "../../../shared/domain/scope-links/scope-links.js"
import type { ScopedTarget } from "../../auth/application/manageable-scopes.js"

/**
 * ABRANGÊNCIA DO WORKFLOW (migration 249, 23/11/2026) — antes um escopo só (`TEAM`/`SUBTEAM` + `team_id`/`subteam_id`); agora:
 *
 *   ALL_TEAMS → todos os Grupos e Subgrupos do universo do Workflow, inclusive os criados depois (a população é resolvida a cada
 *               execução, nunca congelada na publicação);
 *   GROUPS    → só os vínculos: Grupo inteiro (`people.team_id`) ou UM Subgrupo (`people.subteam_id`; nunca os irmãos). GROUPS sem
 *               vínculo não alcança ninguém (nunca vira "todos").
 *
 * Onde mora: publicada em `workflows.scope_type` + `workflow_scope_links`; rascunho em `draft_scope_type` + `draft_scope_links` (jsonb);
 * snapshot da versão em `workflow_versions.scope_type` + `scope_links` (null nas versões anteriores à 249, que guardam
 * `team_id`/`subteam_id`). `WorkflowScopeInput` aceita os dois formatos: o legado (TEAM/SUBTEAM + ids) só aparece em snapshots antigos
 * e em dublês de teste, e mantém exatamente o alcance de antes.
 */
export type WorkflowScopeInput = {
  scopeType: string
  scopeLinks?: readonly { teamId: string | null; subteamId: string | null }[] | null | undefined
  teamId?: string | null | undefined
  subteamId?: string | null | undefined
}

/** Alcance como conjuntos que a população usa: Grupo inteiro casa por `team_id`, Subgrupo por `subteam_id`. `scope_type` desconhecido = ninguém. */
export type WorkflowReach = { all: boolean; wholeTeamIds: string[]; subteamIds: string[] }

export function workflowReachOf(input: WorkflowScopeInput): WorkflowReach {
  if (input.scopeType === "ALL_TEAMS") return { all: true, wholeTeamIds: [], subteamIds: [] }
  if (input.scopeType === "TEAM") return { all: false, wholeTeamIds: input.teamId ? [input.teamId] : [], subteamIds: [] }
  if (input.scopeType === "SUBTEAM") return { all: false, wholeTeamIds: [], subteamIds: input.subteamId ? [input.subteamId] : [] }
  if (input.scopeType !== "GROUPS") return { all: false, wholeTeamIds: [], subteamIds: [] }
  const links = input.scopeLinks ?? []
  return {
    all: false,
    wholeTeamIds: [...new Set(links.flatMap((link) => (link.teamId && !link.subteamId ? [link.teamId] : [])))],
    subteamIds: [...new Set(links.flatMap((link) => (link.subteamId ? [link.subteamId] : [])))],
  }
}

/** A Abrangência alcança a pessoa (pelo cadastro dela)? Mesma regra do SQL de população (`workflowReachSql`). */
export function workflowScopeReaches(input: WorkflowScopeInput, person: { teamId: string | null; subteamId: string | null }): boolean {
  const reach = workflowReachOf(input)
  if (reach.all) return true
  return (person.teamId !== null && reach.wholeTeamIds.includes(person.teamId)) || (person.subteamId !== null && reach.subteamIds.includes(person.subteamId))
}

/**
 * SQL: a pessoa `alias` está na Abrangência? Recebe os placeholders de `workflowReachParams` (todos, Grupos inteiros, Subgrupos). Uma
 * condição sobre a própria linha da pessoa — cada operador aparece uma vez, por mais vínculos que o alcancem.
 */
export function workflowReachSql(alias: string, placeholders: { all: string; wholeTeamIds: string; subteamIds: string }): string {
  return `(${placeholders.all}::boolean or coalesce(${alias}.team_id = any(${placeholders.wholeTeamIds}::uuid[]), false) or coalesce(${alias}.subteam_id = any(${placeholders.subteamIds}::uuid[]), false))`
}

export const workflowReachParams = (reach: WorkflowReach): [boolean, string[], string[]] => [reach.all, reach.wholeTeamIds, reach.subteamIds]

/** Abrangência → alcance do recurso (ALL_TEAMS ou GROUPS + vínculos). SUBTEAM legado sem Grupo-pai conhecido fica sem vínculo. */
export function workflowResourceScope(input: WorkflowScopeInput): ResourceScope {
  if (input.scopeType === "GROUPS") return resourceScopeOf({ scopeType: "GROUPS", scopeLinks: input.scopeLinks ?? [] })
  return resourceScopeOf({ scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null })
}

/**
 * Abrangência → `ScopedTarget` (gestão e compatibilidade com Agentes/Orquestradores: `canManageScope`, `scopesAreCompatible`). O legado
 * TEAM/SUBTEAM vai como está (as duas funções o entendem, inclusive SUBTEAM sem Grupo-pai, que elas resolvem pelo banco).
 */
export function workflowScopedTarget(input: WorkflowScopeInput): ScopedTarget {
  if (input.scopeType === "GROUPS") return { scopeType: "GROUPS", teamId: null, subteamId: null, links: workflowResourceScope(input).links }
  if (input.scopeType === "ALL_TEAMS") return { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }
  return { scopeType: input.scopeType, teamId: input.teamId ?? null, subteamId: input.subteamId ?? null }
}

/** Chave estável da Abrangência (comparar rascunho × publicada sem depender da ordem dos vínculos). */
export function workflowScopeKey(input: WorkflowScopeInput): string {
  if (input.scopeType === "ALL_TEAMS") return "ALL_TEAMS"
  if (input.scopeType === "GROUPS") return `GROUPS:${workflowResourceScope(input).links.map(linkKey).join("|")}`
  return `${input.scopeType}:${input.teamId ?? ""}:${input.subteamId ?? ""}`
}

/** Vínculos normalizados (ordem estável) para gravar no rascunho/snapshot. */
export const workflowScopeLinksJson = (links: readonly ScopeLink[]) => JSON.stringify(sortLinks(links).map((link) => ({ teamId: link.teamId, subteamId: link.subteamId })))

/** SQL: vínculos PUBLICADOS do Workflow `idExpr` em JSON (`[{teamId, subteamId}]`, ordem estável). */
export function workflowLiveScopeLinksSql(idExpr: string): string {
  return `coalesce((select json_agg(json_build_object('teamId', wsl.team_id, 'subteamId', wsl.subteam_id) order by wsl.team_id, wsl.subteam_id nulls first)
      from workflow_scope_links wsl where wsl.workflow_id = ${idExpr}), '[]'::json)`
}

/** SQL: vínculos (publicados ou de um jsonb de rascunho/snapshot) com os nomes, para a API: `[{teamId, teamName, subteamId, subteamName}]`. */
export function workflowJsonScopeLinksWithNamesSql(jsonExpr: string): string {
  return `coalesce((select jsonb_agg(jsonb_build_object('teamId', l ->> 'teamId', 'teamName', t.name, 'subteamId', l ->> 'subteamId', 'subteamName', st.name) order by t.name, l ->> 'teamId', st.name nulls first)
      from jsonb_array_elements(coalesce(${jsonExpr}, '[]'::jsonb)) l
      left join teams t on t.id = (l ->> 'teamId')::uuid
      left join subteams st on st.id = (l ->> 'subteamId')::uuid), '[]'::jsonb)`
}
