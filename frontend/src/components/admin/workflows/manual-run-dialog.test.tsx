/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { WorkflowDetail } from "@/schemas/admin/workflow.schema"
import type { ManualRun, ManualRunInfo } from "@/schemas/admin/workflow-manual-run.schema"

import { ManualRunDialog } from "./manual-run-dialog"

/** Gatilho Manual — "Executar agora": impedimentos, aviso de efeito real, seleção explícita e estado REAL da execução. */
const service = vi.hoisted(() => ({
  fetchManualRunInfo: vi.fn(),
  fetchManualRunCollaborators: vi.fn(),
  fetchManualRunInteractions: vi.fn(),
  fetchManualRunMeasurements: vi.fn(),
  requestManualRun: vi.fn(),
  fetchManualRun: vi.fn(),
}))
vi.mock("@/services/admin/workflow-service", () => service)

const WORKFLOW = {
  id: "wf-1",
  name: "Demo · Feedback no Avatar",
  description: null,
  scopeType: "ALL_TEAMS",
  teamId: null,
  teamName: null,
  subteamId: null,
  subteamName: null,
  active: true,
  createdAt: "2026-09-30T10:00:00Z",
  published: true,
  trigger: { kind: "manual", context: "INTERACTION" },
  activeEnrollments: 0,
  blockedEnrollments: 0,
  draftGraph: { nodes: [], edges: [] },
  publishedGraph: { nodes: [{ id: "out", type: "output", label: "Avatar", position: { x: 0, y: 0 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["AVATAR"], source: "nodeOutputs.gen" } }], edges: [] },
} as unknown as WorkflowDetail

const INFO: ManualRunInfo = { workflowId: "wf-1", workflowName: WORKFLOW.name, context: "INTERACTION", indicator: null, published: true, active: true, blockers: [], recentRuns: [] }

const run = (stage: ManualRun["execution"]["stage"], deliveries: ManualRun["deliveries"] = []): ManualRun => ({
  id: "run-1",
  workflowId: "wf-1",
  workflowName: WORKFLOW.name,
  versionId: "v-1",
  versionNumber: 2,
  requestedAt: "2026-09-30T10:05:00Z",
  requestedBy: { id: "admin", name: "Admin Demo" },
  context: "INTERACTION",
  collaborator: { id: "op-1", name: "Larissa Monteiro", matricula: "DEMO-OP-0001" },
  interaction: { id: "call-1", subject: "Contestação de conta", startedAt: "2026-09-29T13:00:00Z" },
  measurement: null,
  execution: { enrollmentId: "enr-1", status: stage === "COMPLETED" ? "completed" : "active", stage, blockedReason: null, blockedCause: null, currentNodeId: "agent", currentNodeLabel: "Monitoria", waitingFor: null, lastError: null, nextRetryAt: null, updatedAt: "2026-09-30T10:05:00Z", events: [] },
  deliveries,
  interventions: [],
})

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderDialog() {
  return renderWithQuery(<ManualRunDialog workflow={WORKFLOW} open onOpenChange={() => undefined} onShowExecutions={() => undefined} onShowResults={() => undefined} />)
}

