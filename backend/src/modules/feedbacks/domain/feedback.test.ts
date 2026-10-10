import { describe, expect, it } from "vitest"
import { validatePublishableFeedback } from "./feedback.js"

describe("validatePublishableFeedback", () => {
  const complete = {
    impactedIndicator: "TMA",
    evidenceFound: "TMA acima da meta por sete dias",
    observedBehavior: "Validação repetida no encerramento",
    relatedProcedure: "PROC-ATD-014 v3",
    recommendation: "Aplicar checklist de encerramento",
  }

  it("accepts a feedback supported by all mandatory fields", () => {
    expect(validatePublishableFeedback(complete)).toEqual(complete)
  })

  it.each(Object.keys(complete))("rejects feedback without %s", (field) => {
    expect(() => validatePublishableFeedback({ ...complete, [field]: "" })).toThrowError("indicador, evidência, comportamento, procedimento e recomendação")
  })
})
