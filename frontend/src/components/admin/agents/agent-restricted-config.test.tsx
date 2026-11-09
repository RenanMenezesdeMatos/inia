/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { Agent, AgentConfig, AgentHistoryEntry, AgentRun, AgentVersion } from "@/schemas/admin/agent.schema"

import { EditAgentPage } from "./agent-detail-page"
import { AgentLifecycleBar } from "./agent-lifecycle/lifecycle-bar"
import { AgentVersionsPanel } from "./agent-lifecycle/versions-panel"

/**
 * Rascunho, versão, execução ou alteração de um alcance fora do escopo de quem lê chegam sem a configuração (`restricted`). A tela
 * diz isso com um aviso discreto — nunca campos vazios — e o que o servidor recusaria (salvar, publicar, descartar, testar, reverter
 * e a prévia da reversão) fica indisponível, com o motivo. Cenário: quem administra só o Grupo B; a versão 1 e o rascunho valem para
 * todos os Grupos.
 */
const service = vi.hoisted(() => ({
  fetchAgent: vi.fn(),
  fetchAgentHistory: vi.fn(),
  fetchAgentRuns: vi.fn(),
  fetchAgentRun: vi.fn(),
  fetchAgentVersions: vi.fn(),
  fetchAgentVersion: vi.fn(),
  fetchAgentPublishImpact: vi.fn(),
  publishAgent: vi.fn(),
  discardAgentDraft: vi.fn(),
  revertAgent: vi.fn(),
  testAgent: vi.fn(),
  updateAgent: vi.fn(),
  updateAgentActive: vi.fn(),
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  fetchAgentDeletionCheck: vi.fn(),
  fetchAgentReferences: vi.fn(),
  fetchAgents: vi.fn(),
  fetchAgentsPage: vi.fn(),
}))
vi.mock("@/services/admin/agent-service", () => service)
// Resultados estáveis entre renderizações, como os do React Query (o formulário compara a referência dos Grupos).
const lookups = vi.hoisted(() => ({
  teams: { data: { unrestricted: false, teams: [{ id: "team-b", name: "Grupo B", operationId: "op-1", subteams: [] }] } },
  knowledge: { data: [] },
  domains: { data: [], isPending: false },
}))
vi.mock("@/queries/admin/use-org-structure-queries", () => ({ useManageableTeamsQuery: () => lookups.teams }))
vi.mock("@/queries/admin/use-knowledge-queries", () => ({ useKnowledgeDocumentsQuery: () => lookups.knowledge }))
vi.mock("@/queries/admin/use-business-domain-queries", () => ({ useBusinessDomainsQuery: () => lookups.domains }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const NOTICE = /Configuração de um alcance fora do seu escopo/

const LIVE: AgentConfig = {
  name: "Agente de Retenção",
  agentType: "CALL_FEEDBACK",
  objective: "Orientar a retenção",
  description: "Feedback das chamadas de retenção",
  contextPrompt: "Você orienta a retenção do Grupo B.",
  scopeType: "TEAM",
  teamId: "team-b",
  subteamId: null,
  specialty: null,
  specialtyKind: null,
  domain: null,
  capability: null,
  consolidatedInput: false,
  businessDomainId: null,
  recommendSupportMaterials: false,
  investigationCapabilities: [],
  actionLimitsEnabled: false,
  actionLimits: null,
  knowledgeDocumentIds: [],
}

const AGENT: Agent = {
  id: "agent-1",
  name: LIVE.name,
  agentType: LIVE.agentType,
  objective: LIVE.objective,
  description: LIVE.description,
  contextPrompt: LIVE.contextPrompt,
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdByName: "Admin",
  usageCount: 3,
  scopeType: "TEAM",
  teamId: "team-b",
  teamName: "Grupo B",
  subteamId: null,
  subteamName: null,
  knowledgeDocuments: [],
  actionLimitsEnabled: false,
  actionLimits: null,
  specialty: null,
  specialtyKind: null,
  domain: null,
  businessDomainId: null,
  businessDomain: null,
  capability: null,
  consolidatedInput: false,
  recommendSupportMaterials: false,
  investigationCapabilities: [],
  currentVersionId: "v2",
  currentVersionNumber: 2,
  currentVersionPublishedAt: "2026-11-01T10:00:00.000Z",
  published: true,
  hasDraft: true,
  draftRevision: 4,
  draftUpdatedAt: "2026-11-03T09:00:00.000Z",
  draftUpdatedByName: "Administração geral",
  draft: { config: null, revision: 4, updatedAt: "2026-11-03T09:00:00.000Z", updatedByName: "Administração geral", restricted: true },
}
const OWN_DRAFT: Agent = { ...AGENT, draft: { config: { ...LIVE, contextPrompt: "Rascunho do Grupo B." }, revision: 4, updatedAt: null, updatedByName: null, restricted: false } }

const version = (id: string, number: number, current: boolean, restricted: boolean): AgentVersion => ({
  id, number, origin: "PUBLISH", revertedFromNumber: null, publishedAt: "2026-11-01T10:00:00.000Z", publishedByName: "Administração geral", current, restricted,
})
const VERSIONS = [version("v2", 2, true, false), version("v1", 1, false, true)]

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Configuração de outro alcance — barra de publicação", () => {
  it("rascunho de outro alcance: aviso no lugar da configuração; publicar e descartar indisponíveis, sem buscar a prévia", () => {
    renderWithQuery(<AgentLifecycleBar agent={AGENT} dirty={false} onConflict={vi.fn()} />)
    expect(screen.getByTestId("restricted-config")).toHaveTextContent(NOTICE)
    expect(screen.getByRole("button", { name: "Publicar" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Descartar rascunho/ })).toBeDisabled()
    expect(service.fetchAgentPublishImpact).not.toHaveBeenCalled()
  })

  it("rascunho do próprio alcance: sem aviso, publicar e descartar disponíveis", () => {
    renderWithQuery(<AgentLifecycleBar agent={OWN_DRAFT} dirty={false} onConflict={vi.fn()} />)
    expect(screen.queryByTestId("restricted-config")).toBeNull()
    expect(screen.getByRole("button", { name: "Publicar" })).toBeEnabled()
    expect(screen.getByRole("button", { name: /Descartar rascunho/ })).toBeEnabled()
  })
})

