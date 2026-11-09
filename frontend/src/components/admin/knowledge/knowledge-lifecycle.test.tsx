/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { KnowledgeDocument, KnowledgeDocumentDetail, KnowledgeVersionComparison, KnowledgeVersionConfig, KnowledgeVersionDetail, KnowledgeVersionFullRow, KnowledgeVersionRow } from "@/schemas/admin/knowledge.schema"

import { KnowledgeDetailPage } from "./knowledge-detail-page"
import { EditKnowledgePage } from "./knowledge-form-page"
import { KnowledgePage } from "./knowledge-page"

/**
 * PEN-008 (decisão de 04/11/2026): o destaque é a versão EFETIVAMENTE em uso. Rascunho e atualização aparecem à parte, e nenhuma versão é
 * apresentada como em uso só porque foi salva ou teve a publicação pedida. O histórico é comparável e reverter publica uma versão nova.
 */
const service = vi.hoisted(() => ({
  fetchKnowledgeDocument: vi.fn(),
  fetchKnowledgeDocuments: vi.fn(),
  fetchKnowledgeDocumentsPage: vi.fn(),
  fetchKnowledgeFile: vi.fn(),
  fetchKnowledgeDocumentPreview: vi.fn(),
  fetchKnowledgeVersions: vi.fn(),
  fetchKnowledgeVersion: vi.fn(),
  fetchKnowledgeVersionFile: vi.fn(),
  fetchKnowledgeVersionPreview: vi.fn(),
  compareKnowledgeVersions: vi.fn(),
  createKnowledgeDocument: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
  replaceKnowledgeDraftFile: vi.fn(),
  publishKnowledgeDocument: vi.fn(),
  archiveKnowledgeDocument: vi.fn(),
  reactivateKnowledgeDocument: vi.fn(),
  discardKnowledgeDraft: vi.fn(),
  retryKnowledgeVersion: vi.fn(),
  revertKnowledgeVersion: vi.fn(),
  deleteKnowledgeDocument: vi.fn(),
}))
vi.mock("@/services/admin/knowledge-service", () => service)
vi.mock("@/services/admin/org-structure-service", () => ({
  fetchTeams: vi.fn(async () => [{ id: "t1", name: "Atendimento", operationId: "op-1", subteams: [{ id: "st1", teamId: "t1", name: "Contas" }] }]),
  fetchManageableTeams: vi.fn(async () => ({ teams: [], unrestricted: true })),
  fetchSubjects: vi.fn(async () => [{ id: "s1", name: "Faturas", description: null, active: true }]),
}))
vi.mock("@/queries/admin/use-product-catalog-queries", () => ({
  useProductNodesQuery: () => ({ data: [{ id: "p1", kind: "PRODUCT", name: "Linha IP" }] }),
}))
vi.mock("@/components/admin/product-catalog/product-scope-field", () => ({
  ProductScopeCard: () => null,
  ProductScopeField: () => null,
  useProductScopeLabels: () => ({ available: false, labelsOf: () => [] }),
  useSourceProductScope: () => ({ available: false, nodes: [], value: [], setValue: vi.fn(), changed: false, save: vi.fn(async () => undefined), saving: false }),
}))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/admin/knowledge",
  useSearchParams: () => new URLSearchParams(),
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const CONFIG: KnowledgeVersionConfig = {
  title: "Segunda via",
  documentType: "PROCEDURE",
  sourceType: "TEXT",
  file: null,
  orgScopes: [{ scopeType: "SUBTEAM", teamId: "t1", subteamId: "st1" }],
  subjectScopes: [{ scopeType: "SUBJECT", subjectId: "s1" }],
  productNodeIds: [],
}

const ROW: KnowledgeDocument = {
  id: "kb-1",
  title: "Segunda via",
  documentType: "PROCEDURE",
  sourceType: "TEXT",
  originalFilename: null,
  mimeType: null,
  fileSizeBytes: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: null,
  authorName: "Bruna Lima",
  status: "PUBLISHED",
  inUseVersion: 4,
  draftVersion: null,
  updateVersion: null,
  updateStatus: null,
  excerpt: "Trecho da versão em uso",
  orgScopes: [{ id: "o1", scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null }],
  subjectScopes: [{ id: "s1", scopeType: "ALL_SUBJECTS", subjectId: null, subjectName: null }],
}

const IN_USE: NonNullable<KnowledgeDocumentDetail["inUse"]> = {
  id: "v4",
  version: 4,
  status: "PUBLISHED",
  content: "Texto da versão em uso, que a IA consulta.",
  publishedAt: "2026-11-01T10:00:00.000Z",
  publishedByName: "Bruna Lima",
  changeSummary: "Prazo novo",
}

const DRAFT: NonNullable<KnowledgeDocumentDetail["draft"]> = {
  id: "v5",
  version: 5,
  status: "DRAFT",
  content: "Texto do rascunho, ainda fora de uso.",
  config: { ...CONFIG, title: "Segunda via (rascunho)" },
  textAvailable: true,
  changeSummary: "Resumo já gravado",
  updatedAt: "2026-11-03T09:00:00.000Z",
  updatedByName: "Caio Alves",
  restricted: false,
}

const detail = (overrides: Partial<KnowledgeDocumentDetail> = {}): KnowledgeDocumentDetail => ({
  ...ROW,
  inUseProductNodeIds: [],
  latestVersion: { version: 4, content: IN_USE.content, status: "PUBLISHED", createdAt: "2026-11-01T10:00:00.000Z", restricted: false },
  inUse: IN_USE,
  archived: null,
  draft: null,
  updates: [],
  editable: { versionId: "v4", version: 4, status: "PUBLISHED", content: IN_USE.content, config: CONFIG, textAvailable: true, restricted: false },
  ...overrides,
})

const withDraft = (overrides: Partial<KnowledgeDocumentDetail> = {}) =>
  detail({ draftVersion: 5, draft: DRAFT, editable: { versionId: "v5", version: 5, status: "DRAFT", content: DRAFT.content, config: DRAFT.config, textAvailable: true, restricted: false }, ...overrides })

const noVersionReady = (overrides: Partial<KnowledgeDocumentDetail> = {}) =>
  detail({
    status: "DRAFT",
    inUseVersion: null,
    draftVersion: 1,
    inUse: null,
    draft: { ...DRAFT, id: "v1", version: 1 },
    editable: { versionId: "v1", version: 1, status: "DRAFT", content: "Primeiro texto da base.", config: CONFIG, textAvailable: true, restricted: false },
    ...overrides,
  })

const RESTRICTED_NOTE = "Há um rascunho preparado para Grupos fora do seu escopo. Só quem administra todos eles pode vê-lo, editá-lo, publicá-lo ou descartá-lo."

