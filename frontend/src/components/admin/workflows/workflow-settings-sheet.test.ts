import { describe, expect, it } from "vitest"
import { buildConsolidatedStructure, buildPopulationFilter } from "./workflow-settings-sheet"
import { consolidatedStructureGroupId } from "@/schemas/admin/consolidated-structure-schema"

describe("buildConsolidatedStructure", () => {
  it("kinds baseados em pessoa retornam null sem uma âncora escolhida — nunca salva um objeto inválido", () => {
    expect(buildConsolidatedStructure("SUPERVISOR_TEAM", "")).toBeNull()
    expect(buildConsolidatedStructure("COORDINATOR_STRUCTURE", "")).toBeNull()
    expect(buildConsolidatedStructure("MANAGER_STRUCTURE", "")).toBeNull()
    expect(buildConsolidatedStructure("SENIOR_MANAGER_STRUCTURE", "")).toBeNull()
    expect(buildConsolidatedStructure("DIRECTOR_STRUCTURE", "")).toBeNull()
  })

  it("kinds de grupo (Subgrupo/Grupo) retornam null sem grupo escolhido", () => {
    expect(buildConsolidatedStructure("SUBTEAM", "")).toBeNull()
    expect(buildConsolidatedStructure("TEAM", "")).toBeNull()
  })

  it("monta o objeto certo pra cada kind quando uma âncora é escolhida", () => {
    expect(buildConsolidatedStructure("SUPERVISOR_TEAM", "person-1")).toEqual({ kind: "SUPERVISOR_TEAM", supervisorId: "person-1" })
    expect(buildConsolidatedStructure("SUBTEAM", "sub-1")).toEqual({ kind: "SUBTEAM", subteamId: "sub-1" })
    expect(buildConsolidatedStructure("TEAM", "team-1")).toEqual({ kind: "TEAM", teamId: "team-1" })
    expect(buildConsolidatedStructure("COORDINATOR_STRUCTURE", "person-2")).toEqual({ kind: "COORDINATOR_STRUCTURE", coordinatorId: "person-2" })
    expect(buildConsolidatedStructure("MANAGER_STRUCTURE", "person-3")).toEqual({ kind: "MANAGER_STRUCTURE", managerId: "person-3" })
    expect(buildConsolidatedStructure("SENIOR_MANAGER_STRUCTURE", "person-4")).toEqual({ kind: "SENIOR_MANAGER_STRUCTURE", seniorManagerId: "person-4" })
    expect(buildConsolidatedStructure("DIRECTOR_STRUCTURE", "person-5")).toEqual({ kind: "DIRECTOR_STRUCTURE", directorId: "person-5" })
  })
})

describe("buildPopulationFilter", () => {
  it("ALL nunca precisa de âncora", () => {
    expect(buildPopulationFilter("ALL", "")).toEqual({ kind: "ALL" })
  })

  it("EMPLOYEE retorna null sem uma pessoa escolhida", () => {
    expect(buildPopulationFilter("EMPLOYEE", "")).toBeNull()
  })

  it("EMPLOYEE monta o objeto certo quando uma pessoa é escolhida", () => {
    expect(buildPopulationFilter("EMPLOYEE", "person-1")).toEqual({ kind: "EMPLOYEE", employeeId: "person-1" })
  })

  it("kinds de estrutura reaproveitam exatamente buildConsolidatedStructure — nunca duplica a lógica", () => {
    expect(buildPopulationFilter("SUPERVISOR_TEAM", "person-1")).toEqual({ kind: "SUPERVISOR_TEAM", supervisorId: "person-1" })
    expect(buildPopulationFilter("SUPERVISOR_TEAM", "")).toBeNull()
    expect(buildPopulationFilter("TEAM", "team-1")).toEqual({ kind: "TEAM", teamId: "team-1" })
  })
})

describe("consolidatedStructureGroupId", () => {
  it("lê subteamId/teamId direto pros kinds de grupo", () => {
    expect(consolidatedStructureGroupId({ kind: "SUBTEAM", subteamId: "sub-1" })).toBe("sub-1")
    expect(consolidatedStructureGroupId({ kind: "TEAM", teamId: "team-1" })).toBe("team-1")
  })

  it("retorna string vazia pros kinds baseados em pessoa (a âncora vem de consolidatedStructureAnchorId, não daqui)", () => {
    expect(consolidatedStructureGroupId({ kind: "SUPERVISOR_TEAM", supervisorId: "person-1" })).toBe("")
    expect(consolidatedStructureGroupId({ kind: "DIRECTOR_STRUCTURE", directorId: "person-5" })).toBe("")
  })
})
