import { describe, expect, it } from "vitest"
import { projectNodeOutputsForModel } from "./model-context-projection.js"

describe("projeção de nodeOutputs para o modelo (V1.2 — prova do 'JSON gigante')", () => {
  it("o output de Chamar agente (o mesmo conteúdo da Revisão humana) entra no prompt pós-JOIN SEM ids, measurementIds, contextSnapshot ou toolTrace — só texto/estrutura, hipóteses e limitações", () => {
    const agentOutput = {
      kind: "indicator",
      input: {
        organizationId: "00000000-0000-4000-8000-000000000001",
        operatorId: "de00a95b-75ab-4094-88f7-c8e0a239ccb9",
        teamId: "de006e47-4ec0-4b54-8a7e-8bd28f7cc6e0",
        evidenceSourceType: "indicator_period_summary",
        evidenceSourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        contextSnapshot: { periodSummary: { measurementIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] } },
        measuredAt: "2026-09-01T03:00:00.000Z",
        indicatorCode: "TMA",
        indicatorName: "Tempo Médio de Atendimento",
        evidenceFound: "Mês anterior — TMA: 467 SECONDS (meta 400)",
        structured: { title: "TMA acima da meta", summary: "Melhorou 11%", relatedProcedure: "Jeito Vivo", recommendation: "Texto ao colaborador." },
      },
      supportMaterials: [{ materialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", title: "Jeito Vivo de Atender", reason: "motivo" }],
      toolTrace: [{ sequence: 1, tool: "get_indicator_snapshot", argumentsSummary: { indicatorCode: "TMA" }, resultSummary: "TMA: 467 s", startedAt: "2026-09-17T23:00:00.000Z", completedAt: "2026-09-17T23:00:01.000Z", provenance: { method: "resolvedor único…" } }],
      investigation: { toolCalls: 10, budget: 12, outcome: "ANSWERED", tokens: { total: 30119 }, synthesis: { supportedHypotheses: ["acima do subgrupo (F4)"], unsupportedHypotheses: [], limitations: ["amostra de 2 interações"], behavioralClaims: [], recommendationSupport: [] } },
    }
    const projected = JSON.stringify(projectNodeOutputsForModel({ agent: agentOutput, review: { decision: "approved", decidedBy: "Supervisor" } }))
    expect(projected).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)
    expect(projected).not.toContain("toolTrace")
    expect(projected).not.toContain("measurementIds")
    expect(projected).not.toContain("contextSnapshot")
    expect(projected).not.toContain("resolvedor")
    expect(projected).toContain("TMA acima da meta")
    expect(projected).toContain("Texto ao colaborador.")
    expect(projected).toContain("Jeito Vivo de Atender")
    expect(projected).toContain("acima do subgrupo (F4)")
    expect(projected).toContain("amostra de 2 interações")
    expect(projected).toContain('"decision":"approved"')
    // Tamanho: a projeção é uma fração do payload de auditoria.
    expect(projected.length).toBeLessThan(JSON.stringify(agentOutput).length * 0.6)
  })
})
