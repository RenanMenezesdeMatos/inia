/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { AlignmentDetail, AlignmentListItem, AlignmentVersion } from "@/schemas/operational-alignments/operational-alignment.schema"

import { OperationalAlignmentsPage } from "./operational-alignments-page"

const service = vi.hoisted(() => ({
  fetchAlignmentsPage: vi.fn(),
  fetchAlignment: vi.fn(),
  fetchAlignmentScopeOptions: vi.fn(async () => ({ universe: false, teams: [{ id: "t-ouv", name: "Ouvidoria", operatingUniverse: "B2C", manageable: true, subteams: [] }] })),
  fetchPublicationPreview: vi.fn(),
  fetchAffectedAssessments: vi.fn(async () => ({ alignmentId: "a1", truncated: false, items: [] })),
  fetchProcessOptions: vi.fn(),
  createAlignment: vi.fn(),
  saveAlignmentDraft: vi.fn(),
  discardAlignmentDraft: vi.fn(),
  publishAlignment: vi.fn(),
  endAlignment: vi.fn(),
  deleteAlignment: vi.fn(),
  alignmentPayloadOf: vi.fn(),
  fetchReasons: vi.fn(async () => [{ id: "r1", name: "Contingência", active: true, position: 1, uses: 0 }]),
  fetchRequestReasons: vi.fn(async () => [{ id: "s1", code: "fatura", name: "Fatura" }]),
  createReason: vi.fn(),
  updateReason: vi.fn(),
  createRequestReason: vi.fn(),
}))
vi.mock("@/services/operational-alignments/operational-alignment-service", () => service)
vi.mock("@/services/admin/org-structure-service", () => ({
  fetchTeams: vi.fn(async () => [{ id: "t-ouv", name: "Ouvidoria", operationId: "op", subteams: [] }, { id: "t-out", name: "Vendas", operationId: "op", subteams: [] }]),
  fetchManageableTeams: vi.fn(),
  fetchSubjects: vi.fn(async () => []),
}))
vi.mock("@/services/admin/product-catalog-service", () => ({ fetchProductNodes: vi.fn(async () => []) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const version = (overrides: Partial<AlignmentVersion> = {}): AlignmentVersion => ({
  id: "v1", version: 1, reference: "AO-AAAAAAAA v1", status: "DRAFT", title: "Fatura pelo App Meu Telnova ou site", guidance: "Oriente o App Meu Telnova ou o site.",
  processes: [{ id: "doc-1", title: "PR — Envio de fatura", documentType: "PROCEDURE" }], reason: { id: "r1", name: "Contingência" }, requestReasons: [{ id: "s1", name: "Fatura" }], affectedTopic: "Envio da fatura", justification: "Sistema de envio em substituição.", operatingUniverse: "B2C", scopeType: "GROUPS",
  links: [{ teamId: "t-ouv", teamName: "Ouvidoria", subteamId: null, subteamName: null }], product: null, startsOn: "2026-11-10", endsOn: "2026-11-30", timeZone: "America/Sao_Paulo", effectiveFrom: "2026-11-10T03:00:00.000Z", effectiveUntil: "2026-12-01T03:00:00.000Z",
  contentHash: "h", changeReason: null, createdBy: "Gerente Ouvidoria", createdAt: "2026-11-09T12:00:00.000Z", updatedBy: null, updatedAt: null, publishedBy: null, publishedAt: null, supersededAt: null, endedBy: null, endedAt: null, endReason: null, relations: [],
  ...overrides,
})
const listItem = (overrides: Partial<AlignmentListItem> = {}): AlignmentListItem => ({
  id: "a1", reference: "AO-AAAAAAAA v1", version: 1, title: "Fatura pelo App Meu Telnova ou site", reasonName: "Contingência", state: "IN_FORCE", hasDraft: false, operatingUniverse: "B2C", scopeType: "GROUPS",
  links: [{ teamId: "t-ouv", teamName: "Ouvidoria", subteamId: null, subteamName: null }], productName: null,
  startsOn: "2026-11-10", endsOn: "2026-11-30", affectedTopic: null, processCount: 5, processTitles: ["IT — Segunda via", "PR — Envio de fatura", "PR — Ouvidoria"], updatedAt: "2026-11-09T12:00:00.000Z",
  ...overrides,
})
const page = <T,>(items: T[]) => ({ items, total: items.length, page: 1, pageSize: 20 })
const draftDetail: AlignmentDetail = { id: "a1", state: "DRAFT", hasDraft: true, current: null, draft: version(), shown: version(), versions: [version()] }

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Alinhamentos operacionais — tela", () => {
  it("lista paginada no padrão da Administração: processos resumidos, público, vigência e situação", async () => {
    service.fetchAlignmentsPage.mockResolvedValue(page([listItem()]))
    renderWithQuery(<OperationalAlignmentsPage />)
    expect(await screen.findByRole("button", { name: "Fatura pelo App Meu Telnova ou site" })).toBeInTheDocument()
    expect(screen.getByText("IT — Segunda via, PR — Envio de fatura, PR — Ouvidoria e mais 2")).toBeInTheDocument()
    expect(screen.getByText("Ouvidoria")).toBeInTheDocument()
    expect(screen.getByText("10/11/2026 a 30/11/2026")).toBeInTheDocument()
    expect(service.fetchAlignmentsPage).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
  })

  it("lista: público em vários Grupos mostra cada um (inteiro ou só os Subgrupos marcados)", async () => {
    service.fetchAlignmentsPage.mockResolvedValue(page([listItem({ links: [
      { teamId: "t-ouv", teamName: "Ouvidoria", subteamId: null, subteamName: null },
      { teamId: "t-out", teamName: "Vendas", subteamId: "s-v1", subteamName: "Vendas Tarde" },
      { teamId: "t-out", teamName: "Vendas", subteamId: "s-v2", subteamName: "Vendas Noite" },
    ] }), listItem({ id: "a2", title: "Universo inteiro", scopeType: "UNIVERSE", links: [] })]))
    renderWithQuery(<OperationalAlignmentsPage />)
    expect(await screen.findByText("Ouvidoria · Vendas › Vendas Tarde, Vendas Noite")).toBeInTheDocument()
    expect(screen.getByText("Todo o universo")).toBeInTheDocument()
  })

  it("cadastro NA PÁGINA (sem painel nem diálogo): exige justificativa e ao menos um processo", async () => {
    service.fetchAlignmentsPage.mockResolvedValue(page([]))
    service.fetchProcessOptions.mockResolvedValue(page([]))
    renderWithQuery(<OperationalAlignmentsPage />)
    fireEvent.click((await screen.findAllByRole("button", { name: /Novo alinhamento/ }))[0]!)
    fireEvent.change(await screen.findByLabelText("Título"), { target: { value: "Fatura pelo app" } })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    expect(await screen.findByText(/A justificativa é obrigatória/)).toBeInTheDocument()
    expect(screen.getByText("Inclua ao menos um processo.")).toBeInTheDocument()
    expect(service.createAlignment).not.toHaveBeenCalled()
  })

  it("seletor de processos: busca no servidor, inclui, remove e inclui a página inteira", async () => {
    service.fetchAlignmentsPage.mockResolvedValue(page([]))
    service.fetchProcessOptions.mockImplementation(async (params: { search?: string }) => page(params.search
      ? [{ id: "doc-2", title: "IT — Segunda via", documentType: "WORK_INSTRUCTION", operatingUniverse: "B2C", publishedAt: null }]
      : [{ id: "doc-1", title: "PR — Envio de fatura", documentType: "PROCEDURE", operatingUniverse: "B2C", publishedAt: null }, { id: "doc-3", title: "PR — Ouvidoria", documentType: "PROCEDURE", operatingUniverse: null, publishedAt: null }]))
    renderWithQuery(<OperationalAlignmentsPage />)
    fireEvent.click((await screen.findAllByRole("button", { name: /Novo alinhamento/ }))[0]!)
    fireEvent.click(await screen.findByRole("button", { name: "Incluir PR — Envio de fatura" }))
    const included = screen.getByRole("list", { name: "Processos incluídos" })
    expect(within(included).getByText("PR — Envio de fatura")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Incluir os 1 desta página" }))
    expect(within(included).getByText("PR — Ouvidoria")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Buscar processo"), { target: { value: "segunda" } })
    await waitFor(() => expect(service.fetchProcessOptions).toHaveBeenCalledWith(expect.objectContaining({ search: "segunda", page: 1 })))
    fireEvent.click(await screen.findByRole("button", { name: "Incluir IT — Segunda via" }))
    expect(screen.getByText("Processos incluídos (3)")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remover PR — Ouvidoria" }))
    expect(screen.getByText("Processos incluídos (2)")).toBeInTheDocument()
  })

  it("publicar com sobreposição: só habilita depois de decidir a relação e mostra o conflito vindo do backend", async () => {
    service.fetchAlignmentsPage.mockResolvedValue(page([listItem({ state: "DRAFT", hasDraft: true })]))
    service.fetchAlignment.mockResolvedValue(draftDetail)
    service.fetchPublicationPreview.mockResolvedValue({ draft: version(), overlaps: [{ alignmentId: "a2", version: version({ id: "v2", reference: "AO-BBBBBBBB v1", title: "Fatura por SMS", status: "PUBLISHED" }), sharedProcesses: [{ id: "doc-1", title: "PR — Envio de fatura" }], sameScopeLevel: true, moreSpecific: null }] })
    const { AdminApiError } = await import("@/lib/admin/admin-api")
    service.publishAlignment.mockRejectedValue(new AdminApiError("Há alinhamento do MESMO ponto com o MESMO público no mesmo período.", "OPERATIONAL_ALIGNMENT_CONFLICT"))
    renderWithQuery(<OperationalAlignmentsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Fatura pelo App Meu Telnova ou site" }))
    fireEvent.click(await screen.findByRole("button", { name: "Publicar" }))
    expect(await screen.findByText(/Fatura por SMS/)).toBeInTheDocument()
    expect(screen.getByText("Em comum: PR — Envio de fatura")).toBeInTheDocument()
    const publish = screen.getAllByRole("button", { name: "Publicar" }).at(-1)!
    expect(publish).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/Mesmo ponto/))
    await waitFor(() => expect(publish).toBeEnabled())
    fireEvent.click(publish)
    expect(await screen.findByRole("alert")).toHaveTextContent("MESMO ponto")
    expect(service.publishAlignment).toHaveBeenCalledWith("a1", [{ alignmentId: "a2", relation: "SAME_TOPIC" }])
  })

  it("excluir pede o motivo e só então exclui (exclusão lógica)", async () => {
    service.fetchAlignmentsPage.mockResolvedValue(page([listItem()]))
    service.fetchAlignment.mockResolvedValue({ ...draftDetail, state: "IN_FORCE", hasDraft: false, draft: null, current: version({ status: "PUBLISHED" }), shown: version({ status: "PUBLISHED" }) })
    service.deleteAlignment.mockResolvedValue(undefined)
    renderWithQuery(<OperationalAlignmentsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Fatura pelo App Meu Telnova ou site" }))
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }))
    const confirm = screen.getAllByRole("button", { name: "Excluir" }).at(-1)!
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Cadastrado no Grupo errado" } })
    fireEvent.click(confirm)
    await waitFor(() => expect(service.deleteAlignment).toHaveBeenCalledWith("a1", "Cadastrado no Grupo errado"))
  })
})
