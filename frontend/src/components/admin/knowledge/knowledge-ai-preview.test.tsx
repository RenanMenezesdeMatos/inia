// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { buildKnowledgeMaterialHref, buildKnowledgeMaterialPageHref } from "@/lib/knowledge/material-href"
import type { PdfExtraction } from "@/schemas/admin/knowledge.schema"
import { clarificationSourceSchema, sourcePageLabel } from "@/schemas/knowledge-clarification/clarification.schema"

import { parseArticle } from "./knowledge-article-content"
import { KnowledgeAiPreview, KnowledgeCoverageSummary } from "./knowledge-ai-preview"

const previewMock = vi.hoisted(() => ({ data: null as unknown }))
vi.mock("@/queries/admin/use-knowledge-queries", () => ({
  useKnowledgeAiPreviewQuery: () => ({ isLoading: false, isError: false, error: null, data: previewMock.data }),
  useReprocessKnowledgeMutation: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
}))

const page = (number: number, status: PdfExtraction["pages"][number]["status"]) => ({ page: number, status, chars: status === "TEXT" ? 100 : 0, headings: 0, tables: 0, offset: status === "TEXT" ? number * 100 : null })
const extraction = (pages: PdfExtraction["pages"], extra: Partial<PdfExtraction> = {}): PdfExtraction => ({ version: "PDF_MARKDOWN_V1", pageCount: pages.length, pages, headings: 3, tables: 1, repeatedLinesRemoved: 0, taggedPages: 0, edited: false, ...extra })

afterEach(cleanup)

