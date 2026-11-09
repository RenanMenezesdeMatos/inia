/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import type { WorkflowExecutionAgentRecord, WorkflowRetryPreview } from "@/schemas/admin/workflow-retry.schema"
import { workflowEnrollmentSchema, type WorkflowEnrollment } from "@/schemas/admin/workflow.schema"

import { WorkflowEnrollmentsTab } from "./workflow-enrollments-tab"

/**
 * PEN-070/073/074/075/071 — execução bloqueada (agente inativo ou, desde a revisão de 03/11/2026, acesso não autorizado), nova
 * tentativa confirmada com as versões VIGENTES dos agentes e histórico desta execução.
 */
const service = vi.hoisted(() => ({
  fetchWorkflowEnrollmentsPage: vi.fn(),
  fetchWorkflowRetryPreview: vi.fn(),
  confirmWorkflowRetry: vi.fn(),
  fetchWorkflowExecutionAgentRecords: vi.fn(),
  submitHumanReviewDecision: vi.fn(),
}))
vi.mock("@/services/admin/workflow-service", () => service)
vi.mock("@/services/admin/workflow-variable-service", () => ({ fetchWorkflowVariables: vi.fn().mockResolvedValue([]) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const GRAPH = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
    { id: "agent", type: "action", label: "Analisar chamada", position: { x: 0, y: 0 }, config: { actionType: "CALL_AGENT", agentId: "ag-1" } },
  ],
  edges: [],
} as unknown as FlowGraph

/** Pelo schema, como a tela recebe — campos novos ausentes caem nos padrões tolerantes. */
const enrollment = (patch: Record<string, unknown> = {}): WorkflowEnrollment =>
  workflowEnrollmentSchema.parse({
    id: "a1b2c3d4-0000-0000-0000-000000000001",
    currentNodeId: "agent",
    status: "blocked",
    nextEvalAt: "2026-11-03T12:00:00Z",
    createdAt: "2026-11-03T11:00:00Z",
    updatedAt: "2026-11-03T11:05:00Z",
    events: [{ nodeId: "agent", eventType: "node_blocked", payload: { reason: "AGENT_INACTIVE", agentName: "Especialista de Planos", agentVersionNumber: 2 }, createdAt: "2026-11-03T11:05:00Z" }],
    versionId: "v3",
    versionNumber: 3,
    blockedAt: "2026-11-03T11:05:00Z",
    blockedNodeId: "agent",
    blockedReason: "AGENT_INACTIVE",
    blockedDetails: { agentId: "ag-1", agentName: "Especialista de Planos", agentVersionId: "agv-2", agentVersionNumber: 2 },
    ...patch,
  })

const PREVIEW: WorkflowRetryPreview = {
  enrollmentId: "a1b2c3d4-0000-0000-0000-000000000001",
  workflowId: "wf-1",
  workflowName: "Monitoria de atendimento",
  workflowActive: true,
  blockers: [],
  workflowVersion: { id: "v4", number: 4 },
  originalVersion: { id: "v3", number: 3 },
  blockedNode: { id: "agent", label: "Analisar chamada", agentName: "Especialista de Planos" },
  agents: [{ nodeId: "agent", nodeLabel: "Analisar chamada", agentId: "ag-3", agentName: "EXEMPLO · Especialista de Planos 3", agentVersionId: "agv-7", agentVersionNumber: 7, active: true }],
  orchestrators: [],
  destinations: [{ nodeId: "out", nodeLabel: "Enviar feedback", description: "Para o próprio colaborador, em Acompanhamento" }],
  approvals: [{ nodeId: "review", nodeLabel: "Revisão do supervisor", description: "Revisão do supervisor" }],
  startsAt: "TRIGGER",
  fanOut: null,
  fingerprint: "fp-1",
}

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderTab(items: WorkflowEnrollment[]) {
  service.fetchWorkflowEnrollmentsPage.mockResolvedValue({ items, total: items.length, page: 1, pageSize: 10 })
  return renderWithQuery(<WorkflowEnrollmentsTab workflowId="wf-1" graph={GRAPH} />)
}

async function openRetryDialog() {
  fireEvent.click(await screen.findByRole("button", { name: /Nova tentativa/ }))
  return screen.findByRole("alertdialog")
}

describe("Execuções — bloqueada por agente inativo e nova tentativa", () => {
  it("execução bloqueada mostra o status, a etapa, o agente, a orientação e a ação Nova tentativa", async () => {
    renderTab([enrollment()])

    const row = (await screen.findByTestId("blocked-reason")).closest("tr")!
    expect(within(row).getByText("Bloqueada — agente inativo")).toBeInTheDocument()
    expect(within(row).getByTestId("blocked-reason")).toHaveTextContent("Parou na etapa “Analisar chamada” — agente “Especialista de Planos” (versão 2) inativo.")
    expect(within(row).getByTestId("blocked-reason")).toHaveTextContent("Reative ou substitua o agente e solicite uma nova tentativa.")
    expect(within(row).getByRole("button", { name: /Nova tentativa/ })).toBeInTheDocument()
    // Nova tentativa nunca é automática: nada é pedido ao servidor só por mostrar a execução.
    expect(service.fetchWorkflowRetryPreview).not.toHaveBeenCalled()
    expect(service.confirmWorkflowRetry).not.toHaveBeenCalled()
  })

  it("execução que não está bloqueada não oferece nova tentativa", async () => {
    renderTab([enrollment({ status: "completed", blockedAt: null, blockedNodeId: null, blockedReason: null, blockedDetails: null, events: [] })])
    expect(await screen.findByText("Concluído")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Nova tentativa/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId("blocked-reason")).not.toBeInTheDocument()
  })

  it("a confirmação mostra versão, agente com versão, destinos e aprovações; Workflow desligado impede confirmar (PEN-075)", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValue({
      ...PREVIEW,
      workflowActive: false,
      blockers: [{ code: "WORKFLOW_RETRY_WORKFLOW_INACTIVE", message: "Este Workflow está desligado. Reative-o para solicitar uma nova tentativa." }],
    })
    renderTab([enrollment()])
    const dialog = await openRetryDialog()

    expect(await within(dialog).findByTestId("retry-version")).toHaveTextContent("Versão 4 (publicada e vigente) — a execução original começou na versão 3 e continua nela.")
    expect(within(dialog).getByTestId("retry-starts-at")).toHaveTextContent("Recomeça do início (Gatilho)")
    expect(within(dialog).getByTestId("retry-agents")).toHaveTextContent("Analisar chamada: EXEMPLO · Especialista de Planos 3 · versão 7 (vigente)")
    expect(within(dialog).getByTestId("retry-destinations")).toHaveTextContent("Para o próprio colaborador, em Acompanhamento")
    expect(within(dialog).getByTestId("retry-approvals")).toHaveTextContent("Revisão do supervisor")
    expect(within(dialog).getByTestId("retry-blockers")).toHaveTextContent("Este Workflow está desligado. Reative-o para solicitar uma nova tentativa.")
    expect(within(dialog).getByRole("button", { name: "Confirmar nova tentativa" })).toHaveAttribute("aria-disabled", "true")
    expect(service.fetchWorkflowRetryPreview).toHaveBeenCalledWith("wf-1", "a1b2c3d4-0000-0000-0000-000000000001")
    expect(service.confirmWorkflowRetry).not.toHaveBeenCalled()
  })

  it("agente da versão vigente ainda inativo aparece marcado e impede confirmar", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValue({
      ...PREVIEW,
      startsAt: "BLOCKED_STEP",
      workflowVersion: { id: "v3", number: 3 },
      agents: [{ ...PREVIEW.agents[0]!, agentName: "Especialista de Planos", agentVersionNumber: 2, active: false }],
      blockers: [{ code: "WORKFLOW_AGENT_INACTIVE", message: "O nó \"Analisar chamada\" usa o agente \"Especialista de Planos\", que está inativo. Ative-o (ou publique uma versão sem ele) antes de executar." }],
    })
    renderTab([enrollment()])
    const dialog = await openRetryDialog()

    expect(await within(dialog).findByTestId("retry-agents")).toHaveTextContent("Analisar chamada: Especialista de Planos · versão 2 (vigente) inativo")
    expect(within(dialog).getByTestId("retry-version")).toHaveTextContent("a mesma da execução original")
    expect(within(dialog).getByTestId("retry-starts-at")).toHaveTextContent("Continua da etapa bloqueada (“Analisar chamada”)")
    expect(within(dialog).getByTestId("retry-blockers")).toHaveTextContent("que está inativo")
    expect(within(dialog).getByRole("button", { name: "Confirmar nova tentativa" })).toHaveAttribute("aria-disabled", "true")
  })

  it("dados mudaram (RECONFIRM): mostra a prévia nova, nada roda e só cria a tentativa num segundo clique com a impressão digital nova", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValue(PREVIEW)
    const refreshed: WorkflowRetryPreview = { ...PREVIEW, workflowVersion: { id: "v5", number: 5 }, approvals: [], fingerprint: "fp-2" }
    service.confirmWorkflowRetry
      .mockRejectedValueOnce(new AdminApiError("O que será usado na nova tentativa mudou desde que você abriu a confirmação.", "WORKFLOW_RETRY_RECONFIRM", { preview: refreshed }))
      .mockResolvedValueOnce({ enrollmentId: "f0e1d2c3-0000-0000-0000-000000000009", preview: refreshed })
    renderTab([enrollment()])
    const dialog = await openRetryDialog()

    const confirm = await within(dialog).findByRole("button", { name: "Confirmar nova tentativa" })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    expect(await within(dialog).findByTestId("retry-reconfirm")).toHaveTextContent("Os dados mudaram desde que você abriu; confira e confirme de novo.")
    expect(within(dialog).getByTestId("retry-version")).toHaveTextContent("Versão 5")
    expect(within(dialog).getByText("Sem revisão humana nesta versão.")).toBeInTheDocument()
    expect(service.confirmWorkflowRetry).toHaveBeenCalledTimes(1)
    expect(service.confirmWorkflowRetry).toHaveBeenLastCalledWith("wf-1", "a1b2c3d4-0000-0000-0000-000000000001", "fp-1")
    // A recusa tratada no diálogo nunca vira toast de erro.
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar nova tentativa" }))
    await waitFor(() => expect(service.confirmWorkflowRetry).toHaveBeenCalledTimes(2))
    expect(service.confirmWorkflowRetry).toHaveBeenLastCalledWith("wf-1", "a1b2c3d4-0000-0000-0000-000000000001", "fp-2")
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(toast.success).toHaveBeenCalledWith("Nova tentativa iniciada.")
    // Sucesso recarrega Execuções para mostrar a tentativa nova.
    await waitFor(() => expect(service.fetchWorkflowEnrollmentsPage).toHaveBeenCalledTimes(2))
  })

  it("tentativa já em andamento: mostra a mensagem do servidor no diálogo, sem toast", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValue(PREVIEW)
    service.confirmWorkflowRetry.mockRejectedValueOnce(new AdminApiError("Já existe uma nova tentativa desta execução em andamento. Aguarde ela terminar.", "WORKFLOW_RETRY_IN_PROGRESS"))
    renderTab([enrollment()])
    const dialog = await openRetryDialog()
    const confirm = await within(dialog).findByRole("button", { name: "Confirmar nova tentativa" })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    expect(await within(dialog).findByTestId("retry-refusal")).toHaveTextContent("Já existe uma nova tentativa desta execução em andamento.")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ["WORKFLOW_RETRY_REVIEWER_MISSING", "Este colaborador não tem o cargo pedido para a revisão na hierarquia."],
    ["WORKFLOW_RETRY_CONTENT_MISSING", "O conteúdo a revisar continua ausente nesta versão."],
  ])("WF-42 · recusa %s depois de aberto: a prévia nova traz o impedimento junto da ação, o foco fica no botão e não há toast", async (code, message) => {
    service.fetchWorkflowRetryPreview.mockResolvedValue(PREVIEW)
    const refreshed: WorkflowRetryPreview = { ...PREVIEW, blockers: [{ code, message }], fingerprint: "fp-2" }
    service.confirmWorkflowRetry.mockRejectedValueOnce(new AdminApiError(message, code, { preview: refreshed }))
    renderTab([enrollment()])
    const dialog = await openRetryDialog()
    const confirm = await within(dialog).findByRole("button", { name: "Confirmar nova tentativa" })
    await waitFor(() => expect(confirm).toHaveAttribute("aria-disabled", "false"))
    confirm.focus()
    fireEvent.click(confirm)

    const blockers = await within(dialog).findByTestId("retry-blockers")
    expect(blockers).toHaveTextContent(message)
    expect(within(dialog).getByTestId("retry-action-status")).toContainElement(blockers)
    // A mensagem da recusa é a do impedimento: aparece uma vez só.
    expect(within(dialog).getAllByText(message)).toHaveLength(1)
    expect(within(dialog).queryByTestId("retry-refusal")).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()

    const after = within(dialog).getByRole("button", { name: "Confirmar nova tentativa" })
    expect(after).toBe(confirm)
    expect(after).toHaveFocus()
    expect(after).toHaveAttribute("aria-disabled", "true")
    fireEvent.click(after)
    expect(service.confirmWorkflowRetry).toHaveBeenCalledTimes(1)
  })

  it("cada execução mostra o vínculo original ↔ tentativas, a versão usada, os agentes usados e o histórico desta execução", async () => {
    const original = enrollment({
      retries: [{ id: "f0e1d2c3-0000-0000-0000-000000000009", status: "completed", requestedAt: "2026-11-03T13:00:00Z", requestedByName: "Renata Souza" }],
      agentRuns: [{ nodeId: "agent", agentRunId: "run-1", agentId: "ag-0", agentName: "Classificador antigo", agentActive: false, agentVersionNumber: 1, status: "COMPLETED" }],
    })
    const attempt = enrollment({
      id: "f0e1d2c3-0000-0000-0000-000000000009",
      status: "completed",
      versionNumber: 4,
      blockedAt: null,
      blockedNodeId: null,
      blockedReason: null,
      blockedDetails: null,
      events: [],
      retryOfEnrollmentId: "a1b2c3d4-0000-0000-0000-000000000001",
      retryRequestedByName: "Renata Souza",
      retryRequestedAt: "2026-11-03T13:00:00Z",
      retryAgents: [{ nodeLabel: "Analisar chamada", agentName: "EXEMPLO · Especialista de Planos 3", agentVersionNumber: 7 }],
    })
    const records: WorkflowExecutionAgentRecord[] = [
      { id: "run-1", agentId: "ag-0", agentName: "Classificador antigo", agentActive: false, status: "COMPLETED", source: "WORKFLOW", createdAt: "2026-11-03T11:01:00Z", completedAt: "2026-11-03T11:01:05Z", outputText: "Motivo: segunda via", errorMessage: null, agentVersionNumber: 1, nodeId: "agent" },
      { id: "run-2", agentId: "ag-9", agentName: "Agente ativo", agentActive: true, status: "COMPLETED", source: "WORKFLOW", createdAt: "2026-11-03T11:02:00Z", completedAt: null, outputText: null, errorMessage: null, agentVersionNumber: 3, nodeId: "agent" },
    ]
    service.fetchWorkflowExecutionAgentRecords.mockResolvedValue(records)
    renderTab([attempt, original])

    expect(await screen.findByText(/Nova tentativa da execução #a1b2c3d4 · por Renata Souza/)).toBeInTheDocument()
    expect(screen.getByText(/1 nova tentativa · última: Concluído/)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: "Mostrar eventos da execução" })[1]!)
    const links = await screen.findByTestId("execution-links")
    expect(links).toHaveTextContent("Execução #a1b2c3d4 · versão 3 do Workflow")
    expect(within(links).getByTestId("execution-retries")).toHaveTextContent("#f0e1d2c3 · Concluído · pedida por Renata Souza em")
    expect(within(links).getByTestId("execution-agent-runs")).toHaveTextContent("Classificador antigo · versão 1 · etapa “Analisar chamada” · Concluída")
    expect(within(links).getByTestId("execution-agent-runs")).toHaveTextContent("Agente inativo")
    expect(screen.getByText(/Agente "Especialista de Planos" \(versão 2\) inativo\. Reative ou substitua o agente/)).toBeInTheDocument()

    fireEvent.click(within(links).getByRole("button", { name: /Ver histórico desta execução/ }))
    const history = await screen.findByTestId("execution-agent-records")
    expect(service.fetchWorkflowExecutionAgentRecords).toHaveBeenCalledWith("wf-1", "a1b2c3d4-0000-0000-0000-000000000001")
    const [inactive, active] = within(history).getAllByTestId("execution-agent-record")
    expect(inactive).toHaveTextContent("Classificador antigo")
    expect(inactive).toHaveTextContent("Agente inativo")
    expect(within(inactive!).queryByRole("link")).not.toBeInTheDocument()
    expect(within(inactive!).getByText("Motivo: segunda via")).toBeInTheDocument()
    expect(within(active!).getByRole("link", { name: "Agente ativo" })).toHaveAttribute("href", "/admin/agents/ag-9")
  })

  it("a nova tentativa mostra a versão em que rodou e o agente/versão confirmados", async () => {
    renderTab([
      enrollment({
        id: "f0e1d2c3-0000-0000-0000-000000000009",
        status: "active",
        versionNumber: 4,
        blockedAt: null,
        blockedNodeId: null,
        blockedReason: null,
        blockedDetails: null,
        events: [],
        retryOfEnrollmentId: "a1b2c3d4-0000-0000-0000-000000000001",
        retryRequestedByName: "Renata Souza",
        retryRequestedAt: "2026-11-03T13:00:00Z",
        retryAgents: [{ nodeLabel: "Analisar chamada", agentName: "EXEMPLO · Especialista de Planos 3", agentVersionNumber: 7 }],
      }),
    ])
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar eventos da execução" }))
    const links = await screen.findByTestId("execution-links")
    expect(links).toHaveTextContent("Execução #f0e1d2c3 · versão 4 do Workflow")
    expect(links).toHaveTextContent("Nova tentativa da execução #a1b2c3d4 — pedida por Renata Souza em")
    expect(links).toHaveTextContent("Confirmada com: Analisar chamada: EXEMPLO · Especialista de Planos 3 (versão 7)")
  })
  it("bloqueio por acesso não autorizado: status pelo motivo, o detalhe da negação e a orientação de ajustar o agente", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValue({ ...PREVIEW, startsAt: "BLOCKED_STEP", workflowVersion: { id: "v3", number: 3 } })
    renderTab([
      enrollment({
        blockedReason: "AGENT_ACCESS_NOT_AUTHORIZED",
        blockedDetails: { agentId: "ag-1", agentName: "Especialista de Planos", agentVersionId: "agv-4", agentVersionNumber: 4, denial: "SCOPE" },
        events: [{ nodeId: "agent", eventType: "node_blocked", payload: { reason: "AGENT_ACCESS_NOT_AUTHORIZED", agentName: "Especialista de Planos", agentVersionNumber: 4, denial: "SCOPE" }, createdAt: "2026-11-03T11:05:00Z" }],
      }),
    ])

    const reason = await screen.findByTestId("blocked-reason")
    const row = reason.closest("tr")!
    expect(within(row).getByText("Bloqueada — acesso não autorizado")).toBeInTheDocument()
    expect(within(row).queryByText("Bloqueada — agente inativo")).toBeNull()
    expect(reason).toHaveTextContent("Parou na etapa “Analisar chamada” — agente “Especialista de Planos” (versão 4) sem acesso autorizado neste contexto: o alcance da versão vigente do agente não cobre este Workflow.")
    expect(reason).toHaveTextContent("Ajuste o agente (alcance ou bases da versão vigente) ou substitua-o e solicite uma nova tentativa.")

    fireEvent.click(within(row).getByRole("button", { name: "Mostrar eventos da execução" }))
    expect(await screen.findByText(/Agente "Especialista de Planos" \(versão 4\) sem acesso autorizado neste contexto\. Ajuste o agente/)).toBeInTheDocument()

    const dialog = await openRetryDialog()
    expect(within(dialog).getByText(/A execução original continua “Bloqueada — acesso não autorizado”/)).toBeInTheDocument()
    expect(await within(dialog).findByTestId("retry-blocked-step")).toHaveTextContent("Parou em “Analisar chamada” — agente “Especialista de Planos” sem acesso autorizado neste contexto.")
  })

  it("a confirmação mostra a versão vigente dos agentes de cada Orquestrador e explica que a vigente é conferida de novo na chamada", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValue({
      ...PREVIEW,
      agents: [],
      orchestrators: [
        {
          nodeId: "orq",
          nodeLabel: "Responder ao cliente",
          orchestratorId: "o-1",
          orchestratorName: "INIA — Contas",
          orchestratorVersionId: "ov-2",
          orchestratorVersionNumber: 2,
          agents: [
            { agentId: "a-orq", agentName: "Coordenação · Contas", role: "ORCHESTRATOR_AGENT", agentVersionId: "av-5", agentVersionNumber: 5, active: true },
            { agentId: "a-fat", agentName: "Especialista de Faturamento", role: "SPECIALIST", agentVersionId: "av-9", agentVersionNumber: 9, active: true },
            { agentId: "a-ret", agentName: "Especialista de Retenção", role: "SPECIALIST", agentVersionId: "av-2", agentVersionNumber: 2, active: false },
          ],
        },
      ],
    })
    renderTab([enrollment()])
    const dialog = await openRetryDialog()

    const orchestrators = await within(dialog).findByTestId("retry-orchestrators")
    expect(orchestrators).toHaveTextContent("Responder ao cliente: INIA — Contas · configuração da versão 2")
    const agents = within(dialog).getByTestId("retry-orchestrator-agents-orq")
    expect(agents).toHaveTextContent("Agente orquestrador: Coordenação · Contas · versão 5 (vigente)")
    expect(agents).toHaveTextContent("Especialista: Especialista de Faturamento · versão 9 (vigente)")
    expect(agents).toHaveTextContent("Especialista: Especialista de Retenção · versão 2 (vigente) inativo")
    expect(within(dialog).getByTestId("retry-vigente-note")).toHaveTextContent("Os agentes rodam na versão vigente no momento da chamada")
  })

  it("execução de um colaborador de 'Selecionar colaboradores': recomeça depois do envio e diz se entra no resultado consolidado", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValueOnce({ ...PREVIEW, startsAt: "AFTER_FAN_OUT", fanOut: { parentEnrollmentId: "9c8b7a6d-0000-0000-0000-000000000000", parentStatus: "waiting", joinsConsolidation: true } })
    renderTab([enrollment()])
    let dialog = await openRetryDialog()

    expect(await within(dialog).findByTestId("retry-starts-at")).toHaveTextContent("Recomeça logo depois do envio para vários colaboradores (“Selecionar colaboradores”), só para o colaborador desta execução")
    let fanOut = within(dialog).getByTestId("retry-fan-out")
    expect(fanOut).toHaveTextContent("a nova tentativa fica ligada à mesma execução principal (#9c8b7a6d)")
    expect(fanOut).toHaveTextContent("O resultado dela entra no resultado consolidado")

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())

    service.fetchWorkflowRetryPreview.mockResolvedValueOnce({ ...PREVIEW, startsAt: "AFTER_FAN_OUT", fanOut: { parentEnrollmentId: "9c8b7a6d-0000-0000-0000-000000000000", parentStatus: "completed", joinsConsolidation: false } })
    dialog = await openRetryDialog()
    fanOut = await within(dialog).findByTestId("retry-fan-out")
    expect(fanOut).toHaveTextContent("O resultado dela não entra no resultado consolidado: a execução principal não está aguardando em “Consolidar resultados” (situação: Concluído).")
  })

  it("detalhe da tentativa: versão confirmada × usada — diz explicitamente quando alguém publicou entre a confirmação e a chamada", async () => {
    renderTab([
      enrollment({
        id: "f0e1d2c3-0000-0000-0000-000000000009",
        status: "completed",
        versionNumber: 4,
        blockedAt: null,
        blockedNodeId: null,
        blockedReason: null,
        blockedDetails: null,
        events: [],
        retryOfEnrollmentId: "a1b2c3d4-0000-0000-0000-000000000001",
        retryRequestedByName: "Renata Souza",
        retryRequestedAt: "2026-11-03T13:00:00Z",
        retryAgents: [
          { nodeId: "agent", agentId: "ag-3", nodeLabel: "Analisar chamada", agentName: "Especialista de Planos 3", agentVersionId: "agv-7", agentVersionNumber: 7, active: true },
          { nodeId: "agent-2", agentId: "ag-4", nodeLabel: "Resumir", agentName: "Resumidor", agentVersionId: "agv-2", agentVersionNumber: 2, active: true },
        ],
        agentRuns: [
          { nodeId: "agent", agentRunId: "run-8", agentId: "ag-3", agentName: "Especialista de Planos 3", agentActive: true, agentVersionNumber: 8, status: "COMPLETED" },
          { nodeId: "agent-2", agentRunId: "run-9", agentId: "ag-4", agentName: "Resumidor", agentActive: true, agentVersionNumber: 2, status: "COMPLETED" },
        ],
      }),
    ])
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar eventos da execução" }))
    const links = await screen.findByTestId("execution-links")
    expect(within(links).getByTestId("execution-retry-agents")).toHaveTextContent("Confirmada com: Analisar chamada: Especialista de Planos 3 (versão 7) · Resumir: Resumidor (versão 2)")
    const runs = within(links).getByTestId("execution-agent-runs")
    expect(runs).toHaveTextContent("Especialista de Planos 3 · versão 8 · etapa “Analisar chamada”")
    const differences = within(runs).getAllByTestId("agent-version-difference")
    // Só o agente cuja versão mudou entre a confirmação e a chamada.
    expect(differences).toHaveLength(1)
    expect(differences[0]).toHaveTextContent("Confirmada com a versão 7; executada na versão 8, publicada depois da confirmação.")
  })
})