describe("Configuração de outro alcance — versões", () => {
  it("a versão de outro alcance mostra o aviso em vez de 'Ver configuração', e reverter fica indisponível sem pedir a prévia", async () => {
    service.fetchAgentVersions.mockResolvedValue(VERSIONS)
    renderWithQuery(<AgentVersionsPanel agent={{ ...OWN_DRAFT, hasDraft: false, draft: null }} />)

    const rows = await screen.findAllByText(/^Versão \d$/)
    const restrictedRow = rows.find((row) => row.textContent === "Versão 1")!.closest("div.rounded-lg") as HTMLElement
    expect(within(restrictedRow).getByTestId("restricted-config")).toHaveTextContent(NOTICE)
    expect(within(restrictedRow).queryByRole("button", { name: "Ver configuração" })).toBeNull()
    expect(within(restrictedRow).getByRole("button", { name: /Reverter para esta versão/ })).toBeDisabled()
    expect(screen.getAllByRole("button", { name: "Ver configuração" })).toHaveLength(1)
    expect(service.fetchAgentPublishImpact).not.toHaveBeenCalled()
  })

  it("com rascunho de outro alcance em andamento, reverter qualquer versão fica indisponível (reverter o descartaria)", async () => {
    service.fetchAgentVersions.mockResolvedValue([version("v2", 2, true, false), version("v1b", 1, false, false)])
    renderWithQuery(<AgentVersionsPanel agent={AGENT} />)
    expect(await screen.findByRole("button", { name: /Reverter para esta versão/ })).toBeDisabled()
  })

  it("a versão que chega sem configuração ao abrir mostra o aviso, nunca campos vazios", async () => {
    service.fetchAgentVersions.mockResolvedValue([version("v2", 2, true, false)])
    service.fetchAgentVersion.mockResolvedValue({ ...version("v2", 2, true, true), config: null })
    renderWithQuery(<AgentVersionsPanel agent={{ ...OWN_DRAFT, hasDraft: false, draft: null }} />)
    fireEvent.click(await screen.findByRole("button", { name: "Ver configuração" }))
    expect(await screen.findByTestId("restricted-config")).toHaveTextContent(NOTICE)
    expect(screen.queryByText("Contexto")).toBeNull()
  })
})

