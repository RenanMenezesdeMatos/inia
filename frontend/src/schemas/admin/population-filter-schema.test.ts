import { describe, expect, it } from "vitest"
import { populationFilterAnchorId, populationFilterGroupId, type PopulationFilter } from "./population-filter-schema"

describe("populationFilterAnchorId", () => {
  it("ALL não tem âncora nenhuma", () => {
    expect(populationFilterAnchorId({ kind: "ALL" })).toBeNull()
  })

  it("EMPLOYEE devolve o próprio id do colaborador", () => {
    expect(populationFilterAnchorId({ kind: "EMPLOYEE", employeeId: "person-1" })).toBe("person-1")
  })

  it("kinds baseados em pessoa (Equipe de Supervisor/Coordenador/...) devolvem o id da pessoa-âncora", () => {
    const filter: PopulationFilter = { kind: "SUPERVISOR_TEAM", supervisorId: "person-2" }
    expect(populationFilterAnchorId(filter)).toBe("person-2")
  })

  it("kinds de grupo (Subgrupo/Grupo) não têm âncora de pessoa", () => {
    expect(populationFilterAnchorId({ kind: "SUBTEAM", subteamId: "sub-1" })).toBeNull()
    expect(populationFilterAnchorId({ kind: "TEAM", teamId: "team-1" })).toBeNull()
  })
})

describe("populationFilterGroupId", () => {
  it("ALL e EMPLOYEE não têm grupo", () => {
    expect(populationFilterGroupId({ kind: "ALL" })).toBe("")
    expect(populationFilterGroupId({ kind: "EMPLOYEE", employeeId: "person-1" })).toBe("")
  })

  it("Subgrupo/Grupo devolvem o id do grupo direto", () => {
    expect(populationFilterGroupId({ kind: "SUBTEAM", subteamId: "sub-1" })).toBe("sub-1")
    expect(populationFilterGroupId({ kind: "TEAM", teamId: "team-1" })).toBe("team-1")
  })
})