/** O que a API manda quando o alcance do rascunho está fora do de quem lê (d7c5be69): número, situação, quem salvou e quando, sem texto nem configuração. */
const RESTRICTED_DRAFT: NonNullable<KnowledgeDocumentDetail["draft"]> = {
  id: "v5",
  version: 5,
  status: "DRAFT",
  content: "",
  extraction: null,
  config: null,
  textAvailable: false,
  changeSummary: null,
  updatedAt: "2026-11-06T15:00:00.000Z",
  updatedByName: "Diana Rocha",
  ocr: null,
  restricted: true,
}

const withRestrictedDraft = (overrides: Partial<KnowledgeDocumentDetail> = {}) =>
  detail({
    draftVersion: 5,
    latestVersion: { version: 5, content: "", status: "DRAFT", createdAt: "2026-11-06T15:00:00.000Z", restricted: true },
    draft: RESTRICTED_DRAFT,
    editable: { versionId: "v5", version: 5, status: "DRAFT", content: "", extraction: null, config: null, textAvailable: false, restricted: true },
    ...overrides,
  })

const versionRow = (overrides: Partial<KnowledgeVersionFullRow> & { number: number }): KnowledgeVersionFullRow => ({
  id: `v${overrides.number}`,
  status: "PUBLISHED",
  situation: "REPLACED",
  createdAt: "2026-10-01T10:00:00.000Z",
  publishedAt: "2026-10-02T10:00:00.000Z",
  restricted: false,
  origin: "EDIT",
  authorName: "Bruna Lima",
  updatedAt: null,
  updatedByName: null,
  publishRequestedAt: null,
  publishRequestedByName: null,
  publishedByName: "Bruna Lima",
  changeSummary: "Ajuste de prazo",
  revertedFromNumber: null,
  errorCode: null,
  errorMessage: null,
  supersededReason: null,
  textAvailable: true,
  hasConfig: true,
  usageCount: 0,
  lastUsedAt: null,
  ...overrides,
})

const VERSIONS: KnowledgeVersionRow[] = [
  versionRow({ number: 6, status: "SUPERSEDED", situation: "SUPERSEDED", publishedAt: null, supersededReason: "NEWER_VERSION" }),
  versionRow({ number: 5, status: "DRAFT", situation: "DRAFT", publishedAt: null, changeSummary: null, authorName: null, publishedByName: null }),
  versionRow({ number: 4, situation: "IN_USE", usageCount: 37, origin: "REVERT", revertedFromNumber: 2 }),
  { id: "v3", number: 3, status: "PUBLISHED", situation: "REPLACED", createdAt: "2026-10-01T10:00:00.000Z", publishedAt: "2026-10-02T10:00:00.000Z", restricted: true },
  versionRow({ number: 2 }),
  versionRow({ number: 1, status: "SUPERSEDED", situation: "SUPERSEDED", publishedAt: null, supersededReason: "ARCHIVED" }),
]

const VERSION_DETAIL: KnowledgeVersionDetail = { id: "v2", number: 2, status: "PUBLISHED", content: "Texto antigo da V2.", textAvailable: true, config: CONFIG, fileId: null, changeSummary: "Ajuste de prazo", publishedAt: "2026-10-02T10:00:00.000Z" }

const COMPARISON: KnowledgeVersionComparison = {
  from: { id: "v2", number: 2, status: "PUBLISHED" },
  to: { id: "v4", number: 4, status: "PUBLISHED" },
  configuration: {
    comparable: true,
    changes: [
      { field: "title", label: "Título", kind: "CHANGED", from: ["Segunda via"], to: ["Segunda via de conta"] },
      { field: "orgScopes", label: "Alcance", kind: "CHANGED", from: ["Grupo Atendimento", "Subgrupo Contas"], to: ["Subgrupo Contas", "Grupo Vendas"] },
    ],
  },
  file: { change: "REPLACED", from: { filename: "manual-2025.pdf", sizeBytes: 2048 }, to: { filename: "manual-2026.pdf", sizeBytes: 4096 } },
  content: {
    comparable: true,
    identical: false,
    added: 1,
    removed: 1,
    changed: 1,
    unchanged: 10,
    rows: [
      { kind: "CHANGED", leftLine: 1, rightLine: 1, left: "Prazo de 5 dias", right: "Prazo de 3 dias" },
      ...Array.from({ length: 10 }, (_, index) => ({ kind: "UNCHANGED" as const, leftLine: index + 2, rightLine: index + 2, left: `Linha igual ${index + 2}`, right: `Linha igual ${index + 2}` })),
      { kind: "REMOVED", leftLine: 12, left: "Regra que saiu" },
      { kind: "ADDED", rightLine: 12, right: "Regra que entrou" },
    ],
  },
}

const conflict = (code: string, message: string) => new AdminApiError(message, code)

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  service.fetchKnowledgeVersions.mockResolvedValue(VERSIONS)
  service.fetchKnowledgeVersion.mockResolvedValue(VERSION_DETAIL)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

async function renderDetail(document: KnowledgeDocumentDetail) {
  service.fetchKnowledgeDocument.mockResolvedValue(document)
  renderWithQuery(<KnowledgeDetailPage documentId={document.id} />)
  await screen.findByRole("heading", { level: 1, name: document.title })
}

async function openHistory() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Histórico de versões" }), { button: 0 })
  return screen.findByRole("table")
}

