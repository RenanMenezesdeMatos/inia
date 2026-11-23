import { describe, expect, it } from "vitest"

import { agentFitsListScope, agentServesOrchestratorScope } from "./agent-scope-fit"

const TEAMS = [
  { id: "a", subteams: [{ id: "a1" }, { id: "a2" }] },
  { id: "b", subteams: [{ id: "b1" }] },
]
const groups = (...teamIds: string[]) => ({ scopeType: "GROUPS", scopeLinks: teamIds.map((teamId) => ({ teamId, subteamId: null })) })

describe("Agent × alcance do Orquestrador com vários Grupos (espelho de scopesAreCompatible)", () => {
  // Orquestrador: Grupo A inteiro + Subgrupo B1.
  const orchestrator = { global: false, groups: [{ teamId: "a", mode: "WHOLE" as const, subteamIds: [] }, { teamId: "b", mode: "SUBTEAMS" as const, subteamIds: ["b1"] }] }

  it("serve o Agent de 'Todos os Grupos' e o que cobre todos os Grupos do Orquestrador", () => {
    expect(agentServesOrchestratorScope(orchestrator, { scopeType: "ALL_TEAMS" }, TEAMS)).toBe(true)
    expect(agentServesOrchestratorScope(orchestrator, groups("a", "b"), TEAMS)).toBe(true)
    expect(agentServesOrchestratorScope(orchestrator, groups("a", "b", "c"), TEAMS)).toBe(true)
  })

  it("recusa o Agent que não cobre algum Grupo; Orquestrador de 'Todos' só aceita Agent de 'Todos'; sem Grupo escolhido, só 'Todos'", () => {
    expect(agentServesOrchestratorScope(orchestrator, groups("a"), TEAMS)).toBe(false)
    expect(agentServesOrchestratorScope({ global: true, groups: [] }, groups("a", "b"), TEAMS)).toBe(false)
    expect(agentServesOrchestratorScope({ global: false, groups: [] }, groups("a"), TEAMS)).toBe(false)
    expect(agentServesOrchestratorScope({ global: false, groups: [] }, { scopeType: "ALL_TEAMS" }, TEAMS)).toBe(true)
  })

  it("lê o formato legado (TEAM; SUBTEAM pelo Grupo-pai)", () => {
    const onlyA = { global: false, groups: [{ teamId: "a", mode: "WHOLE" as const, subteamIds: [] }] }
    expect(agentServesOrchestratorScope(onlyA, { scopeType: "TEAM", teamId: "a" }, TEAMS)).toBe(true)
    expect(agentServesOrchestratorScope(onlyA, { scopeType: "SUBTEAM", teamId: null, subteamId: "a2" }, TEAMS)).toBe(true)
    expect(agentServesOrchestratorScope(onlyA, { scopeType: "SUBTEAM", teamId: null, subteamId: "b1" }, TEAMS)).toBe(false)
  })

  it("filtro da lista: Grupo = algum vínculo nele; Subgrupo = o próprio ou o Grupo-pai inteiro, nunca o irmão", () => {
    const legacy = () => false
    expect(agentFitsListScope(groups("a"), { teamId: "a" }, TEAMS, legacy)).toBe(true)
    expect(agentFitsListScope(groups("a"), { subteamId: "a1" }, TEAMS, legacy)).toBe(true)
    expect(agentFitsListScope({ scopeType: "GROUPS", scopeLinks: [{ teamId: "a", subteamId: "a2" }] }, { subteamId: "a1" }, TEAMS, legacy)).toBe(false)
    expect(agentFitsListScope(groups("b"), { teamId: "a" }, TEAMS, legacy)).toBe(false)
  })
})
