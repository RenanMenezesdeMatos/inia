import { describe, expect, it } from "vitest"
import { reactivationProblem, type ReactivationIndicator } from "./record-reactivation.js"

const indicator = (overrides: Partial<ReactivationIndicator> = {}): ReactivationIndicator => ({ id: "i", active: true, code: "TMA", unit: "SECONDS", direction: "LOWER", aggregation: "SUM", dailySupported: true, officialClosureSupported: true, ...overrides })
const snapshot = { i: { code: "TMA", unit: "SECONDS", direction: "LOWER", aggregation: "SUM" } }
const noRequirement = { requires: null }

describe("reativar é desfazer: só o indicador ter mudado barra", () => {
  it("nada mudou: volta como estava", () => {
    expect(reactivationProblem(snapshot, indicator(), noRequirement)).toBeNull()
    expect(reactivationProblem(snapshot, indicator(), { requires: "DAILY_MEASUREMENT" })).toBeNull()
    expect(reactivationProblem(snapshot, indicator(), { requires: "OFFICIAL_CLOSURE" })).toBeNull()
  })

  it("indicador ausente ou inativo", () => {
    expect(reactivationProblem(snapshot, undefined, noRequirement)).toBe("INDICATOR_NOT_AVAILABLE")
    expect(reactivationProblem(snapshot, indicator({ active: false }), noRequirement)).toBe("INDICATOR_NOT_AVAILABLE")
  })

  it.each([{ aggregation: "AVERAGE" }, { unit: "COUNT" }, { direction: "HIGHER" }, { code: "TMA_NOVO" }])("%o mudou depois do cancelamento", (change) => {
    expect(reactivationProblem(snapshot, indicator(change), noRequirement)).toBe("INDICATOR_RULE_CHANGED")
  })

  it("capacidade que este registro não usa não barra", () => {
    expect(reactivationProblem(snapshot, indicator({ officialClosureSupported: false }), noRequirement)).toBeNull()
  })

  it("o indicador deixou de aceitar este tipo de dado", () => {
    expect(reactivationProblem(snapshot, indicator({ dailySupported: false }), { requires: "DAILY_MEASUREMENT" })).toBe("CAPABILITY_DISABLED")
    expect(reactivationProblem(snapshot, indicator({ officialClosureSupported: false }), { requires: "OFFICIAL_CLOSURE" })).toBe("CAPABILITY_DISABLED")
  })
})
