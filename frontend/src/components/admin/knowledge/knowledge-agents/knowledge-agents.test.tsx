/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import { knowledgeLinkChangesOf, toggleKnowledgeLinkChoice, type KnowledgeLinkCandidate, type KnowledgeLinks, type KnowledgeLinksParams } from "@/schemas/admin/agent-knowledge-links.schema"

import { KnowledgeAgentsPicker, OPEN_KNOWLEDGE_AGENTS_EVENT } from "./knowledge-agents-picker"
import { knowledgeLinksSummary } from "./knowledge-agents-publish-preview"
import { KnowledgeAgentsSection } from "./knowledge-agents-section"

/**
 * Agentes da base (20/11/2026), nos moldes do seletor de bases do agente: inline no cartão, sem janela solta; abas, busca, filtros e
 * paginação no servidor; escolhas guardadas entre páginas; rascunho sem conferência; publicação com a conferência no próprio cartão.
 */
const service = vi.hoisted(() => ({
  fetchAgentKnowledgeLinks: vi.fn(),
  previewAgentKnowledgeLinks: vi.fn(),
  applyAgentKnowledgeLinks: vi.fn(),
}))
vi.mock("@/services/admin/agent-service", () => service)
vi.mock("@/services/admin/org-structure-service", () => ({
  fetchTeams: vi.fn(async () => [{ id: "t1", name: "Atendimento", operationId: "op-1", subteams: [] }]),
}))
const currentUser = vi.hoisted(() => ({ permissions: ["agents.manage", "knowledge.manage"] }))
vi.mock("@/queries/auth/use-current-user", () => ({ useCurrentUserQuery: () => ({ data: { access: { permissions: currentUser.permissions } } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BASE = "11111111-1111-4111-8111-111111111111"

function candidate(id: string, name: string, overrides: Partial<KnowledgeLinkCandidate> = {}): KnowledgeLinkCandidate {
  return {
    id, name, agentType: "CALL_FEEDBACK", active: true, operatingUniverse: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, teamName: null, subteamName: null,
    linkedInUse: false, linkedInDraft: false, published: true, currentVersionNumber: 1,
    draft: { revision: 3, pending: false, otherChanges: false, updatedAt: null, updatedByName: null },
    block: null, blockMessage: null, ...overrides,
  }
}

/** Servidor falso: separa as abas, filtra pelo nome e pagina como o de verdade. */
function serve(agents: KnowledgeLinkCandidate[], pendingPublish: KnowledgeLinkCandidate[] = []) {
  service.fetchAgentKnowledgeLinks.mockImplementation(async (params: KnowledgeLinksParams): Promise<KnowledgeLinks> => {
    const matching = agents.filter((agent) => !params.search || agent.name.toLowerCase().includes(params.search.toLowerCase()))
    const linked = matching.filter((agent) => agent.linkedInUse || agent.linkedInDraft)
    const available = matching.filter((agent) => !(agent.linkedInUse || agent.linkedInDraft))
    const listed = params.tab === "LINKED" ? linked : available
    return {
      knowledgeDocument: { id: BASE, title: "Procedimento de fatura", operatingUniverse: null },
      items: listed.slice((params.page - 1) * params.pageSize, params.page * params.pageSize),
      total: listed.length, page: params.page, pageSize: params.pageSize,
      counts: { linked: linked.length, available: available.length },
      pendingPublish,
    }
  })
}

const lastParams = () => service.fetchAgentKnowledgeLinks.mock.calls.at(-1)![0] as KnowledgeLinksParams
const renderClosedPicker = () => renderWithQuery(<KnowledgeAgentsPicker documentId={BASE} title="Procedimento de fatura" baseInUse />)
/** O cartão nasce fechado: abre pelo cabeçalho. */
async function renderPicker() {
  const view = renderClosedPicker()
  fireEvent.click(await screen.findByRole("button", { name: /Associar ou desassociar/ }))
  return view
}

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  currentUser.permissions = ["agents.manage", "knowledge.manage"]
  service.fetchAgentKnowledgeLinks.mockReset()
  service.previewAgentKnowledgeLinks.mockReset()
  service.applyAgentKnowledgeLinks.mockReset()
})
afterEach(() => cleanup())

describe("escolhas e mudanças", () => {
  const inUse = candidate("a", "Em uso", { linkedInUse: true, linkedInDraft: true })
  const draftOnly = candidate("b", "Só no rascunho", { linkedInDraft: true })
  const untouched = candidate("c", "Sem base")

  it("marcar e voltar ao que o rascunho já tem desfaz a escolha", () => {
    const marked = toggleKnowledgeLinkChoice(new Map(), untouched, true)
    expect([...marked.keys()]).toEqual(["c"])
    expect(toggleKnowledgeLinkChoice(marked, untouched, false).size).toBe(0)
  })

  it("rascunho: só as escolhas; publicar: também os publicados pendentes vindos do servidor, sem repetir os tocados", () => {
    const choices = toggleKnowledgeLinkChoice(toggleKnowledgeLinkChoice(new Map(), untouched, true), inUse, false)
    expect(knowledgeLinkChangesOf(choices, [draftOnly], "DRAFT")).toEqual([{ agentId: "c", linked: true, expectedDraftRevision: 3 }, { agentId: "a", linked: false, expectedDraftRevision: 3 }])
    expect(knowledgeLinkChangesOf(choices, [draftOnly], "PUBLISH")).toEqual([
      { agentId: "c", linked: true, expectedDraftRevision: 3 },
      { agentId: "a", linked: false, expectedDraftRevision: 3 },
      { agentId: "b", linked: true, expectedDraftRevision: 3 },
    ])
    // Agente nunca publicado nunca entra por tabela.
    expect(knowledgeLinkChangesOf(new Map(), [candidate("d", "Novo", { published: false, linkedInDraft: true })], "PUBLISH")).toEqual([])
  })

  it("resumo do resultado", () => {
    expect(knowledgeLinksSummary({ results: [{ agentId: "a", name: "A", outcome: "PUBLISHED", versionNumber: 2 }, { agentId: "b", name: "B", outcome: "DRAFT_SAVED", versionNumber: null }] })).toBe("Agentes atualizados: 1 publicado(s) · 1 salvo(s) no rascunho.")
    expect(knowledgeLinksSummary({ results: [] })).toBe("Nada mudou nos agentes.")
  })
})

describe("KnowledgeAgentsSection (lateral do editor)", () => {
  it("não aparece para quem não administra agentes", () => {
    currentUser.permissions = ["knowledge.manage"]
    renderWithQuery(<KnowledgeAgentsSection documentId={BASE} />)
    expect(screen.queryByText("Agentes")).not.toBeInTheDocument()
    expect(service.fetchAgentKnowledgeLinks).not.toHaveBeenCalled()
  })

  it("base ainda não criada: pede para salvar antes", () => {
    renderWithQuery(<KnowledgeAgentsSection documentId={null} />)
    expect(screen.getByText(/Salve a base para escolher/)).toBeInTheDocument()
  })

  it("resume os ligados e leva ao cartão de escolha", async () => {
    serve([candidate("a", "Agente Faturas", { linkedInUse: true, linkedInDraft: true }), candidate("b", "Agente Retenção")])
    renderWithQuery(<KnowledgeAgentsSection documentId={BASE} />)
    const linked = await screen.findByTestId("knowledge-linked-agents")
    expect(within(linked).getByText("Agente Faturas")).toBeInTheDocument()
    expect(within(linked).queryByText("Agente Retenção")).not.toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Escolher agentes/ })).toHaveAttribute("href", "#agentes-da-base")
  })
})

