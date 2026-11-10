/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

import { DatePicker, DateRangePicker, parseCivilDate, rangeText, type CivilDateRange } from "./date-picker"

/** Seletores de data do kit: data civil "AAAA-MM-DD" por dentro, "dd/MM/aaaa" e calendário em português por fora. */
beforeAll(installJsdomStubs)
afterEach(() => cleanup())

describe("data civil", () => {
  it("lê só datas reais, sem fuso (nunca vira o dia anterior)", () => {
    expect(parseCivilDate("2026-11-09")?.getDate()).toBe(9)
    expect(parseCivilDate("2026-02-30")).toBeUndefined()
    expect(parseCivilDate("09/11/2026")).toBeUndefined()
    expect(parseCivilDate("")).toBeUndefined()
  })

  it("texto do período", () => {
    expect(rangeText({ from: "2026-10-11", to: "2026-11-09" }, "Período")).toBe("11/10/2026 – 09/11/2026")
    expect(rangeText({ from: "2026-11-09", to: "2026-11-09" }, "Período")).toBe("09/11/2026")
    expect(rangeText({ from: "2026-11-01" }, "Período")).toBe("a partir de 01/11/2026")
    expect(rangeText({}, "Período")).toBe("Período")
  })
})

describe("DatePicker", () => {
  it("mostra dd/MM/aaaa, abre o calendário em português, respeita os limites e limpa", () => {
    const onChange = vi.fn()
    render(
      <>
        <label htmlFor="prazo">Prazo</label>
        <DatePicker id="prazo" value="2026-11-09" min="2026-11-05" max="2026-11-20" clearable onChange={onChange} />
      </>,
    )
    const trigger = screen.getByRole("button", { name: "Prazo" })
    expect(trigger).toHaveTextContent("09/11/2026")
    expect(trigger).toHaveAccessibleDescription(/Data escolhida: segunda-feira, 9 de novembro de 2026/)
    fireEvent.click(trigger)
    expect(screen.getByText("novembro 2026")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /, 4 de novembro de 2026/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /, 21 de novembro de 2026/ })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /, 12 de novembro de 2026/ }))
    expect(onChange).toHaveBeenLastCalledWith("2026-11-12")
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole("button", { name: "Limpar data" }))
    expect(onChange).toHaveBeenLastCalledWith("")
  })

  it("sem data: o texto de exemplo, nunca uma data inventada", () => {
    render(<DatePicker value="" onChange={() => {}} aria-label="Data do feriado" />)
    expect(screen.getByRole("button", { name: "Data do feriado" })).toHaveTextContent("dd/mm/aaaa")
  })
})

describe("DateRangePicker", () => {
  function Controlled({ confirm, onApply }: { confirm?: boolean; onApply: (range: CivilDateRange) => void }) {
    const [value, setValue] = useState<CivilDateRange>({ from: "2026-11-02", to: "2026-11-06" })
    return (
      <DateRangePicker
        aria-label="Período"
        value={value}
        {...(confirm ? { confirm: { validate: (range: { from: string; to: string }) => (range.to < range.from ? "inválido" : range.from < "2026-11-02" ? "Escolha a partir de 02/11." : null) } } : {})}
        onChange={(next) => {
          setValue(next)
          onApply(next)
        }}
      />
    )
  }

  it("filtro de lista: aplica a cada clique e limpa", () => {
    const onApply = vi.fn()
    render(<Controlled onApply={onApply} />)
    fireEvent.click(screen.getByRole("button", { name: "Período" }))
    fireEvent.click(screen.getByRole("button", { name: /, 10 de novembro de 2026/ }))
    expect(onApply).toHaveBeenLastCalledWith({ from: "2026-11-02", to: "2026-11-10" })
  })

  it("período obrigatório: só vale com Aplicar; inválido não aplica e mostra o motivo; Cancelar descarta", () => {
    const onApply = vi.fn()
    render(<Controlled confirm onApply={onApply} />)
    fireEvent.click(screen.getByRole("button", { name: "Período" }))
    fireEvent.click(screen.getByRole("button", { name: /, 1 de novembro de 2026/ }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole("alert")).toHaveTextContent("Escolha a partir de 02/11.")
    expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.getByRole("button", { name: "Período" })).toHaveTextContent("02/11/2026 – 06/11/2026")

    fireEvent.click(screen.getByRole("button", { name: "Período" }))
    fireEvent.click(screen.getByRole("button", { name: /, 12 de novembro de 2026/ }))
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    expect(onApply).toHaveBeenLastCalledWith({ from: "2026-11-02", to: "2026-11-12" })
  })
})