describe("detalhe: em uso × rascunho × atualização", () => {
  it("o destaque é a versão em uso; o rascunho fica à parte e o texto dele não aparece como vigente", async () => {
    await renderDetail(withDraft())
    expect(screen.getByText("Em uso pela IA: V4 · Publicada")).toBeInTheDocument()
    expect(screen.getByText("Rascunho: V5")).toBeInTheDocument()
    expect(screen.getByText(/Salvo por Caio Alves em/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Publicar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Arquivar" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reativar" })).not.toBeInTheDocument()
    expect(screen.getByText("Conteúdo da V4, em uso pela IA.")).toBeInTheDocument()
    expect(screen.getByText(IN_USE.content)).toBeInTheDocument()
    expect(screen.queryByText(DRAFT.content)).not.toBeInTheDocument()
  })

  it("publicação pedida não vira em uso: 'Atualização: V5 · Processando' à parte, com a V4 valendo", async () => {
    await renderDetail(detail({ updateVersion: 5, updateStatus: "PROCESSING", updates: [{ id: "v5", version: 5, status: "PROCESSING", requestedAt: "2026-11-04T10:00:00.000Z", requestedByName: "Caio Alves", errorCode: null, errorMessage: null }] }))
    expect(screen.getByText("Em uso pela IA: V4 · Publicada")).toBeInTheDocument()
    expect(screen.getByText("Atualização: V5 · Processando")).toBeInTheDocument()
    expect(screen.getByText(/A V4 continua em uso/)).toBeInTheDocument()
    expect(screen.queryByText("Em uso pela IA: V5 · Publicada")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Tentar novamente/ })).not.toBeInTheDocument()
  })

  it("enquanto processa, o detalhe se atualiza sozinho e para quando acaba", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const processing = detail({ updateVersion: 5, updateStatus: "PROCESSING", updates: [{ id: "v5", version: 5, status: "PROCESSING", requestedAt: null, requestedByName: null, errorCode: null, errorMessage: null }] })
    const ready = detail({ inUseVersion: 5, inUse: { ...IN_USE, id: "v5", version: 5 } })
    service.fetchKnowledgeDocument.mockResolvedValueOnce(processing).mockResolvedValue(ready)
    renderWithQuery(<KnowledgeDetailPage documentId="kb-1" />)
    await screen.findByText("Atualização: V5 · Processando")
    expect(service.fetchKnowledgeDocument).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(3_100))
    await screen.findByText("Em uso pela IA: V5 · Publicada")
    expect(screen.queryByText("Atualização: V5 · Processando")).not.toBeInTheDocument()
    const callsAfterReady = service.fetchKnowledgeDocument.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(service.fetchKnowledgeDocument).toHaveBeenCalledTimes(callsAfterReady)
  })

  it("PDF digitalizado: mostra a leitura em andamento, não deixa publicar e se atualiza até o texto chegar", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const ocr = (status: "RUNNING" | "DONE", pagesDone: number) => ({ id: "j1", status, stage: "READING" as const, pagesDone, pagesTotal: 5, errorCode: null, errorMessage: null, createdAt: "2026-11-07T10:00:00.000Z", finishedAt: null })
    const reading = withDraft({ draft: { ...DRAFT, content: "", textAvailable: false, ocr: ocr("RUNNING", 2) } })
    const extraction = { version: "PDF_MARKDOWN_V1", pageCount: 5, pages: [], headings: 1, tables: 0, repeatedLinesRemoved: 0, taggedPages: 0, edited: false, images: [], ocr: { version: "PDF_OCR_V1", engine: "Tesseract", printRule: "PDF_PRINT_RULE_V1", pages: [1, 2, 3, 4, 5], failedPages: [], skippedPages: [], prints: 2 } }
    const done = withDraft({ draft: { ...DRAFT, content: "Texto lido.", extraction, ocr: ocr("DONE", 5) } })
    service.fetchKnowledgeDocument.mockResolvedValueOnce(reading).mockResolvedValue(done)
    renderWithQuery(<KnowledgeDetailPage documentId="kb-1" />)
    await screen.findByText("Lendo as páginas digitalizadas (OCR): 2 de 5.")
    expect(screen.getByRole("button", { name: /Publicar/ })).toBeDisabled()
    expect(screen.queryByText(/Sem texto: publicar assim falha/)).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(3_100))
    await screen.findByText(/Parte do texto veio do OCR: confira com o PDF antes de publicar/)
    expect(screen.getByRole("button", { name: /Publicar/ })).toBeEnabled()
  })

  it("leitura do PDF que não terminou mostra o motivo", async () => {
    await renderDetail(withDraft({ draft: { ...DRAFT, ocr: { id: "j1", status: "FAILED", stage: null, pagesDone: 0, pagesTotal: 3, errorCode: "KNOWLEDGE_OCR_UNAVAILABLE", errorMessage: "Os arquivos do motor de OCR não estão no servidor.", createdAt: "2026-11-07T10:00:00.000Z", finishedAt: "2026-11-07T10:01:00.000Z" } } }))
    expect(screen.getByText("Os arquivos do motor de OCR não estão no servidor.")).toBeInTheDocument()
  })

  it("atualização com falha: a anterior segue em uso, com o motivo e Tentar novamente", async () => {
    const failed = detail({ updates: [{ id: "v5", version: 5, status: "FAILED", requestedAt: null, requestedByName: null, errorCode: "KNOWLEDGE_NO_CHUNKS", errorMessage: "O conteúdo não gerou nenhum trecho consultável." }] })
    await renderDetail(failed)
    expect(screen.getByText("Atualização: V5 · Falha")).toBeInTheDocument()
    expect(screen.getByText("O conteúdo não gerou nenhum trecho consultável.")).toBeInTheDocument()
    expect(screen.getByText("Em uso pela IA: V4 · Publicada")).toBeInTheDocument()
    service.retryKnowledgeVersion.mockResolvedValue(detail({ updates: [{ ...failed.updates[0]!, status: "PROCESSING", errorCode: null, errorMessage: null }] }))
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    await waitFor(() => expect(service.retryKnowledgeVersion).toHaveBeenCalledWith("kb-1", "v5", {}))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("V5 em processamento")))
  })

  it("sem versão pronta a base não parece disponível: o conteúdo é o da edição, marcado como fora do alcance da IA", async () => {
    await renderDetail(noVersionReady())
    expect(screen.getByText("Em uso pela IA: nenhuma versão pronta")).toBeInTheDocument()
    expect(screen.getByText("Conteúdo da V1: ainda não disponível para a IA.")).toBeInTheDocument()
    expect(screen.getByText("Primeiro texto da base.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Arquivar" })).not.toBeInTheDocument()
    // A API recusa descartar o único rascunho: a tela explica em vez de oferecer um botão que falha.
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument()
    expect(screen.getByText(/para retirá-la, use Excluir/)).toBeInTheDocument()
  })

  it("arquivada fica claramente fora de uso, com Reativar e sem Arquivar", async () => {
    const archived = detail({ status: "ARCHIVED", inUseVersion: null, inUse: null, archived: { id: "v4", version: 4 } })
    await renderDetail(archived)
    expect(screen.getByText("Base arquivada: fora de uso pela IA")).toBeInTheDocument()
    expect(screen.getByText("Conteúdo da V4, arquivada: fora de uso pela IA.")).toBeInTheDocument()
    expect(screen.queryByText(/Em uso pela IA: V/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Arquivar" })).not.toBeInTheDocument()
    service.reactivateKnowledgeDocument.mockResolvedValue(detail())
    fireEvent.click(screen.getByRole("button", { name: "Reativar" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reativar" }))
    await waitFor(() => expect(service.reactivateKnowledgeDocument.mock.calls[0]?.[0]).toBe("kb-1"))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Base reativada: V4 em uso pela IA."))
  })

  it("arquivar fica disponível com rascunho por cima, depois de confirmar", async () => {
    await renderDetail(withDraft())
    service.archiveKnowledgeDocument.mockResolvedValue(withDraft({ status: "ARCHIVED", inUseVersion: null, inUse: null, archived: { id: "v4", version: 4 } }))
    fireEvent.click(screen.getByRole("button", { name: "Arquivar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/O rascunho, se houver, é mantido/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Arquivar" }))
    await waitFor(() => expect(service.archiveKnowledgeDocument.mock.calls[0]?.[0]).toBe("kb-1"))
  })

  it("descartar o rascunho pede confirmação e mostra o conflito no diálogo", async () => {
    await renderDetail(withDraft())
    service.discardKnowledgeDraft.mockRejectedValue(conflict("KNOWLEDGE_DRAFT_ONLY", "Esta base só tem o rascunho: para retirá-la, exclua a base."))
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Descartar" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("exclua a base")
    expect(toast.error).not.toHaveBeenCalled()
  })
})

/**
 * Rascunho cujo alcance quem lê não alcança (d7c5be69): a API manda só número e situação e recusa editar, trocar arquivo, reprocessar,
 * publicar e descartar com 403. A tela diz isso no lugar do editor vazio e não oferece essas ações; a versão em uso continua normal.
 */
describe("rascunho fora do escopo de quem lê", () => {
  it("aviso no lugar do rascunho, com quem salvou e quando; sem Editar, Publicar nem Descartar; a versão em uso continua visível", async () => {
    await renderDetail(withRestrictedDraft())
    const notice = screen.getByTestId("knowledge-restricted-draft")
    expect(notice).toHaveTextContent(RESTRICTED_NOTE)
    expect(notice).toHaveTextContent(/Salvo por Diana Rocha em/)
    expect(screen.getByText("Em uso pela IA: V4 · Publicada")).toBeInTheDocument()
    expect(screen.getByText("Conteúdo da V4, em uso pela IA.")).toBeInTheDocument()
    expect(screen.getByText(IN_USE.content)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Publicar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Editar" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Sem texto: publicar assim falha/)).not.toBeInTheDocument()
    // Arquivar vale para a versão em uso, não para o rascunho: a API continua aceitando.
    expect(screen.getByRole("button", { name: "Arquivar" })).toBeInTheDocument()
  })

  it("rascunho comum continua igual: sem o aviso, com Editar, Publicar e Descartar", async () => {
    await renderDetail(withDraft())
    expect(screen.queryByTestId("knowledge-restricted-draft")).not.toBeInTheDocument()
    expect(screen.queryByText(RESTRICTED_NOTE)).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute("href", "/admin/knowledge/kb-1/edit")
    expect(screen.getByRole("button", { name: "Publicar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument()
  })

  it("sem versão em uso, o conteúdo do rascunho não aparece como texto vazio: o aviso ocupa o lugar", async () => {
    await renderDetail(withRestrictedDraft({ status: "ARCHIVED", inUseVersion: null, inUse: null, archived: { id: "v4", version: 4 } }))
    expect(screen.getByText("Base arquivada: fora de uso pela IA")).toBeInTheDocument()
    expect(screen.queryByText("Esta versão não tem conteúdo textual.")).not.toBeInTheDocument()
    expect(screen.queryByText(/Conteúdo da V5/)).not.toBeInTheDocument()
    expect(within(screen.getByRole("tabpanel")).getByText(RESTRICTED_NOTE)).toBeInTheDocument()
  })

  it("formulário de edição: aviso no lugar dos campos, sem trocar arquivo nem Salvar", async () => {
    service.fetchKnowledgeDocument.mockResolvedValue(withRestrictedDraft())
    renderWithQuery(<EditKnowledgePage documentId="kb-1" />)
    expect(await screen.findByText(RESTRICTED_NOTE)).toBeInTheDocument()
    expect(screen.getByText(/Salvo por Diana Rocha em/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Título")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Arquivo novo para o rascunho")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Trocar arquivo|Enviar arquivo/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Salvar rascunho" })).not.toBeInTheDocument()
  })

  it("reverter não oferece descartar o rascunho restrito", async () => {
    await renderDetail(withRestrictedDraft())
    await openHistory()
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações da V2" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reverter para esta versão" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).queryByRole("checkbox", { name: "Descartar o rascunho" })).not.toBeInTheDocument()
    expect(within(dialog).getByText(/fora do seu escopo/)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Publicar como versão nova" })).toBeDisabled()
  })
})

describe("publicar", () => {
  it("abre o diálogo, explica o alcance e envia o resumo; a resposta diz o que aconteceu de verdade", async () => {
    await renderDetail(withDraft())
    const requested = detail({ updates: [{ id: "v5", version: 5, status: "PROCESSING", requestedAt: null, requestedByName: null, errorCode: null, errorMessage: null }] })
    service.publishKnowledgeDocument.mockResolvedValue(requested)
    service.fetchKnowledgeDocument.mockResolvedValue(requested)
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/todos os agentes, Workflows e orquestradores que usam esta base, sem republicá-los, e só depois de pronta/)).toBeInTheDocument()
    expect(within(dialog).getByText(/a IA continua usando a V4/)).toBeInTheDocument()
    const summary = within(dialog).getByLabelText("Resumo da alteração (opcional)")
    expect(summary).toHaveValue("Resumo já gravado")
    fireEvent.change(summary, { target: { value: "Prazo de 3 dias" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar V5" }))
    await waitFor(() => expect(service.publishKnowledgeDocument).toHaveBeenCalledWith("kb-1", { changeSummary: "Prazo de 3 dias" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("V5 em processamento: a IA passa a usá-la quando ficar pronta."))
    expect(await screen.findByText("Atualização: V5 · Processando")).toBeInTheDocument()
    expect(screen.getByText("Em uso pela IA: V4 · Publicada")).toBeInTheDocument()
  })

  it("processamento que falhou na hora nunca é anunciado como sucesso", async () => {
    await renderDetail(withDraft())
    service.publishKnowledgeDocument.mockResolvedValue(detail({ updates: [{ id: "v5", version: 5, status: "FAILED", requestedAt: null, requestedByName: null, errorCode: "KNOWLEDGE_TEXT_UNAVAILABLE", errorMessage: "Não há texto para a IA consultar." }] }))
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Publicar V5" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A V5 não ficou pronta: Não há texto para a IA consultar."))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("em base arquivada só publica com a confirmação de que ela volta a valer", async () => {
    await renderDetail(withDraft({ status: "ARCHIVED", inUseVersion: null, inUse: null, archived: { id: "v4", version: 4 } }))
    service.publishKnowledgeDocument.mockResolvedValue(detail())
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }))
    const dialog = await screen.findByRole("alertdialog")
    // Publicar aqui é também reativar: o título, o aviso e o botão dizem isso, e sem a confirmação nada acontece.
    expect(within(dialog).getByRole("heading", { name: "Publicar o rascunho V5 e reativar a base?" })).toBeInTheDocument()
    expect(within(dialog).getByText(/Até lá, e se o processamento falhar, a base continua arquivada/)).toBeInTheDocument()
    expect(within(dialog).getByText(/faz a base voltar a valer para a IA/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Para ela continuar arquivada, cancele; o rascunho fica salvo/)).toBeInTheDocument()
    const publish = within(dialog).getByRole("button", { name: "Publicar V5 e reativar" })
    expect(publish).toBeDisabled()
    fireEvent.click(publish)
    expect(service.publishKnowledgeDocument).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Confirmo que a base volta a valer para a IA" }))
    expect(publish).toBeEnabled()
    fireEvent.click(publish)
    await waitFor(() => expect(service.publishKnowledgeDocument).toHaveBeenCalledWith("kb-1", { changeSummary: "Resumo já gravado", reactivate: true }))
  })

  it("rascunho que muda os produtos: o diálogo avisa que eles passam a valer junto com a versão", async () => {
    await renderDetail(withDraft({ inUseProductNodeIds: ["p1"], draft: { ...DRAFT, config: { ...CONFIG, productNodeIds: ["p2"] } } }))
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/Os produtos do rascunho \(“Vale para”\) passam a valer junto com ela/)).toBeInTheDocument()
  })

  it("base arquivada com atualização em processamento: continua fora de uso, e a tela diz quem confirmou a reativação", async () => {
    await renderDetail(detail({ status: "ARCHIVED", inUseVersion: null, inUse: null, archived: { id: "v4", version: 4 }, updates: [{ id: "v5", version: 5, status: "PROCESSING", requestedAt: "2026-11-03T09:00:00.000Z", requestedByName: "Caio Alves", errorCode: null, errorMessage: null, reactivationConfirmedByName: "Caio Alves" }] }))
    expect(screen.getByText("Base arquivada: fora de uso pela IA")).toBeInTheDocument()
    expect(screen.queryByText(/Em uso pela IA/)).not.toBeInTheDocument()
    expect(screen.getByText(/A base continua arquivada e fora de uso pela IA/)).toBeInTheDocument()
    expect(screen.getByText(/Caio Alves confirmou que a base volta a valer quando esta versão ficar pronta/)).toBeInTheDocument()
  })

  it("tentar de novo em base arquivada pede a mesma confirmação; sem ela, nada é enviado", async () => {
    await renderDetail(detail({ status: "ARCHIVED", inUseVersion: null, inUse: null, archived: { id: "v4", version: 4 }, updates: [{ id: "v5", version: 5, status: "FAILED", requestedAt: "2026-11-03T09:00:00.000Z", requestedByName: "Caio Alves", errorCode: "KNOWLEDGE_NO_CHUNKS", errorMessage: "Sem trechos." }] }))
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(service.retryKnowledgeVersion).not.toHaveBeenCalled()
    const retry = within(dialog).getByRole("button", { name: "Tentar de novo e reativar" })
    expect(retry).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Confirmo que a base volta a valer para a IA" }))
    service.retryKnowledgeVersion.mockResolvedValue(detail())
    fireEvent.click(retry)
    await waitFor(() => expect(service.retryKnowledgeVersion).toHaveBeenCalledWith("kb-1", "v5", { reactivate: true }))
  })

  it("409 de base arquivada no meio do caminho vira a confirmação, sem toast de erro", async () => {
    await renderDetail(withDraft())
    service.publishKnowledgeDocument.mockRejectedValueOnce(conflict("KNOWLEDGE_ARCHIVED_REACTIVATION_REQUIRED", "Esta base está arquivada."))
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar V5" }))
    expect(await within(dialog).findByRole("checkbox", { name: "Confirmo que a base volta a valer para a IA" })).toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("409 sem rascunho fica escrito no diálogo", async () => {
    await renderDetail(withDraft())
    service.publishKnowledgeDocument.mockRejectedValueOnce(conflict("KNOWLEDGE_NOTHING_TO_PUBLISH", "Não há rascunho para publicar."))
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar V5" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Não há rascunho para publicar.")
    expect(toast.error).not.toHaveBeenCalled()
  })
})

describe("lista", () => {
  const rows: KnowledgeDocument[] = [
    { ...ROW, id: "a", title: "Base em uso com rascunho", draftVersion: 5 },
    { ...ROW, id: "b", title: "Base com atualização", updateVersion: 5, updateStatus: "PROCESSING" },
    { ...ROW, id: "c", title: "Base com falha", updateVersion: 6, updateStatus: "FAILED" },
    { ...ROW, id: "d", title: "Base só rascunho", status: "DRAFT", inUseVersion: null, draftVersion: 1 },
    { ...ROW, id: "e", title: "Base arquivada", status: "ARCHIVED", inUseVersion: null },
  ]
  const card = (title: string) => screen.getByRole("link", { name: title }).closest("article") as HTMLElement

  async function renderList() {
    service.fetchKnowledgeDocumentsPage.mockResolvedValue({ items: rows, total: rows.length, page: 1, pageSize: 20 })
    renderWithQuery(<KnowledgePage />)
    await screen.findByRole("link", { name: "Base em uso com rascunho" })
  }

  it("mostra o status da versão em uso, com o número, e os selos à parte", async () => {
    await renderList()
    expect(within(card("Base em uso com rascunho")).getByText("V4 · Publicada")).toBeInTheDocument()
    expect(within(card("Base em uso com rascunho")).getByText("Rascunho V5")).toBeInTheDocument()
    expect(within(card("Base com atualização")).getByText("V4 · Publicada")).toBeInTheDocument()
    expect(within(card("Base com atualização")).getByText("Atualização V5 · Processando")).toBeInTheDocument()
    expect(within(card("Base com falha")).getByText("Atualização V6 · Falha")).toBeInTheDocument()
    expect(within(card("Base arquivada")).getByText("Arquivada")).toBeInTheDocument()
  })

  it("base sem versão pronta nunca parece disponível", async () => {
    await renderList()
    const onlyDraft = within(card("Base só rascunho"))
    expect(onlyDraft.getByText("Sem versão pronta")).toBeInTheDocument()
    expect(onlyDraft.getByText("Rascunho V1")).toBeInTheDocument()
    expect(onlyDraft.queryByText(/Publicada/)).not.toBeInTheDocument()
  })

  it("o filtro de status oferece Publicada, Rascunho, Processando, Falha e Arquivada", async () => {
    await renderList()
    fireEvent.keyDown(screen.getByRole("button", { name: "Filtrar por status" }), { key: "Enter" })
    const options = await screen.findAllByRole("menuitemcheckbox")
    expect(options.map((option) => option.textContent)).toEqual(["Publicada", "Rascunho", "Processando", "Falha", "Arquivada"])
  })

  it("o menu do item só oferece o que cabe em cada base", async () => {
    await renderList()
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações de Base só rascunho" }), { key: "Enter" })
    const menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "Publicar V1" })).toBeInTheDocument()
    expect(within(menu).queryByRole("menuitem", { name: "Arquivar" })).not.toBeInTheDocument()
    expect(within(menu).queryByRole("menuitem", { name: "Reativar" })).not.toBeInTheDocument()
  })
})

describe("histórico de versões", () => {
  it("tabela com situação, autor, resumo, consultas e origem; destaca a vigente", async () => {
    await renderDetail(detail())
    await openHistory()
    const current = screen.getByTestId("knowledge-version-4")
    expect(within(current).getByText("Em uso pela IA")).toBeInTheDocument()
    expect(within(current).getByText("37")).toBeInTheDocument()
    expect(within(current).getByText("origem: reversão da V2")).toBeInTheDocument()
    expect(current).toHaveClass("bg-primary/5")
    expect(within(screen.getByTestId("knowledge-version-2")).getByText("Publicada · substituída")).toBeInTheDocument()
    expect(within(screen.getByTestId("knowledge-version-2")).getByText("Ajuste de prazo")).toBeInTheDocument()
    expect(within(screen.getByTestId("knowledge-version-6")).getByText("Não entrou em uso")).toBeInTheDocument()
    expect(within(screen.getByTestId("knowledge-version-6")).getByText("uma versão mais nova ficou pronta antes")).toBeInTheDocument()
    expect(within(screen.getByTestId("knowledge-version-1")).getByText("a base foi arquivada durante o processamento")).toBeInTheDocument()
  })

  it("dado não registrado aparece como 'Não registrado', nunca inventado", async () => {
    await renderDetail(detail())
    await openHistory()
    const draftRow = screen.getByTestId("knowledge-version-5")
    expect(within(draftRow).getByText("Rascunho")).toBeInTheDocument()
    expect(within(draftRow).getAllByText("Não registrado")).toHaveLength(2)
  })

  it("linha restrita: só número, situação e aviso, sem ações nem seleção", async () => {
    await renderDetail(detail())
    await openHistory()
    const restricted = screen.getByTestId("knowledge-version-3")
    expect(within(restricted).getByText("V3")).toBeInTheDocument()
    expect(within(restricted).getByText("Publicada · substituída")).toBeInTheDocument()
    expect(within(restricted).getByText("Sem acesso a esta versão")).toBeInTheDocument()
    expect(within(restricted).queryByRole("button")).not.toBeInTheDocument()
    expect(within(restricted).queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("ver a versão mostra conteúdo e configuração dela", async () => {
    await renderDetail(detail())
    await openHistory()
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações da V2" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ver a versão" }))
    const dialog = await screen.findByRole("dialog", { name: /V2 · Publicada · substituída/ })
    expect(await within(dialog).findByText("Texto antigo da V2.")).toBeInTheDocument()
    fireEvent.mouseDown(within(dialog).getByRole("tab", { name: "Configuração" }), { button: 0 })
    expect(await within(dialog).findByText("Subgrupo Contas")).toBeInTheDocument()
    expect(await within(dialog).findByText("Assunto Faturas")).toBeInTheDocument()
    fireEvent.mouseDown(within(dialog).getByRole("tab", { name: "Arquivo" }), { button: 0 })
    expect(await within(dialog).findByText("Esta versão não tem arquivo.")).toBeInTheDocument()
  })

  it("baixar só aparece ativo quando a versão tem arquivo; a lista não diz, então o menu confere", async () => {
    await renderDetail(detail())
    await openHistory()
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações da V2" }), { key: "Enter" })
    const item = await screen.findByRole("menuitem", { name: "Esta versão não tem arquivo" })
    expect(item).toHaveAttribute("data-disabled")
    expect(service.fetchKnowledgeVersion).toHaveBeenCalledWith("kb-1", "v2")
  })

  it("baixa o arquivo pela rota da própria versão", async () => {
    const createObjectURL = vi.fn(() => "blob:x")
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    service.fetchKnowledgeVersion.mockResolvedValue({ ...VERSION_DETAIL, fileId: "f2", config: { ...CONFIG, sourceType: "PDF", file: { id: "f2", filename: "manual.pdf", mimeType: "application/pdf", sizeBytes: 1024, checksum: "abc" } } })
    service.fetchKnowledgeVersionFile.mockResolvedValue({ blob: new Blob(["x"]), filename: "manual.pdf" })
    await renderDetail(detail())
    await openHistory()
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações da V2" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Baixar arquivo" }))
    await waitFor(() => expect(service.fetchKnowledgeVersionFile).toHaveBeenCalledWith("kb-1", "v2"))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    expect(anchorClick).toHaveBeenCalled()
    anchorClick.mockRestore()
  })
})

