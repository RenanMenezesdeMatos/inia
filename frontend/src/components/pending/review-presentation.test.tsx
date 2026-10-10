/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ReviewPresentationView } from "./review-presentation"
import type { ReviewPresentation } from "@/schemas/pending-actions/review-presentation.schema"

afterEach(cleanup)

const presentation: ReviewPresentation = {
  kind: "indicator",
  title: "TMA acima da meta",
  summary: "Melhorou 11,1% e segue 14,8% acima do subgrupo.",
  indicator: { name: "Tempo Médio de Atendimento", evidence: "Mês anterior — TMA: 467 SECONDS (meta vigente: 400 SECONDS)", observed: null },
  fields: [{ label: "Recomendação", text: "Texto ao colaborador." }],
  evolution: "F2 · Comparar períodos: ago 467 × jul 525 → -11,1% · IMPROVED",
  comparison: "F3 · Comparar com a estrutura: SUBGROUP: 467 × 406 (n=24) → +14,8%",
  keyEvidence: ["F1 · Consultar indicador: TMA: 467 s · meta 400 (fora)"],
  limitations: ["amostra de 2 interações"],
  supportedHypotheses: [],
  unsupportedHypotheses: [],
  behavioralClaims: [{ text: "Na interação analisada você repetiu a confirmação", scope: "INTERACTION_SPECIFIC", evidenceRefs: ["F4"] }],
  recommendationSupport: [{ text: "Avise antes de pausar", basis: "KNOWLEDGE_GUIDANCE", evidenceRefs: [] }],
  representativeness: [{ ref: "F4", analyzed: 2, universe: 1267, level: "ANECDOTAL" }],
  materials: [{ title: "Jeito Vivo de Atender", reason: "orienta o aviso de pausa" }],
  toolSummary: { executed: 10, preflight: 3, investigation: 7, budget: 12, outcome: "ANSWERED", rejectedClaims: 1, corrected: true },
}

describe("Review Presentation (Revisão humana — desktop e mobile)", () => {
  it("mostra resultado, indicador, evolução, comparação, evidências, escopo/representatividade, limitações, base das recomendações, materiais e resumo das ferramentas; detalhes técnicos só no Collapsible", () => {
    render(<ReviewPresentationView presentation={presentation} technicalDetails={<pre data-testid="raw-json">{"{ organizationId: … }"}</pre>} />)
    const view = screen.getByTestId("review-presentation")
    expect(view).toHaveTextContent("TMA acima da meta")
    expect(view).toHaveTextContent("Tempo Médio de Atendimento")
    expect(view).toHaveTextContent("ago 467 × jul 525 → -11,1%")
    expect(view).toHaveTextContent("SUBGROUP: 467 × 406 (n=24)")
    expect(view).toHaveTextContent("F1 · Consultar indicador")
    expect(view).toHaveTextContent("Nesta(s) interação(ões)")
    expect(view).toHaveTextContent("2 analisada(s) de 1267 registrada(s) no período")
    expect(view).toHaveTextContent("Anedótica")
    expect(view).toHaveTextContent("amostra de 2 interações")
    expect(view).toHaveTextContent("Avise antes de pausar — Orientação da base de conhecimento")
    expect(view).toHaveTextContent("Jeito Vivo de Atender — orienta o aviso de pausa")
    expect(screen.getByTestId("review-tool-summary")).toHaveTextContent("10 chamada(s) · 3 no preflight · 7 escolhida(s) pelo Agent de 12 · respondida · 1 afirmação(ões) sem evidência corrigida(s)")
    expect(screen.queryByTestId("raw-json")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("review-technical-details"))
    expect(screen.getByTestId("raw-json")).toBeInTheDocument()
  })

  it("mobile (375px): o mesmo conteúdo continua legível em coluna única, sem tabela técnica", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 375 })
    window.dispatchEvent(new Event("resize"))
    render(<ReviewPresentationView presentation={{ ...presentation, evolution: null, comparison: null }} />)
    const view = screen.getByTestId("review-presentation")
    expect(view).toHaveTextContent("TMA acima da meta")
    expect(view.querySelector("table")).toBeNull()
    expect(screen.queryByTestId("review-technical-details")).not.toBeInTheDocument()
  })
})
