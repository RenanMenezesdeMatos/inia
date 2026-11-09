// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { KnowledgeMaterial } from "@/schemas/knowledge/knowledge-material.schema"

import { KnowledgeMaterialPage } from "./knowledge-material-page"

const fileQuery = vi.fn()
let material: KnowledgeMaterial

vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }))
vi.mock("next/dynamic", () => ({ default: () => ({ initialPage }: { initialPage?: number }) => <div data-testid="pdf-viewer" data-page={initialPage} /> }))
vi.mock("@/queries/knowledge/use-knowledge-material-queries", () => ({
  useKnowledgeMaterialQuery: () => ({ isLoading: false, isError: false, data: material }),
  useKnowledgeMaterialFileQuery: (id: string | null) => {
    fileQuery(id)
    return { isLoading: false, isError: false, data: id ? { blob: new Blob(["pdf"]), filename: "manual.pdf" } : undefined }
  },
  useKnowledgeMaterialPreviewQuery: () => ({ isLoading: false, isError: true, data: undefined }),
}))

const EXTRACTION = {
  version: "PDF_MARKDOWN_V1",
  pageCount: 2,
  pages: [
    { page: 1, status: "TEXT" as const, chars: 10, headings: 0, tables: 0, offset: 0 },
    { page: 2, status: "TEXT" as const, chars: 10, headings: 0, tables: 0, offset: 18 },
  ],
  headings: 0,
  tables: 0,
  repeatedLinesRemoved: 0,
  taggedPages: 0,
  edited: false,
  images: [{ id: "abc", page: 1, offset: 16, width: 800, height: 400 }],
}
const base: KnowledgeMaterial = { id: "m1", title: "Manual", documentType: "MANUAL", sourceType: "PDF", originalFilename: "manual.pdf", mimeType: "application/pdf", fileSizeBytes: 1000, updatedAt: "2026-11-06T10:00:00.000Z", content: "Texto da página 1\n\nTexto da página 2", version: 2, versionId: "v2", extraction: EXTRACTION }

beforeEach(() => {
  material = base
  fileQuery.mockClear()
})
afterEach(cleanup)

describe("página do material em PDF", () => {
  it("abre como conteúdo, com os prints no texto, sem baixar o arquivo", () => {
    render(<KnowledgeMaterialPage materialId="m1" />)
    expect(screen.getByTestId("knowledge-reading-view")).toBeTruthy()
    expect(screen.getByText("Texto da página 1")).toBeTruthy()
    expect(screen.getByRole("img", { name: "Imagem da página 1 do documento" }).getAttribute("src")).toContain("/api/v1/knowledge-materials/m1/images/abc")
    expect(screen.queryByTestId("pdf-viewer")).toBeNull()
    expect(fileQuery).toHaveBeenLastCalledWith(null)
  })

  it("o PDF original fica a um clique", () => {
    render(<KnowledgeMaterialPage materialId="m1" />)
    fireEvent.click(screen.getByRole("radio", { name: "PDF original" }))
    expect(screen.getByTestId("pdf-viewer")).toBeTruthy()
    expect(screen.queryByTestId("knowledge-reading-view")).toBeNull()
    expect(fileQuery).toHaveBeenLastCalledWith("m1")
    fireEvent.click(screen.getByRole("radio", { name: "Conteúdo" }))
    expect(screen.getByTestId("knowledge-reading-view")).toBeTruthy()
  })

  it("chegando por uma citação, avisa a página e leva a ela no PDF", () => {
    render(<KnowledgeMaterialPage materialId="m1" citedPage={2} citedVersionId="v2" />)
    expect(screen.getByTestId("material-cited-page").textContent).toContain("Aberto na página 2")
    expect(screen.getByTestId("pagina-2")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Ver no PDF" }))
    expect(screen.getByTestId("pdf-viewer").getAttribute("data-page")).toBe("2")
  })

  it("citação de outra versão diz que a página pode ter mudado", () => {
    render(<KnowledgeMaterialPage materialId="m1" citedPage={2} citedVersionId="v1" />)
    expect(screen.getByTestId("material-cited-page").textContent).toContain("versão anterior")
  })

  it("versão convertida antes da leitura de imagens: continua abrindo o PDF, onde as imagens estão", () => {
    const older: NonNullable<KnowledgeMaterial["extraction"]> = { ...EXTRACTION }
    delete older.images
    material = { ...base, extraction: older }
    render(<KnowledgeMaterialPage materialId="m1" />)
    expect(screen.getByTestId("pdf-viewer")).toBeTruthy()
    expect(screen.queryByTestId("reading-mode")).toBeNull()
    expect(screen.getByText("Leitura do arquivo original.")).toBeTruthy()
  })

  it("PDF digitalizado e PDF sem registro continuam no PDF", () => {
    material = { ...base, content: "", extraction: { ...EXTRACTION, pages: [{ page: 1, status: "NO_TEXT", chars: 0, headings: 0, tables: 0, offset: null }] } }
    const { unmount } = render(<KnowledgeMaterialPage materialId="m1" />)
    expect(screen.getByTestId("pdf-viewer")).toBeTruthy()
    unmount()
    material = { ...base, extraction: null }
    render(<KnowledgeMaterialPage materialId="m1" />)
    expect(screen.getByTestId("pdf-viewer")).toBeTruthy()
  })

  it("material de outro formato não ganha a troca", () => {
    material = { ...base, sourceType: "TXT", extraction: null, content: "Só texto." }
    render(<KnowledgeMaterialPage materialId="m1" />)
    expect(screen.queryByTestId("reading-mode")).toBeNull()
    expect(screen.getByText("Só texto.")).toBeTruthy()
  })
})
