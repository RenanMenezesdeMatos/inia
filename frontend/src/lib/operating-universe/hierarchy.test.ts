import { describe, expect, it } from "vitest"

import { filterByUniverse, fitsUniverse, orgScopeAfterUniverseChange, scopesFitOrgScope, teamIdAfterUniverseChange, teamsForUniverse } from "./hierarchy"
import type { Team } from "@/schemas/admin/org-structure.schema"

// B2C com um Subgrupo B2B (Subgrupo com universo próprio, migration 204), um B2B e um ainda sem universo.
const TEAMS: Team[] = [
  { id: "t-b2c", name: "Varejo", operationId: "op", operatingUniverse: "B2C", subteams: [
    { id: "s-b2c", teamId: "t-b2c", name: "Turno A", operatingUniverse: "B2C" },
    { id: "s-b2b", teamId: "t-b2c", name: "Empresas no Varejo", operatingUniverse: "B2B" },
  ] },
  { id: "t-b2b", name: "Grandes Contas", operationId: "op", operatingUniverse: "B2B", subteams: [{ id: "s-gc", teamId: "t-b2b", name: "Turno GC", operatingUniverse: "B2B" }] },
  { id: "t-pend", name: "Sem universo", operationId: "op", operatingUniverse: null, subteams: [] },
]

describe("hierarquia universo → Grupo → Subgrupo", () => {
  it("pendente cabe em qualquer universo; sem escolha, tudo cabe", () => {
    expect(fitsUniverse(null, "B2B")).toBe(true)
    expect(fitsUniverse("B2C", undefined)).toBe(true)
    expect(fitsUniverse("B2C", "B2B")).toBe(false)
    expect(fitsUniverse("B2C", ["B2B", "PENDING"])).toBe(false)
    expect(fitsUniverse("B2C", ["PENDING"])).toBe(true)
  })

  it("só Grupos/Subgrupos classificados no universo; Grupo de outro universo aparece só pelo Subgrupo compatível; sem universo some", () => {
    const b2b = teamsForUniverse(TEAMS, "B2B")
    expect(b2b.map((team) => [team.id, team.selectable, team.subteams.map((subteam) => subteam.id)])).toEqual([
      ["t-b2c", false, ["s-b2b"]],
      ["t-b2b", true, ["s-gc"]],
    ])
    expect(teamsForUniverse(TEAMS, "B2X")).toEqual([])
    expect(teamsForUniverse(TEAMS, undefined).map((team) => team.id)).toEqual(["t-b2c", "t-b2b", "t-pend"])
  })

  it("trocar o universo limpa o Grupo/Subgrupo que deixou de caber e mantém o que cabe", () => {
    expect(orgScopeAfterUniverseChange({ teamId: "t-b2c" }, TEAMS, "B2B")).toEqual({})
    expect(orgScopeAfterUniverseChange({ teamId: "t-b2c", subteamId: "s-b2b" }, TEAMS, "B2B")).toEqual({ teamId: "t-b2c", subteamId: "s-b2b" })
    expect(orgScopeAfterUniverseChange({ teamId: "t-b2b" }, TEAMS, "B2B")).toEqual({ teamId: "t-b2b" })
    expect(orgScopeAfterUniverseChange({ scopeType: "ALL_TEAMS" }, TEAMS, "B2X")).toEqual({ scopeType: "ALL_TEAMS" })
    expect(teamIdAfterUniverseChange("t-b2b", TEAMS, "B2C")).toBeUndefined()
    expect(orgScopeAfterUniverseChange({ teamId: "t-pend" }, TEAMS, "B2B")).toEqual({})
  })

  it("recursos filtrados pelo universo, mantendo o valor salvo pedido", () => {
    const items = [{ id: "a", operatingUniverse: "B2B" }, { id: "b", operatingUniverse: "B2C" }, { id: "c", operatingUniverse: null }]
    expect(filterByUniverse(items, "B2B").map((item) => item.id)).toEqual(["a", "c"])
    expect(filterByUniverse(items, "B2B", (item) => item.id === "b").map((item) => item.id)).toEqual(["a", "b", "c"])
  })

  it("recurso com alcances cabe no Grupo/Subgrupo escolhido", () => {
    const global = [{ scopeType: "ALL_TEAMS" }]
    const ofTeam = [{ scopeType: "TEAM", teamId: "t-b2b" }]
    const ofSubteam = [{ scopeType: "SUBTEAM", teamId: "t-b2c", subteamId: "s-b2b" }]
    expect(scopesFitOrgScope(global, { teamId: "t-b2c" }, TEAMS)).toBe(true)
    expect(scopesFitOrgScope(ofTeam, { teamId: "t-b2c" }, TEAMS)).toBe(false)
    expect(scopesFitOrgScope(ofTeam, { teamId: "t-b2b", subteamId: "s-gc" }, TEAMS)).toBe(true)
    expect(scopesFitOrgScope(ofSubteam, { teamId: "t-b2c" }, TEAMS)).toBe(true)
    expect(scopesFitOrgScope(ofSubteam, { subteamId: "s-b2c" }, TEAMS)).toBe(false)
    expect(scopesFitOrgScope(ofTeam, {}, TEAMS)).toBe(true)
  })
})
