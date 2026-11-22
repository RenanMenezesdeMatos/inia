/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"
import type { FlowNode, HistoricalQuery } from "@/schemas/admin/workflow-graph.schema"

import { HistoricalConditionForm, minimumCoverageApplies } from "./historical-condition-form"

afterEach(cleanup)
// Radix Select no jsdom: abrir a lista precisa de scrollIntoView.
Element.prototype.scrollIntoView ??= () => {}

const TMA: IndicatorWithRules = {
  id: "tma", code: "TMA", name: "Tempo médio de atendimento", unit: "SECONDS", desiredDirection: "LOWER", active: true,
  operationalAggregation: "WEIGHTED_AVERAGE", dailySupported: true, minimumSampleSize: 3, minimumCoverage: 0.7, officialClosureSupported: true, provesWorkActivity: false, unjustifiedAbsencePolicy: "NO_SAMPLE", availabilityPolicy: null, iconKey: null,
  glossaryDescription: null, interpretation: null, goodPractices: null, feedbackGuidance: null, calculationRules: [],
}

vi.mock("@/queries/admin/use-indicator-rule-queries", () => ({
  useIndicatorsWithRulesQuery: () => ({ data: [TMA], isLoading: false }),
}))

type ConditionNode = Extract<FlowNode, { type: "condition" }>

function conditionWith(query: HistoricalQuery): ConditionNode {
  return { id: "cond", type: "condition", label: "Condição", position: { x: 0, y: 0 }, config: { comparator: "LT", thresholdNumeric: 100, historicalQuery: query } }
}

function renderForm(node: ConditionNode) {
  const onChange = vi.fn()
  render(<HistoricalConditionForm node={node} onChange={onChange} />)
  return onChange
}

function chooseTma() {
  fireEvent.click(screen.getByRole("combobox", { name: "Indicador" }))
  fireEvent.click(screen.getByRole("option", { name: "Tempo médio de atendimento" }))
}

const lastQuery = (onChange: ReturnType<typeof vi.fn>) => (onChange.mock.calls.at(-1)![0] as ConditionNode).config.historicalQuery!

describe("Condição › Cobertura mínima só onde ela existe", () => {
  it("regra única: só o Valor do indicador com agregação tem cobertura", () => {
    expect(minimumCoverageApplies(undefined, "WEIGHTED_AVERAGE")).toBe(true)
    expect(minimumCoverageApplies("MEASUREMENT", "AVERAGE")).toBe(true)
    expect(minimumCoverageApplies("MEASUREMENT", "COUNT")).toBe(false)
    expect(minimumCoverageApplies("INDICATOR_ACHIEVEMENT", "AVERAGE")).toBe(false)
    expect(minimumCoverageApplies("PRV_ACHIEVEMENT", "AVERAGE")).toBe(false)
  })

  it("Atingimento por fechamentos: escolher o indicador não pré-preenche a cobertura do catálogo (campo escondido)", () => {
    const onChange = renderForm(conditionWith({ kind: "INDICATOR_THRESHOLD_COUNT", source: "INDICATOR_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 2 } }))
    chooseTma()
    const query = lastQuery(onChange)
    expect(query.indicatorCode).toBe("TMA")
    expect(query.minimumCoverage).toBeUndefined()
    expect(query.minimumSampleSize).toBe(3)
    expect(screen.queryByLabelText(/Cobertura mínima de dias/)).toBeNull()
  })

  it("Valor do indicador: a cobertura padrão do catálogo continua entrando e aparece para editar", () => {
    const onChange = renderForm(conditionWith({ kind: "INDICATOR_THRESHOLD_COUNT", source: "MEASUREMENT", aggregation: "WEIGHTED_AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } }))
    expect(screen.getByLabelText(/Cobertura mínima de dias/)).toBeInTheDocument()
    chooseTma()
    expect(lastQuery(onChange).minimumCoverage).toBe(0.7)
  })

  it("rascunho antigo com a cobertura escondida mostra o aviso e deixa remover", () => {
    const onChange = renderForm(conditionWith({ kind: "INDICATOR_THRESHOLD_COUNT", source: "INDICATOR_ACHIEVEMENT", indicatorCode: "TMA", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 2 }, minimumCoverage: 0.7 }))
    expect(screen.getByText(/Cobertura mínima de 70%, que só vale para o Valor do indicador/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remover" }))
    expect(lastQuery(onChange).minimumCoverage).toBeUndefined()
  })
})
