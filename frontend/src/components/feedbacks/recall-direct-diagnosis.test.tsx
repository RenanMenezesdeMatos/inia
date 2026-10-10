// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { feedbackViewSchema } from "@/schemas/feedbacks/feedback-view.schema"
import { prvSupervisorViewSchema } from "@/schemas/feedbacks/prv-supervisor-view.schema"
import fixture from "./__fixtures__/recall-direct-views.json"
import { FeedbackNarrativeView } from "./feedback-narrative-view"
import { PrvSupervisorDiagnosis } from "./prv-supervisor-diagnosis"

afterEach(cleanup)

/** View models PUBLICADOS na homologação real de Rechamada V1 (diagnóstico direto, sem PRV) — o contrato é o schema. */
const COLLABORATOR = feedbackViewSchema.parse(fixture.collaborator)
const SUPERVISOR = prvSupervisorViewSchema.parse(fixture.supervisor)

describe("Indicator Diagnosis V2 — Rechamada (diagnóstico direto) no Acompanhamento", () => {
  it("colaborador: narrativa humana com o resultado e onde as rechamadas aparecem; sem PRV, sem causa, sem jargão técnico", () => {
    const { container } = render(<FeedbackNarrativeView view={COLLABORATOR} />)
    expect(screen.getByText("Olá, Joana!")).toBeInTheDocument()
    expect(screen.getByText(/o resultado oficial de Rechamada foi de 14,6%, fora da meta de 10%/)).toBeInTheDocument()
    expect(screen.getByText(/Contestação de cobrança reuniu 5 delas/)).toBeInTheDocument()
    expect(screen.getByText(/não indicam qual atendimento anterior o originou/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/PRV|fechamento|porque|por causa|causou|reduzir|DIRECT_INDICATOR|SIGNAL_|PROCESS_ASSESSMENT/i)
  })

  it("gestão: origem direta, estratégia e versão, passos escolhidos pela IA × indisponíveis, tabela do sinal com denominadores e a lacuna de evidência", () => {
    const { container } = render(<PrvSupervisorDiagnosis view={SUPERVISOR} />)
    fireEvent.click(screen.getByRole("button", { name: /Diagnóstico técnico/ }))
    expect(screen.getByText("Origem: Diagnóstico direto do indicador (sem PRV)")).toBeInTheDocument()
    expect(screen.getByText(/Investigação · estratégia v1/)).toBeInTheDocument()
    expect(screen.getByText(/Orientado pela IA — escolhidos pela IA a partir da estratégia/)).toBeInTheDocument()
    expect(screen.getByText("Interações sinalizadas por motivo")).toBeInTheDocument()
    expect(screen.getByText(/Indisponível: Avaliar processos nos atendimentos — os dados de interação não trazem vínculo/)).toBeInTheDocument()
    expect(screen.getByText(/7 de 48 interações atendidas \(14,6%\) · concentrado em um motivo/)).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "35,7%" })).toBeInTheDocument()
    expect(screen.getByText(/Evidência comportamental indisponível/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/)
  })
})
