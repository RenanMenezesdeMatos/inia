/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TypedComparatorSelect, TypedValueInput } from "./typed-value-field"

afterEach(cleanup)

describe("TypedValueInput — valor guiado pelo tipo do resultado estruturado", () => {
  it("Sim/Não para um campo BOOLEAN da definição; Verdadeiro/Falso continua para variáveis/flags", () => {
    render(<TypedValueInput kind="BOOLEAN" comparator="EQUALS" fieldType="BOOLEAN" value={true} onChange={vi.fn()} />)
    expect(screen.getByRole("combobox").textContent).toBe("Sim")
    cleanup()
    render(<TypedValueInput kind="BOOLEAN" comparator="EQUALS" value={false} onChange={vi.fn()} />)
    expect(screen.getByRole("combobox").textContent).toBe("Falso")
  })

  it("Lista de opções vira select mostrando o rótulo amigável e gravando o valor técnico", () => {
    render(<TypedValueInput kind="STRING" comparator="EQUALS" enumValues={["BAIXA", "ALTA"]} enumOptions={[{ value: "BAIXA", label: "Baixa" }, { value: "ALTA", label: "Alta" }]} value="ALTA" onChange={vi.fn()} />)
    expect(screen.getByRole("combobox").textContent).toBe("Alta")
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("Número oferece comparação numérica (maior/menor que…) e input numérico", () => {
    render(
      <>
        <TypedComparatorSelect kind="NUMBER" value="GT" onChange={vi.fn()} />
        <TypedValueInput kind="NUMBER" comparator="GT" value={7} onChange={vi.fn()} />
      </>,
    )
    expect(screen.getByRole("combobox").textContent).toBe("é maior que")
    expect(screen.getByRole("spinbutton")).toHaveValue(7)
  })
})
