/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { Agent, AgentPublishImpact, AgentVersion } from "@/schemas/admin/agent.schema"

import { AgentLifecycleBar } from "./lifecycle-bar"
import { AgentVersionsPanel } from "./versions-panel"

/**
 * Revisão aprovada da PEN-002/PEN-076 (03/11/2026): publicar torna a versão nova a VIGENTE para todos os consumidores, sem
 * republicá-los. Condição de segurança: antes de confirmar, a pessoa vê os consumidores afetados (com quem perde o acesso), o aviso
 * dos que não pode consultar e as mudanças em bases, ferramentas, alcance e limites.
 */
const service = vi.hoisted(() => ({
  fetchAgentPublishImpact: vi.fn(),
  publishAgent: vi.fn(),
  discardAgentDraft: vi.fn(),
  fetchAgentVersions: vi.fn(),
  fetchAgentVersion: vi.fn(),
  revertAgent: vi.fn(),
}))
vi.mock("@/services/admin/agent-service", () => service)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const AGENT: Agent = {
  id: "agent-1",
  name: "Especialista de Faturamento",
  agentType: "CALL_FEEDBACK",
  objective: "Explicar a fatura",
  description: "Responde sobre faturas",
  contextPrompt: "Você explica faturas.",
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  createdByName: "Admin",
  usageCount: 3,
  scopeType: "ALL_TEAMS",
  teamId: null,
  teamName: null,
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
  currentVersionId: "v3",
  currentVersionNumber: 3,
  currentVersionPublishedAt: "2026-11-01T10:00:00.000Z",
  published: true,
  hasDraft: true,
  draftRevision: 7,
  draftUpdatedAt: "2026-11-03T09:00:00.000Z",
  draftUpdatedByName: "Bruna Lima",
  draft: null,
}

const IMPACT: AgentPublishImpact = {
  nextVersionNumber: 4,
  currentVersionNumber: 3,
  consumers: [
    { kind: "WORKFLOW", id: "wf-1", name: "Monitoria de atendimento", status: "ACTIVE", usages: ["Analisar chamada", "Resumir"], link: "/admin/workflows/wf-1", losesAccess: false },
    { kind: "ORCHESTRATOR", id: "orq-1", name: "INIA — Time Sul", status: "INACTIVE", usages: ["Especialista"], link: "/admin/assistant/orq-1", losesAccess: true },
  ],
  hasRestrictedConsumers: true,
  changes: {
    knowledge: { added: [{ id: "kb-2", title: "Manual de faturas 2026" }], removed: [{ id: "kb-1", title: "Manual de faturas 2025" }] },
    tools: { added: ["Histórico de chamadas"], removed: ["Indicadores do colaborador"] },
    scope: { from: "Todos os grupos", to: "Grupo Norte" },
    limits: { from: "Desligados", to: "Só assuntos de faturamento." },
    otherFields: ["Objetivo", "Contexto"],
  },
}

const NO_CHANGES: AgentPublishImpact = {
  nextVersionNumber: 4,
  currentVersionNumber: 3,
  consumers: [],
  hasRestrictedConsumers: false,
  changes: { knowledge: { added: [], removed: [] }, tools: { added: [], removed: [] }, scope: null, limits: null, otherFields: [] },
}

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function openPublish(agent: Agent = AGENT) {
  renderWithQuery(<AgentLifecycleBar agent={agent} dirty={false} onConflict={vi.fn()} />)
  fireEvent.click(screen.getByRole("button", { name: "Publicar" }))
  return screen.findByRole("alertdialog")
}

