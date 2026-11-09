/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { IndicatorCatalog, IndicatorCorrectionImpact } from "@/schemas/admin/indicator-definition.schema"
import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"

const state = vi.hoisted(() => ({
  preview: { data: undefined as unknown, isFetching: false, isError: false, error: null as Error | null, refetch: vi.fn() },
  lastFields: undefined as unknown,
  apply: { mutateAsync: vi.fn(), isPending: false, isError: false, error: null as Error | null },
}))

vi.mock("@/queries/admin/use-indicator-rule-queries", () => ({
  useIndicatorCorrectionPreviewQuery: (_id: string, fields: unknown) => {
    state.lastFields = fields
    return fields ? state.preview : { data: undefined, isFetching: false, isError: false, error: null, refetch: vi.fn() }
  },
  useApplyIndicatorCorrectionMutation: () => state.apply,
}))

import { IndicatorCorrectionPanel } from "./indicator-correction-panel"

beforeAll(installJsdomStubs)
afterEach(cleanup)

const CATALOG: IndicatorCatalog = {
  units: [
    { value: "COUNT", label: "Quantidade", suffix: "", decimals: 0, score: false },
    { value: "SECONDS", label: "Segundos (tempo)", suffix: "s", decimals: 0, score: false },
  ],
  directions: ["HIGHER", "LOWER", "TARGET"],
  granularities: ["DAILY"],
  strategies: [
    { value: "SUM", label: "Soma", help: "", requiredComponents: ["value"], optionalComponents: [], allowedUnits: null },
    { value: "WEIGHTED_AVERAGE", label: "Média ponderada", help: "", requiredComponents: ["value", "numerator", "denominator"], optionalComponents: [], allowedUnits: null },
  ],
}

const INDICATOR = { id: "ind-1", code: "QA_TEMPO", name: "Tempo", unit: "COUNT", desiredDirection: "HIGHER", operationalAggregation: "SUM" } as IndicatorWithRules

function impact(partial: Partial<IndicatorCorrectionImpact> = {}): IndicatorCorrectionImpact {
  return {
    indicator: { id: "ind-1", code: "QA_TEMPO", name: "Tempo" },
    current: { unit: "COUNT", desiredDirection: "HIGHER", operationalAggregation: "SUM" },
    next: { unit: "COUNT", desiredDirection: "HIGHER", operationalAggregation: "WEIGHTED_AVERAGE" },
    changes: [{ field: "operationalAggregation", label: "Estratégia de consolidação", from: "Soma", to: "Média ponderada" }],
    calculation: { before: { label: "Soma do período", description: "Soma dos valores." }, after: { label: "Média ponderada pelo volume", description: "Soma do total ÷ soma do volume do período." } },
    history: { measurements: 15, goals: 2, officialClosures: 0, workflows: 1 },
    measurements: { requiredComponents: ["value", "numerator", "denominator"], missingComponents: 0, incoherentValues: 0, outOfUnitRange: 0, unusedComponents: 0, examples: [] },
    allowedAggregations: ["Média ponderada pelo volume", "Mínimo"],
    workflows: { activePublished: [], pausedPublished: [], drafts: [], outOfScope: { activePublished: 0, pausedPublished: 0, drafts: 0 } },
    zeroContributionReset: false,
    blockers: [],
    notices: [],
    canApply: true,
    ...partial,
  }
}

function renderPanel() {
  const onApplied = vi.fn()
  const onCancel = vi.fn()
  render(<IndicatorCorrectionPanel catalog={CATALOG} indicator={INDICATOR} onApplied={onApplied} onCancel={onCancel} />)
  return { onApplied, onCancel }
}

async function chooseStrategy() {
  fireEvent.click(screen.getByRole("combobox", { name: "Como consolidar no período" }))
  fireEvent.click(await screen.findByRole("option", { name: "Média ponderada" }))
}

beforeEach(() => {
  state.preview = { data: impact(), isFetching: false, isError: false, error: null, refetch: vi.fn() }
  state.apply = { mutateAsync: vi.fn(async () => undefined), isPending: false, isError: false, error: null }
  state.lastFields = undefined
})

