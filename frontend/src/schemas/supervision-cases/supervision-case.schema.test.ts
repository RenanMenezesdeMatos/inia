import { describe, expect, it } from "vitest"
import { supervisionCaseSchema } from "./supervision-case.schema"

describe("supervisionCaseSchema", () => {
  it("rejects an incomplete case contract", () => {
    expect(supervisionCaseSchema.safeParse({ title: "Caso incompleto" }).success).toBe(false)
  })

  it("requires every evidence to have a verifiable source", () => {
    const evidence = {
      id: "ev-1", type: "INDICATOR", title: "TMA", description: "Acima da meta",
      sourceType: "", sourceId: "", occurredAt: new Date().toISOString(),
    }
    const result = supervisionCaseSchema.shape.evidences.element.safeParse(evidence)
    expect(result.success).toBe(false)
  })
})
