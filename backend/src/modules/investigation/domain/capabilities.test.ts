import { describe, expect, it } from "vitest"
import { effectiveCapabilities, INVESTIGATION_CAPABILITIES, INVESTIGATION_CAPABILITY_LABELS, normalizeCapabilities } from "./capabilities.js"

describe("capabilities — o Agent é dono; o Workflow só restringe", () => {
  it("as 7 capacidades têm rótulo amigável (a UI nunca mostra nomes técnicos)", () => {
    for (const capability of INVESTIGATION_CAPABILITIES) expect(INVESTIGATION_CAPABILITY_LABELS[capability].length).toBeGreaterThan(3)
    expect(INVESTIGATION_CAPABILITY_LABELS.INDICATOR_ANALYSIS).toBe("Indicadores e tendências")
    expect(INVESTIGATION_CAPABILITY_LABELS.SUPPORT_MATERIALS).toBe("Materiais de apoio")
  })

  it("normaliza: descarta valores fora do catálogo, remove duplicatas e ordena na ordem canônica", () => {
    expect(normalizeCapabilities(["KNOWLEDGE", "INDICATOR_ANALYSIS", "KNOWLEDGE", "diagnose_everything", 3, null])).toEqual(["INDICATOR_ANALYSIS", "KNOWLEDGE"])
    expect(normalizeCapabilities(null)).toEqual([])
  })

  it("effective = Agent ∩ Workflow; sem override do Workflow valem as do Agent", () => {
    const agent = ["INDICATOR_ANALYSIS", "SEGMENTATION", "OPERATIONAL_COMPARISON", "INTERACTION_ANALYSIS", "KNOWLEDGE"] as const
    expect(effectiveCapabilities(agent, ["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS"])).toEqual(["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS"])
    expect(effectiveCapabilities(agent)).toEqual([...agent])
    expect(effectiveCapabilities(agent, null)).toEqual([...agent])
  })

  it("o Workflow NUNCA concede capacidade ausente no Agent", () => {
    expect(effectiveCapabilities(["KNOWLEDGE"], ["KNOWLEDGE", "WORK_CONTEXT", "INTERACTION_ANALYSIS"])).toEqual(["KNOWLEDGE"])
    expect(effectiveCapabilities([], ["KNOWLEDGE"])).toEqual([])
    expect(effectiveCapabilities(["KNOWLEDGE"], [])).toEqual([])
  })
})
