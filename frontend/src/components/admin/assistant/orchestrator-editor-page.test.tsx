/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import type { ReactNode } from "react"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"

import { NewOrchestratorPage, OrchestratorEditorPage } from "./orchestrator-editor-page"

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  create: vi.fn<(input: unknown) => Promise<{ id: string }>>(async () => ({ id: "orch-new" })),
  update: vi.fn<(input: unknown) => Promise<unknown>>(async () => ({})),
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
}
const SPECIALIST: Agent = { ...COORDINATOR, id: "agent-spec", name: "Especialista de Faturamento", agentType: "CALL_FEEDBACK" }

// Dados ESTÁVEIS entre renders, como os do React Query (um objeto novo a cada render dispararia os ajustes na renderização sem fim).
const AGENTS = [COORDINATOR, SPECIALIST]
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
  useOrchestratorQuery: () => ({ data: mocks.orchestrator, isLoading: false, isError: mocks.orchestrator === null }),
  useStructuredOutputUsageQuery: () => ({ data: undefined, refetch: vi.fn() }),
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
  specialists: [{ agentId: SPECIALIST.id, agentName: SPECIALIST.name, agentType: "CALL_FEEDBACK", specialty: null, specialtyKind: null, domain: null, businessDomainId: null, businessDomain: null, capability: null }] as Orchestrator["specialists"],
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
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ name: "INIA — Time de Contas", specialistAgentIds: [SPECIALIST.id], routingPolicy: "OPEN" })))
    expect(mocks.push).not.toHaveBeenCalled()
  })
})