describe("Publicar agente — prévia dos consumidores e das mudanças", () => {
  it("mostra a versão nova substituindo a vigente, os consumidores com status, etapas e link, quem perde o acesso, o aviso dos restritos e o que muda", async () => {
    service.fetchAgentPublishImpact.mockResolvedValue(IMPACT)
    service.publishAgent.mockResolvedValue({ version: { id: "v4", number: 4 }, agent: { ...AGENT, hasDraft: false, currentVersionId: "v4", currentVersionNumber: 4 } })
    const dialog = await openPublish()

    expect(within(dialog).getByRole("heading", { name: "Publicar a versão 4?" })).toBeInTheDocument()
    const effect = within(dialog).getByTestId("publish-effect")
    expect(effect).toHaveTextContent(
      "A versão 4 substitui a vigente (versão 3) e vale nas próximas execuções do chat, da voz, dos Workflows e dos orquestradores que usam este agente, sem republicá-los.",
    )
    expect(effect).not.toHaveTextContent(/fixa/)
    expect(service.fetchAgentPublishImpact).toHaveBeenCalledWith("agent-1", undefined)

    const consumers = await within(dialog).findAllByTestId("publish-consumer")
    expect(consumers).toHaveLength(2)
    const [workflow, orchestrator] = consumers
    expect(workflow).toHaveTextContent("Monitoria de atendimento")
    expect(workflow).toHaveTextContent("Workflow de automação")
    expect(workflow).toHaveTextContent("Ativo")
    expect(workflow).toHaveTextContent("Etapa: Analisar chamada, Resumir")
    expect(within(workflow!).getByRole("link", { name: /Ver Workflow/ })).toHaveAttribute("href", "/admin/workflows/wf-1")
    expect(within(workflow!).queryByTestId("publish-loses-access")).toBeNull()

    expect(orchestrator).toHaveTextContent("INIA — Time Sul")
    expect(orchestrator).toHaveTextContent("Orquestrador")
    expect(orchestrator).toHaveTextContent("Inativo")
    expect(orchestrator).toHaveTextContent("Papel: Especialista")
    expect(within(orchestrator!).getByTestId("publish-loses-access")).toHaveTextContent("Perde o acesso")
    expect(orchestrator).toHaveTextContent("O alcance da versão nova não cobre este orquestrador: as execuções dele que chamarem o agente passam a ser bloqueadas.")
    expect(within(orchestrator!).getByRole("link", { name: /Ver orquestrador/ })).toHaveAttribute("href", "/admin/assistant/orq-1")

    expect(within(dialog).getByTestId("publish-restricted")).toHaveTextContent("Existem outros consumidores que você não tem permissão para consultar.")

    expect(within(dialog).getByText("O que muda em relação à versão 3")).toBeInTheDocument()
    const knowledge = within(dialog).getByTestId("publish-change-knowledge")
    expect(knowledge).toHaveTextContent("Inclui: Manual de faturas 2026")
    expect(knowledge).toHaveTextContent("Remove: Manual de faturas 2025")
    const tools = within(dialog).getByTestId("publish-change-tools")
    expect(tools).toHaveTextContent("Inclui: Histórico de chamadas")
    expect(tools).toHaveTextContent("Remove: Indicadores do colaborador")
    expect(within(dialog).getByTestId("publish-change-scope")).toHaveTextContent(/Hoje:\s*Todos os grupos\s*Passa a ser:\s*Grupo Norte/)
    expect(within(dialog).getByTestId("publish-change-limits")).toHaveTextContent(/Hoje:\s*Desligados\s*Passa a ser:\s*Só assuntos de faturamento\./)
    expect(within(dialog).getByTestId("publish-change-other")).toHaveTextContent("Outros campos alterados: Objetivo, Contexto")

    const confirm = within(dialog).getByRole("button", { name: "Publicar versão 4" })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(service.publishAgent).toHaveBeenCalledWith("agent-1", 7))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith("Versão publicada.")
  })

  it("agente inativo: diz que publicar não o reativa; sem consumidores visíveis nem mudanças sensíveis, diz isso", async () => {
    service.fetchAgentPublishImpact.mockResolvedValue(NO_CHANGES)
    const dialog = await openPublish({ ...AGENT, active: false })

    expect(within(dialog).getByTestId("publish-effect")).toHaveTextContent("O agente está inativo e continua assim: publicar não o reativa.")
    expect(await within(dialog).findByText("Nenhum Workflow ou orquestrador que você pode consultar usa este agente.")).toBeInTheDocument()
    expect(within(dialog).queryByTestId("publish-restricted")).toBeNull()
    expect(within(dialog).getByText("Sem mudança em bases de conhecimento, ferramentas, alcance ou limites de atuação.")).toBeInTheDocument()
    expect(within(dialog).queryByTestId("publish-change-scope")).toBeNull()
  })

  it("sem a prévia carregada a publicação fica indisponível (condição de segurança)", async () => {
    service.fetchAgentPublishImpact.mockRejectedValue(new Error("rede"))
    const dialog = await openPublish()

    expect(within(dialog).getByRole("button", { name: "Publicar versão 4" })).toBeDisabled()
    expect(await within(dialog).findByText(/Não foi possível carregar quem usa este agente e o que muda/)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Publicar versão 4" })).toBeDisabled()
    expect(service.publishAgent).not.toHaveBeenCalled()
  })

  it("a barra mostra a versão vigente e não fala mais em versão fixada por Workflow ou orquestrador", () => {
    renderWithQuery(<AgentLifecycleBar agent={AGENT} dirty={false} onConflict={vi.fn()} />)
    expect(screen.getByText("Versão 3 vigente")).toBeInTheDocument()
    expect(screen.queryByText(/fixam outra versão/)).toBeNull()
    // Nada é buscado só por mostrar a barra: a prévia vem ao abrir o "Publicar".
    expect(service.fetchAgentPublishImpact).not.toHaveBeenCalled()
  })
})

