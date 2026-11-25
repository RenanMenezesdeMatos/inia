import { describe, expect, it } from "vitest"

import { teamsForUniverse, type ScopeTeam } from "./scope-hierarchy"

const TEAMS: ScopeTeam[] = [
  { id: "ouv", name: "Ouvidoria", operatingUniverse: "B2C", manageable: true, subteams: [{ id: "ouv-n2", name: "Nível 2", operatingUniverse: "B2C" }] },
  { id: "emp", name: "Empresas", operatingUniverse: "B2B", manageable: true, subteams: [{ id: "emp-gc", name: "Grandes contas", operatingUniverse: "B2B" }] },
  { id: "novo", name: "Grupo novo", operatingUniverse: null, manageable: true, subteams: [] },
]

describe("encadeamento universo → Grupo → Subgrupo", () => {
  it("escolhido o universo, só os Grupos classificados nele (sem universo não aparece)", () => {
    expect(teamsForUniverse(TEAMS, "B2B").map((team) => team.id)).toEqual(["emp"])
    expect(teamsForUniverse(TEAMS, "B2C").map((team) => team.id)).toEqual(["ouv"])
    expect(teamsForUniverse(TEAMS, null).map((team) => team.id)).toEqual(["ouv", "emp", "novo"])
  })

  it("Subgrupo administrado sem o Grupo: o Grupo aparece só como caminho até ele", () => {
    const onlySub: ScopeTeam[] = [{ id: "ouv", name: "Ouvidoria", operatingUniverse: "B2C", manageable: false, subteams: [{ id: "ouv-n2", name: "Nível 2", operatingUniverse: "B2C" }] }]
    expect(teamsForUniverse(onlySub, "B2C").map((team) => team.id)).toEqual(["ouv"])
    expect(teamsForUniverse(onlySub, "B2B")).toEqual([])
  })
})
