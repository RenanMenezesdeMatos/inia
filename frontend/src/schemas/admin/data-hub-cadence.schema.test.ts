import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { cadenceLabel, cadenceProblem, cadenceSaveProblem, cadenceSchema, type Cadence } from "./data-hub-cadence.schema"

/** A MESMA tabela que o backend confere em `data-hub/domain/cadence.test.ts`: frase e validação nunca divergem entre as pontas. */
const cases = JSON.parse(readFileSync(resolve(process.cwd(), "../backend/src/modules/data-hub/testing/cadence-cases.json"), "utf-8")) as {
  labels: { cadence: Cadence; label: string }[]
  invalid: { cadence: Cadence; message: string }[]
}

describe("periodicidade na tela espelha o backend", () => {
  it.each(cases.labels)("$label", ({ cadence, label }) => {
    expect(cadenceSchema.parse(cadence)).toBeTruthy()
    expect(cadenceLabel(cadence)).toBe(label)
    expect(cadenceProblem(cadence)).toBeNull()
  })

  it.each(cases.invalid)("recusa: $message", ({ cadence, message }) => {
    expect(cadenceProblem(cadence)).toBe(message)
  })

  it("horário apagado no campo não passa", () => {
    expect(cadenceProblem({ kind: "DAILY", time: "" })).toBe("Use o horário no formato HH:mm.")
    expect(cadenceProblem({ kind: "CALENDAR", times: ["06:00", ""], frequency: { type: "DAILY" } })).toBe("Use o horário no formato HH:mm.")
  })

  it("o valor já gravado continua valendo; qualquer outro respeita o mínimo", () => {
    const saved: Cadence = { kind: "INTERVAL", minutes: 5 }
    expect(cadenceSaveProblem({ kind: "INTERVAL", minutes: 5 }, saved)).toBeNull()
    expect(cadenceSaveProblem({ kind: "INTERVAL", minutes: 10 }, saved)).toMatch(/mínimo/)
    expect(cadenceSaveProblem({ kind: "INTERVAL", minutes: 5 })).toMatch(/mínimo/)
    expect(cadenceProblem({ kind: "INTERVAL", minutes: 24 * 60 + 1 })).toMatch(/máximo/)
  })
})
