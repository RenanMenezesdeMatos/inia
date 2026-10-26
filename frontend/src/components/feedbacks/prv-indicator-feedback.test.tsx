/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"
import { prvSupervisorViewSchema } from "@/schemas/feedbacks/prv-supervisor-view.schema"
import fixture from "./__fixtures__/prv-indicator-views.json"
import { FeedbackNarrativeView } from "./feedback-narrative-view"
import { PrvSupervisorDiagnosis } from "./prv-supervisor-diagnosis"

afterEach(cleanup)

/** View models REAIS gerados pelo backend (`scripts/dev/prv-view-fixture.ts`) — o contrato é o schema. */
const COLLABORATOR = feedbackViewSchema.parse(fixture.collaborator)
const SUPERVISOR = prvSupervisorViewSchema.parse(fixture.supervisor)
const TECHNICAL = /READY|HOLD_FOR_QA|VERIFIED|BEHAVIOR:|RECAPITULATE|practiceKey|Subgrupo|equipe|colegas|INCONCLUSIVE|ACTIONABLE/

describe("Indicator Diagnosis V1 — feedback de indicador no Acompanhamento", () => {
  it("colaborador: narrativa natural primeiro; detalhes fechados; nada técnico, nada do grupo", () => {
    const { container } = render(<FeedbackNarrativeView view={COLLABORATOR} />)
    expect(screen.getByText("Olá, Larissa!")).toBeInTheDocument()
    expect(screen.getByText(/seu TMA oficial foi de 495 s, fora da meta de 450 s/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Entenda este feedback/ })).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Resultado do ciclo · agosto de 2026")).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(TECHNICAL)
    expect(container.textContent).not.toMatch(/por causa|causou|mais rápido|encerre mais cedo/i)
  })

  it("detalhes do indicador: resultado do ciclo (oficial), o que trabalhar com exemplos das chamadas e a regra; materiais fora dos detalhes", () => {
    render(<FeedbackNarrativeView view={COLLABORATOR} />)
    expect(screen.getByRole("heading", { name: /^Materiais utilizados/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Entenda este feedback/ }))
    expect(screen.getByText(/O resultado do ciclo, o padrão encontrado/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Resultado do ciclo · agosto de 2026" }))
    expect(screen.getByText("495 s")).toBeInTheDocument()
    expect(screen.getByText("Q4 (Q1 = melhor, Q4 = pior)")).toBeInTheDocument()
    expect(screen.getByText("90,9%")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "O que trabalhar no próximo ciclo" }))
    fireEvent.click(screen.getByRole("button", { name: "Recapitulação" }))
    expect(screen.getByText("Exemplos das chamadas")).toBeInTheDocument()
    expect(screen.getAllByText(/Em uma chamada de \d\d\/08, você disse/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Antes de encerrar, recapitule o que foi feito/, { selector: "blockquote" })).toBeInTheDocument()
    expect(screen.getAllByText(/Nas próximas chamadas de contestação de cobrança: antes de encerrar/).length).toBeGreaterThanOrEqual(1)
  })

  it("gestão: diagnóstico técnico sob demanda com população, reuso, padrões com denominadores, Subgrupo (não atribuído) e limitações", () => {
    const { container } = render(<PrvSupervisorDiagnosis view={SUPERVISOR} />)
    const trigger = screen.getByRole("button", { name: /Diagnóstico técnico \(gestão\)/ })
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(trigger)
    expect(container.textContent).toContain("Elegíveis: 12 · analisadas: 6 · reaproveitadas: 2")
    expect(container.textContent).toContain("4 de 6 (66,7%)")
    expect(container.textContent).toContain("Confirmação de entendimento: a desenvolver (13 de 18 não seguidas)")
    expect(container.textContent).toContain("A mudança de mix coincidiu com o resultado do fechamento; composição não demonstra causa.")
    expect(container.textContent).toMatch(/associação e composição não são causa/)
  })

  it("gestão (V1.0.1): cobertura da avaliação — etapas centrais planejadas, faltantes/inconsistentes na 1ª resposta, revisões e o que restou", () => {
    const coverage = { status: "completa", interactionCount: 10, mustAssessPlanned: 100, missingInitial: 84, inconsistentInitial: 6, repairInteractions: 10, repairTargets: 90, missingAfterRepair: 0, inconsistentAfterRepair: 0, budgetSkipped: 0, interactions: [] }
    const view = prvSupervisorViewSchema.parse({ ...fixture.supervisor, indicators: fixture.supervisor.indicators.map((indicator) => ({ ...indicator, coverage })) })
    const { container } = render(<PrvSupervisorDiagnosis view={view} />)
    fireEvent.click(screen.getByRole("button", { name: /Diagnóstico técnico \(gestão\)/ }))
    expect(screen.getByLabelText("Cobertura da avaliação")).toHaveTextContent("Cobertura da avaliação (completa): 100 etapas centrais planejadas em 10 chamadas · faltando na 1ª resposta: 84 · inconsistentes: 6 · revisadas: 10 chamada(s) (90 etapas) · ainda faltando: 0 · ainda inconsistentes: 0")
    expect(container.textContent).not.toMatch(/CP-|MUST_ASSESS|OMISSION/)
    // Diagnóstico anterior (sem cobertura) continua válido e sem a linha.
    cleanup()
    render(<PrvSupervisorDiagnosis view={SUPERVISOR} />)
    fireEvent.click(screen.getByRole("button", { name: /Diagnóstico técnico \(gestão\)/ }))
    expect(screen.queryByLabelText("Cobertura da avaliação")).toBeNull()
  })
})