describe("ManualRunDialog", () => {
  it("mostra os impedimentos do backend e não deixa executar", async () => {
    service.fetchManualRunInfo.mockResolvedValue({ ...INFO, published: false, blockers: [{ code: "WORKFLOW_MANUAL_RUN_NOT_PUBLISHED", message: "O workflow ainda não foi publicado. Publique o rascunho antes de executar." }] })
    renderDialog()
    expect(await screen.findByTestId("manual-run-blockers")).toHaveTextContent("ainda não foi publicado")
    expect(screen.getByRole("button", { name: /Executar agora/ })).toBeDisabled()
    expect(service.fetchManualRunCollaborators).not.toHaveBeenCalled()
  })

  it("exige colaborador E interação; avisa que é execução real; envia a chave de idempotência; mostra o estado REAL (iniciada ≠ entregue)", async () => {
    service.fetchManualRunInfo.mockResolvedValue(INFO)
    service.fetchManualRunCollaborators.mockResolvedValue({ items: [{ id: "op-1", name: "Larissa Monteiro", matricula: "DEMO-OP-0001", jobTitle: "Operadora", teamName: "B2C", subteamName: null }], total: 1 })
    service.fetchManualRunInteractions.mockResolvedValue([{ id: "call-1", externalId: "CALL-1", subject: "Contestação de conta", channel: "VOICE", startedAt: "2026-09-29T13:00:00Z", endedAt: "2026-09-29T13:09:00Z", durationSeconds: 540, flags: [] }])
    service.requestManualRun.mockResolvedValue({ created: true, run: run("QUEUED") })
    service.fetchManualRun.mockResolvedValueOnce(run("QUEUED")).mockResolvedValue(run("COMPLETED", [{ surface: "AVATAR", status: "PENDING", recipientName: "Larissa Monteiro", createdAt: "2026-09-30T10:06:00Z", deliveredAt: null, title: "Recado da INIA" }]))
    renderDialog()

    expect(await screen.findByTestId("manual-run-real-effects")).toHaveTextContent("Execução real neste ambiente")
    expect(screen.getByTestId("manual-run-real-effects")).toHaveTextContent("Avatar")
    const runButton = screen.getByRole("button", { name: /Executar agora/ })
    expect(runButton).toBeDisabled()

    fireEvent.click(await screen.findByRole("option", { name: /Larissa Monteiro/ }))
    expect(runButton).toBeDisabled() // falta a interação
    fireEvent.click(await screen.findByRole("option", { name: /Contestação de conta/ }))
    expect(screen.getByTestId("manual-run-summary")).toHaveTextContent("será executado para Larissa Monteiro")
    expect(runButton).toBeEnabled()

    fireEvent.click(runButton)
    await waitFor(() => expect(service.requestManualRun).toHaveBeenCalledTimes(1))
    const [, body] = service.requestManualRun.mock.calls[0]!
    expect(body).toMatchObject({ collaboratorId: "op-1", interactionId: "call-1", indicatorMeasurementId: null })
    expect(typeof body.idempotencyKey).toBe("string")

    expect(await screen.findByText("Execução iniciada — na fila do motor")).toBeInTheDocument()
    expect(screen.getByText(/Nada entregue ainda/)).toBeInTheDocument()
    expect(await screen.findByText("Concluída", {}, { timeout: 4000 })).toBeInTheDocument()
    expect(screen.getByText(/recado disponível para Larissa Monteiro/)).toBeInTheDocument()
    expect(screen.getByText(/só conta como entregue depois que Larissa Monteiro aceitar/)).toBeInTheDocument()
  })

  it("revisão sem revisor: mostra o motivo real, sem falar em agente (P5c)", async () => {
    service.fetchManualRunInfo.mockResolvedValue(INFO)
    service.fetchManualRunCollaborators.mockResolvedValue({ items: [{ id: "op-1", name: "Larissa Monteiro", matricula: "DEMO-OP-0001", jobTitle: "Operadora", teamName: "B2C", subteamName: null }], total: 1 })
    service.fetchManualRunInteractions.mockResolvedValue([{ id: "call-1", externalId: "CALL-1", subject: "Contestação de conta", channel: "VOICE", startedAt: "2026-09-29T13:00:00Z", endedAt: "2026-09-29T13:09:00Z", durationSeconds: 540, flags: [] }])
    const blocked = run("BLOCKED")
    service.requestManualRun.mockResolvedValue({ created: true, run: blocked })
    service.fetchManualRun.mockResolvedValue({ ...blocked, execution: { ...blocked.execution, status: "blocked", blockedReason: "HUMAN_REVIEW_NO_REVIEWER", blockedCause: "NO_ONE_IN_CHAIN" } })
    renderDialog()

    fireEvent.click(await screen.findByRole("option", { name: /Larissa Monteiro/ }))
    fireEvent.click(await screen.findByRole("option", { name: /Contestação de conta/ }))
    fireEvent.click(screen.getByRole("button", { name: /Executar agora/ }))

    const blockedText = await screen.findByTestId("manual-run-blocked")
    await waitFor(() => expect(blockedText).toHaveTextContent("não tem o cargo pedido na hierarquia"))
    expect(blockedText).toHaveTextContent("Ajuste a hierarquia ou o revisor da etapa")
    expect(blockedText).not.toHaveTextContent(/agente/i)
  })

  it("etapa do agente bloqueada (inativo ou acesso não autorizado): aparece Bloqueada, com a orientação, sem 'processando' para sempre (PEN-070/073)", async () => {
    service.fetchManualRunInfo.mockResolvedValue(INFO)
    service.fetchManualRunCollaborators.mockResolvedValue({ items: [{ id: "op-1", name: "Larissa Monteiro", matricula: "DEMO-OP-0001", jobTitle: "Operadora", teamName: "B2C", subteamName: null }], total: 1 })
    service.fetchManualRunInteractions.mockResolvedValue([{ id: "call-1", externalId: "CALL-1", subject: "Contestação de conta", channel: "VOICE", startedAt: "2026-09-29T13:00:00Z", endedAt: "2026-09-29T13:09:00Z", durationSeconds: 540, flags: [] }])
    const blocked = run("BLOCKED")
    service.requestManualRun.mockResolvedValue({ created: true, run: blocked })
    service.fetchManualRun.mockResolvedValue({ ...blocked, execution: { ...blocked.execution, status: "blocked", blockedReason: "AGENT_ACCESS_NOT_AUTHORIZED" } })
    renderDialog()

    fireEvent.click(await screen.findByRole("option", { name: /Larissa Monteiro/ }))
    fireEvent.click(await screen.findByRole("option", { name: /Contestação de conta/ }))
    fireEvent.click(screen.getByRole("button", { name: /Executar agora/ }))

    // O motivo vem da execução: acesso não autorizado, com a orientação de ajustar o agente (sem nada do que é restrito).
    expect(await screen.findByText("Bloqueada")).toBeInTheDocument()
    expect(await screen.findByText(/a versão vigente dele não está autorizada para este Workflow/)).toBeInTheDocument()
    expect(screen.getByTestId("manual-run-blocked")).toHaveTextContent("Ajuste o agente (alcance ou bases da versão vigente) ou substitua-o e solicite uma nova tentativa.")
    expect(screen.getByTestId("manual-run-blocked")).not.toHaveTextContent("inativo")
    expect(screen.getByText(/Nada foi entregue — a execução parou antes da entrega\./)).toBeInTheDocument()
    // Estado terminal: o polling para (sem nova busca depois da primeira).
    const calls = service.fetchManualRun.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 2300))
    expect(service.fetchManualRun.mock.calls.length).toBe(calls)
  })
})
