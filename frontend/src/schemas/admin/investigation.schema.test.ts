import { describe, expect, it } from "vitest"
import { effectiveCapabilities, INVESTIGATION_CAPABILITIES, INVESTIGATION_CAPABILITY_LABELS, INVESTIGATION_TOOLS, readToolTrace, toolsForCapabilities } from "./investigation.schema"

describe("espelho de UI das capacidades/Tools de investigação", () => {
  it("7 capacidades com rótulos amigáveis; 19 Tools, cada uma numa capacidade do catálogo", () => {
    expect(INVESTIGATION_CAPABILITIES).toHaveLength(7)
    expect(INVESTIGATION_CAPABILITY_LABELS.OPERATIONAL_COMPARISON).toBe("Comparação operacional")
    expect(INVESTIGATION_TOOLS).toHaveLength(19)
    for (const tool of INVESTIGATION_TOOLS) expect(INVESTIGATION_CAPABILITIES).toContain(tool.capability)
    expect(toolsForCapabilities(["KNOWLEDGE", "SUPPORT_MATERIALS"]).map((tool) => tool.key)).toEqual(["query_knowledge", "recommend_support_materials"])
  })

  it("effective = Agent ∩ Workflow; o Workflow nunca concede", () => {
    expect(effectiveCapabilities(["INDICATOR_ANALYSIS", "KNOWLEDGE"], ["KNOWLEDGE", "WORK_CONTEXT"])).toEqual(["KNOWLEDGE"])
    expect(effectiveCapabilities(["INDICATOR_ANALYSIS", "KNOWLEDGE"])).toEqual(["INDICATOR_ANALYSIS", "KNOWLEDGE"])
  })

  it("readToolTrace lê o topo (Agent direto) ou os especialistas (Orquestrador) e ignora entradas malformadas", () => {
    const entry = { sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: { indicatorCode: "TMA" }, resultSummary: "TMA: 452 s", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "" }
    expect(readToolTrace({ toolTrace: [entry, { broken: true }] })).toHaveLength(1)
    expect(readToolTrace({ results: [{ toolTrace: [entry] }, { toolTrace: [entry] }] })).toHaveLength(2)
    expect(readToolTrace({ text: "sem trace" })).toEqual([])
  })
})
