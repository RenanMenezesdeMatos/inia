/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { IndicatorCatalog, IndicatorDependencies } from "@/schemas/admin/indicator-definition.schema"
import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"

import { IndicatorDefinitionForm } from "./indicator-definition-form"

beforeAll(installJsdomStubs)
afterEach(cleanup)

/** Mesmo formato de GET /admin/indicator-rules/catalog — o formulário é dirigido por ele. */
const CATALOG: IndicatorCatalog = {
  units: [
    { value: "PERCENT", label: "Percentual (%)", suffix: "%", decimals: 1, score: false },
    { value: "SECONDS", label: "Segundos (tempo)", suffix: "s", decimals: 0, score: false },
    { value: "COUNT", label: "Quantidade", suffix: "", decimals: 0, score: false },
  ],
  directions: ["HIGHER", "LOWER", "TARGET"],
  granularities: ["DAILY"],
  strategies: [
    { value: "RATE", label: "Taxa", help: "Soma das ocorrências ÷ soma dos elegíveis do período × 100.", requiredComponents: ["value", "numerator", "denominator"], optionalComponents: [], allowedUnits: ["PERCENT"] },
    { value: "WEIGHTED_AVERAGE", label: "Média ponderada", help: "Soma do total ÷ soma do volume/amostra do período (nunca média de médias).", requiredComponents: ["value", "numerator", "denominator"], optionalComponents: ["sampleCount"], allowedUnits: null },
    { value: "LATEST", label: "Último valor", help: "Usa a medição mais recente da janela (snapshot).", requiredComponents: ["value"], optionalComponents: [], allowedUnits: null },
  ],
}

function indicator(partial: Partial<IndicatorWithRules> = {}): IndicatorWithRules {
  return {
    id: "ind-1", code: "TAXA_X", name: "Taxa X", unit: "PERCENT", desiredDirection: "HIGHER", active: true,
    operationalAggregation: "RATE", dailySupported: true, minimumSampleSize: null, minimumCoverage: null, officialClosureSupported: true, provesWorkActivity: false, unjustifiedAbsencePolicy: "NO_SAMPLE", availabilityPolicy: null, iconKey: null,
    calculation: { label: "Taxa consolidada do período", description: "Ocorrências ÷ elegíveis do período × 100." },
    glossaryDescription: null, interpretation: null, goodPractices: null, feedbackGuidance: null, calculationRules: [],
    ...partial,
  }
}

const NO_HISTORY: IndicatorDependencies = { measurements: 0, goals: 0, officialClosures: 0, workflows: [], workflowsOutOfScope: 0, hasHistory: false }
const WITH_HISTORY: IndicatorDependencies = { measurements: 1200, goals: 3, officialClosures: 40, workflows: [{ id: "wf", name: "Modelo · 07" }], workflowsOutOfScope: 0, hasHistory: true }