describe("comparação", () => {
  async function compare(result: KnowledgeVersionComparison) {
    service.compareKnowledgeVersions.mockResolvedValue(result)
    await renderDetail(detail())
    await openHistory()
    expect(screen.getByRole("button", { name: "Comparar" })).toBeDisabled()
    // Marca a mais nova primeiro: a comparação vai da mais antiga para a mais nova mesmo assim.
    fireEvent.click(screen.getByRole("checkbox", { name: "Comparar a V4" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Comparar a V2" }))
    fireEvent.click(screen.getByRole("button", { name: "Comparar" }))
    const dialog = await screen.findByRole("dialog", { name: "Comparar V2 com V4" })
    await waitFor(() => expect(service.compareKnowledgeVersions).toHaveBeenCalledWith("kb-1", "v2", "v4"))
    await within(dialog).findByRole("heading", { name: "Texto" })
    return dialog
  }

  it("só duas versões por vez", async () => {
    await renderDetail(detail())
    await openHistory()
    fireEvent.click(screen.getByRole("checkbox", { name: "Comparar a V4" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Comparar a V2" }))
    expect(screen.getByRole("checkbox", { name: "Comparar a V5" })).toBeDisabled()
    expect(screen.getByRole("checkbox", { name: "Comparar a V4" })).toBeEnabled()
  })

  it("texto lado a lado, com contagem, rótulo em palavras e a vigente identificada", async () => {
    const dialog = await compare(COMPARISON)
    expect(within(dialog).getByText("Vigente · em uso pela IA")).toBeInTheDocument()
    expect(within(dialog).getByText("1 linha adicionada")).toBeInTheDocument()
    expect(within(dialog).getByText("1 linha removida")).toBeInTheDocument()
    expect(within(dialog).getByText("1 linha alterada")).toBeInTheDocument()
    const changed = within(dialog).getByText("Prazo de 5 dias").closest("tr") as HTMLElement
    expect(within(changed).getByText("Alterada")).toBeInTheDocument()
    expect(within(changed).getByText("Prazo de 3 dias")).toBeInTheDocument()
    expect(within(within(dialog).getByText("Regra que saiu").closest("tr") as HTMLElement).getByText("Removida")).toBeInTheDocument()
    expect(within(within(dialog).getByText("Regra que entrou").closest("tr") as HTMLElement).getByText("Adicionada")).toBeInTheDocument()
  })

  it("linhas iguais longas ficam recolhidas, com a opção de expandir", async () => {
    const dialog = await compare(COMPARISON)
    expect(within(dialog).getAllByText("Linha igual 2")).toHaveLength(2)
    expect(within(dialog).queryByText("Linha igual 6")).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Mostrar 6 linhas iguais" }))
    expect(within(dialog).getAllByText("Linha igual 6")).toHaveLength(2)
  })

  it("configuração: o que mudou, entrou e saiu; arquivo trocado", async () => {
    const dialog = await compare(COMPARISON)
    expect(within(dialog).getByText(/Segunda via de conta/)).toBeInTheDocument()
    expect(within(dialog).getByText("Entrou: Grupo Vendas")).toBeInTheDocument()
    expect(within(dialog).getByText("Saiu: Grupo Atendimento")).toBeInTheDocument()
    expect(within(dialog).getByText("Arquivo trocado: manual-2025.pdf → manual-2026.pdf")).toBeInTheDocument()
    expect(within(dialog).getByText("Tamanho: 2 KB → 4 KB")).toBeInTheDocument()
  })

  it("arquivo adicionado, removido e sem mudança são ditos em palavras", async () => {
    const dialog = await compare({ ...COMPARISON, file: { change: "ADDED", from: null, to: { filename: "novo.pdf", sizeBytes: null } } })
    expect(within(dialog).getByText("Arquivo adicionado: novo.pdf")).toBeInTheDocument()
    cleanup()
    const removed = await compare({ ...COMPARISON, file: { change: "REMOVED", from: { filename: "velho.pdf", sizeBytes: null }, to: null } })
    expect(within(removed).getByText("Arquivo removido: velho.pdf")).toBeInTheDocument()
    cleanup()
    const same = await compare({ ...COMPARISON, file: { change: "UNCHANGED", from: { filename: "igual.pdf", sizeBytes: 1 }, to: { filename: "igual.pdf", sizeBytes: 1 } } })
    expect(within(same).getByText("Sem mudança no arquivo: igual.pdf")).toBeInTheDocument()
  })

  it("NOT_RECORDED: diz que a configuração não foi registrada", async () => {
    const dialog = await compare({ ...COMPARISON, configuration: { comparable: false, reason: "NOT_RECORDED", versions: [2] } })
    expect(within(dialog).getByText("A configuração da versão 2 não foi registrada")).toBeInTheDocument()
  })

  it("TEXT_UNAVAILABLE: diz que só dá para informar a troca do arquivo, e a troca aparece", async () => {
    const dialog = await compare({ ...COMPARISON, content: { comparable: false, reason: "TEXT_UNAVAILABLE", versions: [4] } })
    expect(within(dialog).getByText("Não há texto extraído da versão 4: só dá para informar a troca do arquivo")).toBeInTheDocument()
    expect(within(dialog).getByText("Arquivo trocado: manual-2025.pdf → manual-2026.pdf")).toBeInTheDocument()
  })

  it("TOO_LARGE e texto idêntico têm mensagem própria", async () => {
    const dialog = await compare({ ...COMPARISON, content: { comparable: false, reason: "TOO_LARGE", versions: [2, 4] } })
    expect(within(dialog).getByText("As versões são grandes demais para comparar aqui")).toBeInTheDocument()
    cleanup()
    const identical = await compare({ ...COMPARISON, content: { comparable: true, identical: true, added: 0, removed: 0, changed: 0, unchanged: 2, rows: [] } })
    expect(within(identical).getByText("Sem diferença no texto")).toBeInTheDocument()
  })

  it("o painel do texto rola por dentro: a tabela larga não empurra a página", async () => {
    const dialog = await compare(COMPARISON)
    const table = within(dialog).getByText("Prazo de 5 dias").closest("table") as HTMLElement
    expect(table.parentElement).toHaveClass("overflow-auto")
  })
})

describe("reverter", () => {
  async function openRevert(document: KnowledgeDocumentDetail) {
    await renderDetail(document)
    await openHistory()
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações da V2" }), { key: "Enter" })
    fireEvent.click(await screen.findByRole("menuitem", { name: "Reverter para esta versão" }))
    return screen.findByRole("alertdialog")
  }

  it("só para o que já ficou pronto e não é a vigente", async () => {
    await renderDetail(detail())
    await openHistory()
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações da V4" }), { key: "Enter" })
    await screen.findByRole("menuitem", { name: "Ver a versão" })
    expect(screen.queryByRole("menuitem", { name: "Reverter para esta versão" })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações da V1" }), { key: "Enter" })
    await screen.findByRole("menuitem", { name: "Ver a versão" })
    expect(screen.queryByRole("menuitem", { name: "Reverter para esta versão" })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    fireEvent.keyDown(screen.getByRole("button", { name: "Ações da V6" }), { key: "Enter" })
    expect(await screen.findByRole("menuitem", { name: "Reverter para esta versão" })).toBeInTheDocument()
  })

  it("explica que publica uma versão nova sem apagar nada e envia o resumo", async () => {
    const dialog = await openRevert(detail())
    expect(within(dialog).getByText(/publicado como uma versão nova, sem apagar nenhuma versão/)).toBeInTheDocument()
    expect(within(dialog).getByText(/passa pelo processamento/)).toBeInTheDocument()
    expect(within(dialog).getByText(/a IA continua usando a V4/)).toBeInTheDocument()
    service.revertKnowledgeVersion.mockResolvedValue(detail({ updates: [{ id: "v7", version: 7, status: "PROCESSING", requestedAt: null, requestedByName: null, errorCode: null, errorMessage: null }] }))
    fireEvent.change(within(dialog).getByLabelText("Resumo da alteração (opcional)"), { target: { value: "Voltar o prazo" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar como versão nova" }))
    await waitFor(() => expect(service.revertKnowledgeVersion).toHaveBeenCalledWith("kb-1", "v2", { changeSummary: "Voltar o prazo" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("V7 em processamento: a IA passa a usá-la quando ficar pronta."))
  })

  it("com rascunho, só depois de confirmar o descarte", async () => {
    const dialog = await openRevert(withDraft())
    const confirm = within(dialog).getByRole("button", { name: "Publicar como versão nova" })
    expect(within(dialog).getByText(/Há um rascunho em edição \(V5\)/)).toBeInTheDocument()
    expect(confirm).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Descartar o rascunho" }))
    service.revertKnowledgeVersion.mockResolvedValue(detail())
    fireEvent.click(confirm)
    await waitFor(() => expect(service.revertKnowledgeVersion).toHaveBeenCalledWith("kb-1", "v2", { discardDraft: true }))
  })

  it("arquivada, só depois de confirmar que volta a valer", async () => {
    const dialog = await openRevert(detail({ status: "ARCHIVED", inUseVersion: null, inUse: null, archived: { id: "v4", version: 4 } }))
    const confirm = within(dialog).getByRole("button", { name: "Publicar como versão nova e reativar" })
    expect(confirm).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Confirmo que a base volta a valer para a IA" }))
    service.revertKnowledgeVersion.mockResolvedValue(detail())
    fireEvent.click(confirm)
    await waitFor(() => expect(service.revertKnowledgeVersion).toHaveBeenCalledWith("kb-1", "v2", { reactivate: true }))
  })

  it("409 de rascunho que surgiu no meio pede a confirmação; 409 de já vigente fica escrito", async () => {
    const dialog = await openRevert(detail())
    service.revertKnowledgeVersion.mockRejectedValueOnce(conflict("KNOWLEDGE_DRAFT_PENDING", "Há um rascunho em edição."))
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar como versão nova" }))
    const checkbox = await within(dialog).findByRole("checkbox", { name: "Descartar o rascunho" })
    expect(toast.error).not.toHaveBeenCalled()
    fireEvent.click(checkbox)
    service.revertKnowledgeVersion.mockRejectedValueOnce(conflict("KNOWLEDGE_VERSION_ALREADY_CURRENT", "Esta já é a versão em uso."))
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar como versão nova" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Esta já é a versão em uso.")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("versão sem configuração registrada avisa que volta só o conteúdo", async () => {
    service.fetchKnowledgeVersions.mockResolvedValue([versionRow({ number: 4, situation: "IN_USE" }), versionRow({ number: 2, hasConfig: false })])
    const dialog = await openRevert(detail())
    expect(within(dialog).getByText(/A configuração da V2 não foi registrada: volta só o conteúdo/)).toBeInTheDocument()
  })
})

describe("formulário de edição", () => {
  async function renderForm(document: KnowledgeDocumentDetail) {
    service.fetchKnowledgeDocument.mockResolvedValue(document)
    renderWithQuery(<EditKnowledgePage documentId={document.id} />)
    return screen.findByLabelText("Título")
  }

  it("abre o que está em edição, sem seletor de status, e deixa claro que a IA continua na versão em uso", async () => {
    const title = await renderForm(withDraft())
    expect(title).toHaveValue("Segunda via (rascunho)")
    expect(screen.getByLabelText("Conteúdo")).toHaveValue(DRAFT.content)
    expect(screen.queryByLabelText("Status")).not.toBeInTheDocument()
    expect(screen.getByText(/A IA continua usando a V4/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeInTheDocument()
    expect(screen.getByLabelText("Resumo da alteração (opcional)")).toHaveValue("Resumo já gravado")
  })

  it("salvar envia o rascunho, sem status; texto igual fica de fora para não criar versão sem mudança", async () => {
    const title = await renderForm(detail())
    service.updateKnowledgeDocument.mockResolvedValue(detail())
    fireEvent.change(title, { target: { value: "Segunda via nova" } })
    fireEvent.change(screen.getByLabelText("Resumo da alteração (opcional)"), { target: { value: "Novo título" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    await waitFor(() => expect(service.updateKnowledgeDocument).toHaveBeenCalledTimes(1))
    const [id, input] = service.updateKnowledgeDocument.mock.calls[0]!
    expect(id).toBe("kb-1")
    expect(input).toEqual({ title: "Segunda via nova", documentType: "PROCEDURE", changeSummary: "Novo título" })
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/knowledge/kb-1"))
    expect(toast.success).toHaveBeenCalledWith("Nada mudou em relação à versão atual: nenhum rascunho foi criado.")
  })

  it("texto alterado vai junto, e o aviso diz que a IA continua na versão em uso", async () => {
    await renderForm(detail())
    service.updateKnowledgeDocument.mockResolvedValue(withDraft())
    fireEvent.change(screen.getByLabelText("Conteúdo"), { target: { value: "Texto novo do procedimento." } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    await waitFor(() => expect(service.updateKnowledgeDocument.mock.calls[0]?.[1]).toMatchObject({ content: "Texto novo do procedimento." }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Rascunho V5 salvo. A IA continua usando a V4."))
  })

  it("trocar arquivo sem texto extraído avisa; dá para salvar sem texto ou digitar", async () => {
    await renderForm(withDraft())
    const fileConfig: KnowledgeVersionConfig = { ...CONFIG, sourceType: "PDF", file: { id: "f9", filename: "escaneado.pdf", mimeType: "application/pdf", sizeBytes: 2048, checksum: "abc" } }
    service.replaceKnowledgeDraftFile.mockResolvedValue(withDraft({ draft: { ...DRAFT, content: "", textAvailable: false, config: fileConfig }, editable: { versionId: "v5", version: 5, status: "DRAFT", content: "", config: fileConfig, textAvailable: false, restricted: false } }))
    const file = new File(["%PDF"], "escaneado.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText("Arquivo novo para o rascunho"), { target: { files: [file] } })
    await waitFor(() => expect(service.replaceKnowledgeDraftFile).toHaveBeenCalledWith("kb-1", file))
    expect(await screen.findByText(/Não foi possível extrair texto deste arquivo/)).toBeInTheDocument()
    expect(screen.getByText(/escaneado\.pdf/)).toBeInTheDocument()
    const content = screen.getByLabelText("Texto extraído do arquivo")
    expect(content).toHaveValue("")
    const save = screen.getByRole("button", { name: "Salvar rascunho" })
    expect(save).toBeEnabled()
    fireEvent.change(content, { target: { value: "curto" } })
    expect(save).toBeDisabled()
    fireEvent.change(content, { target: { value: "" } })
    service.updateKnowledgeDocument.mockResolvedValue(withDraft())
    fireEvent.click(save)
    await waitFor(() => expect(service.updateKnowledgeDocument).toHaveBeenCalledTimes(1))
    expect(service.updateKnowledgeDocument.mock.calls[0]?.[1]).not.toHaveProperty("content")
  })

  it("base sem versão em uso: avisa que salvar não a disponibiliza para a IA", async () => {
    await renderForm(noVersionReady())
    expect(screen.getByText(/esta base ainda não tem versão em uso/)).toBeInTheDocument()
  })

  it("base arquivada: avisa que salvar não reativa", async () => {
    await renderForm(detail({ status: "ARCHIVED", inUseVersion: null, inUse: null, archived: { id: "v4", version: 4 } }))
    expect(screen.getByText(/salvar não reativa a base/)).toBeInTheDocument()
  })
})