describe("KnowledgeAgentsPicker (cartão inline)", () => {
  it("não aparece para quem não administra agentes", () => {
    currentUser.permissions = ["knowledge.manage"]
    renderClosedPicker()
    expect(screen.queryByTestId("knowledge-agents-picker")).not.toBeInTheDocument()
  })

  it("nasce fechado: só o resumo, sem a lista; abre pelo cabeçalho e pelo atalho da lateral", async () => {
    serve([candidate("a", "Agente Faturas", { linkedInUse: true, linkedInDraft: true }), candidate("b", "Agente Retenção")])
    renderClosedPicker()
    await waitFor(() => expect(screen.getByTestId("knowledge-agents-summary")).toHaveTextContent("1 agente: Agente Faturas."))
    expect(screen.queryByRole("tab", { name: /Ligados/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    // Só a consulta do resumo (5 ligados, sem filtro); a lista ainda não foi pedida.
    expect(service.fetchAgentKnowledgeLinks.mock.calls.every(([params]) => params.tab === "LINKED" && params.pageSize === 5)).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: /Associar ou desassociar/ }))
    expect(await screen.findByRole("checkbox", { name: /Agente Faturas/ })).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: /Fechar/ }))
    await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument())
    window.dispatchEvent(new Event(OPEN_KNOWLEDGE_AGENTS_EVENT))
    expect(await screen.findByRole("checkbox", { name: /Agente Faturas/ })).toBeInTheDocument()
  })

  it("fechar com escolhas não gravadas mantém as escolhas e avisa no cabeçalho", async () => {
    serve([candidate("b", "Agente Retenção")])
    await renderPicker()
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(await screen.findByRole("checkbox", { name: /Agente Retenção/ }))
    fireEvent.click(screen.getByRole("button", { name: /Fechar/ }))
    expect(await screen.findByText("1 alteração não gravada")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Associar ou desassociar/ }))
    expect(await screen.findByTestId("knowledge-agents-pending")).toHaveTextContent("1 agente alterado")
  })

  it("abas com os números do servidor; busca vai ao servidor; nada abre janela solta", async () => {
    serve([candidate("a", "Agente Faturas", { linkedInUse: true, linkedInDraft: true }), candidate("b", "Agente Retenção"), candidate("c", "Agente Cobrança")])
    await renderPicker()
    expect(await screen.findByRole("checkbox", { name: /Agente Faturas/ })).toBeChecked()
    expect(screen.getByTestId("knowledge-agents-linked-count")).toHaveTextContent("1")
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Disponíveis/ }))
    expect(await screen.findByRole("checkbox", { name: /Agente Retenção/ })).not.toBeChecked()
    expect(lastParams()).toMatchObject({ tab: "AVAILABLE", page: 1 })
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar agente" }), { target: { value: "cobr" } })
    await waitFor(() => expect(lastParams()).toMatchObject({ tab: "AVAILABLE", search: "cobr" }))
    await waitFor(() => expect(screen.queryByRole("checkbox", { name: /Agente Retenção/ })).not.toBeInTheDocument())
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("escolha marcada numa página continua ao trocar de página; rascunho grava sem conferência", async () => {
    serve(Array.from({ length: 25 }, (_, index) => candidate(`id-${String(index).padStart(2, "0")}`, `Agente ${String(index).padStart(2, "0")}`)))
    service.applyAgentKnowledgeLinks.mockResolvedValue({ mode: "DRAFT", results: [{ agentId: "id-00", name: "Agente 00", outcome: "DRAFT_SAVED", versionNumber: null }] })
    await renderPicker()
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(await screen.findByRole("checkbox", { name: /Agente 00/ }))
    expect(screen.getByTestId("knowledge-agents-pending")).toHaveTextContent("1 agente alterado")
    fireEvent.click(screen.getByRole("button", { name: /próxima/i }))
    expect(await screen.findByRole("checkbox", { name: /Agente 24/ })).toBeInTheDocument()
    expect(screen.getByTestId("knowledge-agents-pending")).toHaveTextContent("1 agente alterado")
    fireEvent.click(screen.getByRole("button", { name: /Salvar no rascunho dos agentes/ }))
    await waitFor(() => expect(service.applyAgentKnowledgeLinks).toHaveBeenCalledWith({ knowledgeDocumentId: BASE, mode: "DRAFT", changes: [{ agentId: "id-00", linked: true, expectedDraftRevision: 3 }] }))
    expect(service.previewAgentKnowledgeLinks).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId("knowledge-agents-pending")).not.toBeInTheDocument())
  })

  it("agente bloqueado não marca e diz por quê", async () => {
    serve([candidate("a", "Agente de outro Grupo", { block: "SCOPE", blockMessage: "A base não vale para o Grupo deste agente." })])
    await renderPicker()
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Disponíveis/ }))
    expect(await screen.findByRole("checkbox", { name: /Agente de outro Grupo/ })).toBeDisabled()
    expect(screen.getByText("A base não vale para o Grupo deste agente.")).toBeInTheDocument()
  })

  it("publicar: conferência no próprio cartão, inclui os pendentes do servidor, só confirma carregada; conflito volta à lista", async () => {
    const pending = candidate("p", "Agente Pendente", { linkedInDraft: true, draft: { revision: 7, pending: true, otherChanges: false, updatedAt: null, updatedByName: null } })
    serve([candidate("a", "Agente Faturas"), pending], [pending])
    let resolvePreview: (value: unknown) => void = () => undefined
    service.previewAgentKnowledgeLinks.mockReturnValue(new Promise((resolve) => { resolvePreview = resolve }))
    service.applyAgentKnowledgeLinks.mockRejectedValue(new AdminApiError("Outra pessoa alterou", "AGENT_DRAFT_CONFLICT"))
    await renderPicker()
    // Só o pendente do servidor: "Salvar e publicar" já existe sem marcar nada.
    expect(await screen.findByTestId("knowledge-agents-pending")).toHaveTextContent(/1 agente já tem a mudança desta base só no rascunho/)
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(await screen.findByRole("checkbox", { name: /Agente Faturas/ }))
    fireEvent.click(screen.getByRole("button", { name: /Salvar e publicar/ }))
    const confirm = await screen.findByRole("button", { name: /Confirmar e publicar/ })
    expect(confirm).toBeDisabled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(service.previewAgentKnowledgeLinks).toHaveBeenCalledWith({
      knowledgeDocumentId: BASE, mode: "PUBLISH",
      changes: [{ agentId: "a", linked: true, expectedDraftRevision: 3 }, { agentId: "p", linked: true, expectedDraftRevision: 7 }],
    })
    resolvePreview({
      mode: "PUBLISH",
      agents: [{
        agentId: "a", name: "Agente Faturas", outcome: "PUBLISHED", firstPublication: false, problem: null,
        impact: { nextVersionNumber: 2, currentVersionNumber: 1, consumers: [], hasRestrictedConsumers: false, changes: { knowledge: { added: [{ id: BASE, title: "Procedimento de fatura" }], removed: [] }, tools: { added: [], removed: [] }, scope: null, limits: null, otherFields: [] } },
      }],
    })
    expect(await screen.findByText("Publica a versão 2")).toBeInTheDocument()
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    expect(await screen.findByRole("alert")).toHaveTextContent(/Outra pessoa alterou um destes agentes/)
    expect(screen.getByRole("tab", { name: /Ligados/ })).toBeInTheDocument()
  })

  it("prévia com problema num agente mantém a publicação bloqueada", async () => {
    serve([candidate("a", "Agente Faturas")])
    service.previewAgentKnowledgeLinks.mockResolvedValue({ mode: "PUBLISH", agents: [{ agentId: "a", name: "Agente Faturas", outcome: null, firstPublication: false, problem: { code: "OPERATING_UNIVERSE_LINK_CONFLICT", message: "Universos não se misturam." }, impact: null }] })
    await renderPicker()
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Disponíveis/ }))
    fireEvent.click(await screen.findByRole("checkbox", { name: /Agente Faturas/ }))
    fireEvent.click(screen.getByRole("button", { name: /Salvar e publicar/ }))
    expect(await screen.findByText("Universos não se misturam.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Confirmar e publicar/ })).toBeDisabled()
  })
})