describe("Formulário de indicador — seções dirigidas pelo catálogo de comportamentos", () => {
  it("mostra as quatro seções, a ajuda contextual da estratégia e os componentes exigidos pela medição", () => {
    render(<IndicatorDefinitionForm catalog={CATALOG} pending={false} error={null} submitLabel="Salvar indicador" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    for (const title of ["Informações básicas", "Comportamento", "Medição operacional", "Fechamento oficial"]) expect(screen.getByRole("heading", { name: title })).toBeInTheDocument()
    expect(screen.getByText(/Soma das ocorrências ÷ soma dos elegíveis/)).toBeInTheDocument()
    expect(screen.getByText(/Cada medição precisa informar valor \+ numerador \+ denominador/)).toBeInTheDocument()
    expect(screen.getByLabelText("Amostra mínima (opcional)")).toBeInTheDocument()
    expect(screen.getByLabelText("Cobertura mínima (%) (opcional)")).toBeInTheDocument()
    expect(screen.getByText(/Periodicidade oficial: mensal \(competência\)/)).toBeInTheDocument()
  })

  it("normaliza o código em maiúsculas e aponta o padrão inválido sem liberar o salvar", () => {
    render(<IndicatorDefinitionForm catalog={CATALOG} pending={false} error={null} submitLabel="Salvar indicador" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    const code = screen.getByLabelText(/Código/) as HTMLInputElement
    fireEvent.change(code, { target: { value: "taxa digital" } })
    expect(code.value).toBe("TAXA DIGITAL")
    expect(screen.getByText(/comece com letra e use só letras maiúsculas/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar indicador" })).toBeDisabled()
  })

  it("envia o payload completo do contrato do produto (metadata operacional, amostra e cobertura em fração)", async () => {
    const onSubmit = vi.fn()
    render(<IndicatorDefinitionForm catalog={CATALOG} initial={indicator()} dependencies={NO_HISTORY} pending={false} error={null} submitLabel="Salvar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Taxa de Resolução Digital" } })
    fireEvent.change(screen.getByLabelText(/Código/), { target: { value: "digital_resolution_rate" } })
    fireEvent.change(screen.getByLabelText("Amostra mínima (opcional)"), { target: { value: "5" } })
    fireEvent.change(screen.getByLabelText("Cobertura mínima (%) (opcional)"), { target: { value: "60" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit).toHaveBeenCalledWith({
      code: "DIGITAL_RESOLUTION_RATE",
      name: "Taxa de Resolução Digital",
      unit: "PERCENT",
      desiredDirection: "HIGHER",
      dailySupported: true,
      operationalAggregation: "RATE",
      minimumSampleSize: 5,
      minimumCoverage: 0.6,
      officialClosureSupported: true,
      provesWorkActivity: false,
      unjustifiedAbsencePolicy: "NO_SAMPLE",
      availabilityPolicy: null,
      iconKey: null,
    })
  })

  it("tratamento de falta injustificada: 'Contribuição zero' só para soma/média de contagens (TMA/taxa bloqueiam); help text explica que não cria medição; override de disponibilidade D-N até HH:MM", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<IndicatorDefinitionForm catalog={CATALOG} initial={indicator({ code: "ATENDIMENTOS", name: "Atendimentos", unit: "COUNT", operationalAggregation: "SUM" })} dependencies={NO_HISTORY} pending={false} error={null} submitLabel="Salvar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByTestId("indicator-absence-policy"))
    fireEvent.click(await screen.findByRole("option", { name: "Contribuição zero" }))
    expect(screen.getByText(/Contribuição zero não cria uma medição artificial/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("indicator-availability-override"))
    fireEvent.change(screen.getByTestId("indicator-availability-lag"), { target: { value: "2" } })
    fireEvent.change(screen.getByTestId("indicator-availability-time"), { target: { value: "08:00" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION", availabilityPolicy: { lagDays: 2, availableByLocalTime: "08:00" } })
    cleanup()
    // TMA (segundos, média ponderada) + contribuição zero → problema de validação, botão desabilitado.
    render(<IndicatorDefinitionForm catalog={CATALOG} initial={indicator({ code: "TMA", name: "TMA", unit: "SECONDS", operationalAggregation: "WEIGHTED_AVERAGE" })} dependencies={NO_HISTORY} pending={false} error={null} submitLabel="Salvar" onSubmit={onSubmit} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByTestId("indicator-absence-policy"))
    fireEvent.click(await screen.findByRole("option", { name: "Contribuição zero" }))
    expect(screen.getByText(/só é válida para soma ou média de contagens/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
  })

  it("com histórico, bloqueia código/unidade/direção/estratégia e desligar a medição operacional — nome continua livre", () => {
    render(<IndicatorDefinitionForm catalog={CATALOG} initial={indicator()} dependencies={WITH_HISTORY} pending={false} error={null} submitLabel="Salvar" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/Este indicador já tem histórico/)).toBeInTheDocument()
    expect(screen.getByText(/1\.200 medições · 3 metas · 40 fechamentos oficiais · 1 Workflow\(s\): Modelo · 07/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Código/)).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "Unidade" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "Direção desejada" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "Estratégia de consolidação" })).toBeDisabled()
    expect(screen.getByRole("switch", { name: /Medição operacional ativada/ })).toBeDisabled()
    expect(screen.getByLabelText("Nome")).toBeEnabled()
    expect(screen.getByLabelText("Amostra mínima (opcional)")).toBeEnabled()
  })

  it("Workflows de outros Grupos entram só pela contagem, nunca pelo nome (lote 2 da 4ª auditoria)", () => {
    const { unmount } = render(<IndicatorDefinitionForm catalog={CATALOG} initial={indicator()} dependencies={{ ...WITH_HISTORY, workflowsOutOfScope: 2 }} pending={false} error={null} submitLabel="Salvar" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/3 Workflow\(s\): Modelo · 07 \+ 2 de outros Grupos/)).toBeInTheDocument()
    unmount()
    render(<IndicatorDefinitionForm catalog={CATALOG} initial={indicator()} dependencies={{ ...NO_HISTORY, workflowsOutOfScope: 1, hasHistory: true }} pending={false} error={null} submitLabel="Salvar" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/\(1 Workflow\(s\): 1 de outros Grupos\)/)).toBeInTheDocument()
  })

  it("sem histórico nada fica bloqueado; desligar a medição operacional esconde amostra/cobertura e exige ao menos uma capacidade", () => {
    render(<IndicatorDefinitionForm catalog={CATALOG} initial={indicator()} dependencies={NO_HISTORY} pending={false} error={null} submitLabel="Salvar" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(/já tem histórico/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Código/)).toBeEnabled()
    fireEvent.click(screen.getByRole("switch", { name: /Medição operacional ativada/ }))
    expect(screen.queryByLabelText("Amostra mínima (opcional)")).not.toBeInTheDocument()
    expect(screen.getByText(/só participa de Workflows por períodos mensais/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("switch", { name: "Pode receber fechamento oficial" }))
    expect(screen.getByText(/ao menos uma capacidade/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
  })

  it("estratégia incompatível com a unidade (Taxa em segundos) é apontada e bloqueia o salvar", () => {
    render(<IndicatorDefinitionForm catalog={CATALOG} initial={indicator({ unit: "SECONDS", operationalAggregation: "RATE" })} dependencies={NO_HISTORY} pending={false} error={null} submitLabel="Salvar" onSubmit={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/A estratégia "Taxa" só é válida para Percentual/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar" })).toBeDisabled()
  })
})
