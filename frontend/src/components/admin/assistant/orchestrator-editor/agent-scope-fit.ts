import { linksFromScopeValue, type ScopeLinksValue } from "@/lib/scope-links/scope-links"

/** Alcance de um Agent como a API devolve: ALL_TEAMS, GROUPS + `scopeLinks` (249) ou o legado TEAM/SUBTEAM + ids. */
export type AgentScopeLike = {
  scopeType: string
  teamId?: string | null
  subteamId?: string | null
  scopeLinks?: readonly { teamId: string; subteamId: string | null }[] | null
}

type TeamTree = readonly { id: string; subteams: readonly { id: string }[] }[]

/** Grupos efetivos do Agent (Subgrupo → Grupo-pai); null = "Todos os Grupos". */
function agentGroups(agent: AgentScopeLike, teams: TeamTree): Set<string> | null {
  if (agent.scopeType === "ALL_TEAMS") return null
  if (agent.scopeType === "TEAM") return new Set(agent.teamId ? [agent.teamId] : [])
  if (agent.scopeType === "SUBTEAM") {
    const parent = agent.teamId ?? teams.find((team) => team.subteams.some((subteam) => subteam.id === agent.subteamId))?.id ?? null
    return new Set(parent ? [parent] : [])
  }
  return new Set((agent.scopeLinks ?? []).map((link) => link.teamId))
}

/**
 * O Agent pode ser usado por um Orquestrador com este alcance? Espelha `scopesAreCompatible` do backend (manageable-scopes.ts), que
 * decide de verdade na gravação (422 ORCHESTRATOR_AGENT_SCOPE_FORBIDDEN): Agent de "Todos os Grupos" sempre serve; Orquestrador de
 * "Todos os Grupos" só usa Agent de "Todos os Grupos"; com vínculos, cada Grupo do Orquestrador (o Grupo-pai, no vínculo de Subgrupo)
 * precisa estar entre os Grupos do Agent. Sem nenhum Grupo escolhido ainda, só os de "Todos os Grupos" aparecem.
 */
export function agentServesOrchestratorScope(scope: ScopeLinksValue, agent: AgentScopeLike, teams: TeamTree = []): boolean {
  const groups = agentGroups(agent, teams)
  if (groups === null) return true
  if (scope.global) return false
  const orchestratorTeams = [...new Set(linksFromScopeValue(scope).map((link) => link.teamId))]
  return orchestratorTeams.length > 0 && orchestratorTeams.every((teamId) => groups.has(teamId))
}

/**
 * Filtro de Grupo/Subgrupo da lista de Orquestradores aplicado às opções de Agent (o Agent aparece se alcança o Grupo/Subgrupo
 * filtrado). Vínculos (249): Grupo = algum vínculo naquele Grupo; Subgrupo = vínculo daquele Subgrupo ou do Grupo-pai inteiro.
 * Formato legado: `legacyFits` (a regra antiga da hierarquia).
 */
export function agentFitsListScope(agent: AgentScopeLike, filter: { teamId?: string | undefined; subteamId?: string | undefined }, teams: TeamTree, legacyFits: () => boolean): boolean {
  if (!filter.teamId && !filter.subteamId) return true
  if (agent.scopeType === "ALL_TEAMS") return true
  if (agent.scopeType !== "GROUPS") return legacyFits()
  const parentOfFiltered = filter.subteamId ? teams.find((team) => team.subteams.some((subteam) => subteam.id === filter.subteamId))?.id : undefined
  return (agent.scopeLinks ?? []).some((link) =>
    filter.subteamId ? link.subteamId === filter.subteamId || (link.subteamId === null && link.teamId === parentOfFiltered) : link.teamId === filter.teamId,
  )
}
