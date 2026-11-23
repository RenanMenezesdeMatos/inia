import { describe, expect, it } from "vitest"
import { configurationChanges, stableJson, type WorkflowConfiguration } from "./workflow-configuration.js"

const PUBLISHED: WorkflowConfiguration = {
  triggerConfig: { kind: "manual", context: "INTERACTION" },
  scopeType: "GROUPS",
  scopeLinks: [{ teamId: "11111111-1111-4111-8111-111111111111", subteamId: null }],
  consolidatedStructure: null,
  populationFilter: null,
  operatingUniverse: null,
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
      scopeLinks: [],
      populationFilter: { kind: "SUPERVISOR_TEAM", supervisorId: "22222222-2222-4222-8222-222222222222" },
    }
    expect(configurationChanges(draft, PUBLISHED)).toEqual(["SCOPE", "ANALYSIS"])
  })

  it("vínculos da Abrangência: mesma lista em outra ordem não é mudança; acrescentar/trocar um Subgrupo é", () => {
    const A = "11111111-1111-4111-8111-111111111111"
    const B = "11111111-1111-4111-8111-111111111112"
    const B1 = "33333333-3333-4333-8333-333333333331"
    const published: WorkflowConfiguration = { ...PUBLISHED, scopeLinks: [{ teamId: A, subteamId: null }, { teamId: B, subteamId: B1 }] }
    expect(configurationChanges({ ...published, scopeLinks: [{ teamId: B, subteamId: B1 }, { teamId: A, subteamId: null }] }, published)).toEqual([])
    expect(configurationChanges({ ...published, scopeLinks: [{ teamId: A, subteamId: null }] }, published)).toEqual(["SCOPE"])
    expect(configurationChanges({ ...published, scopeLinks: [{ teamId: A, subteamId: null }, { teamId: B, subteamId: null }] }, published)).toEqual(["SCOPE"])
  })

  it('ligar ou desligar "Somente quem tem acesso ativo à INIA" é mudança de população; ausente e desligada são a mesma coisa', () => {
    expect(configurationChanges({ ...PUBLISHED, requireActiveAccess: true }, PUBLISHED)).toEqual(["ANALYSIS"])
    expect(configurationChanges(PUBLISHED, { ...PUBLISHED, requireActiveAccess: true })).toEqual(["ANALYSIS"])
    expect(configurationChanges({ ...PUBLISHED, requireActiveAccess: false }, PUBLISHED)).toEqual([])
    expect(configurationChanges({ ...PUBLISHED, requireActiveAccess: true }, { ...PUBLISHED, requireActiveAccess: true })).toEqual([])
  })

  it('"Todos os colaboradores elegíveis" e filtro ausente são a mesma população', () => {
    expect(configurationChanges({ ...PUBLISHED, populationFilter: { kind: "ALL" } }, PUBLISHED)).toEqual([])
  })
})
