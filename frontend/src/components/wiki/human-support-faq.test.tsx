/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CopyablePrompt } from "./copyable-prompt"
import { buildHumanSupportPrompt, HUMAN_SUPPORT_FAQ } from "./human-support-faq-data"

afterEach(() => cleanup())

describe("FAQ da operação dos Anjos — fonte única da página e do prompt", () => {
  it("o prompt traz as regras de resposta e TODAS as perguntas e respostas, na ordem da página", () => {
    const prompt = buildHumanSupportPrompt()
    expect(prompt).toMatch(/nunca invente regra, número ou prazo/)
    expect(prompt).toMatch(/Para o operador, quem atende se chama "Apoio"/)
    let cursor = 0
    for (const section of HUMAN_SUPPORT_FAQ) {
      for (const item of section.items) {
        const at = prompt.indexOf(`P: ${item.q}`, cursor)
        expect(at, item.q).toBeGreaterThan(-1)
        expect(prompt).toContain(`R: ${item.a}`)
        cursor = at
      }
    }
  })

  it("ids das seções únicos e perguntas únicas (a página usa as perguntas como chave)", () => {
    expect(new Set(HUMAN_SUPPORT_FAQ.map((section) => section.id)).size).toBe(HUMAN_SUPPORT_FAQ.length)
    const questions = HUMAN_SUPPORT_FAQ.flatMap((section) => section.items.map((item) => item.q))
    expect(new Set(questions).size).toBe(questions.length)
  })

  it("os padrões citados são os do produto (15/20/15, Desconexão 20/10, capacidade 2, fila 10–25/20)", () => {
    const text = buildHumanSupportPrompt()
    for (const fact of ["Padrão 15 minutos, contados a partir da ÚLTIMA MENSAGEM DO ANJO", "Padrão 20 minutos, contados TAMBÉM da última mensagem do Anjo", "Quando fica 20 minutos (padrão) sem responder NINGUÉM", "Depois de 10 minutos (padrão) na pausa", "A capacidade padrão da organização é 2", "limitado entre 10 e 25 minutos. Sem histórico, 20 minutos"]) expect(text).toContain(fact)
    // Queda de rede não é abandono; deslogar é.
    expect(text).toMatch(/Queda de rede NÃO conta como abandono do Anjo/)
    expect(text).toMatch(/isso CONTA como abandono do Anjo \(ele saiu e derrubou o operador\)/)
  })

  it("Copiar prompt: copia o texto inteiro e confirma; sem permissão, pede a cópia manual", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    render(<CopyablePrompt text="REGRAS" title="Prompt" description="d" />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar prompt" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Copiado" })).toBeInTheDocument())
    expect(writeText).toHaveBeenCalledWith("REGRAS")
    cleanup()
    writeText.mockRejectedValue(new Error("negado"))
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true })
    render(<CopyablePrompt text="REGRAS" title="Prompt" description="d" />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar prompt" }))
    expect(await screen.findByText(/Não foi possível copiar/)).toBeInTheDocument()
  })
})
