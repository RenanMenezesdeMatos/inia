import { describe, expect, it } from "vitest"
import { INVESTIGATION_CAPABILITIES } from "./capabilities.js"
import { findTool, TOOL_CATALOG, TOOL_KEYS, toFunctionDeclaration, toolsForCapabilities } from "./tool-catalog.js"

describe("tool catalog — pequenas, determinísticas e agrupadas por capacidade", () => {
  it("as 19 Tools da V1 existem, sem 'diagnose_everything'", () => {
    expect(TOOL_CATALOG.map((tool) => tool.key)).toEqual([...TOOL_KEYS])
    expect(TOOL_CATALOG).toHaveLength(19)
    expect(findTool("diagnose_everything")).toBeNull()
  })

  it("toda capacidade libera ao menos uma Tool e toda Tool pertence a uma capacidade do catálogo", () => {
    for (const capability of INVESTIGATION_CAPABILITIES) expect(toolsForCapabilities([capability]).length).toBeGreaterThan(0)
    for (const tool of TOOL_CATALOG) expect(INVESTIGATION_CAPABILITIES).toContain(tool.capability)
  })

  it("só as duas Tools de análise semântica usam LLM — o resto é determinístico", () => {
    expect(TOOL_CATALOG.filter((tool) => tool.usesLlm).map((tool) => tool.key)).toEqual(["analyze_interactions", "analyze_peer_patterns"])
  })

  it("capacidades → Tools: Indicadores libera snapshot/comparar/histórico/composição/qualidade/picos/síntese; Materiais libera só recommend_support_materials", () => {
    expect(toolsForCapabilities(["INDICATOR_ANALYSIS"]).map((tool) => tool.key)).toEqual(["get_indicator_snapshot", "compare_periods", "inspect_indicator_composition", "validate_data_quality", "detect_anomalies", "get_employee_history", "synthesize_evidence"])
    expect(toolsForCapabilities(["SUPPORT_MATERIALS"]).map((tool) => tool.key)).toEqual(["recommend_support_materials"])
    expect(toolsForCapabilities([])).toEqual([])
  })

  it("declaração de function calling: nome = key, parâmetros objeto com properties; o schema zod valida os argumentos", () => {
    const tool = findTool("segment_indicator")!
    const declaration = toFunctionDeclaration(tool)
    expect(declaration.name).toBe("segment_indicator")
    expect(declaration.parameters.type).toBe("object")
    expect(Object.keys(declaration.parameters.properties)).toEqual(["indicatorCode", "dimension", "period", "filters"])
    expect(tool.inputSchema.safeParse({ indicatorCode: "TMA", dimension: "SUBJECT" }).success).toBe(true)
    expect(tool.inputSchema.safeParse({ indicatorCode: "TMA", dimension: "CUSTOMER_PROFILE" }).success).toBe(false)
    expect(findTool("find_interactions")!.inputSchema.safeParse({ period: { from: "2026-09-01", to: "2026-09-15" }, limit: 5 }).success).toBe(true)
    expect(findTool("analyze_interactions")!.inputSchema.safeParse({ interactionIds: [], objective: "padrões" }).success).toBe(false)
  })
})
