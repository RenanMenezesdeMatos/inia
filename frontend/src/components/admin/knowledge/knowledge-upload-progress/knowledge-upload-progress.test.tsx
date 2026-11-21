/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { UploadTransfer } from "@/lib/admin/admin-api"
import type { KnowledgeUploadRun, KnowledgeUploadStage } from "@/schemas/admin/knowledge-upload.schema"

import { CreateKnowledgePage } from "../knowledge-form-page"
import { KnowledgeRecentUploads } from "./knowledge-recent-uploads"
import { KnowledgeUploadProgress } from "./knowledge-upload-progress"
import { newUploadId } from "./use-tracked-upload"

/**
 * Envio de arquivo de base (migration 243): a barra mostra os bytes que o navegador enviou e as etapas mostram só o que o servidor informa. Nada
 * aparece concluído antes de o servidor dizer que terminou, e a falha aparece na etapa, com o motivo.
 */
const knowledgeService = vi.hoisted(() => ({
  fetchKnowledgeDocument: vi.fn(),
  fetchKnowledgeDocuments: vi.fn(async () => []),
  createKnowledgeDocument: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
  fetchKnowledgeSubjects: vi.fn(async () => ({ items: [], canCreate: true })),
  createKnowledgeSubject: vi.fn(),
  fetchKnowledgeUploadRun: vi.fn(),
  fetchRecentKnowledgeUploads: vi.fn(async (): Promise<KnowledgeUploadRun[]> => []),
}))
vi.mock("@/services/admin/knowledge-service", () => knowledgeService)
vi.mock("@/services/admin/org-structure-service", () => ({
  fetchTeams: vi.fn(async () => [{ id: "t1", name: "Atendimento", operationId: "op-1", operatingUniverse: "B2C", subteams: [] }]),
  fetchManageableTeams: vi.fn(async () => ({ teams: [], unrestricted: true })),
  fetchSubjects: vi.fn(async () => []),
}))
vi.mock("@/components/admin/product-catalog/product-scope-field", () => ({
  ProductScopeField: () => null,
  productsCompatibleWith: () => [],
  useProductScopeLabels: () => ({ available: false, labelsOf: () => [], pendingOf: () => null }),
  useSourceProductScope: () => ({ available: false, nodes: [], value: [], setValue: vi.fn(), changed: false, saving: false, save: vi.fn(async () => undefined) }),
}))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/admin/knowledge/new", useSearchParams: () => new URLSearchParams() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

const KEYS = ["CHECK", "TEXT", "IMAGES", "MARKDOWN", "SAVE", "OCR"] as const
const stage = (key: KnowledgeUploadStage["key"], state: KnowledgeUploadStage["state"], patch: Partial<KnowledgeUploadStage> = {}): KnowledgeUploadStage => ({ key, state, detail: null, warning: null, errorCode: null, errorMessage: null, startedAt: null, finishedAt: null, progress: null, ...patch })
const run = (states: Partial<Record<KnowledgeUploadStage["key"], KnowledgeUploadStage>>, patch: Partial<KnowledgeUploadRun> = {}): KnowledgeUploadRun => ({
  id: "u1",
  kind: "CREATE",
  documentId: null,
  title: "Manual de chamados",
  filename: "manual.pdf",
  sourceType: "PDF",
  sizeBytes: 4 * 1024 * 1024,
  status: "PROCESSING",
  finished: false,
  errorCode: null,
  errorMessage: null,
  createdAt: "2026-11-19T12:00:00.000Z",
  updatedAt: "2026-11-19T12:00:05.000Z",
  finishedAt: null,
  stages: KEYS.map((key) => states[key] ?? stage(key, "PENDING")),
  ...patch,
})
const stateOf = (key: string) => screen.getByTestId(`knowledge-upload-stage-${key}`).getAttribute("data-state")

