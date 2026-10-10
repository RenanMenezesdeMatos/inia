/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { ConversationView, formatCallDuration, matchHighlights, parseConversation, transcriptLines } from "./interaction-evidence"

afterEach(cleanup)

describe("QA Lab — helpers de exibição da interação", () => {
  it("formatCallDuration: segundos de LIGAÇÃO em mm'ss (nunca confundido com duração de request)", () => {
    expect(formatCallDuration(438)).toBe("07m18s")
    expect(formatCallDuration(0)).toBe("00m00s")
    expect(formatCallDuration(3661)).toBe("1h01m01s")
    expect(formatCallDuration(null)).toBe("—")
  })

  it("transcriptLines: preserva quebras existentes e só quebra numa linha única onde o rótulo já está no texto", () => {
    expect(transcriptLines("Operador: Bom dia.\nCliente: Oi.")).toEqual(["Operador: Bom dia.", "Cliente: Oi."])
    expect(transcriptLines("Operador: Bom dia, em que posso ajudar? Cliente: Estou ligando novamente. Operador: Entendi.")).toEqual([
      "Operador: Bom dia, em que posso ajudar?",
      "Cliente: Estou ligando novamente.",
      "Operador: Entendi.",
    ])
    expect(transcriptLines("texto corrido sem falantes. outra frase.")).toEqual(["texto corrido sem falantes. outra frase."])
  })
})

describe("QA Lab — transcrição como conversa (rótulos literais, nunca inferidos)", () => {
  it("Operador:/Cliente: em cada fala → 3 bubbles ordenados, Cliente à esquerda e Operador à direita, sempre com rótulo textual", () => {
    render(<ConversationView content={"Operador: Olá\nCliente: Preciso de ajuda\nOperador: Claro"} />)
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.getAttribute("data-speaker"))).toEqual(["OPERATOR", "CUSTOMER", "OPERATOR"])
    expect(items[0]).toHaveClass("justify-end")
    expect(items[1]).toHaveClass("justify-start")
    expect(within(items[1]!).getByText("Cliente")).toBeInTheDocument()
    expect(within(items[1]!).getByText("Preciso de ajuda")).toBeInTheDocument()
    expect(within(items[0]!).getByText("Operador")).toBeInTheDocument()
    expect(screen.queryByTestId("transcript-text")).not.toBeInTheDocument()
  })

  it("texto puro sem rótulos → fallback de texto integral, sem bubbles inventados", () => {
    render(<ConversationView content="texto puro sem speaker. segunda frase sem ninguém." />)
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument()
    expect(screen.getByTestId("transcript-text")).toHaveTextContent("Esta transcrição não possui identificação estruturada dos participantes.")
    expect(screen.getByRole("document", { name: "Transcrição integral" })).toHaveTextContent("texto puro sem speaker. segunda frase sem ninguém.")
  })

  it("uma única fala sem rótulo no meio invalida a conversa inteira (nunca adivinha quem falou)", () => {
    expect(parseConversation("Operador: Olá\nalguém falou isso\nCliente: Oi").kind).toBe("text")
    expect(parseConversation("Atendente: Olá\nUsuário: Oi").kind).toBe("text")
    expect(parseConversation("operador: Olá\nCLIENTE: Oi").kind).toBe("chat")
  })
})

describe("QA Lab — destaque determinístico de evidência (dado já estruturado do Feedback)", () => {
  it("evidência literal existente → bubble e trecho destacados", () => {
    render(<ConversationView content={"Cliente: meu protocolo é 123\nOperador: anotado"} highlights={[{ text: "meu protocolo é 123", reason: "Trecho utilizado como evidência pelo Agent" }]} />)
    const items = screen.getAllByRole("listitem")
    expect(items[0]).toHaveAttribute("data-highlighted", "true")
    expect(items[1]).not.toHaveAttribute("data-highlighted")
    expect(within(items[0]!).getByText("meu protocolo é 123").tagName).toBe("MARK")
    expect(within(items[0]!).getByText("Trecho utilizado como evidência pelo Agent")).toBeInTheDocument()
  })

  it("evidência inexistente → nenhum destaque incorreto", () => {
    render(<ConversationView content={"Cliente: meu protocolo é 123\nOperador: anotado"} highlights={[{ text: "quero cancelar tudo", reason: "x" }]} />)
    expect(screen.queryAllByRole("listitem").some((item) => item.hasAttribute("data-highlighted"))).toBe(false)
    expect(document.querySelector("mark")).toBeNull()
  })

  it("matchHighlights: só substring exata com normalização de espaços/caixa, recortando o texto original", () => {
    const segments = matchHighlights("Não posso   ajudar com isso, tchau.", [{ text: "não posso ajudar com isso", reason: "r" }])
    expect(segments.map((segment) => [segment.text, segment.highlight !== null])).toEqual([
      ["Não posso   ajudar com isso", true],
      [", tchau.", false],
    ])
    expect(matchHighlights("frase qualquer", [{ text: "frase qualqer", reason: "r" }])).toEqual([{ text: "frase qualquer", highlight: null }])
  })
})
