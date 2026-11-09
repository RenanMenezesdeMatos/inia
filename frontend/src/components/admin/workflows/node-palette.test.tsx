/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NodePalette, paletteEntryById } from "./node-palette"

afterEach(cleanup)

describe("NodePalette", () => {
  it("WF-20: cada ação tem o próprio item, com o nome usado na Wiki e nas mensagens, e nunca o genérico \"Ação\"", () => {
    render(<NodePalette isConsolidatedMode={false} />)
    for (const name of ["Chamar agente", "Gerar feedback", "Escalonar", "Definir variável"]) {
      expect(screen.getByRole("button", { name: `Adicionar etapa ${name}` })).toBeInTheDocument()
    }
    expect(screen.queryByRole("button", { name: "Adicionar etapa Ação" })).not.toBeInTheDocument()
  })

  it("clicar ou usar o teclado entrega o mesmo item, já com a ação escolhida", () => {
    const onAddNode = vi.fn()
    render(<NodePalette isConsolidatedMode={false} onAddNode={onAddNode} />)
    fireEvent.click(screen.getByRole("button", { name: "Adicionar etapa Gerar feedback" }))
    fireEvent.keyDown(screen.getByRole("button", { name: "Adicionar etapa Escalonar" }), { key: "Enter" })
    expect(onAddNode.mock.calls.map(([entry]) => [entry.type, entry.actionType])).toEqual([
      ["action", "GENERATE_FEEDBACK"],
      ["action", "ESCALATE"],
    ])
  })

  it("etapas de estrutura só aparecem no modo Consolidado", () => {
    const { rerender } = render(<NodePalette isConsolidatedMode={false} />)
    expect(screen.queryByRole("button", { name: "Adicionar etapa Consolidar resultados" })).not.toBeInTheDocument()
    rerender(<NodePalette isConsolidatedMode />)
    expect(screen.getByRole("button", { name: "Adicionar etapa Consolidar resultados" })).toBeInTheDocument()
  })

  it("o arrasto identifica o item, para o drop criar a mesma etapa que o clique", () => {
    expect(paletteEntryById("GENERATE_FEEDBACK")?.actionType).toBe("GENERATE_FEEDBACK")
    expect(paletteEntryById("consolidate_results")?.type).toBe("consolidate_results")
    expect(paletteEntryById("inexistente")).toBeUndefined()
  })
})
