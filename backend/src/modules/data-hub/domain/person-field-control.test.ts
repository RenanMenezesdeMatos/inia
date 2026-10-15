import { describe, expect, it } from "vitest"
import { describeManagedFieldViolations, managedFieldViolations, personFieldsWrittenBy, resolvePersonFieldControl, type PersonFeedApplication } from "./person-field-control.js"

const mapping = (...targets: string[]) => ({ fields: targets.map((target) => ({ target, source: target, transforms: [] })) })
const application = (patch: Partial<PersonFeedApplication>): PersonFeedApplication => ({
  feedId: "feed-1",
  feedName: "Colaboradores",
  sourceName: "RH Corporativo",
  contractKey: "EMPLOYEES",
  authoritative: false,
  mapping: mapping("externalEmployeeId", "name", "role"),
  lastAppliedAt: "2026-10-01T10:00:00.000Z",
  ...patch,
})

describe("quem controla cada campo da pessoa", () => {
  it("Colaboradores manda só no que o mapeamento do feed traz: e-mail e capital operacional não mapeados continuam da INIA", () => {
    const written = personFieldsWrittenBy("EMPLOYEES", mapping("externalEmployeeId", "name", "role", "groupExternalCode", "active"))
    expect([...written].sort()).toEqual(["active", "name", "role", "subteamId", "teamId"])
    expect(written.has("email")).toBe(false)
    expect(written.has("operationalCapitalCode")).toBe(false)
  })

  it("Grupo e Subgrupo andam juntos: só o Subgrupo mapeado também manda no Grupo", () => {
    expect([...personFieldsWrittenBy("EMPLOYEES", mapping("subgroupExternalCode"))].sort()).toEqual(["subteamId", "teamId"])
  })

  it("Estrutura organizacional sempre grava o gestor (vazio = topo da cadeia); Grupo só quando mapeado", () => {
    expect([...personFieldsWrittenBy("ORGANIZATIONAL_STRUCTURE", mapping("externalEmployeeId"))]).toEqual(["managerId"])
    expect([...personFieldsWrittenBy("ORGANIZATIONAL_STRUCTURE", mapping("externalEmployeeId", "groupExternalCode"))].sort()).toEqual(["managerId", "subteamId", "teamId"])
  })

  it("outros contratos e mapeamento inválido não controlam nada", () => {
    expect(personFieldsWrittenBy("WORK_SCHEDULES", mapping("externalEmployeeId", "name")).size).toBe(0)
    expect(personFieldsWrittenBy("EMPLOYEES", null).size).toBe(0)
    expect(personFieldsWrittenBy("EMPLOYEES", { fields: "x" }).size).toBe(0)
  })

  it("pessoa sem feed que a aplicou: tudo editável", () => {
    expect(Object.values(resolvePersonFieldControl([])).every((manager) => manager === null)).toBe(true)
  })

  it("prefere o feed autoritativo; sem autoritativo, o que aplicou por último", () => {
    const older = application({ feedId: "feed-a", feedName: "Planilha antiga", lastAppliedAt: "2026-09-01T10:00:00.000Z" })
    const newer = application({ feedId: "feed-b", feedName: "Planilha nova", lastAppliedAt: "2026-10-01T10:00:00.000Z" })
    const authoritative = application({ feedId: "feed-c", feedName: "RH oficial", sourceName: "ERP", authoritative: true, lastAppliedAt: "2026-08-01T10:00:00.000Z" })
    expect(resolvePersonFieldControl([older, newer]).name).toEqual({ sourceName: "RH Corporativo", feedName: "Planilha nova" })
    expect(resolvePersonFieldControl([older, newer, authoritative]).name).toEqual({ sourceName: "ERP", feedName: "RH oficial" })
  })

  it("cada campo pode vir de um feed diferente (Colaboradores × Estrutura)", () => {
    const employees = application({ authoritative: true })
    const structure = application({ feedId: "feed-s", feedName: "Hierarquia", sourceName: "Organograma", contractKey: "ORGANIZATIONAL_STRUCTURE", mapping: mapping("externalEmployeeId", "groupExternalCode") })
    const control = resolvePersonFieldControl([employees, structure])
    expect(control.name?.feedName).toBe("Colaboradores")
    expect(control.teamId?.feedName).toBe("Hierarquia")
    expect(control.managerId?.feedName).toBe("Hierarquia")
    expect(control.email).toBeNull()
  })

  it("recusa só o que a base controla e explica de onde vem", () => {
    const control = resolvePersonFieldControl([application({ mapping: mapping("name", "role", "groupExternalCode") })])
    const violations = managedFieldViolations(control, ["name", "teamId", "operationalCapitalCode"])
    expect(violations.map((violation) => violation.field)).toEqual(["name", "teamId"])
    expect(describeManagedFieldViolations(violations)).toBe("Nome e Grupo vêm da base RH Corporativo · Colaboradores — altere na origem.")
    expect(describeManagedFieldViolations(violations.slice(0, 1))).toBe("Nome vem da base RH Corporativo · Colaboradores — altere na origem.")
  })
})
