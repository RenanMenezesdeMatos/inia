import { describe, expect, it } from "vitest"
import { findTool, TOOL_CATALOG, toFunctionDeclaration } from "./tool-catalog.js"
import { injectRuntimeDefaults, renderCommonParametersNote, toModelDeclaration } from "./tool-declarations.js"

// V1.3 — §17–22/§55: declaração model-facing compacta; validação continua no catálogo/Zod.
describe("ModelToolDeclaration compacta", () => {
  const declared = TOOL_CATALOG.filter((tool) => tool.key !== "synthesize_evidence" && tool.key !== "recommend_support_materials")

  it("é bem menor que a declaração integral, mantém nomes, enums e obrigatórios semânticos, e não muda o significado das 19 Tools", () => {
    const full = JSON.stringify(declared.map(toFunctionDeclaration)).length
    const compact = JSON.stringify(declared.map((tool) => toModelDeclaration(tool, { mode: "COMPACT", indicatorInFocus: true }))).length
    expect(compact).toBeLessThan(full * 0.6)
    for (const tool of declared) {
      const declaration = toModelDeclaration(tool, { mode: "COMPACT", indicatorInFocus: false })
      expect(declaration.name).toBe(tool.key)
      expect(Object.keys(declaration.parameters.properties)).toEqual(Object.keys(tool.parameters.properties ?? {}))
      expect(declaration.parameters.required ?? []).toEqual(tool.parameters.required ?? [])
      expect(declaration.description.length).toBeGreaterThan(20)
    }
    expect(toModelDeclaration(findTool("segment_indicator")!, { mode: "COMPACT", indicatorInFocus: true }).parameters.properties.dimension?.enum).toContain("SUBJECT")
    expect(toModelDeclaration(findTool("compare_population")!, { mode: "COMPACT", indicatorInFocus: true }).parameters.properties.reference?.enum).toEqual(["SUBGROUP", "GROUP"])
    expect(toModelDeclaration(findTool("get_indicator_snapshot")!, { mode: "FULL", indicatorInFocus: true })).toEqual(toFunctionDeclaration(findTool("get_indicator_snapshot")!))
  })

  it("com indicador em foco, indicatorCode deixa de ser obrigatório no schema e o runtime injeta o indicador da investigação; o modelo ainda pode pedir outro código", () => {
    const tool = findTool("compare_periods")!
    expect(toModelDeclaration(tool, { mode: "COMPACT", indicatorInFocus: true }).parameters.required).toBeUndefined()
    expect(toModelDeclaration(tool, { mode: "COMPACT", indicatorInFocus: false }).parameters.required).toEqual(["indicatorCode"])
    expect(injectRuntimeDefaults(tool, {}, { indicatorCode: "TMA" })).toEqual({ indicatorCode: "TMA" })
    expect(injectRuntimeDefaults(tool, { indicatorCode: "FCR" }, { indicatorCode: "TMA" })).toEqual({ indicatorCode: "FCR" })
    expect(injectRuntimeDefaults(tool, {}, { indicatorCode: null })).toEqual({})
    expect(injectRuntimeDefaults(findTool("inspect_work_context")!, {}, { indicatorCode: "TMA" })).toEqual({})
    // A validação continua no catálogo: argumento inválido segue rejeitado pelo Zod.
    expect(tool.inputSchema.safeParse(injectRuntimeDefaults(tool, { currentPeriod: { from: "x", to: "y" } }, { indicatorCode: "TMA" })).success).toBe(false)
    expect(tool.inputSchema.safeParse(injectRuntimeDefaults(tool, {}, { indicatorCode: "TMA" })).success).toBe(true)
    expect(renderCommonParametersNote({ mode: "COMPACT", indicatorInFocus: true })).toContain("omita para o indicador em foco")
  })
})
