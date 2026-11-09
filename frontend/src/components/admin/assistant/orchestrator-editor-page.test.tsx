/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import type { ReactNode } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"

import { NewOrchestratorPage, OrchestratorEditorPage } from "./orchestrator-editor-page"

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  create: vi.fn<(input: unknown) => Promise<{ id: string }>>(async () => ({ id: "orch-new" })),
  update: vi.fn<(input: unknown) => Promise<unknown>>(async () => ({})),
  refetch: vi.fn<() => Promise<{ isError: boolean }>>(async () => ({ isError: false })),
  orchestrator: null as Orchestrator | null,
}))

// As abas do kit medem o indicador com ResizeObserver, que o jsdom não tem.
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: vi.fn(), refresh: vi.fn() }) }))
// O mapa é só leitura — no jsdom basta saber que ele está na aba.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ children }: { children?: ReactNode }) => <div data-testid="specialists-map">{children}</div>,
  ReactFlowProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}))

const COORDINATOR: Agent = {
  id: "agent-orch",
  name: "Coordenação · Contas",
  agentType: "ORCHESTRATOR",
  objective: "Coordenar",
  description: "Coordena especialistas",
  contextPrompt: "Você coordena.",
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
  currentVersionId: "v1",
  currentVersionNumber: 1,
  currentVersionPublishedAt: null,
  published: true,
  hasDraft: false,
  draftRevision: 0,
  draftUpdatedAt: null,
  draftUpdatedByName: null,
  draft: null,
}
// O especialista está na versão 3 (vigente) — é com ela que o orquestrador o executa (revisão de 03/11/2026: nada fica fixado).
const SPECIALIST: Agent = { ...COORDINATOR, id: "agent-spec", name: "Especialista de Faturamento", agentType: "CALL_FEEDBACK", currentVersionId: "vs-3", currentVersionNumber: 3 }
// Nunca publicado (PEN-047): aparece no seletor, mas não pode ser escolhido.
const DRAFT_ONLY: Agent = { ...COORDINATOR, id: "agent-draft", name: "Especialista em Rascunho", agentType: "CALL_FEEDBACK", currentVersionId: null, currentVersionNumber: null, published: false }

// Dados ESTÁVEIS entre renders, como os do React Query (um objeto novo a cada render dispararia os ajustes na renderização sem fim).
const AGENTS = [COORDINATOR, SPECIALIST, DRAFT_ONLY]
const MANAGEABLE_TEAMS = { teams: [], unrestricted: true }
const DOMAINS: never[] = []
vi.mock("@/queries/admin/use-agent-queries", () => ({ useAgentsQuery: () => ({ data: AGENTS }) }))
vi.mock("@/queries/admin/use-org-structure-queries", () => ({ useManageableTeamsQuery: () => ({ data: MANAGEABLE_TEAMS }) }))
vi.mock("@/queries/admin/use-business-domain-queries", () => ({ useBusinessDomainsQuery: () => ({ data: DOMAINS, isPending: false }) }))
vi.mock("@/queries/admin/use-assistant-queries", () => ({
  useCreateOrchestratorMutation: () => ({ mutateAsync: mocks.create, isPending: false, isError: false, error: null }),
  useUpdateOrchestratorMutation: () => ({ mutateAsync: mocks.update, isPending: false, isError: false, error: null }),
  useToggleOrchestratorActiveMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteOrchestratorMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrchestratorQuery: () => ({ data: mocks.orchestrator, isLoading: false, isError: mocks.orchestrator === null, refetch: mocks.refetch }),
  useStructuredOutputUsageQuery: () => ({ data: undefined, refetch: vi.fn() }),
  useOrchestratorVersionsQuery: () => ({ data: undefined, isPending: true, isError: false, refetch: vi.fn() }),
}))

const ORCHESTRATOR: Orchestrator = {
  id: "orch-1",
  name: "INIA — Time de Contas",
  active: true,
  createdAt: "2026-10-01T00:00:00.000Z",
  scopeType: "ALL_TEAMS",
  teamId: null,
  teamName: null,
  subteamId: null,
  subteamName: null,
  orchestratorAgentId: COORDINATOR.id,
  orchestratorAgentName: COORDINATOR.name,
  orchestratorAgentActive: true,
  orchestratorAgentPublished: true,
  orchestratorAgentCurrentVersionId: "v1",
  orchestratorAgentCurrentVersionNumber: 1,
  currentVersionId: "ov-1",
  currentVersionNumber: 1,
  specialists: [
    {
      agentId: SPECIALIST.id,
      agentName: SPECIALIST.name,
      agentType: "CALL_FEEDBACK",
      specialty: null,
      specialtyKind: null,
      domain: null,
      businessDomainId: null,
      businessDomain: null,
      capability: null,
      active: true,
      published: true,
      agentCurrentVersionId: "vs-3",
      agentCurrentVersionNumber: 3,
    },
  ],
  invocationMode: "INTERACTIVE",
  outputInstructions: null,
  outputSchema: null,
  structuredOutput: null,
  structuredOutputSource: "NONE",
  structuredOutputReview: null,
  structuredOutputFields: null,
  policyKind: "INTERACTIVE",
  policyDomains: [],
  routingPolicy: "OPEN",
  routingDomains: [],
  businessDomains: [],
  recommendSupportMaterials: false,
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.orchestrator = null
})