describe("Configuração de outro alcance — tela do agente", () => {
  const RUNS: AgentRun[] = [
    { id: "run-1", source: "WORKFLOW", inputContext: null, outputText: null, status: "COMPLETED", errorMessage: null, model: null, caseId: null, createdAt: "2026-11-02T10:00:00.000Z", completedAt: "2026-11-02T10:00:05.000Z", agentVersionId: "v1", agentVersionNumber: 1, runTarget: "VERSION", hasTestedConfig: false, restricted: true },
    { id: "run-2", source: "MANUAL_TEST", inputContext: "Cenário do Grupo B", outputText: "Resposta do Grupo B", status: "COMPLETED", errorMessage: null, model: "modelo", caseId: null, createdAt: "2026-11-02T11:00:00.000Z", completedAt: "2026-11-02T11:00:05.000Z", agentVersionId: "v2", agentVersionNumber: 2, runTarget: "VERSION", hasTestedConfig: false, restricted: false },
  ]
  const HISTORY: AgentHistoryEntry[] = [
    { id: "h-1", action: "UPDATED", changedByName: "Administração geral", changes: [{ field: "contextPrompt", label: "Contexto", from: "", to: "" }], createdAt: "2026-11-03T09:00:00.000Z", restricted: true },
    { id: "h-2", action: "UPDATED", changedByName: "Administração do Grupo B", changes: [{ field: "objective", label: "Objetivo", from: "antes", to: "depois" }], createdAt: "2026-11-02T09:00:00.000Z", restricted: false },
  ]

  function renderPage(agent: Agent = AGENT) {
    service.fetchAgent.mockResolvedValue(agent)
    service.fetchAgentVersions.mockResolvedValue(VERSIONS)
    service.fetchAgentRuns.mockResolvedValue(RUNS)
    service.fetchAgentHistory.mockResolvedValue(HISTORY)
    renderWithQuery(<EditAgentPage agentId={agent.id} />)
  }
  const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 })

  it("rascunho de outro alcance: aviso, a versão vigente só para leitura e salvar indisponível", async () => {
    renderPage()
    const name = await screen.findByLabelText("Nome")
    expect(name).toHaveValue(LIVE.name)
    expect(name).toBeDisabled()
    expect(screen.getByLabelText("Contexto (prompt)")).toBeDisabled()
    expect(screen.getAllByTestId("restricted-config").map((notice) => notice.textContent)).toEqual(
      expect.arrayContaining([expect.stringMatching(/a versão vigente, só para leitura/)]),
    )
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Publicar" })).toBeDisabled()
    // Ativar/desativar não passa pelo rascunho e continua disponível.
    expect(screen.getByRole("switch", { name: "Desativar agente" })).toBeEnabled()
  })

  it("rascunho do próprio alcance: o formulário edita o rascunho e salvar fica disponível", async () => {
    renderPage(OWN_DRAFT)
    expect(await screen.findByLabelText("Contexto (prompt)")).toHaveValue("Rascunho do Grupo B.")
    expect(screen.getByLabelText("Contexto (prompt)")).toBeEnabled()
    expect(screen.queryByTestId("restricted-config")).toBeNull()
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled()
  })

  it("teste: o rascunho e a versão de outro alcance aparecem indisponíveis, com o aviso", async () => {
    renderPage()
    await screen.findByLabelText("Nome")
    openTab("Teste")
    fireEvent.click(await screen.findByLabelText("Configuração a testar"))
    expect(await screen.findByRole("option", { name: "Rascunho salvo — fora do seu escopo" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Versão 1 — fora do seu escopo" })).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("option", { name: "Versão 2 (em uso)" })).not.toHaveAttribute("aria-disabled")
  })

  it("execuções e histórico: o de outro alcance mostra o aviso no lugar da entrada, da resposta e dos valores", async () => {
    renderPage()
    await screen.findByLabelText("Nome")
    openTab("Execuções")
    const runs = await screen.findByText("Cenário do Grupo B")
    expect(runs).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByTestId("restricted-config").some((notice) => /a entrada, a resposta e o conteúdo testado/.test(notice.textContent ?? ""))).toBe(true))

    openTab("Histórico")
    expect(await screen.findByText(/Campos alterados:/)).toBeInTheDocument()
    expect(screen.getAllByTestId("restricted-config").some((notice) => /os valores desta alteração não aparecem/.test(notice.textContent ?? ""))).toBe(true)
    expect(screen.getByText(/“antes” → “depois”/)).toBeInTheDocument()
    expect(screen.queryByText(/“” → “”/)).toBeNull()
  })
})
