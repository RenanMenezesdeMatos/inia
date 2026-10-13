/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { useState } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ActionLimitsCard } from "./action-limits-card"

afterEach(cleanup)

function Harness({ initialEnabled = false, initialText = "" }: { initialEnabled?: boolean; initialText?: string }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [text, setText] = useState(initialText)
  return <ActionLimitsCard enabled={enabled} text={text} onEnabledChange={setEnabled} onTextChange={setText} />
}

describe("ActionLimitsCard — interruptor + até onde o agente vai", () => {
  it("desligado: campo bloqueado e texto guardado; ligar libera o campo com o mesmo texto", () => {
    render(<Harness initialText="Só faturamento." />)
    const field = screen.getByLabelText("Até onde este agente vai")
    expect(field).toBeDisabled()
    expect(field).toHaveValue("Só faturamento.")
    expect(screen.getByText("Desligado: ele responde como sempre.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("switch", { name: "Limitar a atuação deste agente" }))
    expect(field).toBeEnabled()
    expect(field).toHaveValue("Só faturamento.")
    expect(screen.getByText("Ligado: ele só atua dentro do que estiver escrito abaixo.")).toBeInTheDocument()
  })

  it("ligado sem texto: avisa e marca o campo inválido; ao escrever, o aviso some", () => {
    render(<Harness initialEnabled />)
    const field = screen.getByLabelText("Até onde este agente vai")
    expect(screen.getByText("Descreva até onde este agente vai ou desligue os limites.")).toBeInTheDocument()
    expect(field).toHaveAttribute("aria-invalid", "true")
    fireEvent.change(field, { target: { value: "Só assuntos de trabalho." } })
    expect(screen.queryByText("Descreva até onde este agente vai ou desligue os limites.")).not.toBeInTheDocument()
    expect(field).not.toHaveAttribute("aria-invalid")
  })
})
