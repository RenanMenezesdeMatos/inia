import { describe, expect, it } from "vitest"

import { filterByUniverse, fitsUniverse, scopesFitOrgScope, unitFitsUniverse } from "./hierarchy"

describe("hierarquia universo → Grupo → Subgrupo", () => {
  it("pendente cabe em qualquer universo; sem escolha, tudo cabe", () => {
    expect(fitsUniverse(null, "B2B")).toBe(true)
    expect(fitsUniverse("B2C", undefined)).toBe(true)
    expect(fitsUniverse("B2C", "B2B")).toBe(false)
    expect(fitsUniverse("B2C", ["B2B", "PENDING"])).toBe(false)
    expect(fitsUniverse("B2C", ["PENDING"])).toBe(true)
  })

  it("Grupo/Subgrupo sem universo some quando há universo escolhido", () => {
    expect(unitFitsUniverse(null, "B2B")).toBe(false)
    expect(unitFitsUniverse("B2B", "B2B")).toBe(true)
    expect(unitFitsUniverse("B2C", ["B2B", "PENDING"])).toBe(false)
    expect(unitFitsUniverse(null, ["PENDING"])).toBe(true)
    expect(unitFitsUniverse(null, undefined)).toBe(true)
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
    const parents = new Map([["s-b2c", "t-b2c"], ["s-b2b", "t-b2c"], ["s-gc", "t-b2b"]])
    expect(scopesFitOrgScope(global, { teamId: ["t-b2c"] }, parents)).toBe(true)
    expect(scopesFitOrgScope(ofTeam, { teamId: ["t-b2c"] }, parents)).toBe(false)
    expect(scopesFitOrgScope(ofTeam, { teamId: ["t-b2c", "t-b2b"] }, parents)).toBe(true)
    expect(scopesFitOrgScope(ofTeam, { subteamId: ["s-gc"] }, parents)).toBe(true)
    expect(scopesFitOrgScope(ofSubteam, { teamId: ["t-b2c"] }, parents)).toBe(true)
    expect(scopesFitOrgScope(ofSubteam, { subteamId: ["s-b2c"] }, parents)).toBe(false)
    expect(scopesFitOrgScope(ofSubteam, { teamId: ["t-b2c"], subteamId: ["s-b2c", "s-b2b"] }, parents)).toBe(true)
    expect(scopesFitOrgScope(ofTeam, {}, parents)).toBe(true)
  })
})
