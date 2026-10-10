import { describe, expect, it } from "vitest"
import { BRAZILIAN_CAPITALS, BRAZILIAN_STATE_CODES, capitalLabel, normalizeCapitalCode, stateCodeOfCapital } from "./brazilian-capitals.js"

describe("catálogo das capitais brasileiras — reference data", () => {
  it("exatamente 27 (26 estaduais + Brasília/DF), códigos e IBGE únicos, 27 UFs", () => {
    expect(BRAZILIAN_CAPITALS).toHaveLength(27)
    expect(new Set(BRAZILIAN_CAPITALS.map((capital) => capital.code)).size).toBe(27)
    expect(new Set(BRAZILIAN_CAPITALS.map((capital) => capital.ibgeCode)).size).toBe(27)
    expect(BRAZILIAN_STATE_CODES).toHaveLength(27)
    for (const capital of BRAZILIAN_CAPITALS) {
      expect(capital.code).toMatch(/^[A-Z][A-Z_]{2,39}$/)
      expect(capital.ibgeCode).toMatch(/^\d{7}$/)
      expect(capital.stateCode).toMatch(/^[A-Z]{2}$/)
    }
  })

  it("UF derivada: Fortaleza → CE, Recife → PE, Brasília → DF (nunca 'estado Brasília')", () => {
    expect(stateCodeOfCapital("FORTALEZA")).toBe("CE")
    expect(stateCodeOfCapital("RECIFE")).toBe("PE")
    expect(stateCodeOfCapital("BRASILIA")).toBe("DF")
    expect(stateCodeOfCapital("XYZ")).toBeNull()
    expect(capitalLabel("FORTALEZA")).toBe("Fortaleza / CE")
  })

  it("normalização estrita: código ou nome oficial; abreviações da empresa NÃO viram capital por heurística", () => {
    expect(normalizeCapitalCode("fortaleza")).toBe("FORTALEZA")
    expect(normalizeCapitalCode("São Paulo")).toBe("SAO_PAULO")
    expect(normalizeCapitalCode("Rio de Janeiro")).toBe("RIO_DE_JANEIRO")
    expect(normalizeCapitalCode("FOR")).toBeNull()
    expect(normalizeCapitalCode("CE-FOR")).toBeNull()
    expect(normalizeCapitalCode("Fortal")).toBeNull()
  })
})