function renderPage(node: ReactNode) {
  return render(<TooltipProvider>{node}</TooltipProvider>)
}

/** Radix Tabs troca de aba no mousedown do botão esquerdo. */
function openTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 })
}

describe("Orquestrador — cadastro em página com abas, no padrão de Agentes", () => {
  it("Novo orquestrador abre a página (sem pop-up) e o Criar fica bloqueado dizendo o que falta", () => {
    renderPage(<NewOrchestratorPage />)
    expect(screen.getByRole("heading", { name: "Novo orquestrador" })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Configuração", "Especialistas (0)", "Resultado estruturado"])
    const create = screen.getByRole("button", { name: "Criar orquestrador" })
    expect(create).toBeDisabled()
    fireEvent.focus(create.parentElement!)
    return waitFor(() => expect(screen.getAllByText(/Informe o nome\. Escolha o agente orquestrador\./).length).toBeGreaterThan(0))
  })

  it("cria com especialista e política escolhidos em abas diferentes e abre o cadastro criado", async () => {
    renderPage(<NewOrchestratorPage />)
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "INIA — Time de Contas" } })
    fireEvent.click(screen.getByRole("button", { name: /Coordenação · Contas/ }))
    fireEvent.click(screen.getByRole("radio", { name: "Qualquer assunto autorizado" }))

    openTab(/Especialistas/)
    expect(screen.getByTestId("specialists-map")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }))
    fireEvent.click(screen.getByRole("button", { name: /Especialista de Faturamento/ }))
    expect(screen.getByRole("tab", { name: "Especialistas (1)" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Criar orquestrador" }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/admin/assistant/orch-new"))
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "INIA — Time de Contas", orchestratorAgentId: COORDINATOR.id, specialistAgentIds: [SPECIALIST.id], routingPolicy: "OPEN", structuredOutput: null }),
    )
  })

  it("o resultado estruturado continua montado ao trocar de aba — nada do que não foi salvo se perde", () => {
    renderPage(<NewOrchestratorPage />)
    openTab(/Resultado estruturado/)
    const toggle = screen.getByRole("switch", { name: "Produzir resultado estruturado" })
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
    openTab(/Configuração/)
    // Escondida pela classe (`data-[state=inactive]:hidden`), não desmontada — o jsdom não aplica o Tailwind, então confere o estado.
    expect(screen.getByTestId("structured-output-builder").closest("[role=tabpanel]")).toHaveAttribute("data-state", "inactive")
    openTab(/Resultado estruturado/)
    expect(screen.getByRole("switch", { name: "Produzir resultado estruturado" })).toBeChecked()
  })

  it("editar abre o mesmo cadastro com o registro carregado e salva no lugar", async () => {
    mocks.orchestrator = ORCHESTRATOR
    renderPage(<OrchestratorEditorPage orchestratorId="orch-1" />)
    expect(screen.getByRole("heading", { name: "INIA — Time de Contas" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Especialistas (1)" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Desativar orquestrador" })).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    // A gravação diz em qual versão do orquestrador a edição se baseou; nenhuma versão de agente vai junto (rodam na vigente).
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ name: "INIA — Time de Contas", specialistAgentIds: [SPECIALIST.id], routingPolicy: "OPEN", expectedVersionId: "ov-1" })))
    expect(mocks.update.mock.calls[0]![0]).not.toHaveProperty("specialistVersionIds")
    expect(mocks.update.mock.calls[0]![0]).not.toHaveProperty("orchestratorAgentVersionId")
    expect(mocks.push).not.toHaveBeenCalled()
  })
})

