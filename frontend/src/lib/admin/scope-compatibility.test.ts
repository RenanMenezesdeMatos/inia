import { describe, expect, it } from "vitest"
import { formatScopeLabel, scopesAreCompatible } from "./scope-compatibility"
import type { Team } from "@/schemas/admin/org-structure.schema"

const TEAM_A: Team = { id: "team-a", name: "FATURAS", operationId: "op-1", subteams: [{ id: "sub-a1", teamId: "team-a", name: "Faturas Cobrança" }] }
const TEAM_B: Team = { id: "team-b", name: "RETENÇÃO", operationId: "op-1", subteams: [{ id: "sub-b1", teamId: "team-b", name: "Retenção Digital" }] }
const TEAMS = [TEAM_A, TEAM_B]

describe("formatScopeLabel", () => {
  it("mostra 'Todos os grupos' pra ALL_TEAMS, ignorando nomes", () => {
    expect(formatScopeLabel({ scopeType: "ALL_TEAMS", teamName: "FATURAS", subteamName: null })).toBe("Todos os grupos")
  })

  it("prefere o nome do subgrupo quando presente", () => {
    expect(formatScopeLabel({ scopeType: "SUBTEAM", teamName: "FATURAS", subteamName: "Faturas Cobrança" })).toBe("Faturas Cobrança")
  })

  it("cai pro nome do time quando não é subgrupo", () => {
    expect(formatScopeLabel({ scopeType: "TEAM", teamName: "FATURAS", subteamName: null })).toBe("FATURAS")
  })
})

// Espelha manageable-scopes.ts do backend — mesma regra, calculada em cima da árvore de
// times/subgrupos já carregada no cliente. Achado real desta sessão: um dos call sites do
// equivalente no backend passava os argumentos na ordem errada (referencer/referenced trocados),
// o que rejeitava silenciosamente casos que deveriam ser aceitos. Estes testes fixam as duas
// direções reais de uso — nunca confiar só na simetria aparente da regra.
describe("scopesAreCompatible", () => {
  it("um recurso referenciado ALL_TEAMS sempre é compatível", () => {
    const allTeams = { scopeType: "ALL_TEAMS" }
    expect(scopesAreCompatible(TEAMS, { scopeType: "TEAM", teamId: "team-a" }, allTeams)).toBe(true)
    expect(scopesAreCompatible(TEAMS, { scopeType: "SUBTEAM", subteamId: "sub-a1" }, allTeams)).toBe(true)
  })

  it("um referencer ALL_TEAMS só é compatível com um referenced também ALL_TEAMS", () => {
    const referencer = { scopeType: "ALL_TEAMS" }
    expect(scopesAreCompatible(TEAMS, referencer, { scopeType: "TEAM", teamId: "team-a" })).toBe(false)
    expect(scopesAreCompatible(TEAMS, referencer, { scopeType: "ALL_TEAMS" })).toBe(true)
  })

  it("exige o mesmo time efetivo fora dos casos ALL_TEAMS — subgrupo resolve pro time-pai via a árvore", () => {
    expect(scopesAreCompatible(TEAMS, { scopeType: "TEAM", teamId: "team-a" }, { scopeType: "TEAM", teamId: "team-a" })).toBe(true)
    expect(scopesAreCompatible(TEAMS, { scopeType: "TEAM", teamId: "team-a" }, { scopeType: "TEAM", teamId: "team-b" })).toBe(false)
    expect(scopesAreCompatible(TEAMS, { scopeType: "SUBTEAM", subteamId: "sub-a1" }, { scopeType: "TEAM", teamId: "team-a" })).toBe(true)
    expect(scopesAreCompatible(TEAMS, { scopeType: "SUBTEAM", subteamId: "sub-b1" }, { scopeType: "TEAM", teamId: "team-a" })).toBe(false)
  })

  it("uma pessoa de qualquer time é compatível com um Workflow Todos os grupos (direção pessoa-âncora → Workflow)", () => {
    const workflowAllTeams = { scopeType: "ALL_TEAMS" }
    expect(scopesAreCompatible(TEAMS, { scopeType: "TEAM", teamId: "team-a" }, workflowAllTeams)).toBe(true)
    expect(scopesAreCompatible(TEAMS, { scopeType: "TEAM", teamId: "team-b" }, workflowAllTeams)).toBe(true)
  })

  it("rejeita uma pessoa de outro time quando o Workflow é restrito a um time específico", () => {
    const workflowTeamA = { scopeType: "TEAM", teamId: "team-a" }
    expect(scopesAreCompatible(TEAMS, { scopeType: "TEAM", teamId: "team-a" }, workflowTeamA)).toBe(true)
    expect(scopesAreCompatible(TEAMS, { scopeType: "TEAM", teamId: "team-b" }, workflowTeamA)).toBe(false)
  })
})
