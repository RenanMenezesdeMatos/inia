import { describe, expect, it } from "vitest"
import { evidenceSourceCoverage, EVIDENCE_SOURCES, renderEvidenceSources, sourcesAvailable, sourcesUsed, TOOL_EVIDENCE_SOURCE } from "./evidence-sources.js"
import { TOOL_KEYS } from "./tool-catalog.js"
import type { LedgerEntry } from "./evidence-ledger.js"

const entry = (ref: string, tool: string): LedgerEntry => ({ ref, sequence: 1, round: 1, tool, capability: "x", keyArgs: "", summary: "", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: null, periodLabel: null, preflight: false })

describe("fontes de evidência (V1.3.2 — §28/§29)", () => {
  it("toda Tool do catálogo tem fonte mapeada (ou null explícito) — determinístico", () => {
    for (const tool of TOOL_KEYS) expect(tool in TOOL_EVIDENCE_SOURCE).toBe(true)
    expect(TOOL_EVIDENCE_SOURCE.get_employee_history).toBe("TEMPORAL_HISTORY")
    expect(TOOL_EVIDENCE_SOURCE.get_interaction_flags).toBe("INTERACTION_EVENTS")
    expect(TOOL_EVIDENCE_SOURCE.synthesize_evidence).toBeNull()
  })

  it("cobertura = fontes disponíveis (Tools declaradas) × consultadas (ledger); o bloco lista ✓/— e faz a pergunta de lacuna, sem mandar chamar Tool", () => {
    const coverage = evidenceSourceCoverage(["find_interactions", "analyze_interactions", "get_employee_history", "query_knowledge"], [entry("F1", "find_interactions"), entry("F2", "analyze_interactions")])
    expect(coverage.map((item) => `${item.source}:${item.used}`)).toEqual(["INTERACTION_CONTENT:true", "INTERACTION_EVENTS:true", "TEMPORAL_HISTORY:false", "KNOWLEDGE:false"])
    const block = renderEvidenceSources(coverage)
    expect(block).toContain("✓ Conteúdo das interações")
    expect(block).toContain("— Histórico/evolução no tempo: get_employee_history")
    expect(block).toContain("que TIPO de evidência ainda poderia mudar a conclusão")
    expect(block).toContain("não consulte uma fonte só porque está listada")
    expect(block).not.toMatch(/chame|obrigat/i)
    expect(sourcesUsed([entry("F1", "segment_indicator")])).toEqual(["SEGMENTATION"])
    expect(sourcesAvailable(["query_knowledge", "recommend_support_materials"])).toEqual(["KNOWLEDGE"])
    expect(EVIDENCE_SOURCES).toHaveLength(9)
  })
})
