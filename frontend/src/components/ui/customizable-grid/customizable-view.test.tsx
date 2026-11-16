/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

import { CustomizableView } from "./customizable-view"
import type { GridSection, ViewLayout } from "./layout"

const CATALOG: GridSection[] = [
  {
    id: "resumo",
    title: "Resumo",
    cards: [
      { id: "a", title: "Card A", defaultWidth: 3, render: () => <p>conteúdo A</p> },
      { id: "b", title: "Card B", defaultWidth: 6, render: () => <p>conteúdo B</p> },
    ],
  },
  { id: "grafico", title: "Gráfico", cards: [{ id: "g", title: "Gráfico G", defaultWidth: 12, defaultRows: 4, render: ({ rows }) => <p>altura {rows ?? "auto"}</p> }] },
]

beforeAll(() => installJsdomStubs())
afterEach(() => cleanup())

const setup = (saved: ViewLayout | null = null) => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onReset = vi.fn().mockResolvedValue(undefined)
  render(<CustomizableView catalog={CATALOG} saved={saved} onSave={onSave} onReset={onReset} label="Teste" />)
  return { onSave, onReset }
}
const sectionOrder = () => [...document.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"))

describe("CustomizableView", () => {
  it("sem nada salvo mostra o catálogo; com disposição salva, a ordem, a largura, a altura e o que está escondido", () => {
    setup({
      version: 1,
      sections: [
        { id: "grafico", hidden: false, cards: [{ id: "g", hidden: false, w: 8, h: 6 }] },
        { id: "resumo", hidden: false, cards: [{ id: "b", hidden: false, w: 12, h: null }, { id: "a", hidden: true, w: 3, h: null }] },
      ],
    })
    expect(sectionOrder()).toEqual(["grafico", "resumo"])
    expect(document.querySelector('[data-card="g"]')).toHaveAttribute("data-width", "8")
    expect(document.querySelector('[data-card="g"]')).toHaveAttribute("data-rows", "6")
    expect(document.querySelector('[data-card="b"]')).toHaveAttribute("data-rows", "auto")
    expect(screen.getByText("altura 6")).toBeInTheDocument()
    expect(screen.queryByText("conteúdo A")).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Resumo" })).toBeInTheDocument()
  })

  it("editar: esconder card, mudar a largura pelo menu, adicionar de volta e Concluir salva a disposição", async () => {
    const { onSave } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Personalizar a visão de Teste" }))
    expect(screen.getByRole("button", { name: "Mover a área Resumo" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mover o card Card A" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Esconder o card Card A" }))
    expect(document.querySelector('[data-card="a"]')).not.toBeInTheDocument()

    fireEvent.keyDown(screen.getByRole("button", { name: "Tamanho do card Card B" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Largura toda" }))
    expect(document.querySelector('[data-card="b"]')).toHaveAttribute("data-width", "12")
    fireEvent.keyDown(screen.getByRole("button", { name: "Tamanho do card Card B" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "3 blocos" }))
    expect(document.querySelector('[data-card="b"]')).toHaveAttribute("data-rows", "3")

    fireEvent.click(screen.getByRole("button", { name: "Adicionar card" }))
    fireEvent.click(await screen.findByRole("button", { name: "Card A" }))
    expect(document.querySelector('[data-card="a"]')).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Esconder o card Card A" }))

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Concluir" }))
    })
    expect(onSave).toHaveBeenCalledWith({
      version: 1,
      sections: [
        { id: "resumo", hidden: false, cards: [{ id: "a", hidden: true, w: 3, h: null }, { id: "b", hidden: false, w: 12, h: 3 }] },
        { id: "grafico", hidden: false, cards: [{ id: "g", hidden: false, w: 12, h: 4 }] },
      ],
    })
    expect(screen.getByRole("button", { name: "Personalizar a visão de Teste" })).toBeInTheDocument()
  })

  it("esconder e mostrar uma área; Cancelar descarta; Restaurar padrão pede confirmação", async () => {
    const { onSave, onReset } = setup()
    fireEvent.click(screen.getByRole("button", { name: "Personalizar a visão de Teste" }))
    const grafico = screen.getByRole("region", { name: "Gráfico" })
    fireEvent.click(within(grafico).getByRole("button", { name: "Esconder área" }))
    expect(screen.queryByRole("region", { name: "Gráfico" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Mostrar Gráfico" }))
    expect(screen.getByRole("region", { name: "Gráfico" })).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole("region", { name: "Gráfico" })).getByRole("button", { name: "Esconder área" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.getByRole("region", { name: "Gráfico" })).toBeInTheDocument()
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("button", { name: "Personalizar a visão de Teste" }))
    fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }))
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Restaurar padrão" }))
    })
    expect(onReset).toHaveBeenCalled()
  })

  it("falha ao salvar: avisa e continua editando", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("falhou"))
    render(<CustomizableView catalog={CATALOG} saved={null} onSave={onSave} onReset={vi.fn()} label="Teste" />)
    fireEvent.click(screen.getByRole("button", { name: "Personalizar a visão de Teste" }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Concluir" }))
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar a sua visão")
    expect(screen.getByRole("button", { name: "Concluir" })).toBeInTheDocument()
  })
})
