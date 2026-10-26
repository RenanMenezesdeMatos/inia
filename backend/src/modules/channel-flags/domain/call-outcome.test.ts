import { describe, expect, it } from "vitest"
import { callOutcomeLabelsOf, callOutcomeOf, callOutcomeSchema, conditionsOverlap } from "./call-outcome.js"

/** Chamada boa × ruim no sinal: cadastro, nunca suposição; sem o sinal, a chamada não é boa nem ruim. */
describe("call_outcome — chamada boa × ruim no sinal", () => {
  const ura = callOutcomeSchema.parse({ kind: "NUMERIC", good: { operator: "GTE", value: 4 }, bad: { operator: "LTE", value: 2 } })
  const rechamada = callOutcomeSchema.parse({ kind: "BOOLEAN", badValue: true })

  it("numérico: boa, ruim e o meio fora; sem o sinal, fora", () => {
    expect(callOutcomeOf(ura, { boolean: null, numeric: 5 })).toBe("GOOD")
    expect(callOutcomeOf(ura, { boolean: null, numeric: 4 })).toBe("GOOD")
    expect(callOutcomeOf(ura, { boolean: null, numeric: 2 })).toBe("BAD")
    expect(callOutcomeOf(ura, { boolean: null, numeric: 3 })).toBeNull()
    expect(callOutcomeOf(ura, undefined)).toBeNull()
    expect(callOutcomeOf(ura, { boolean: true, numeric: null })).toBeNull()
  })

  it("sim/não: o valor ruim é o cadastrado; o oposto enviado é o bom; ausência não é resultado", () => {
    expect(callOutcomeOf(rechamada, { boolean: true, numeric: null })).toBe("BAD")
    expect(callOutcomeOf(rechamada, { boolean: false, numeric: null })).toBe("GOOD")
    expect(callOutcomeOf(rechamada, null)).toBeNull()
  })

  it("faixas de bom e ruim com valor em comum são recusadas no cadastro", () => {
    expect(conditionsOverlap({ operator: "GTE", value: 4 }, { operator: "LTE", value: 2 })).toBe(false)
    expect(conditionsOverlap({ operator: "GTE", value: 3 }, { operator: "LTE", value: 3 })).toBe(true)
    expect(conditionsOverlap({ operator: "GT", value: 3 }, { operator: "LTE", value: 3 })).toBe(false)
    expect(conditionsOverlap({ operator: "EQ", value: 5 }, { operator: "GTE", value: 4 })).toBe(true)
    expect(callOutcomeSchema.safeParse({ kind: "NUMERIC", good: { operator: "GTE", value: 3 }, bad: { operator: "LTE", value: 4 } }).success).toBe(false)
  })

  it("rótulos para a tela, a análise e o feedback", () => {
    expect(callOutcomeLabelsOf("Nota da URA", ura)).toEqual({ good: "Nota da URA ≥ 4", bad: "Nota da URA ≤ 2" })
    expect(callOutcomeLabelsOf("Rechamada", rechamada)).toEqual({ good: "Rechamada = não", bad: "Rechamada = sim" })
  })
})
