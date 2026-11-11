/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

import { DATE_RANGE_PRESETS, DatePicker, DateRangePicker, parseCivilDate, presetRange, rangeText, type CivilDateRange } from "./date-picker"

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

/** Atalhos de período do seletor de período do kit (todos os filtros de período do app usam este componente). */
const open = () => fireEvent.click(screen.getByRole("button", { name: /Selecionar período|\d{2}\/\d{2}\/\d{4}/ }))
const shortcuts = () => within(screen.getByRole("group", { name: "Atalhos de período" }))

describe("DateRangePicker — atalhos de período", () => {
  // Só o relógio de data é falso: "hoje" = 10/11/2026 (terça-feira), no calendário de quem vê.
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 10, 10, 15, 30), toFake: ["Date"] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("cada atalho vira um período em datas civis contado de hoje", () => {
    const today = new Date(2026, 10, 10, 23, 59)
    expect(Object.fromEntries(DATE_RANGE_PRESETS.map((preset) => [preset.label, presetRange(preset, today)]))).toEqual({
      Hoje: { from: "2026-11-10", to: "2026-11-10" },
      "Últimos 7 dias": { from: "2026-11-04", to: "2026-11-10" },
      "Últimas 2 semanas": { from: "2026-10-28", to: "2026-11-10" },
      "Último mês": { from: "2026-10-12", to: "2026-11-10" },
      "Este mês": { from: "2026-11-01", to: "2026-11-10" },
      "Mês passado": { from: "2026-10-01", to: "2026-10-31" },
      "Últimos 3 meses": { from: "2026-08-13", to: "2026-11-10" },
      "Últimos 6 meses": { from: "2026-05-15", to: "2026-11-10" },
    })
    // Virada de ano: o mês passado de janeiro é dezembro do ano anterior.
    expect(presetRange(DATE_RANGE_PRESETS.find((preset) => preset.id === "previous-month")!, new Date(2027, 0, 5))).toEqual({ from: "2026-12-01", to: "2026-12-31" })
  })

  it("um clique no atalho aplica o período e fecha o calendário", () => {
    const onChange = vi.fn()
    render(<DateRangePicker value={{}} onChange={onChange} />)
    open()
    expect(shortcuts().getAllByRole("button").map((button) => button.textContent)).toEqual(["Hoje", "Últimos 7 dias", "Últimas 2 semanas", "Último mês", "Este mês", "Mês passado", "Últimos 3 meses", "Últimos 6 meses"])
    fireEvent.click(shortcuts().getByRole("button", { name: "Últimos 7 dias" }))
    expect(onChange).toHaveBeenCalledWith({ from: "2026-11-04", to: "2026-11-10" })
    expect(screen.queryByRole("group", { name: "Atalhos de período" })).not.toBeInTheDocument()
  })

  it("o atalho do período atual fica marcado", () => {
    render(<DateRangePicker value={{ from: "2026-10-28", to: "2026-11-10" }} onChange={vi.fn()} />)
    open()
    expect(shortcuts().getByRole("button", { name: "Últimas 2 semanas" })).toHaveAttribute("aria-pressed", "true")
    expect(shortcuts().getByRole("button", { name: "Últimos 7 dias" })).toHaveAttribute("aria-pressed", "false")
  })

  it("com 'Aplicar', o atalho válido aplica direto; o que a validação do filtro recusa fica desabilitado com o motivo", () => {
    const onChange = vi.fn()
    const validate = ({ from, to }: { from: string; to: string }) => (Date.parse(to) - Date.parse(from) > 20 * 86_400_000 ? "Escolha um período de até 21 dias." : null)
    render(<DateRangePicker value={{ from: "2026-11-01", to: "2026-11-02" }} onChange={onChange} confirm={{ validate }} />)
    open()
    const month = shortcuts().getByRole("button", { name: "Último mês" })
    expect(month).toBeDisabled()
    expect(month).toHaveAttribute("title", "Escolha um período de até 21 dias.")
    fireEvent.click(shortcuts().getByRole("button", { name: "Últimas 2 semanas" }))
    expect(onChange).toHaveBeenCalledWith({ from: "2026-10-28", to: "2026-11-10" })
  })

  it("atalho fora dos limites do filtro fica desabilitado; `presets={false}` tira os atalhos", () => {
    render(<DateRangePicker value={{}} onChange={vi.fn()} max="2026-11-09" min="2026-09-01" />)
    open()
    expect(shortcuts().getByRole("button", { name: "Hoje" })).toBeDisabled()
    expect(shortcuts().getByRole("button", { name: "Últimos 3 meses" })).toBeDisabled()
    expect(shortcuts().getByRole("button", { name: "Mês passado" })).toBeEnabled()
    cleanup()
    render(<DateRangePicker value={{}} onChange={vi.fn()} presets={false} />)
    open()
    expect(screen.queryByRole("group", { name: "Atalhos de período" })).not.toBeInTheDocument()
  })

  it("filtro que pode ficar vazio: \"Limpar\" no fim dos atalhos (desabilitado sem período); obrigatório não tem", () => {
    const onChange = vi.fn()
    render(<DateRangePicker value={{}} onChange={onChange} clearable />)
    open()
    expect(shortcuts().getByRole("button", { name: "Limpar" })).toBeDisabled()
    cleanup()
    render(<DateRangePicker value={{ from: "2026-11-04", to: "2026-11-10" }} onChange={onChange} clearable />)
    open()
    // Um só "Limpar": o do rodapé só aparece quando não há atalhos.
    expect(screen.getAllByRole("button", { name: /Limpar/ })).toHaveLength(1)
    fireEvent.click(shortcuts().getByRole("button", { name: "Limpar" }))
    expect(onChange).toHaveBeenCalledWith({})
    expect(screen.queryByRole("group", { name: "Atalhos de período" })).not.toBeInTheDocument()
    cleanup()
    render(<DateRangePicker value={{ from: "2026-11-04", to: "2026-11-10" }} onChange={vi.fn()} confirm={{}} />)
    open()
    expect(shortcuts().queryByRole("button", { name: "Limpar" })).not.toBeInTheDocument()
    cleanup()
    render(<DateRangePicker value={{ from: "2026-11-04", to: "2026-11-10" }} onChange={vi.fn()} clearable presets={false} />)
    open()
    expect(screen.getByRole("button", { name: "Limpar período" })).toBeInTheDocument()
  })
})
