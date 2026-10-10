/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { ArgumentScript, ArgumentScriptContent, ArgumentScriptDetail, ArgumentScriptVersion } from "@/schemas/admin/argument-script.schema"

import { ArgumentScriptsPage } from "./argument-scripts-page"

const service = vi.hoisted(() => ({
  fetchArgumentScriptsPage: vi.fn(),
  fetchArgumentScript: vi.fn(),
  fetchArgumentScriptScopeOptions: vi.fn(),
  createArgumentScript: vi.fn(),
  updateArgumentScript: vi.fn(),
  discardArgumentScriptDraft: vi.fn(),
  publishArgumentScript: vi.fn(),
  archiveArgumentScript: vi.fn(),
  reactivateArgumentScript: vi.fn(),
  deleteArgumentScript: vi.fn(),
}))
const fixtures = vi.hoisted(() => ({
  teams: [
    { id: "t1", name: "Atendimento", operationId: "op-1", subteams: [{ id: "st1", teamId: "t1", name: "Contas" }] },
    { id: "t2", name: "Vendas", operationId: "op-1", subteams: [{ id: "st2", teamId: "t2", name: "Ativo" }] },
  ],
  domains: [{ id: "d1", code: "FATURAMENTO", name: "Faturamento", description: null, active: true, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z", agentCount: 0, orchestratorCount: 0 }],
}))

vi.mock("@/services/admin/argument-script-service", () => service)
vi.mock("@/services/admin/org-structure-service", () => ({
  fetchTeams: vi.fn(async () => fixtures.teams),
  fetchManageableTeams: vi.fn(),
  fetchSubjects: vi.fn(async () => []),
}))
vi.mock("@/services/admin/business-domain-service", () => ({
  fetchBusinessDomains: vi.fn(async () => fixtures.domains),
  fetchBusinessDomainsPage: vi.fn(),
  fetchBusinessDomainDependencies: vi.fn(),
  createBusinessDomain: vi.fn(),
  updateBusinessDomain: vi.fn(),
  setBusinessDomainActive: vi.fn(),
  deleteBusinessDomain: vi.fn(),
}))
vi.mock("@/services/admin/knowledge-service", () => ({
  fetchKnowledgeDocuments: vi.fn(async () => []),
  fetchKnowledgeDocumentsPage: vi.fn(),
  fetchKnowledgeDocument: vi.fn(),
  fetchKnowledgeFile: vi.fn(),
  fetchKnowledgeDocumentPreview: vi.fn(),
  createKnowledgeDocument: vi.fn(),
  updateKnowledgeDocument: vi.fn(),
  setKnowledgeDocumentStatus: vi.fn(),
  deleteKnowledgeDocument: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/argument-scripts",
  useSearchParams: () => new URLSearchParams(),
}))

const LEGACY_LABEL = "Convertido do cadastro antigo — revise os campos"
const READ_ONLY_LABEL = "Somente leitura — vale para o seu escopo, administrado acima"

const item = (overrides: Partial<ArgumentScript>): ArgumentScript => ({
  id: "s-native",
  name: "Retenção por preço",
  businessDomainId: "d1",
  businessDomainName: "Faturamento",
  scopeType: "ALL_TEAMS",
  teamId: null,
  teamName: null,
  subteamId: null,
  subteamName: null,
  subjectName: null,
  status: "ACTIVE",
  conversion: "NATIVE",
  currentVersion: 1,
  currentEffectiveFrom: "2025-01-10T15:00:00.000Z",
  currentEffectiveUntil: null,
  draftVersion: 2,
  updatedAt: "2025-01-10T15:00:00.000Z",
  createdAt: "2025-01-10T15:00:00.000Z",
  canEdit: true,
  ...overrides,
})

const CONTENT: ArgumentScriptContent = {
  schemaVersion: 1,
  trigger: "Cliente pede para cancelar porque encontrou um preço menor.",
  notApplicableWhen: null,
  operatorGuidance: [{ key: "guid0001", text: "Oferecer o plano com desconto", modality: "MUST" }],
  requiredPoints: [{ key: "grp00001", mode: "ALL", items: [{ key: "pt000001", text: "Informar a multa de cancelamento", condition: "quando houver fidelidade" }] }],
  avoid: [{ key: "avd00001", text: "Prometer isenção de multa" }],
  suggestedScript: null,
  monitoringReference: null,
}

const version = (status: ArgumentScriptVersion["status"], number: number, content: ArgumentScriptContent = CONTENT): ArgumentScriptVersion => ({
  id: `v-${number}`,
  version: number,
  status,
  content,
  contentHash: "hash",
  sourceDocumentId: null,
  sourceDocumentTitle: null,
  sourceReference: null,
  effectiveFrom: status === "DRAFT" ? null : "2025-01-10T15:00:00.000Z",
  effectiveUntil: null,
  publishedAt: status === "DRAFT" ? null : "2025-01-10T15:00:00.000Z",
  publishedByName: status === "DRAFT" ? null : "Admin",
  createdAt: "2025-01-10T15:00:00.000Z",
  updatedAt: "2025-01-10T15:00:00.000Z",
})

const detail = (overrides: Partial<ArgumentScriptDetail> = {}): ArgumentScriptDetail => {
  const current = version("PUBLISHED", 1)
  return { ...item({}), current, draft: version("DRAFT", 2), history: [current], draftIssues: [], everPublished: true, ...overrides }
}

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Argumentários", () => {
  it("a lista mostra área, escopo, vigência e os selos de cadastro antigo, rascunho e somente leitura", async () => {
    service.fetchArgumentScriptsPage.mockResolvedValue({
      items: [
        item({ id: "s-legacy", name: "Protocolo no encerramento", conversion: "LEGACY_UNSTRUCTURED", businessDomainId: null, businessDomainName: null, draftVersion: null }),
        item({ id: "s-readonly", name: "Segunda via no portal", scopeType: "SUBTEAM", teamId: "t1", teamName: "Atendimento", subteamId: "st1", subteamName: "Contas", canEdit: false, draftVersion: null }),
        item({}),
      ],
      total: 3,
      page: 1,
      pageSize: 10,
    })
    renderWithQuery(<ArgumentScriptsPage />)

    const legacyRow = await screen.findByTestId("argument-script-row-s-legacy")
    expect(within(legacyRow).getByText(LEGACY_LABEL)).toBeInTheDocument()
    expect(within(legacyRow).queryByText(READ_ONLY_LABEL)).toBeNull()
    expect(legacyRow).toHaveTextContent("Todos os grupos")

    const readOnlyRow = screen.getByTestId("argument-script-row-s-readonly")
    expect(within(readOnlyRow).getByText(READ_ONLY_LABEL)).toBeInTheDocument()
    expect(within(readOnlyRow).queryByText(LEGACY_LABEL)).toBeNull()
    expect(readOnlyRow).toHaveTextContent("Atendimento › Contas")
    expect(within(readOnlyRow).getByRole("button", { name: "Ver Segunda via no portal" })).toBeInTheDocument()

    const nativeRow = screen.getByTestId("argument-script-row-s-native")
    expect(nativeRow).toHaveTextContent("Faturamento")
    expect(nativeRow).toHaveTextContent("v1 · Vigente desde 10/01/2025")
    expect(within(nativeRow).getByText("Rascunho v2")).toBeInTheDocument()
    expect(within(nativeRow).getByText("Ativo")).toBeInTheDocument()
    expect(service.fetchArgumentScriptsPage).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: undefined }))
  })

  it("quem não administra a organização inteira nunca vê 'Todos os grupos' e só escolhe os próprios grupos", async () => {
    service.fetchArgumentScriptsPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 })
    service.fetchArgumentScriptScopeOptions.mockResolvedValue({ allTeams: false, teamIds: ["t1"], subteamIds: [] })
    renderWithQuery(<ArgumentScriptsPage />)
    fireEvent.click(screen.getAllByRole("button", { name: /Novo argumentário/ })[0]!)

    const scope = await screen.findByTestId("argument-script-scope")
    const [scopeType] = within(scope).getAllByRole("combobox")
    expect(scopeType).toHaveTextContent("Um grupo específico")
    fireEvent.click(scopeType!)
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Um grupo específico", "Um subgrupo específico"])
    fireEvent.click(screen.getByRole("option", { name: "Um grupo específico" }))

    fireEvent.click(within(scope).getAllByRole("combobox")[1]!)
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Atendimento"])
  })

  it("com pendências de publicação, mostra as mensagens e o botão Publicar fica desabilitado", async () => {
    service.fetchArgumentScriptsPage.mockResolvedValue({ items: [item({})], total: 1, page: 1, pageSize: 10 })
    service.fetchArgumentScriptScopeOptions.mockResolvedValue({ allTeams: true, teamIds: [], subteamIds: [] })
    service.fetchArgumentScript.mockResolvedValue(
      detail({
        draft: version("DRAFT", 2, { ...CONTENT, trigger: null }),
        draftIssues: [{ field: "trigger", code: "ARGUMENT_SCRIPT_TRIGGER_REQUIRED", message: "Informe a condição ou gatilho: sem ela não há como saber quando o argumentário vale." }],
      }),
    )
    renderWithQuery(<ArgumentScriptsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Retenção por preço" }))

    const issues = await screen.findByTestId("argument-script-issues")
    expect(issues).toHaveTextContent("Informe a condição ou gatilho: sem ela não há como saber quando o argumentário vale.")
    expect(screen.getByRole("button", { name: "Publicar…" })).toBeDisabled()
    // Nada de código interno (chaves de item, hash) na tela.
    expect(screen.queryByText(/guid0001|grp00001|pt000001|hash/)).toBeNull()
  })

  it("salvar o rascunho envia 'Pode' como MAY, o grupo de alternativas como ANY e preserva as chaves dos itens existentes", async () => {
    service.fetchArgumentScriptsPage.mockResolvedValue({ items: [item({})], total: 1, page: 1, pageSize: 10 })
    service.fetchArgumentScriptScopeOptions.mockResolvedValue({ allTeams: true, teamIds: [], subteamIds: [] })
    service.fetchArgumentScript.mockResolvedValue(detail())
    service.updateArgumentScript.mockResolvedValue(detail())
    renderWithQuery(<ArgumentScriptsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Retenção por preço" }))

    fireEvent.click(await screen.findByRole("combobox", { name: "Tipo da orientação 1" }))
    fireEvent.click(await screen.findByRole("option", { name: "Pode" }))

    fireEvent.click(screen.getByRole("button", { name: /Adicionar grupo/ }))
    fireEvent.click(screen.getByRole("combobox", { name: "Como cumprir o grupo 2" }))
    fireEvent.click(await screen.findByRole("option", { name: "Alternativas — basta uma" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Item 1 do grupo 2" }), { target: { value: "Oferecer desconto na mensalidade" } })
    fireEvent.change(screen.getByRole("textbox", { name: "Item 2 do grupo 2" }), { target: { value: "Oferecer upgrade sem custo" } })

    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    await waitFor(() => expect(service.updateArgumentScript).toHaveBeenCalledTimes(1))
    const [id, input] = service.updateArgumentScript.mock.calls[0]!
    expect(id).toBe("s-native")
    // Já publicado: o escopo não é reenviado (não muda depois da primeira publicação).
    expect(input).not.toHaveProperty("scope")
    expect(input.content.operatorGuidance).toEqual([{ key: "guid0001", text: "Oferecer o plano com desconto", modality: "MAY" }])
    expect(input.content.requiredPoints).toEqual([
      { key: "grp00001", mode: "ALL", items: [{ key: "pt000001", text: "Informar a multa de cancelamento", condition: "quando houver fidelidade" }] },
      { mode: "ANY", items: [{ text: "Oferecer desconto na mensalidade", condition: null }, { text: "Oferecer upgrade sem custo", condition: null }] },
    ])
    expect(input.content.avoid).toEqual([{ key: "avd00001", text: "Prometer isenção de multa" }])
    expect(input.content.trigger).toBe(CONTENT.trigger)
  })
})
