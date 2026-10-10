import { describe, expect, it } from "vitest"
import { buildReviewPresentation } from "./review-presentation.js"

const agentOutput = {
  kind: "indicator",
  input: {
    organizationId: "00000000-0000-4000-8000-000000000001",
    operatorId: "de00a95b-75ab-4094-88f7-c8e0a239ccb9",
    indicatorName: "Tempo Médio de Atendimento",
    evidenceFound: "Mês anterior — TMA: 467 SECONDS (meta vigente: 400 SECONDS)",
    observedBehavior: "TMA médio de 467 SECONDS no período (meta 400 SECONDS)",
    contextSnapshot: { periodSummary: { measurementIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] } },
    structured: { title: "TMA acima da meta", summary: "Melhorou 11,1% e segue 14,8% acima do subgrupo.", relatedProcedure: "Jeito Vivo de Atender", recommendation: "Texto ao colaborador." },
  },
  supportMaterials: [{ materialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Jeito Vivo de Atender", reason: "orienta o aviso de pausa" }],
  toolTrace: [
    { sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "TMA: 467 s · meta 400 (fora)", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "", round: 0, ledgerRef: "F1" },
    { sequence: 2, tool: "compare_periods", label: "Comparar períodos", capability: "INDICATOR_ANALYSIS", argumentsSummary: {}, resultSummary: "ago 467 × jul 525 → -11,1% · IMPROVED", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "", round: 1, ledgerRef: "F2" },
    { sequence: 3, tool: "compare_population", label: "Comparar com a estrutura", capability: "OPERATIONAL_COMPARISON", argumentsSummary: {}, resultSummary: "SUBGROUP: 467 × 406 (n=24) → +14,8%", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "", round: 1, ledgerRef: "F3" },
    { sequence: 4, tool: "find_interactions", label: "Buscar interações", capability: "INTERACTION_ANALYSIS", argumentsSummary: {}, resultSummary: "orçamento", quality: null, provenance: null, status: "BUDGET_EXCEEDED", startedAt: "", completedAt: "" },
  ],
  investigation: {
    toolCalls: 3, cachedCalls: 0, rejectedCalls: 1, budget: 12, outcome: "ANSWERED", preflightCalls: 1, investigationToolCalls: 2,
    synthesis: { supportedHypotheses: ["acima do subgrupo (F3)"], unsupportedHypotheses: ["causa comportamental"], limitations: ["amostra de 2 interações"], behavioralClaims: [{ text: "na interação analisada você repetiu a confirmação", evidenceRefs: ["F4"], scope: "INTERACTION_SPECIFIC" }], recommendationSupport: [{ text: "Avise antes de pausar", basis: "KNOWLEDGE_GUIDANCE", evidenceRefs: [] }], evidenceRepresentativeness: [{ ref: "F4", tool: "analyze_interactions", analyzed: 2, universe: 1267, level: "ANECDOTAL" }] },
    evidenceGating: { rejectedClaims: [{ kind: "BEHAVIORAL_CLAIM", text: "você costuma…", reason: "escopo" }], corrected: true },
  },
}

describe("Review Presentation (HUMAN REVIEW CONTEXT)", () => {
  it("apresenta resultado, evolução, comparação, evidências, limitações, base das recomendações, materiais e resumo das ferramentas — sem nenhum UUID ou JSON técnico", () => {
    const presentation = buildReviewPresentation(agentOutput)!
    expect(presentation.kind).toBe("indicator")
    expect(presentation.title).toBe("TMA acima da meta")
    expect(presentation.indicator).toEqual({ name: "Tempo Médio de Atendimento", evidence: "Mês anterior — TMA: 467 SECONDS (meta vigente: 400 SECONDS)", observed: "TMA médio de 467 SECONDS no período (meta 400 SECONDS)" })
    expect(presentation.fields.map((field) => field.label)).toEqual(["Procedimento relacionado", "Recomendação"])
    expect(presentation.evolution).toBe("F2 · Comparar períodos: ago 467 × jul 525 → -11,1% · IMPROVED")
    expect(presentation.comparison).toBe("F3 · Comparar com a estrutura: SUBGROUP: 467 × 406 (n=24) → +14,8%")
    expect(presentation.keyEvidence).toEqual(["F1 · Consultar indicador: TMA: 467 s · meta 400 (fora)"])
    expect(presentation.limitations).toEqual(["amostra de 2 interações"])
    expect(presentation.behavioralClaims[0]).toEqual({ text: "na interação analisada você repetiu a confirmação", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F4"] })
    expect(presentation.recommendationSupport[0]!.basis).toBe("KNOWLEDGE_GUIDANCE")
    expect(presentation.representativeness[0]).toMatchObject({ ref: "F4", analyzed: 2, universe: 1267, level: "ANECDOTAL" })
    expect(presentation.materials).toEqual([{ title: "Jeito Vivo de Atender", reason: "orienta o aviso de pausa" }])
    expect(presentation.toolSummary).toEqual({ executed: 3, preflight: 1, investigation: 2, budget: 12, outcome: "ANSWERED", rejectedClaims: 1, corrected: true })
    expect(JSON.stringify(presentation)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
    expect(JSON.stringify(presentation)).not.toContain("contextSnapshot")
  })

  it("texto simples e valores sem estrutura continuam apresentáveis; null/undefined → null", () => {
    expect(buildReviewPresentation("Resposta do Orquestrador")?.summary).toBe("Resposta do Orquestrador")
    expect(buildReviewPresentation({ text: "síntese", results: [{ text: "a" }] })?.kind).toBe("orchestrator")
    expect(buildReviewPresentation(null)).toBeNull()
    expect(buildReviewPresentation(undefined)).toBeNull()
  })
})
