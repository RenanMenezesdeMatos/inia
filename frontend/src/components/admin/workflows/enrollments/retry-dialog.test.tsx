/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

import { WorkflowRetryDialog } from "./retry-dialog"

const service = vi.hoisted(() => ({ fetchWorkflowRetryPreview: vi.fn(), confirmWorkflowRetry: vi.fn() }))
vi.mock("@/services/admin/workflow-service", () => service)

/** WF-42: o motivo de não poder confirmar fica junto da ação; só os detalhes rolam. */
const preview = (blockers: { code: string; message: string }[]) => ({
  enrollmentId: "e1", workflowId: "wf", workflowName: "Fluxo", workflowActive: true, blockers,
  workflowVersion: { id: "v1", number: 1 }, originalVersion: { id: "v1", number: 1 },
  blockedNode: { id: "revisao", label: "Revisão", agentName: null, cause: "NO_ONE_IN_CHAIN" },
  agents: [], orchestrators: [], destinations: [], approvals: [], startsAt: "BLOCKED_STEP", fanOut: null, fingerprint: "f1",
})
const open = () => renderWithQuery(<WorkflowRetryDialog workflowId="wf" enrollmentId="e1" blockedReason="HUMAN_REVIEW_NO_REVIEWER" open onOpenChange={vi.fn()} />)
const confirmButton = () => screen.getByRole("button", { name: "Confirmar nova tentativa" })

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WF-42 · diálogo de nova tentativa", () => {
  it("com impedimento: fora da área rolável, junto da ação, e descreve o botão, que não confirma", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValue(preview([{ code: "WORKFLOW_RETRY_REVIEWER_MISSING", message: "Sem revisor." }]))
    open()
    const blockers = await screen.findByTestId("retry-blockers")
    const details = screen.getByRole("region", { name: "Detalhes da nova tentativa" })
    expect(within(details).queryByTestId("retry-blockers")).toBeNull()
    expect(details).toHaveAttribute("tabindex", "0")
    const status = screen.getByTestId("retry-action-status")
    expect(status).toContainElement(blockers)
    expect(status).toHaveAttribute("aria-live", "polite")
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true")
    expect(confirmButton()).toHaveAttribute("aria-describedby", status.id)
    fireEvent.click(confirmButton())
    expect(service.confirmWorkflowRetry).not.toHaveBeenCalled()
    expect(screen.getAllByText("Não é possível confirmar agora")).toHaveLength(1)
  })

  it("confirmação disponível: sem aviso, sem descrição, e confirma", async () => {
    service.fetchWorkflowRetryPreview.mockResolvedValue(preview([]))
    service.confirmWorkflowRetry.mockResolvedValue({ enrollmentId: "e2" })
    open()
    await screen.findByTestId("retry-details")
    expect(screen.getByTestId("retry-action-status")).toBeEmptyDOMElement()
    expect(confirmButton()).toHaveAttribute("aria-disabled", "false")
    expect(confirmButton()).not.toHaveAttribute("aria-describedby")
    fireEvent.click(confirmButton())
    await vi.waitFor(() => expect(service.confirmWorkflowRetry).toHaveBeenCalled())
  })

  it("carregando: a explicação fica junto do botão, sem área de detalhes", () => {
    service.fetchWorkflowRetryPreview.mockReturnValue(new Promise(() => {}))
    open()
    expect(screen.getByTestId("retry-action-status")).toHaveTextContent("Conferindo a versão")
    expect(screen.queryByTestId("retry-details")).toBeNull()
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true")
  })

  it("erro ao carregar: a mensagem fica junto do botão, e Cancelar continua disponível", async () => {
    service.fetchWorkflowRetryPreview.mockRejectedValue(new Error("falhou"))
    open()
    expect(await screen.findByText("Não foi possível carregar o que a nova tentativa usará.", {}, { timeout: 5000 })).toBeInTheDocument()
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeEnabled()
  })
})
