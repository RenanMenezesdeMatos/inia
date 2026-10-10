import { describe, expect, it } from "vitest"
import { describeReviewContent } from "./review-content.js"

describe("describeReviewContent", () => {
  it("texto e resposta de orquestrador viram o próprio texto", () => {
    expect(describeReviewContent("Olá **mundo**")).toBe("Olá **mundo**")
    expect(describeReviewContent({ text: "### Diagnóstico\n- a", results: [] })).toBe("### Diagnóstico\n- a")
  })

  it("resultado estruturado de agente vira seções rotuladas", () => {
    const text = describeReviewContent({ kind: "monitoring", input: { structured: { impactedIndicator: "TMA", recommendation: "Revise o fechamento.", evidenceFound: "" } } })
    expect(text).toBe("**Indicador impactado:** TMA\n\n**Recomendação:** Revise o fechamento.")
  })

  it("objeto desconhecido vira bloco JSON; vazio vira null", () => {
    expect(describeReviewContent({ flags: { q4: true } })).toMatch(/^```json\n[\s\S]*"q4": true[\s\S]*```$/)
    expect(describeReviewContent(undefined)).toBeNull()
    expect(describeReviewContent("   ")).toBeNull()
  })
})

describe("describeReviewContent — materiais de apoio recomendados", () => {
  it("o revisor vê os materiais (título real + motivo) que acompanharão o feedback", () => {
    const text = describeReviewContent({
      kind: "monitoring",
      input: { structured: { recommendation: "Explique a composição da conta." } },
      supportMaterials: [{ materialId: "11111111-1111-4111-8111-111111111111", title: "Contestação de Contas Móvel", reason: "Mostra como explicar a composição da conta antes de registrar." }],
    })
    expect(text).toContain("**Recomendação:** Explique a composição da conta.")
    expect(text).toContain("**Material de apoio recomendado:**")
    expect(text).toContain("- **Contestação de Contas Móvel** — Mostra como explicar a composição da conta antes de registrar.")
    expect(text).not.toContain("11111111-1111-4111-8111-111111111111")
  })

  it("plural com vários; nada quando a lista está vazia ou ausente", () => {
    const structured = (materials: unknown) => ({ kind: "monitoring", input: { structured: { recommendation: "R" } }, supportMaterials: materials })
    expect(describeReviewContent(structured([{ materialId: "a", title: "A", reason: "motivo a" }, { materialId: "b", title: "B", reason: "motivo b" }]))).toContain("**Materiais de apoio recomendados:**")
    expect(describeReviewContent(structured([]))).toBe("**Recomendação:** R")
    expect(describeReviewContent(structured(undefined))).toBe("**Recomendação:** R")
  })

  it("resposta de Orquestrador (texto) também mostra os materiais recomendados ao revisor", () => {
    const text = describeReviewContent({ text: "Síntese final.", orchestratorName: "Retenção", supportMaterials: [{ materialId: "a", title: "Técnicas de sondagem", reason: "Traz perguntas de sondagem para retenção por preço." }] })
    expect(text).toBe("Síntese final.\n\n**Material de apoio recomendado:**\n- **Técnicas de sondagem** — Traz perguntas de sondagem para retenção por preço.")
  })
})

describe("describeReviewContent — ferramentas de investigação utilizadas", () => {
  const trace = [
    { sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: { indicatorCode: "TMA" }, resultSummary: "TMA: 452 s no período · meta 400 (fora)", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "" },
    { sequence: 2, tool: "find_interactions", label: "Buscar interações", capability: "INTERACTION_ANALYSIS", argumentsSummary: {}, resultSummary: "não disponível", quality: null, provenance: null, status: "REJECTED", startedAt: "", completedAt: "" },
  ]

  it("o revisor vê a lista numerada das Tools concluídas com o resumo do resultado (nunca prompt/raciocínio); rejeitadas ficam de fora", () => {
    const text = describeReviewContent({ kind: "indicator", input: { structured: { title: "TMA acima da meta", recommendation: "Reveja a sondagem." } }, toolTrace: trace })!
    expect(text).toContain("**Ferramentas de investigação utilizadas:**\n1. Consultar indicador — TMA: 452 s no período · meta 400 (fora)")
    expect(text).not.toContain("Buscar interações")
    expect(text).not.toContain("REJECTED")
  })

  it("resposta de Orquestrador: o trace dos especialistas também aparece", () => {
    const text = describeReviewContent({ text: "síntese", results: [{ agentId: "a", toolName: "t", text: "x", toolTrace: [trace[0]] }] })!
    expect(text).toBe("síntese\n\n**Ferramentas de investigação utilizadas:**\n1. Consultar indicador — TMA: 452 s no período · meta 400 (fora)")
  })
})
