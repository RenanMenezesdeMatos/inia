import { describe, expect, it } from "vitest"
import { ANALYSIS_DIMENSION_DEFINITIONS, dimensionsForIndicator, interactionMetricFor } from "./analysis-dimensions.js"

describe("dimensões analíticas — só o que os dados reais suportam, por metadata", () => {
  it("cada dimensão declara fonte, campo, agrupamento e privacidade", () => {
    for (const definition of Object.values(ANALYSIS_DIMENSION_DEFINITIONS)) {
      expect(["MEASUREMENT", "INTERACTION"]).toContain(definition.source)
      expect(definition.field.length).toBeGreaterThan(3)
      expect(definition.privacy.length).toBeGreaterThan(3)
    }
  })

  it("indicador em SEGUNDOS com medição diária: dia/dia da semana/semana pela medição; assunto/hora/flag pela duração das interações (proxy declarada)", () => {
    const dimensions = dimensionsForIndicator({ code: "TMA", unit: "SECONDS", dailySupported: true }, true)
    const available = Object.fromEntries(dimensions.map((item) => [item.dimension, item]))
    expect(available.DAY!.available).toBe(true)
    expect(available.SUBJECT!.available).toBe(true)
    expect(available.SUBJECT!.metric).toContain("proxy")
    expect(interactionMetricFor({ unit: "SECONDS" })).toBe("INTERACTION_DURATION_SECONDS")
  })

  it("indicador em PERCENT (Qualidade, taxas): recorte por assunto/hora/flag NÃO é suportado — nunca inventa medição por interação", () => {
    const dimensions = dimensionsForIndicator({ code: "MONITORIA_QUALIDADE", unit: "PERCENT", dailySupported: true }, true)
    const subject = dimensions.find((item) => item.dimension === "SUBJECT")!
    expect(subject.available).toBe(false)
    expect(subject.reason).toContain("não é suportado")
    expect(dimensions.find((item) => item.dimension === "DAY_OF_WEEK")!.available).toBe(true)
  })

  it("indicador sem medição diária: nenhuma dimensão de medição; sem interações no período: nenhuma de interação", () => {
    const dimensions = dimensionsForIndicator({ code: "PRODUTIVIDADE", unit: "CASES_PER_DAY", dailySupported: false }, false)
    expect(dimensions.every((item) => !item.available)).toBe(true)
    const count = dimensionsForIndicator({ code: "ATENDIMENTOS", unit: "COUNT", dailySupported: true }, false)
    expect(count.find((item) => item.dimension === "SUBJECT")!.reason).toContain("não tem interações")
  })
})
