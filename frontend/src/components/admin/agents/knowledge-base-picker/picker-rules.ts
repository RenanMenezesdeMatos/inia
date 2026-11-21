import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"
import { fitsUniverse } from "@/lib/operating-universe/hierarchy"
import type { AgentKnowledgeScope, KnowledgeOption, KnowledgeOptionState } from "@/schemas/admin/agent-knowledge-options.schema"
import type { Team } from "@/schemas/admin/org-structure.schema"
import type { OperatingUniverse } from "@/schemas/operating-universe/operating-universe.schema"

/**
 * Regras do seletor de bases do Agent, puras. São só UX: o salvar do agente continua recusando base de outro universo
 * (`OPERATING_UNIVERSE_LINK_CONFLICT`) e de outro Grupo (`AGENT_KNOWLEDGE_SCOPE_FORBIDDEN`).
 */

/** Alcance do formulário → alcance que o servidor usa para oferecer bases. Grupo/Subgrupo ainda não escolhido = sem restrição. */
export function agentKnowledgeScopeOf(scope: OrgScopeValue): AgentKnowledgeScope | undefined {
  if (scope.scopeType === "ALL_TEAMS") return { scopeType: "ALL_TEAMS" }
  if (scope.scopeType === "TEAM") return scope.teamId ? { scopeType: "TEAM", teamId: scope.teamId } : undefined
  return scope.subteamId ? { scopeType: "SUBTEAM", subteamId: scope.subteamId, ...(scope.teamId ? { teamId: scope.teamId } : {}) } : undefined
}

/** Grupo do agente (o próprio ou o pai do Subgrupo). */
function agentTeamId(scope: AgentKnowledgeScope | undefined, teams: readonly Team[] | undefined): string | null {
  if (!scope || scope.scopeType === "ALL_TEAMS") return null
  if (scope.scopeType === "TEAM") return scope.teamId
  return scope.teamId ?? teams?.find((team) => (team.subteams ?? []).some((subteam) => subteam.id === scope.subteamId))?.id ?? null
}

/**
 * A base cabe no Grupo do agente? Agente de todos os Grupos (ou sem Grupo ainda) aceita qualquer uma; o de Grupo, global ou do mesmo Grupo.
 * Cópia da regra do servidor (`backend/src/modules/knowledge/application/knowledge-agent-fit.ts`) só para avisar antes de salvar; as duas
 * respondem o caderno `backend/src/modules/knowledge/testing/knowledge-agent-fit-cases.ts` (run-8, ARQ-03).
 */
export function fitsAgentScope(option: Pick<KnowledgeOption, "orgScopes">, scope: AgentKnowledgeScope | undefined, teams: readonly Team[] | undefined): boolean {
  const teamId = agentTeamId(scope, teams)
  if (!teamId) return true
  return option.orgScopes.some((entry) => entry.scopeType === "ALL_TEAMS" || entry.teamId === teamId)
}

export type OptionProblem = "OTHER_UNIVERSE" | "OTHER_GROUP"

/** O que impede salvar o agente com esta base ligada. */
export function optionProblems(option: Pick<KnowledgeOption, "orgScopes" | "operatingUniverse">, universe: OperatingUniverse | null, scope: AgentKnowledgeScope | undefined, teams: readonly Team[] | undefined): OptionProblem[] {
  const problems: OptionProblem[] = []
  if (!fitsUniverse(option.operatingUniverse, universe)) problems.push("OTHER_UNIVERSE")
  if (!fitsAgentScope(option, scope, teams)) problems.push("OTHER_GROUP")
  return problems
}

export const STATE_LABELS: Record<KnowledgeOptionState, string> = { IN_USE: "Em uso", ARCHIVED: "Arquivada", NO_VERSION: "Sem versão disponível" }
export const STATE_HINTS: Record<KnowledgeOptionState, string> = {
  IN_USE: "O agente consulta a versão em uso.",
  ARCHIVED: "Base arquivada: o agente não a consulta enquanto ela estiver arquivada.",
  NO_VERSION: "O agente não consulta esta base até haver uma versão pronta.",
}

/** "Todos os Grupos" · "Grupo A" · "Grupo A › Subgrupo". */
export function scopeSummary(option: Pick<KnowledgeOption, "orgScopes">): string {
  if (option.orgScopes.some((scope) => scope.scopeType === "ALL_TEAMS")) return "Todos os Grupos"
  const names = option.orgScopes.map((scope) => (scope.subteamName ? `${scope.teamName ?? "Grupo"} › ${scope.subteamName}` : (scope.teamName ?? "Grupo")))
  return names.length ? names.join(", ") : "Sem Grupo"
}

/** Texto da busca nas escolhidas (local): título, Grupos, assuntos e produtos, sem acento e sem caixa — a mesma ideia do servidor. */
export const foldText = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
export function matchesLocalSearch(option: KnowledgeOption, term: string): boolean {
  const folded = foldText(term).trim()
  if (!folded) return true
  return foldText([option.title, scopeSummary(option), ...option.subjects, ...option.products].join(" ")).includes(folded)
}
