// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

import type { ClarificationSource } from "@/schemas/knowledge-clarification/clarification.schema"

import { KnowledgeSourceImages } from "./knowledge-source-images"

afterEach(cleanup)

const image = (id: string, page = 1) => ({ id, page, width: 800, height: 400 })
const source = (overrides: Partial<ClarificationSource> = {}): ClarificationSource => ({ documentId: "doc-1", documentTitle: "Manual de chamados", versionId: "v1", heading: "Abertura", chunkIndex: 0, available: true, ...overrides })

describe("imagens abaixo de uma resposta", () => {
  it("sem imagens, nada aparece: resposta de base de texto e resposta antiga ficam como eram", () => {
    const { container } = render(<KnowledgeSourceImages sources={[source()]} />)
    expect(container.firstChild).toBeNull()
  })

  it("mostra as da seção, diz que a INIA não as lê e leva ao material na página", () => {
    render(<KnowledgeSourceImages sources={[source({ images: [image("a", 7)] })]} />)
    const shown = screen.getByRole("img", { name: "Imagem da página 7 do documento" })
    expect(shown.getAttribute("src")).toContain("/api/v1/knowledge-materials/doc-1/images/a")
    expect(screen.getByText("Manual de chamados · p. 7")).toBeTruthy()
    expect(screen.getByText(/A INIA não lê imagens/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Ampliar a imagem da página 7" }))
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Abrir o material nesta página" }).getAttribute("href")).toBe("/materiais/doc-1?pagina=7&versao=v1")
  })

  it("seção com muitas imagens: quatro de início, e 'Ver mais' traz o resto", () => {
    render(<KnowledgeSourceImages sources={[source({ images: ["a", "b", "c", "d", "e", "f"].map((id) => image(id)) })]} />)
    expect(screen.getAllByRole("img")).toHaveLength(4)
    fireEvent.click(screen.getByRole("button", { name: "Ver mais 2" }))
    expect(screen.getAllByRole("img")).toHaveLength(6)
    fireEvent.click(screen.getByRole("button", { name: "Ver menos" }))
    expect(screen.getAllByRole("img")).toHaveLength(4)
  })

  it("a mesma imagem citada por duas fontes aparece uma vez", () => {
    render(<KnowledgeSourceImages sources={[source({ images: [image("a")] }), source({ chunkIndex: 1, images: [image("a"), image("b")] })]} />)
    expect(screen.getAllByRole("img")).toHaveLength(2)
  })

  it("fonte que quem lê não pode mais abrir não mostra nada", () => {
    const { container } = render(<KnowledgeSourceImages sources={[source({ available: false, images: [image("a")] })]} />)
    expect(container.firstChild).toBeNull()
  })

  it("imagem que não existe mais no material em vigor some, sem imagem quebrada", () => {
    render(<KnowledgeSourceImages sources={[source({ images: [image("a"), image("b", 2)] })]} />)
    fireEvent.error(screen.getByRole("img", { name: "Imagem da página 1 do documento" }))
    expect(screen.getAllByRole("img")).toHaveLength(1)
  })
})
