/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { HumanReviewDetail, PendingActionsSummary } from "@/schemas/pending-actions/pending-actions.schema"

import { PendingActionsView } from "./pending-actions-view"

const service = vi.hoisted(() => ({ fetchPendingActions: vi.fn(), fetchHumanReviewDetail: vi.fn(), decideHumanReview: vi.fn() }))
vi.mock("@/services/pending-actions/pending-actions-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PENDING_ITEM: PendingActionsSummary["pending"][number] = {
  id: "enr-1:review",
  kind: "HUMAN_REVIEW",
  status: "PENDING",
  enrollmentId: "enr-1",
  nodeId: "review",
  workflowName: "Qualidade recorrente",
  nodeLabel: "Revisão do supervisor",
  operator: { personId: "op-1", name: "Karoline", teamName: "Atendimento", jobTitle: "Operadora" },
  reason: "Avalie a recorrência.",
  requestedAt: "2026-09-14T10:00:00.000Z",
  caseId: "case-1",
  decision: null,
  decidedAt: null,
  reviewer: null,
}
const OTHER_ITEM = { ...PENDING_ITEM, id: "enr-2:review", enrollmentId: "enr-2", operator: { personId: "op-2", name: "Samuel", teamName: "Contas", jobTitle: null } }
const LIST: PendingActionsSummary = { pending: [PENDING_ITEM, OTHER_ITEM], history: [], pendingCount: 2 }
const DETAIL: HumanReviewDetail = {
  ...PENDING_ITEM,
  instruction: "Avalie a recorrência.",
  content: "### Diagnóstico\n\n**Qualidade** abaixo da meta.",
  allowedDecisions: ["approved", "rejected"],
  caseTitle: "Qualidade abaixo da meta",
  caseSummary: "Duas monitorias abaixo de 80.",
  evidences: [{ id: "ev-1", type: "INDICATOR", title: "Monitoria 72", description: "Nota 72 em 12/09", occurredAt: "2026-09-12T10:00:00.000Z" }],
  previousOutputs: [{ nodeId: "orch", nodeLabel: "Diagnóstico", text: "texto" }],
  timeline: [{ eventType: "human_review_requested", nodeId: "review", createdAt: "2026-09-14T10:00:00.000Z" }],
}
const DECIDED: HumanReviewDetail = { ...DETAIL, status: "DECIDED", decision: "approved", decidedAt: "2026-09-15T12:00:00.000Z", reviewer: { personId: "sup-1", name: "Vanessa" } }

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Pendências — lista e detalhe", () => {
  it("lista o que aguarda decisão, filtra por colaborador (deep link da Equipe) e abre a revisão pela URL", async () => {
    service.fetchPendingActions.mockResolvedValue(LIST)
    const onStateChange = vi.fn()
    renderWithQuery(<PendingActionsView state={{ review: null, operator: "op-2" }} onStateChange={onStateChange} />)
    expect(await screen.findByText("Samuel")).toBeInTheDocument()
    expect(screen.queryByText("Karoline")).not.toBeInTheDocument()
    expect(screen.getAllByText("Aguardando sua decisão").length).toBeGreaterThan(0)
    // Um botão por revisão (o filtro "limpar" também cita o nome) — o item da fila vem primeiro.
    fireEvent.click(screen.getAllByRole("button", { name: /Samuel/ }).find((button) => button.textContent?.includes("Qualidade recorrente"))!)
    expect(onStateChange).toHaveBeenCalledWith({ review: "enr-2:review" })
  })

  it("detalhe mostra contexto (instrução, conteúdo formatado, evidências) e só as decisões previstas — Escalar não aparece", async () => {
    service.fetchPendingActions.mockResolvedValue(LIST)
    service.fetchHumanReviewDetail.mockResolvedValue(DETAIL)
    renderWithQuery(<PendingActionsView state={{ review: "enr-1:review", operator: null }} onStateChange={() => {}} />)
    await screen.findByText("Avalie a recorrência.")
    const dialog = screen.getByRole("dialog")
    expect(service.fetchHumanReviewDetail).toHaveBeenCalledWith("enr-1", "review")
    expect(dialog).toHaveTextContent("Avalie a recorrência.")
    expect(dialog).toHaveTextContent("Qualidade abaixo da meta")
    expect(dialog).toHaveTextContent("Monitoria 72")
    // Markdown do conteúdo renderizado, não asteriscos crus.
    expect(dialog.querySelector("strong")).toHaveTextContent("Qualidade")
    expect(dialog).not.toHaveTextContent("**Qualidade**")
    expect(screen.getByRole("button", { name: "Aprovar" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reprovar" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Escalar" })).not.toBeInTheDocument()
  })
})

describe("Pendências — decisão", () => {
  it("aprovar pede confirmação (AlertDialog do DS), envia a decisão real e mostra o estado decidido", async () => {
    service.fetchPendingActions.mockResolvedValueOnce(LIST).mockResolvedValue({ pending: [OTHER_ITEM], history: [{ ...PENDING_ITEM, status: "DECIDED", decision: "approved" }], pendingCount: 1 })
    service.fetchHumanReviewDetail.mockResolvedValue(DETAIL)
    service.decideHumanReview.mockResolvedValue(DECIDED)
    renderWithQuery(<PendingActionsView state={{ review: "enr-1:review", operator: null }} onStateChange={() => {}} />)
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar" }))
    expect(service.decideHumanReview).not.toHaveBeenCalled()
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Aprovar esta revisão?")
    fireEvent.click(screen.getByRole("button", { name: "Aprovar" , hidden: false }))
    await waitFor(() => expect(service.decideHumanReview).toHaveBeenCalledWith("enr-1", "review", "approved"))
    expect(await screen.findByText(/Aprovada por Vanessa/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Reprovar" })).not.toBeInTheDocument()
    // A fila é refeita (invalidação) e a revisão decidida some de "Aguardando sua decisão".
    await waitFor(() => expect(service.fetchPendingActions).toHaveBeenCalledTimes(2))
  })

  it("reprovar segue o mesmo fluxo com confirmação", async () => {
    service.fetchPendingActions.mockResolvedValue(LIST)
    service.fetchHumanReviewDetail.mockResolvedValue(DETAIL)
    service.decideHumanReview.mockResolvedValue({ ...DECIDED, decision: "rejected" })
    renderWithQuery(<PendingActionsView state={{ review: "enr-1:review", operator: null }} onStateChange={() => {}} />)
    fireEvent.click(await screen.findByRole("button", { name: "Reprovar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Reprovar esta revisão?")
    fireEvent.click(screen.getAllByRole("button", { name: "Reprovar" }).at(-1)!)
    await waitFor(() => expect(service.decideHumanReview).toHaveBeenCalledWith("enr-1", "review", "rejected"))
    expect(await screen.findByText(/Reprovada por Vanessa/)).toBeInTheDocument()
  })

  it("'Voltar' na confirmação não envia nada", async () => {
    service.fetchPendingActions.mockResolvedValue(LIST)
    service.fetchHumanReviewDetail.mockResolvedValue(DETAIL)
    renderWithQuery(<PendingActionsView state={{ review: "enr-1:review", operator: null }} onStateChange={() => {}} />)
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar" }))
    fireEvent.click(await screen.findByRole("button", { name: "Voltar" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(service.decideHumanReview).not.toHaveBeenCalled()
  })
})