describe("barra de envio e etapas do processamento", () => {
  it("enviando: a barra mostra os bytes e a porcentagem que o navegador informou; nenhuma etapa aparece", () => {
    render(<KnowledgeUploadProgress filename="manual.pdf" sizeBytes={4 * 1024 * 1024} transfer={{ loaded: 1024 * 1024, total: 4 * 1024 * 1024 }} waiting run={null} requestError={null} />)
    expect(screen.getByRole("progressbar", { name: "Envio do arquivo" })).toHaveAttribute("aria-valuetext", "25%")
    expect(screen.getByTestId("knowledge-upload-transfer")).toHaveTextContent("1.0 MB de 4.0 MB (25%)")
    expect(screen.getByText("Enviando o arquivo")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Etapas do processamento" })).not.toBeInTheDocument()
    expect(screen.getByText(/Começa quando o arquivo terminar de chegar/)).toBeInTheDocument()
  })

  it("enviado e ainda sem resposta do servidor: diz que espera a primeira etapa, sem inventar nenhuma", () => {
    render(<KnowledgeUploadProgress filename="manual.pdf" sizeBytes={100} transfer={{ loaded: 100, total: 100 }} waiting run={null} requestError={null} />)
    expect(screen.getByText("Aguardando o servidor")).toBeInTheDocument()
    expect(screen.getByText("Aguardando o servidor informar a primeira etapa.")).toBeInTheDocument()
    expect(screen.queryByText("Concluído")).not.toBeInTheDocument()
  })

  it("cada etapa com o estado do servidor: concluída, em andamento, aguardando e não se aplica", () => {
    const current = run({
      CHECK: stage("CHECK", "DONE", { detail: "PDF conferido: tipo e estrutura aceitos." }),
      TEXT: stage("TEXT", "DONE", { detail: "12 páginas lidas." }),
      IMAGES: stage("IMAGES", "RUNNING"),
    })
    render(<KnowledgeUploadProgress filename="manual.pdf" sizeBytes={100} transfer={null} waiting={false} run={current} requestError={null} />)
    expect([stateOf("CHECK"), stateOf("TEXT"), stateOf("IMAGES"), stateOf("MARKDOWN"), stateOf("SAVE")]).toEqual(["DONE", "DONE", "RUNNING", "PENDING", "PENDING"])
    const images = screen.getByTestId("knowledge-upload-stage-IMAGES")
    expect(within(images).getByText("Imagens (prints do passo a passo)")).toBeInTheDocument()
    expect(within(images).getByText("Em andamento")).toBeInTheDocument()
    expect(within(screen.getByTestId("knowledge-upload-stage-MARKDOWN")).getByText("Aguardando")).toBeInTheDocument()
    expect(screen.getByText("12 páginas lidas.")).toBeInTheDocument()
    expect(screen.getByText("Processando no servidor")).toBeInTheDocument()
    // Visto pelo registro, o envio dos bytes já terminou.
    expect(screen.getByTestId("knowledge-upload-transfer")).toHaveTextContent("Enviado")
    expect(screen.getByText(/Pode sair desta tela/)).toBeInTheDocument()
  })

  it("OCR na fila não é 'concluído': o rascunho foi gravado e a leitura segue, com o andamento das páginas", () => {
    const reading = run(
      {
        ...Object.fromEntries(["CHECK", "TEXT", "IMAGES", "MARKDOWN", "SAVE"].map((key) => [key, stage(key as KnowledgeUploadStage["key"], "DONE")])),
        OCR: stage("OCR", "RUNNING", { detail: "Desenhando e lendo as páginas: 3 de 12.", progress: { done: 3, total: 12 } }),
      },
      { status: "DONE" },
    )
    render(<KnowledgeUploadProgress filename="digitalizado.pdf" sizeBytes={100} transfer={null} waiting={false} run={reading} requestError={null} />)
    expect(screen.getByText("Rascunho gravado · leitura por OCR em andamento")).toBeInTheDocument()
    expect(screen.queryByText("Concluído")).not.toBeInTheDocument()
    expect(screen.getByRole("progressbar", { name: /Andamento: Páginas digitalizadas/ })).toHaveAttribute("aria-valuenow", "25")
    expect(screen.getByText("Desenhando e lendo as páginas: 3 de 12.")).toBeInTheDocument()
  })

  it("falha: a etapa mostra o motivo e o código, as seguintes não feitas, e o envio aparece como falho", () => {
    const failed = run(
      {
        CHECK: stage("CHECK", "DONE"),
        TEXT: stage("TEXT", "FAILED", { errorCode: "KNOWLEDGE_EXTRACTION_BUSY", errorMessage: "Há muitos arquivos sendo lidos agora. Tente de novo em instantes." }),
        IMAGES: stage("IMAGES", "SKIPPED", { detail: "Não executada: o processamento parou numa etapa anterior." }),
      },
      { status: "FAILED", finished: true, errorCode: "KNOWLEDGE_EXTRACTION_BUSY", errorMessage: "Há muitos arquivos sendo lidos agora. Tente de novo em instantes." },
    )
    render(<KnowledgeUploadProgress filename="manual.pdf" sizeBytes={100} transfer={null} waiting={false} run={failed} requestError={null} />)
    const text = screen.getByTestId("knowledge-upload-stage-TEXT")
    expect(within(text).getByText("Falhou")).toBeInTheDocument()
    expect(within(text).getByRole("alert")).toHaveTextContent("Há muitos arquivos sendo lidos agora. Tente de novo em instantes.(KNOWLEDGE_EXTRACTION_BUSY)")
    expect(within(screen.getByTestId("knowledge-upload-stage-IMAGES")).getByText("Não executada")).toBeInTheDocument()
    expect(screen.getByText(/^O arquivo não entrou na base\./)).toBeInTheDocument()
    expect(screen.getAllByText("Falhou").length).toBeGreaterThan(1)
  })

  it("concluído com etapa que falhou sem impedir o envio: aparece com ressalvas, nunca como concluído limpo", () => {
    const flagged = run(
      {
        ...Object.fromEntries(["CHECK", "TEXT", "MARKDOWN", "SAVE"].map((key) => [key, stage(key as KnowledgeUploadStage["key"], "DONE")])),
        IMAGES: stage("IMAGES", "FAILED", { errorMessage: "Não foi possível separar as imagens do PDF." }),
        OCR: stage("OCR", "SKIPPED"),
      },
      { status: "DONE", finished: true },
    )
    render(<KnowledgeUploadProgress filename="manual.pdf" sizeBytes={100} transfer={null} waiting={false} run={flagged} requestError={null} />)
    expect(screen.getByText("Concluído com ressalvas")).toBeInTheDocument()
  })

  it("erro da própria requisição (antes do registro) aparece no lugar das etapas", () => {
    render(<KnowledgeUploadProgress filename="manual.pdf" sizeBytes={100} transfer={{ loaded: 40, total: 100 }} waiting={false} run={null} requestError="A conexão com o servidor caiu durante o envio do arquivo." />)
    expect(screen.getByRole("alert")).toHaveTextContent("A conexão com o servidor caiu durante o envio do arquivo.")
    expect(screen.getByText("Falhou")).toBeInTheDocument()
  })
})

describe("no editor: enviar o arquivo da base nova", () => {
  it("mostra a barra com os bytes, depois as etapas do servidor até concluir, e só então abre a base", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let progress: ((transfer: UploadTransfer) => void) | undefined
    let finish: ((value: { id: string }) => void) | undefined
    knowledgeService.createKnowledgeDocument.mockImplementation((input: { onProgress?: (transfer: UploadTransfer) => void }) => {
      progress = input.onProgress
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const running = run({ CHECK: stage("CHECK", "DONE"), TEXT: stage("TEXT", "RUNNING") })
    const done = run(Object.fromEntries(KEYS.map((key) => [key, stage(key, key === "OCR" ? "SKIPPED" : "DONE")])), { status: "DONE", finished: true, documentId: "kb-9" })
    knowledgeService.fetchKnowledgeUploadRun.mockResolvedValueOnce(null).mockResolvedValue(running)

    renderWithQuery(<CreateKnowledgePage />)
    fireEvent.change(await screen.findByLabelText("Título da base"), { target: { value: "Manual de chamados" } })
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Enviar arquivo/ }))
    const file = new File([new Uint8Array(2048)], "manual.pdf", { type: "application/pdf" })
    fireEvent.change(screen.getByLabelText("Arquivo da base"), { target: { files: [file] } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))

    await waitFor(() => expect(knowledgeService.createKnowledgeDocument).toHaveBeenCalledTimes(1))
    const sent = knowledgeService.createKnowledgeDocument.mock.calls[0]![0] as { uploadId: string; file: File }
    expect(sent.uploadId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(sent.file).toBe(file)

    act(() => progress!({ loaded: 1024, total: 2048 }))
    expect(await screen.findByTestId("knowledge-upload-transfer")).toHaveTextContent("(50%)")
    act(() => progress!({ loaded: 2048, total: 2048 }))
    // O servidor ainda não abriu o registro (null), depois informa a extração em andamento.
    await act(() => vi.advanceTimersByTimeAsync(3_200))
    await waitFor(() => expect(stateOf("TEXT")).toBe("RUNNING"))
    expect(knowledgeService.fetchKnowledgeUploadRun).toHaveBeenCalledWith(sent.uploadId)
    expect(router.replace).not.toHaveBeenCalled()

    // Enquanto o servidor não termina, a etapa continua em andamento, sem relógio que a adiante.
    await act(() => vi.advanceTimersByTimeAsync(6_000))
    expect(stateOf("TEXT")).toBe("RUNNING")
    expect(stateOf("SAVE")).toBe("PENDING")
    knowledgeService.fetchKnowledgeUploadRun.mockResolvedValue(done)
    await act(async () => finish!({ id: "kb-9" }))
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/admin/knowledge/kb-9/edit"))
    await waitFor(() => expect(stateOf("SAVE")).toBe("DONE"))
  })

  it("arquivo recusado: a etapa que falhou fica na tela com o motivo e dá para escolher outro arquivo", async () => {
    knowledgeService.createKnowledgeDocument.mockRejectedValue(new Error("O conteúdo do arquivo não corresponde ao tipo informado (aceitos: PDF, DOCX, TXT e JSON)."))
    const failed = run(
      { CHECK: stage("CHECK", "FAILED", { errorCode: "KNOWLEDGE_FILE_TYPE_MISMATCH", errorMessage: "O conteúdo do arquivo não corresponde ao tipo informado (aceitos: PDF, DOCX, TXT e JSON)." }), ...Object.fromEntries(KEYS.slice(1).map((key) => [key, stage(key, "SKIPPED")])) },
      { status: "FAILED", finished: true, errorCode: "KNOWLEDGE_FILE_TYPE_MISMATCH", errorMessage: "O conteúdo do arquivo não corresponde ao tipo informado (aceitos: PDF, DOCX, TXT e JSON)." },
    )
    // A primeira leitura chega antes de o servidor abrir o registro; depois da resposta de erro, uma última leitura traz a etapa que falhou.
    let reads = 0
    knowledgeService.fetchKnowledgeUploadRun.mockImplementation(async (uploadId: string | null) => {
      if (!uploadId) return null
      reads += 1
      return reads === 1 ? null : failed
    })
    renderWithQuery(<CreateKnowledgePage />)
    fireEvent.change(await screen.findByLabelText("Título da base"), { target: { value: "Manual" } })
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Enviar arquivo/ }))
    fireEvent.change(screen.getByLabelText("Arquivo da base"), { target: { files: [new File(["x"], "falso.pdf", { type: "application/pdf" })] } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    await waitFor(() => expect(stateOf("CHECK")).toBe("FAILED"))
    expect(within(screen.getByTestId("knowledge-upload-stage-CHECK")).getByRole("alert")).toHaveTextContent(/não corresponde ao tipo informado/)
    expect(screen.getByLabelText("Arquivo da base")).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })
})