describe("cobertura do PDF", () => {
  it("diz quantas páginas foram lidas e cada página sem texto leva ao PDF", () => {
    const onOpenPage = vi.fn()
    render(<KnowledgeCoverageSummary extraction={extraction([page(1, "TEXT"), page(2, "NO_TEXT"), page(3, "TEXT"), page(4, "PARTIAL")])} onOpenPage={onOpenPage} />)
    expect(screen.getByText("3 de 4 páginas lidas")).toBeTruthy()
    expect(screen.getByText(/Sem texto, parecem digitalizadas: p\. 2/)).toBeTruthy()
    expect(screen.getByText(/Com imagem grande: p\. 4/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Abrir a página 2 do PDF" }))
    expect(onOpenPage).toHaveBeenCalledWith(2)
  })

  it("página em branco não conta como perda nem gera aviso", () => {
    render(<KnowledgeCoverageSummary extraction={extraction([page(1, "TEXT"), page(2, "BLANK")])} onOpenPage={() => undefined} />)
    expect(screen.getByText("1 de 1 página lida")).toBeTruthy()
    expect(screen.queryByText(/digitalizadas/)).toBeNull()
  })

  it("conta as imagens; versão sem a leitura de imagens manda reprocessar; a que ficou de fora é dita", () => {
    const { unmount } = render(<KnowledgeCoverageSummary extraction={extraction([page(1, "TEXT")], { images: [{ id: "a", page: 1, offset: 0, width: 800, height: 400 }, { id: "b", page: 1, offset: 0, width: 800, height: 400 }], imagesOmitted: 1 })} onOpenPage={() => undefined} />)
    expect(screen.getByText(/2 imagens/)).toBeTruthy()
    expect(screen.getByText(/1 imagem ficou de fora/)).toBeTruthy()
    expect(screen.queryByText(/Reprocesse o arquivo/)).toBeNull()
    unmount()
    render(<KnowledgeCoverageSummary extraction={extraction([page(1, "TEXT")])} onOpenPage={() => undefined} />)
    expect(screen.getByText(/Reprocesse o arquivo para trazê-las para o texto/)).toBeTruthy()
  })

  it("páginas lidas por OCR: pede conferência com o PDF, conta os prints e leva a cada página", () => {
    const onOpenPage = vi.fn()
    const ocr = { version: "PDF_OCR_V1", engine: "Tesseract", printRule: "PDF_PRINT_RULE_V1", pages: [2, 3], failedPages: [], skippedPages: [9], prints: 1 }
    render(<KnowledgeCoverageSummary extraction={extraction([page(1, "TEXT"), page(2, "TEXT"), page(3, "PARTIAL")], { ocr })} onOpenPage={onOpenPage} />)
    const notice = screen.getByTestId("knowledge-ocr-notice")
    expect(notice.textContent).toContain("Lidas por OCR, da imagem da página: p. 2 e 3.")
    expect(notice.textContent).toContain("principalmente números, prazos e valores")
    expect(notice.textContent).toContain("1 print foi separado como imagem")
    expect(notice.textContent).toContain("1 página ficou sem leitura pelo limite por documento.")
    fireEvent.click(within(notice).getByRole("button", { name: "Abrir a página 3 do PDF" }))
    expect(onOpenPage).toHaveBeenCalledWith(3)
  })

  it("texto editado depois da conversão fica dito", () => {
    render(<KnowledgeCoverageSummary extraction={extraction([page(1, "TEXT")], { edited: true })} onOpenPage={() => undefined} />)
    expect(screen.getByText(/editado depois da conversão/)).toBeTruthy()
  })
})

describe("prévia do que a IA lê", () => {
  const document = { id: "d", sourceType: "PDF", originalFilename: "a.pdf", draft: null, inUse: { id: "v1", version: 1 }, editable: { versionId: "v1", version: 1, config: null } } as unknown as Parameters<typeof KnowledgeAiPreview>[0]["document"]
  const chunk = { index: 0, heading: "", pages: null, chars: 40, text: "Linha 1 de conteudo. Linha 2 de conteudo." }

  it("mostra a imagem no ponto dela dentro do trecho, com a marca de que a IA não lê, servida pela versão na tela", () => {
    const text = "Passo um.\nPasso dois."
    previewMock.data = { versionId: "v1", version: 1, extraction: null, chunks: [{ ...chunk, heading: "Abertura", text, images: [{ id: "abc", page: 3, width: 800, height: 400, at: "Passo um.".length }] }] }
    render(<KnowledgeAiPreview document={document} />)
    fireEvent.click(screen.getByText("Abertura"))
    const image = screen.getByRole("img", { name: "Imagem da página 3 do documento" })
    expect(image.getAttribute("src")).toContain("/api/v1/admin/knowledge/d/versions/v1/images/abc")
    expect(screen.getByText(/A IA não lê imagens: ela recebe só o texto deste trecho/)).toBeTruthy()
    expect(screen.getByText("Passo um.").compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(image.compareDocumentPosition(screen.getByText("Passo dois.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("mostra as linhas do documento e diz que a IA recebe as mesmas palavras", () => {
    previewMock.data = { versionId: "v1", version: 1, extraction: null, chunks: [{ ...chunk, displayText: "Linha 1 de conteudo.\nLinha 2 de conteudo." }] }
    const { container } = render(<KnowledgeAiPreview document={document} />)
    fireEvent.click(screen.getByText("Trecho 1, sem título"))
    expect(screen.getByText(/A IA recebe as mesmas palavras/)).toBeTruthy()
    expect(container.querySelector(".knowledge-article")?.querySelectorAll("br").length).toBeGreaterThan(0)
  })

  it("rascunho fora do escopo de quem lê não entra na prévia nem oferece reprocessar", () => {
    previewMock.data = { versionId: "v1", version: 1, extraction: null, chunks: [chunk] }
    const restricted = { ...document, draft: { id: "v2", version: 2, restricted: true }, editable: { versionId: "v2", version: 2, config: null, restricted: true } } as typeof document
    render(<KnowledgeAiPreview document={restricted} />)
    expect(screen.queryByRole("button", { name: "Rascunho: V2" })).toBeNull()
    expect(screen.getByText("Em uso: V1")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Reprocessar arquivo original/ })).toBeNull()
  })

  it("sem diferença de linhas, usa o texto do trecho e não mostra o aviso", () => {
    previewMock.data = { versionId: "v1", version: 1, extraction: null, chunks: [{ ...chunk, displayText: null }] }
    render(<KnowledgeAiPreview document={document} />)
    fireEvent.click(screen.getByText("Trecho 1, sem título"))
    expect(screen.queryByText(/A IA recebe as mesmas palavras/)).toBeNull()
    expect(screen.getByText(/Linha 1 de conteudo\. Linha 2 de conteudo\./)).toBeTruthy()
  })
})

describe("página citada", () => {
  it("o link da fonte abre o material na página, dizendo de que versão ela é", () => {
    expect(buildKnowledgeMaterialHref("a/b")).toBe("/materiais/a%2Fb")
    expect(buildKnowledgeMaterialPageHref("abc", { page: 3, versionId: "v1" })).toBe("/materiais/abc?pagina=3&versao=v1")
  })

  it("fonte sem páginas (resposta antiga ou base que não é PDF) continua válida e sem rótulo", () => {
    const base = { documentId: "d", documentTitle: "T", versionId: "v", heading: "H", chunkIndex: 0, available: true }
    expect(sourcePageLabel(clarificationSourceSchema.parse(base))).toBeNull()
    expect(sourcePageLabel(clarificationSourceSchema.parse({ ...base, pages: { from: 3, to: 3 } }))).toBe("p. 3")
    expect(sourcePageLabel(clarificationSourceSchema.parse({ ...base, pages: { from: 3, to: 4 } }))).toBe("p. 3–4")
    expect(sourcePageLabel(clarificationSourceSchema.parse({ ...base, available: false, pages: { from: 3, to: 3 } }))).toBeNull()
  })
})

describe("Markdown que vem do PDF", () => {
  it("barra dentro da célula não abre coluna nova", () => {
    const blocks = parseArticle("| Produto | Canal |\n| --- | --- |\n| Fibra \\| Cabo | App |")
    expect(blocks[0]).toEqual({ kind: "table", header: ["Produto", "Canal"], rows: [["Fibra | Cabo", "App"]] })
  })
})
