import { describe, expect, it } from "vitest"
import { configurationChanges, stableJson, type WorkflowConfiguration } from "./workflow-configuration.js"

const PUBLISHED: WorkflowConfiguration = {
  triggerConfig: { kind: "manual", context: "INTERACTION" },
  scopeType: "TEAM",
  teamId: "11111111-1111-4111-8111-111111111111",
  subteamId: null,
  consolidatedStructure: null,
  populationFilter: null,
}

describe("configurationChanges — rascunho × publicada", () => {
  it("nada mudou: lista vazia (ordem das chaves do jsonb nunca conta)", () => {
    const draft = { ...PUBLISHED, triggerConfig: JSON.parse('{"context":"INTERACTION","kind":"manual"}') }
    expect(configurationChanges(draft, PUBLISHED)).toEqual([])
    expect(stableJson({ b: 1, a: [{ d: 2, c: 1 }] })).toBe(stableJson({ a: [{ c: 1, d: 2 }], b: 1 }))
  })

  it("troca de gatilho (o incidente: Manual → Por agenda) é reconhecida", () => {
    const draft: WorkflowConfiguration = { ...PUBLISHED, triggerConfig: { kind: "schedule", times: ["18:30"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } } }
    expect(configurationChanges(draft, PUBLISHED)).toEqual(["TRIGGER"])
  })

  it("Abrangência e população são mudanças separadas, na ordem do editor", () => {
    const draft: WorkflowConfiguration = {
      ...PUBLISHED,
      scopeType: "ALL_TEAMS",
      teamId: null,
      populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: "22222222-2222-4222-8222-222222222222" },
    }
    expect(configurationChanges(draft, PUBLISHED)).toEqual(["SCOPE", "ANALYSIS"])
  })

  it('"Todos os colaboradores elegíveis" e filtro ausente são a mesma população', () => {
    expect(configurationChanges({ ...PUBLISHED, populationFilter: { kind: "ALL" } }, PUBLISHED)).toEqual([])
  })
})