describe("voltar depois: envios recentes", () => {
  it("lista os envios do último dia com o estado gravado; o concluído sem ressalva fica numa linha", async () => {
    const reading = run(
      { ...Object.fromEntries(["CHECK", "TEXT", "IMAGES", "MARKDOWN", "SAVE"].map((key) => [key, stage(key as KnowledgeUploadStage["key"], "DONE")])), OCR: stage("OCR", "PENDING", { detail: "4 páginas digitalizadas na fila de leitura." }) },
      { id: "u1", status: "DONE", documentId: "kb-1" },
    )
    const clean = run(Object.fromEntries(KEYS.map((key) => [key, stage(key, key === "OCR" ? "SKIPPED" : "DONE")])), { id: "u2", filename: "procedimento.docx", sourceType: "DOCX", status: "DONE", finished: true, documentId: "kb-2", title: "Procedimento" })
    knowledgeService.fetchRecentKnowledgeUploads.mockResolvedValue([reading, clean])
    renderWithQuery(<KnowledgeRecentUploads />)
    expect(await screen.findByText("Envios recentes")).toBeInTheDocument()
    expect(screen.getByText("4 páginas digitalizadas na fila de leitura.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Abrir “Manual de chamados”/ })).toHaveAttribute("href", "/admin/knowledge/kb-1/edit")
    const summary = screen.getByTestId("knowledge-upload-summary")
    expect(within(summary).getByText("Concluído")).toBeInTheDocument()
    fireEvent.click(within(summary).getByRole("button", { name: /Ver etapas/ }))
    expect(await screen.findByRole("region", { name: "Envio de procedimento.docx" })).toBeInTheDocument()
  })

  it("o envio que estava em andamento continua aberto quando termina, para não sumir de quem acompanhava", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const reading = run(
      { ...Object.fromEntries(["CHECK", "TEXT", "IMAGES", "MARKDOWN", "SAVE"].map((key) => [key, stage(key as KnowledgeUploadStage["key"], "DONE")])), OCR: stage("OCR", "RUNNING", { detail: "Desenhando e lendo as páginas: 1 de 4.", progress: { done: 1, total: 4 } }) },
      { status: "DONE", documentId: "kb-1" },
    )
    const done = { ...reading, finished: true, stages: reading.stages.map((item) => (item.key === "OCR" ? stage("OCR", "DONE", { detail: "4 páginas lidas, 3 prints recortados." }) : item)) }
    knowledgeService.fetchRecentKnowledgeUploads.mockResolvedValueOnce([reading]).mockResolvedValue([done])
    renderWithQuery(<KnowledgeRecentUploads />)
    await waitFor(() => expect(stateOf("OCR")).toBe("RUNNING"))
    await act(() => vi.advanceTimersByTimeAsync(3_100))
    await waitFor(() => expect(stateOf("OCR")).toBe("DONE"))
    expect(screen.queryByTestId("knowledge-upload-summary")).not.toBeInTheDocument()
    expect(screen.getByText("Concluído")).toBeInTheDocument()
  })

  it("sem envio recente, nada aparece", async () => {
    knowledgeService.fetchRecentKnowledgeUploads.mockResolvedValue([])
    const { container } = renderWithQuery(<KnowledgeRecentUploads />)
    await waitFor(() => expect(knowledgeService.fetchRecentKnowledgeUploads).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe("id do envio", () => {
  it("é um uuid v4 também sem crypto.randomUUID (instalação por http na rede)", () => {
    const original = crypto.randomUUID
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true })
    try {
      expect(newUploadId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true })
    }
  })
})