describe("Aba Execuções — linguagem de tela e decisão de revisão", () => {
  const REVIEW_GRAPH = {
    nodes: [...GRAPH.nodes, { id: "review", type: "human_review", label: "Revisão do supervisor", position: { x: 0, y: 0 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } }],
    edges: [],
  } as unknown as FlowGraph

  function renderList(items: WorkflowEnrollment[], graph: FlowGraph = REVIEW_GRAPH, workflow?: { published: boolean; active: boolean }) {
    service.fetchWorkflowEnrollmentsPage.mockResolvedValue({ items, total: items.length, page: 1, pageSize: 12 })
    window.localStorage.clear()
    return renderWithQuery(<WorkflowEnrollmentsTab workflowId="wf-1" graph={graph} workflow={workflow} />)
  }

  const running = (patch: Record<string, unknown>) => enrollment({ blockedAt: null, blockedNodeId: null, blockedReason: null, blockedDetails: null, ...patch })

  it("WF-16: mostra o nome da etapa e o evento em português; nunca o id nem o nome técnico do evento", async () => {
    const { container } = renderList([
      running({
        status: "active",
        currentNodeId: "agent",
        events: [
          { nodeId: "trigger", eventType: "node_advanced", payload: {}, createdAt: "2026-11-03T11:00:00Z" },
          { nodeId: "agent", eventType: "action_executed", payload: {}, createdAt: "2026-11-03T11:01:00Z" },
          { nodeId: "removida-na-versao-nova", eventType: "evento_desconhecido", payload: {}, createdAt: "2026-11-03T11:02:00Z" },
        ],
      }),
    ])
    expect(await screen.findByText("Analisar chamada")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Mostrar eventos da execução" }))
    expect(await screen.findByText("· Etapa concluída")).toBeInTheDocument()
    expect(screen.getByText("· Ação executada")).toBeInTheDocument()
    expect(screen.getByText("Etapa de outra versão do fluxo")).toBeInTheDocument()
    for (const technical of ["node_advanced", "action_executed", "evento_desconhecido", "removida-na-versao-nova"]) expect(container.textContent).not.toContain(technical)
  })

  it("WF-16: execução terminada não tem próxima etapa e a falha definitiva é dita com clareza", async () => {
    renderList([running({ status: "dead", currentNodeId: "agent", events: [] })])
    expect(await screen.findByText("Encerrada com falha")).toBeInTheDocument()
    expect(screen.getByRole("row", { name: /Encerrada com falha/ })).toHaveTextContent("—")
    expect(screen.queryByText("Desistiu")).not.toBeInTheDocument()
  })

  it("WF-16: não oferece busca que só encontraria o id técnico", async () => {
    renderList([])
    await waitFor(() => expect(service.fetchWorkflowEnrollmentsPage).toHaveBeenCalled())
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument()
  })

  it.each([
    [{ published: false, active: true }, "Só depois de publicar"],
    [{ published: true, active: false }, "está desativado"],
    [{ published: true, active: true }, "assim que o gatilho disparar"],
  ])("WF-16: lista vazia orienta conforme o estado (%j)", async (workflow, expected) => {
    renderList([], REVIEW_GRAPH, workflow)
    expect(await screen.findByText(new RegExp(expected))).toBeInTheDocument()
    expect(screen.queryByText(/matriculou/)).not.toBeInTheDocument()
  })

  it("WF-13: decidir revisão nunca sai de um clique só; o diálogo diz o caminho que será seguido", async () => {
    service.submitHumanReviewDecision.mockResolvedValue(undefined)
    renderList([running({ status: "waiting", currentNodeId: "review", events: [] })])
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar" }))
    expect(service.submitHumanReviewDecision).not.toHaveBeenCalled()
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent('Aprovar a etapa "Revisão do supervisor"?')
    expect(dialog).toHaveTextContent('caminho "Aprovado"')
    expect(dialog).toHaveTextContent("não pode ser desfeita")
    fireEvent.click(within(dialog).getByRole("button", { name: "Voltar" }))
    expect(service.submitHumanReviewDecision).not.toHaveBeenCalled()

    fireEvent.click(await screen.findByRole("button", { name: "Reprovar" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reprovar" }))
    await waitFor(() => expect(service.submitHumanReviewDecision).toHaveBeenCalledWith("wf-1", expect.anything(), "review", "rejected"))
  })
})