describe("correção de unidade, direção ou cálculo", () => {
  it("diz em linguagem simples o que muda e o que fica; sem mudança, não pede prévia e não deixa aplicar", () => {
    renderPanel()
    expect(screen.getByText(/O resultado de períodos passados e futuros passa a ser calculado pela regra nova, em todas as telas\. Fechamentos oficiais e feedbacks já entregues ficam como estão\./)).toBeInTheDocument()
    expect(state.lastFields).toBeNull()
    expect(screen.getByText("Escolha o que corrigir para ver o impacto.")).toBeInTheDocument()
    expect(screen.queryByTestId("indicator-correction-impact")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aplicar correção" })).toBeDisabled()
  })

  it("só envia o que mudou e mostra o impacto vindo do servidor", async () => {
    renderPanel()
    await chooseStrategy()
    expect(state.lastFields).toEqual({ operationalAggregation: "WEIGHTED_AVERAGE" })
    const view = within(screen.getByTestId("indicator-correction-impact"))
    expect(view.getByText(/Soma →/)).toBeInTheDocument()
    expect(view.getByText("Média ponderada")).toBeInTheDocument()
    expect(view.getByText("15")).toBeInTheDocument()
    expect(view.getByText("Medições sem numerador e denominador")).toBeInTheDocument()
    expect(view.getByText("Medições com valor que não confere")).toBeInTheDocument()
  })

  it("só libera com motivo e o código digitado; envia os dois e fecha", async () => {
    const { onApplied } = renderPanel()
    await chooseStrategy()
    const submit = screen.getByRole("button", { name: "Aplicar correção" })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "curto" } })
    fireEvent.change(screen.getByLabelText(/Para confirmar, digite o código/), { target: { value: "QA_TEMPO" } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "Cadastrado com a estratégia errada" } })
    fireEvent.change(screen.getByLabelText(/Para confirmar, digite o código/), { target: { value: "OUTRO" } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Para confirmar, digite o código/), { target: { value: "qa_tempo" } })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    expect(state.apply.mutateAsync).toHaveBeenCalledWith({ id: "ind-1", fields: { operationalAggregation: "WEIGHTED_AVERAGE" }, reason: "Cadastrado com a estratégia errada", confirmation: "qa_tempo" })
  })

  it("com bloqueio mostra o motivo e os exemplos, esconde motivo e confirmação, e não deixa aplicar", async () => {
    state.preview.data = impact({
      canApply: false,
      blockers: [{ code: "MISSING_COMPONENTS", message: "3 medições não têm numerador e denominador." }],
      measurements: { requiredComponents: ["value", "numerator", "denominator"], missingComponents: 3, incoherentValues: 0, outOfUnitRange: 0, unusedComponents: 0, examples: [{ issue: "MISSING_COMPONENTS", employeeLabel: "Ana (OP-1)", date: "2026-09-15", value: 10, numerator: null, denominator: null, expected: null }] },
    })
    renderPanel()
    await chooseStrategy()
    const blockers = within(screen.getByTestId("indicator-correction-blockers"))
    expect(blockers.getByText("3 medições não têm numerador e denominador.")).toBeInTheDocument()
    expect(blockers.getByText(/Ana \(OP-1\), 15\/09\/2026: valor 10 \(sem numerador e denominador\)/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Motivo da correção")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aplicar correção" })).toBeDisabled()
  })

  it("lista os Workflows pelo nome com link, o que cada nó usa e a contagem dos de outros Grupos", async () => {
    const workflow = { id: "wf-1", name: "Fluxo de TMA", inFlightEnrollments: 2, uses: [{ nodeLabel: "Limite", problem: "AGGREGATION" as const, aggregationLabel: "Soma", message: 'O nó "Limite" usa "Soma".' }] }
    state.preview.data = impact({ canApply: false, blockers: [{ code: "ACTIVE_WORKFLOWS", message: "1 Workflow ativo depende de uma configuração que a regra nova não aceita." }], workflows: { activePublished: [workflow], pausedPublished: [], drafts: [{ ...workflow, id: "wf-2", name: "Rascunho", inFlightEnrollments: 0 }], outOfScope: { activePublished: 1, pausedPublished: 0, drafts: 0 } } })
    renderPanel()
    await chooseStrategy()
    expect(screen.getByRole("link", { name: /Fluxo de TMA/ })).toHaveAttribute("href", "/admin/workflows/wf-1")
    expect(screen.getByText(/2 execuções em andamento param com o motivo/)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Workflows ativos que precisam ser pausados antes" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Rascunhos: publicar é recusado até ajustar" })).toBeInTheDocument()
    expect(screen.getByText(/1 Workflow de outro Grupo: só quem administra/)).toBeInTheDocument()
    expect(screen.getByText(/A regra nova aceita: Média ponderada pelo volume, Mínimo\./)).toBeInTheDocument()
  })

  it("recusa do servidor ao aplicar aparece na tela e a prévia é lida de novo", async () => {
    state.apply.mutateAsync = vi.fn(async () => {
      throw new Error("Bloqueado")
    })
    const { onApplied } = renderPanel()
    await chooseStrategy()
    fireEvent.change(screen.getByLabelText("Motivo da correção"), { target: { value: "Cadastrado com a estratégia errada" } })
    fireEvent.change(screen.getByLabelText(/Para confirmar, digite o código/), { target: { value: "QA_TEMPO" } })
    fireEvent.click(screen.getByRole("button", { name: "Aplicar correção" }))
    await waitFor(() => expect(state.preview.refetch).toHaveBeenCalledTimes(1))
    expect(onApplied).not.toHaveBeenCalled()
  })

  it("erro da prévia (ex.: sem escopo de organização) aparece com a mensagem do servidor", async () => {
    state.preview = { data: undefined, isFetching: false, isError: true, error: new Error("Só quem administra toda a organização pode alterá-los."), refetch: vi.fn() }
    renderPanel()
    await chooseStrategy()
    expect(screen.getByRole("alert")).toHaveTextContent("Só quem administra toda a organização")
  })
})
