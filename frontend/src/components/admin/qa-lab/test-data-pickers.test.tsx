/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MeasurementPicker } from "./test-data-pickers"

vi.mock("@/queries/admin/use-qa-lab-queries", () => ({
  useQaMeasurementsQuery: () => ({ isLoading: false, isError: false, data: [] }),
  useQaPeopleQuery: () => ({ isLoading: false, isError: false, data: [] }),
  useQaConditionPreviewQuery: () => ({ isLoading: false, isError: false, data: null }),
}))

afterEach(() => cleanup())

describe("MeasurementPicker — acessibilidade", () => {
  it("Cenário é um grupo com nome e diz qual opção está escolhida", () => {
    render(<MeasurementPicker indicatorCode="TMA" indicatorName="TMA" hint={{ comparator: "GT", thresholdNumeric: 600 }} value={null} onChange={vi.fn()} />)
    const scenario = screen.getByRole("group", { name: "Cenário" })
    expect(within(scenario).getByRole("button", { name: "Atende" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(within(scenario).getByRole("button", { name: "Todas" }))
    expect(within(scenario).getByRole("button", { name: "Todas" })).toHaveAttribute("aria-pressed", "true")
    expect(within(scenario).getByRole("button", { name: "Atende" })).toHaveAttribute("aria-pressed", "false")
  })
})
