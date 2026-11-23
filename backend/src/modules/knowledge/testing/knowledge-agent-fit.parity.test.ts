import { describe, expect, it } from "vitest"
import { FIT_SUBTEAM_PARENT, KNOWLEDGE_AGENT_FIT_CASES, type FitAgentScope, type FitDocumentScope, type FitSubteam, type FitTeam } from "./knowledge-agent-fit-cases.js"

/**
 * PARIDADE da regra "a base cabe no agente" (run-8, ARQ-03): a cópia da tela (`picker-rules.ts`, carregada do código-fonte do frontend,
 * sem cópia) responde o caderno único. A SQL do servidor responde o MESMO caderno na prova de banco `knowledge-agent-fit-proof`.
 */
type DocumentScope = { scopeType: string; teamId: string | null; teamName: string | null; subteamId: string | null; subteamName: string | null }
type AgentScope = { scopeType: "ALL_TEAMS" } | { scopeType: "TEAM"; teamId: string } | { scopeType: "SUBTEAM"; subteamId: string; teamId?: string } | { scopeType: "GROUPS"; links: { teamId: string | null; subteamId: string | null }[] }
type Team = { id: string; name: string; subteams: { id: string; name: string }[] }
type FitsAgentScope = (option: { orgScopes: DocumentScope[] }, scope: AgentScope | undefined, teams: readonly Team[] | undefined) => boolean

const PICKER_RULES_URL = new URL("../../../../../frontend/src/components/admin/agents/knowledge-base-picker/picker-rules.ts", import.meta.url)

const teamId = (team: FitTeam) => `team-${team}`
const subteamId = (subteam: FitSubteam) => `subteam-${subteam}`
const TEAMS: Team[] = (["A", "B"] as const).map((team) => ({ id: teamId(team), name: team, subteams: (Object.keys(FIT_SUBTEAM_PARENT) as FitSubteam[]).filter((sub) => FIT_SUBTEAM_PARENT[sub] === team).map((sub) => ({ id: subteamId(sub), name: sub })) }))

/** Como o servidor entrega o vínculo à tela: o de Subgrupo vem com o Grupo-pai (normalizado na gravação). */
function documentScope(scope: FitDocumentScope): DocumentScope {
  if (scope.scopeType === "ALL_TEAMS") return { scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null }
  if (scope.scopeType === "TEAM") return { scopeType: "TEAM", teamId: teamId(scope.team), teamName: scope.team, subteamId: null, subteamName: null }
  return { scopeType: "SUBTEAM", teamId: teamId(FIT_SUBTEAM_PARENT[scope.subteam]), teamName: FIT_SUBTEAM_PARENT[scope.subteam], subteamId: subteamId(scope.subteam), subteamName: scope.subteam }
}

/** O formulário do agente de Subgrupo pode não saber o Grupo-pai: a tela o acha pela lista de Grupos. Os dois jeitos são conferidos. */
function agentScopes(scope: FitAgentScope): AgentScope[] {
  if (scope.scopeType === "ALL_TEAMS") return [{ scopeType: "ALL_TEAMS" }]
  if (scope.scopeType === "GROUPS") {
    const isTeam = (link: string): link is FitTeam => link === "A" || link === "B"
    // O vínculo de Subgrupo com e sem o Grupo-pai (a tela acha o pai pela lista de Grupos).
    return [
      { scopeType: "GROUPS", links: scope.links.map((link) => (isTeam(link) ? { teamId: teamId(link), subteamId: null } : { teamId: teamId(FIT_SUBTEAM_PARENT[link]), subteamId: subteamId(link) })) },
      { scopeType: "GROUPS", links: scope.links.map((link) => (isTeam(link) ? { teamId: teamId(link), subteamId: null } : { teamId: null, subteamId: subteamId(link) })) },
    ]
  }
  if (scope.scopeType === "TEAM") return [{ scopeType: "TEAM", teamId: teamId(scope.team) }]
  return [{ scopeType: "SUBTEAM", subteamId: subteamId(scope.subteam) }, { scopeType: "SUBTEAM", subteamId: subteamId(scope.subteam), teamId: teamId(FIT_SUBTEAM_PARENT[scope.subteam]) }]
}

describe("a base cabe no agente — a tela responde o caderno único (ARQ-03)", async () => {
  const { fitsAgentScope } = (await import(PICKER_RULES_URL.href)) as { fitsAgentScope: FitsAgentScope }
  it.each(KNOWLEDGE_AGENT_FIT_CASES)("$name", (fitCase) => {
    for (const scope of agentScopes(fitCase.agent)) expect(fitsAgentScope({ orgScopes: fitCase.document.map(documentScope) }, scope, TEAMS)).toBe(fitCase.fits)
  })
})
