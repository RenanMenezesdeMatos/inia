import { describe, expect, it } from "vitest"
import { callOutcomeDraftOf, callOutcomeOfDraft } from "./call-outcome-fields"

/** Chamada boa × ruim no cadastro do sinal: o rascunho da tela vira o contrato do backend só quando está completo. */
describe("CallOutcomeFields — rascunho × contrato", () => {
  it("numérico: as duas faixas viram o critério; número incompleto não salva; desligado = o sinal não compara chamadas", () => {
    const draft = { ...callOutcomeDraftOf(null), enabled: true, goodOperator: "GTE" as const, goodValue: "4", badOperator: "LTE" as const, badValue: "2,5" }
    expect(callOutcomeOfDraft(draft, "NUMERIC")).toEqual({ kind: "NUMERIC", good: { operator: "GTE", value: 4 }, bad: { operator: "LTE", value: 2.5 } })
    expect(callOutcomeOfDraft({ ...draft, badValue: "" }, "NUMERIC")).toBeUndefined()
    expect(callOutcomeOfDraft({ ...draft, enabled: false }, "NUMERIC")).toBeNull()
  })
  it("sim/não: o valor ruim cadastrado; o rascunho volta igual a partir do contrato gravado", () => {
    expect(callOutcomeOfDraft({ ...callOutcomeDraftOf(null), enabled: true, badBoolean: true }, "BOOLEAN")).toEqual({ kind: "BOOLEAN", badValue: true })
    expect(callOutcomeDraftOf({ kind: "NUMERIC", good: { operator: "GTE", value: 4 }, bad: { operator: "LTE", value: 2 } })).toMatchObject({ enabled: true, goodValue: "4", badValue: "2" })
  })
})
