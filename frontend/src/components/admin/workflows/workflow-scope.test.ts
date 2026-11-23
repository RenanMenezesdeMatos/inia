import { describe, expect, it } from "vitest"
import { workflowScopePayload, workflowScopeTeamIds } from "./workflow-scope"

describe("Abrangência do Workflow com vários Grupos (249)", () => {
  it("vira o formato da API: ALL_TEAMS sem vínculos; GROUPS com cada vínculo (Grupo inteiro ou Subgrupo)", () => {
    expect(workflowScopePayload({ scopeType: "ALL_TEAMS", scopeLinks: [] })).toEqual({ scopeType: "ALL_TEAMS", scopeLinks: [] })
    expect(workflowScopePayload({ scopeType: "GROUPS", scopeLinks: [{ teamId: "a", subteamId: null }, { teamId: "b", subteamId: "b1" }] })).toEqual({
      scopeType: "GROUPS",
      scopeLinks: [{ teamId: "a", subteamId: null }, { teamId: "b", subteamId: "b1" }],
    })
  })

  it("Grupos da Abrangência para a âncora: null em ALL_TEAMS; o Subgrupo conta pelo Grupo-pai", () => {
    expect(workflowScopeTeamIds({ scopeType: "ALL_TEAMS" })).toBeNull()
    expect([...(workflowScopeTeamIds({ scopeType: "GROUPS", scopeLinks: [{ teamId: "a", subteamId: null }, { teamId: "b", subteamId: "b1" }] }) ?? [])]).toEqual(["a", "b"])
  })
})
