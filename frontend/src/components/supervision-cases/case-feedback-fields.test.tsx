/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { CaseFeedbackFields } from "./case-feedback-fields"

afterEach(() => cleanup())

const FEEDBACK = {
  id: "f-1",
  status: "PUBLISHED",
  kind: "MONITORING" as const,
  impactedIndicator: "Contestação de cobrança",
  evidenceFound: "Operador: “Isso não é comigo, vou te transferir para o setor de faturamento.”",
  observedBehavior: "Informar prazo da análise: A conduta nesta chamada não seguiu o que esta etapa pede.",
  relatedProcedure: "Procedimento Operacional — Contestação de Contas Móvel",
  recommendation: "Antes de transferir, você precisa **informar o número do protocolo**.\n\n- Explique o motivo.\n- Repasse o contexto.",
  suggestedApproach: null,
}

describe("feedback estruturado do caso", () => {
  it("a recomendação do redator sai formatada (negrito e lista), sem os asteriscos crus", () => {
    const { container } = render(<CaseFeedbackFields feedback={FEEDBACK} />)
    expect(screen.getByText("informar o número do protocolo").tagName).toBe("STRONG")
    expect(screen.getByText("Explique o motivo.").closest("li")).not.toBeNull()
    expect(container.textContent).not.toContain("**")
  })

  it("no feedback de indicador a medição crua aparece no formato do produto; no de monitoria nada é reformatado", () => {
    const indicator = { ...FEEDBACK, kind: "INDICATOR" as const, evidenceFound: "Mês anterior — TMA: 466.95238095238096 SECONDS (meta vigente: 400 SECONDS)", observedBehavior: "TMA médio de 466.95 SECONDS no período (meta 400 SECONDS)" }
    const { rerender } = render(<CaseFeedbackFields feedback={indicator} />)
    expect(screen.getByText("Mês anterior — TMA: 7m47s (meta vigente: 6m40s)")).toBeInTheDocument()
    expect(screen.getByText("TMA médio de 7m47s no período (meta 6m40s)")).toBeInTheDocument()
    const monitoring = { ...FEEDBACK, evidenceFound: "Cliente: “são 400 SECONDS de espera”" }
    rerender(<CaseFeedbackFields feedback={monitoring} />)
    expect(screen.getByText(monitoring.evidenceFound)).toBeInTheDocument()
  })

  it("evidência literal e rótulos continuam texto puro; sem abordagem, 'Não informada'", () => {
    render(<CaseFeedbackFields feedback={FEEDBACK} />)
    expect(screen.getByText(FEEDBACK.evidenceFound)).toBeInTheDocument()
    expect(screen.getByText(FEEDBACK.relatedProcedure)).toBeInTheDocument()
    expect(screen.getByText("Não informada")).toBeInTheDocument()
  })
})
