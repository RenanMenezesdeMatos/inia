// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

import type { PdfExtraction } from "@/schemas/admin/knowledge.schema"

import { KnowledgeDocumentImage } from "./knowledge-document-image"
import { KnowledgeReadingView } from "./knowledge-reading-view"

afterEach(cleanup)

const CONTENT = "# Manual\n\n1. Abrir a tela.\n2. Salvar.\n\n| Campo | Valor |\n| --- | --- |\n| A | 1 |"
const extraction: PdfExtraction = {
  version: "PDF_MARKDOWN_V1",
  pageCount: 3,
  pages: [
    { page: 1, status: "TEXT", chars: 10, headings: 1, tables: 0, offset: 0 },
    { page: 2, status: "NO_TEXT", chars: 0, headings: 0, tables: 0, offset: null },
    { page: 3, status: "TEXT", chars: 10, headings: 0, tables: 1, offset: CONTENT.indexOf("| Campo") },
  ],
  headings: 1,
  tables: 1,
  repeatedLinesRemoved: 0,
  taggedPages: 0,
  edited: false,
  images: [{ id: "abc", page: 1, offset: CONTENT.indexOf("1. Abrir a tela.") + "1. Abrir a tela.".length, width: 800, height: 400 }],
}

function view(onOpenPage = vi.fn()) {
  return render(<KnowledgeReadingView content={CONTENT} extraction={extraction} title="Manual" imageSrc={(id) => `/imagem/${id}`} onOpenPage={onOpenPage} />)
}

describe("PDF lido como conteúdo", () => {
  it("mostra o texto como um conteúdo cadastrado, sem repetir o título, com lista e tabela de verdade", () => {
    view()
    const article = within(screen.getByTestId("knowledge-reading-view"))
    expect(article.queryByRole("heading", { name: "Manual" })).toBeNull()
    expect(article.getByRole("table")).toBeTruthy()
    expect(article.getByText("Abrir a tela.")).toBeTruthy()
  })

  it("o print fica entre os dois passos, e a numeração continua depois dele", () => {
    const { container } = view()
    const image = screen.getByRole("img", { name: "Imagem da página 1 do documento" })
    expect(image.getAttribute("src")).toBe("/imagem/abc")
    expect(image.getAttribute("loading")).toBe("lazy")
    const first = screen.getByText("Abrir a tela.")
    const second = screen.getByText("Salvar.")
    expect(first.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(image.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.querySelectorAll("ol")[1]?.getAttribute("start")).toBe("2")
    expect(screen.getByText("Imagem da página 1. A INIA não lê imagens.")).toBeTruthy()
  })

  it("página sem o que mostrar avisa no lugar dela e leva ao PDF original", () => {
    const onOpenPage = vi.fn()
    view(onOpenPage)
    const notice = within(screen.getByTestId("reading-missing-page"))
    expect(notice.getByText("A página 2 não tem texto para mostrar aqui.")).toBeTruthy()
    fireEvent.click(notice.getByRole("button", { name: "Ver no PDF" }))
    expect(onOpenPage).toHaveBeenCalledWith(2)
  })

  it("imagem que ficou de fora é dita, para nada sumir sem aviso", () => {
    render(<KnowledgeReadingView content={CONTENT} extraction={{ ...extraction, imagesOmitted: 2 }} title="Manual" imageSrc={(id) => id} onOpenPage={vi.fn()} />)
    expect(screen.getByTestId("reading-images-omitted").textContent).toContain("2 imagens deste documento só aparecem no PDF original.")
  })

  it("documento lido por OCR avisa que o texto veio da imagem e pode ter erro de leitura", () => {
    const ocr = { version: "PDF_OCR_V1", engine: "Tesseract", printRule: "PDF_PRINT_RULE_V1", pages: [2], failedPages: [], skippedPages: [], prints: 0 }
    render(<KnowledgeReadingView content={CONTENT} extraction={{ ...extraction, ocr }} title="Manual" imageSrc={(id) => id} onOpenPage={vi.fn()} />)
    expect(screen.getByTestId("reading-ocr").textContent).toContain("Parte deste documento é digitalizada")
    expect(screen.getByTestId("reading-ocr").textContent).toContain("pode ter erros de leitura")
  })

  it("tem a âncora da página citada e rola até ela", () => {
    const scroll = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scroll
    render(<KnowledgeReadingView content={CONTENT} extraction={extraction} title="Manual" imageSrc={(id) => id} targetPage={3} onOpenPage={vi.fn()} />)
    expect(screen.getByTestId("pagina-3")).toBeTruthy()
    expect(scroll).toHaveBeenCalledWith({ block: "start" })
  })
})

describe("imagem de um PDF", () => {
  const props = { src: "/imagem/x", page: 4, width: 800, height: 400, caption: "Legenda da imagem" }

  it("reserva o espaço antes de carregar e amplia num clique", () => {
    render(<KnowledgeDocumentImage {...props} />)
    const image = screen.getByRole("img", { name: "Imagem da página 4 do documento" })
    expect(image.getAttribute("width")).toBe("800")
    expect(image.getAttribute("height")).toBe("400")
    fireEvent.click(screen.getByRole("button", { name: "Ampliar a imagem da página 4" }))
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(within(screen.getByRole("dialog")).getByRole("img").getAttribute("src")).toBe("/imagem/x")
  })

  it("falhou ao carregar: no texto, avisa; abaixo de uma resposta, some", () => {
    const { rerender } = render(<KnowledgeDocumentImage {...props} />)
    fireEvent.error(screen.getByRole("img"))
    expect(screen.getByText("Não foi possível carregar a imagem da página 4.")).toBeTruthy()
    const gone = vi.fn()
    rerender(<KnowledgeDocumentImage key="outra" {...props} onUnavailable={gone} />)
    fireEvent.error(screen.getByRole("img"))
    expect(gone).toHaveBeenCalled()
    expect(screen.queryByRole("img")).toBeNull()
  })
})