describe("Reverter para uma versão anterior", () => {
  it("explica que a versão revertida vira a vigente para todos os consumidores, sem falar em versão fixada", async () => {
    const versions: AgentVersion[] = [
      { id: "v3", number: 3, origin: "PUBLISH", revertedFromNumber: null, publishedAt: "2026-11-01T10:00:00.000Z", publishedByName: "Bruna Lima", current: true, restricted: false },
      { id: "v2", number: 2, origin: "PUBLISH", revertedFromNumber: null, publishedAt: "2026-10-20T10:00:00.000Z", publishedByName: "Bruna Lima", current: false, restricted: false },
    ]
    service.fetchAgentVersions.mockResolvedValue(versions)
    renderWithQuery(<AgentVersionsPanel agent={{ ...AGENT, hasDraft: false }} />)

    expect(await screen.findByText("Vigente")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Reverter para esta versão/ }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("A configuração da versão 2 será publicada como uma versão nova, que passa a ser a vigente")
    expect(dialog).toHaveTextContent("sem republicá-los")
    expect(dialog).not.toHaveTextContent(/fixam outra versão/)
  })

  it("reverter também publica: mostra a prévia da versão escolhida contra a vigente e só confirma com ela carregada", async () => {
    const versions: AgentVersion[] = [
      { id: "v3", number: 3, origin: "PUBLISH", revertedFromNumber: null, publishedAt: "2026-11-01T10:00:00.000Z", publishedByName: "Bruna Lima", current: true, restricted: false },
      { id: "v2", number: 2, origin: "PUBLISH", revertedFromNumber: null, publishedAt: "2026-10-20T10:00:00.000Z", publishedByName: "Bruna Lima", current: false, restricted: false },
    ]
    service.fetchAgentVersions.mockResolvedValue(versions)
    let resolveImpact: (impact: AgentPublishImpact) => void = () => undefined
    service.fetchAgentPublishImpact.mockReturnValue(new Promise<AgentPublishImpact>((resolve) => { resolveImpact = resolve }))
    service.revertAgent.mockResolvedValue({ version: { id: "v4", number: 4 }, agent: { ...AGENT, hasDraft: false } })
    renderWithQuery(<AgentVersionsPanel agent={{ ...AGENT, hasDraft: false }} />)

    await screen.findByText("Vigente")
    fireEvent.click(screen.getByRole("button", { name: /Reverter para esta versão/ }))
    const dialog = await screen.findByRole("alertdialog")
    expect(service.fetchAgentPublishImpact).toHaveBeenCalledWith("agent-1", "v2")
    const confirm = within(dialog).getByRole("button", { name: "Publicar como versão nova" })
    expect(confirm).toBeDisabled()

    resolveImpact(IMPACT)
    expect(await within(dialog).findByTestId("publish-change-scope")).toHaveTextContent(/Hoje:\s*Todos os grupos\s*Passa a ser:\s*Grupo Norte/)
    expect(within(dialog).getByTestId("publish-restricted")).toBeInTheDocument()
    expect(within(dialog).getAllByTestId("publish-loses-access")).toHaveLength(1)
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(service.revertAgent).toHaveBeenCalled())
  })
})