describe("Orquestrador — versões (PEN-076 com a revisão de 03/11/2026, PEN-050, PEN-047)", () => {
  it("mostra a versão em uso do orquestrador e a VIGENTE de cada agente, sem escolha de versão; a gravação não envia versões de agente", async () => {
    mocks.orchestrator = ORCHESTRATOR
    renderPage(<OrchestratorEditorPage orchestratorId="orch-1" />)
    expect(screen.getByText("Versão 1 em uso")).toBeInTheDocument()
    expect(within(screen.getByTestId(`agent-version-${COORDINATOR.id}`)).getByText("Versão vigente: 1")).toBeInTheDocument()

    openTab(/Especialistas/)
    const specialist = screen.getByTestId(`agent-version-${SPECIALIST.id}`)
    expect(within(specialist).getByText("Versão vigente: 3")).toBeInTheDocument()
    // Nada de "usar a versão N" / "manter": o especialista roda sempre na vigente.
    expect(within(specialist).queryByRole("button")).toBeNull()
    expect(screen.queryByRole("button", { name: /disponível — usar/ })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ specialistAgentIds: [SPECIALIST.id], expectedVersionId: "ov-1" })))
    expect(mocks.update.mock.calls[0]![0]).not.toHaveProperty("specialistVersionIds")
    expect(mocks.update.mock.calls[0]![0]).not.toHaveProperty("orchestratorAgentVersionId")
  })

  it("especialista recém-incluído mostra a versão vigente da lista de agentes", () => {
    renderPage(<NewOrchestratorPage />)
    openTab(/Especialistas/)
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }))
    fireEvent.click(screen.getByRole("button", { name: /Especialista de Faturamento/ }))
    expect(within(screen.getByTestId(`agent-version-${SPECIALIST.id}`)).getByText("Versão vigente: 3")).toBeInTheDocument()
  })

  it("especialista inativo e agente orquestrador não publicado ficam marcados", () => {
    mocks.orchestrator = {
      ...ORCHESTRATOR,
      orchestratorAgentPublished: false,
      orchestratorAgentCurrentVersionId: null,
      orchestratorAgentCurrentVersionNumber: null,
      specialists: ORCHESTRATOR.specialists.map((specialist) => ({ ...specialist, active: false })),
    }
    renderPage(<OrchestratorEditorPage orchestratorId="orch-1" />)
    expect(within(screen.getByTestId(`agent-version-${COORDINATOR.id}`)).getByText("Não publicado")).toBeInTheDocument()
    openTab(/Especialistas/)
    const specialist = screen.getByTestId(`agent-version-${SPECIALIST.id}`)
    expect(within(specialist).getByText("Agente inativo")).toBeInTheDocument()
    expect(within(specialist).getByText("Versão vigente: 3")).toBeInTheDocument()
  })

  it("409 de versão: nada se perde — o aviso explica e, ao atualizar, as alterações são reaplicadas sobre a versão atual", async () => {
    mocks.orchestrator = ORCHESTRATOR
    mocks.update.mockRejectedValueOnce(
      new AdminApiError("Outra pessoa gravou este orquestrador depois que você o abriu. Atualize para ver a versão atual; o que você alterou continua na tela.", "ORCHESTRATOR_VERSION_CONFLICT", {
        currentVersionId: "ov-2",
        publishedByName: "Bruna Lima",
      }),
    )
    const view = renderPage(<OrchestratorEditorPage orchestratorId="orch-1" />)
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "INIA — Contas (revisado)" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))

    const alert = await screen.findByText(/Outra pessoa gravou este orquestrador/)
    expect(alert).toHaveTextContent("Última gravação: Bruna Lima.")
    expect(screen.getByLabelText("Nome")).toHaveValue("INIA — Contas (revisado)")
    // Salvar de novo sem atualizar repetiria o conflito: fica bloqueado com o motivo.
    expect(screen.getByRole("button", { name: "Salvar alterações" })).toBeDisabled()

    mocks.refetch.mockImplementationOnce(async () => {
      mocks.orchestrator = { ...ORCHESTRATOR, name: "INIA — Contas (versão da Bruna)", currentVersionId: "ov-2", currentVersionNumber: 2 }
      return { isError: false }
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Atualizar e reaplicar minhas alterações" }))
    })
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
    view.rerender(
      <TooltipProvider>
        <OrchestratorEditorPage orchestratorId="orch-1" />
      </TooltipProvider>,
    )

    expect(screen.getByText("Versão 2 em uso")).toBeInTheDocument()
    expect(screen.getByLabelText("Nome")).toHaveValue("INIA — Contas (revisado)")
    expect(screen.queryByText(/Outra pessoa gravou este orquestrador/)).toBeNull()
    expect(screen.getByText(/suas alterações foram reaplicadas por cima/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    await waitFor(() => expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ name: "INIA — Contas (revisado)", expectedVersionId: "ov-2" })))
  })

  it("agente nunca publicado aparece como 'Não publicado' e não pode ser escolhido", () => {
    renderPage(<NewOrchestratorPage />)
    openTab(/Especialistas/)
    fireEvent.click(screen.getByRole("button", { name: "Adicionar" }))
    const draftOnly = screen.getByRole("button", { name: /Especialista em Rascunho/ })
    expect(draftOnly).toBeDisabled()
    expect(draftOnly).toHaveTextContent("Não publicado")
  })

  it("422 de agente não publicado marca o agente recusado", async () => {
    mocks.orchestrator = ORCHESTRATOR
    mocks.update.mockRejectedValueOnce(new AdminApiError(`O agente "${SPECIALIST.name}" ainda não foi publicado. Publique-o antes de usá-lo num orquestrador.`, "ORCHESTRATOR_AGENT_NOT_PUBLISHED", { agentId: SPECIALIST.id }))
    renderPage(<OrchestratorEditorPage orchestratorId="orch-1" />)
    fireEvent.click(screen.getByRole("button", { name: "Salvar alterações" }))
    openTab(/Especialistas/)
    await waitFor(() => expect(within(screen.getByTestId(`agent-version-${SPECIALIST.id}`)).getByText("Não publicado")).toBeInTheDocument())
  })
})
