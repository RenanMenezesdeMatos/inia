/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"

import { aggregationOptionLabel, describeIndicatorMismatch, IndicatorSelect, indicatorMeetsRequirement } from "./indicator-select"

afterEach(cleanup)

function indicator(partial: Partial<IndicatorWithRules>): IndicatorWithRules {
  return {
    id: partial.code ?? "x", code: "X", name: "X", unit: "PERCENT", desiredDirection: "HIGHER", active: true,
    operationalAggregation: "RATE", dailySupported: true, minimumSampleSize: null, minimumCoverage: null, officialClosureSupported: true, provesWorkActivity: false, unjustifiedAbsencePolicy: "NO_SAMPLE", availabilityPolicy: null, iconKey: null,
    glossaryDescription: null, interpretation: null, goodPractices: null, feedbackGuidance: null, calculationRules: [],
    ...partial,
  }
}

const CATALOG = [
  indicator({ code: "OPERACIONAL", name: "Indicador operacional", calculation: { label: "Taxa consolidada do período", description: "Ocorrências ÷ elegíveis." } }),
  indicator({ code: "SO_OFICIAL", name: "Só fechamento oficial", dailySupported: false, operationalAggregation: "AVERAGE" }),
  indicator({ code: "SO_OPERACIONAL", name: "Só operacional", officialClosureSupported: false }),
  indicator({ code: "INATIVO", name: "Indicador desativado", active: false }),
]

vi.mock("@/queries/admin/use-indicator-rule-queries", () => ({
  useIndicatorsWithRulesQuery: () => ({ data: CATALOG, isLoading: false }),
}))

describe("IndicatorSelect — catálogo dinâmico filtrado por capacidade", () => {
  it("capacidade: OPERATIONAL exige medição diária; OFFICIAL exige fechamento oficial; ANY aceita qualquer ativo", () => {
    expect(indicatorMeetsRequirement(CATALOG[1]!, "OPERATIONAL")).toBe(false)
    expect(indicatorMeetsRequirement(CATALOG[2]!, "OFFICIAL")).toBe(false)
    expect(indicatorMeetsRequirement(CATALOG[1]!, "ANY")).toBe(true)
    expect(describeIndicatorMismatch(CATALOG[3], "ANY")).toBe("desativado")
    expect(describeIndicatorMismatch(CATALOG[1], "OPERATIONAL")).toBe("sem medição operacional")
    expect(describeIndicatorMismatch(undefined, "ANY")).toBe("não existe mais no catálogo")
  })

  it("um Workflow existente que aponta pra indicador desativado continua abrindo — marcado, com aviso, sem sumir", () => {
    render(<IndicatorSelect value="INATIVO" requirement="ANY" onValueChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Indicador" })).toHaveTextContent("Indicador desativado (desativado)")
    expect(screen.getByText(/está desativado — a publicação vai rejeitar/)).toBeInTheDocument()
  })

  it("indicador sem medição operacional escolhido num uso operacional aparece com o motivo", () => {
    render(<IndicatorSelect value="SO_OFICIAL" requirement="OPERATIONAL" onValueChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Indicador" })).toHaveTextContent("Só fechamento oficial (sem medição operacional)")
  })

  it("indicador compatível e ativo não recebe aviso", () => {
    render(<IndicatorSelect value="OPERACIONAL" requirement="OPERATIONAL" onValueChange={vi.fn()} />)
    expect(screen.getByRole("combobox", { name: "Indicador" })).toHaveTextContent("Indicador operacional")
    expect(screen.queryByText(/a publicação vai rejeitar/)).not.toBeInTheDocument()
  })

  it("rótulo funcional: a agregação natural do indicador mostra o cálculo do catálogo; as demais, o rótulo genérico", () => {
    expect(aggregationOptionLabel("WEIGHTED_AVERAGE", CATALOG[0])).toBe("Cálculo no período: Taxa consolidada do período")
    expect(aggregationOptionLabel("MAXIMUM", CATALOG[0])).toBe("Máximo (pior/melhor período)")
    expect(aggregationOptionLabel("WEIGHTED_AVERAGE", undefined)).toBe("Média ponderada pelo volume (Σ total ÷ Σ volume)")
  })
})
