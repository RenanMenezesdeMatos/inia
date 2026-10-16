import { describe, expect, it } from "vitest"

import { formatInteractionReason } from "./interaction-reason"

describe("formatInteractionReason", () => {
  it("motivo › submotivo quando a fonte informou o submotivo", () => {
    expect(formatInteractionReason("Fatura", "Segunda via")).toBe("Fatura › Segunda via")
  })

  it("só o motivo quando não há submotivo (nulo, ausente ou vazio)", () => {
    expect(formatInteractionReason("Fatura", null)).toBe("Fatura")
    expect(formatInteractionReason("Fatura")).toBe("Fatura")
    expect(formatInteractionReason("Fatura", "  ")).toBe("Fatura")
  })
})
