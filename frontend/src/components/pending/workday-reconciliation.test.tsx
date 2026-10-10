/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { PendingActionsSummary, WorkdayReconciliationDetail } from "@/schemas/pending-actions/pending-actions.schema"

import { PendingActionsView } from "./pending-actions-view"

const service = vi.hoisted(() => ({ fetchPendingActions: vi.fn(), fetchHumanReviewDetail: vi.fn(), decideHumanReview: vi.fn(), fetchWorkdayReconciliationDetail: vi.fn(), resolveWorkdayReconciliation: vi.fn() }))
vi.mock("@/services/pending-actions/pending-actions-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const WORKDAY_ITEM: PendingActionsSummary["pending"][number] = {
  id: "workday:rec-1",
  kind: "WORKDAY_RECONCILIATION",
  status: "PENDING",
  reconciliationId: "rec-1",
  operator: { personId: "op-9", name: "Joana Esteves", teamName: "B2C · Atendimento Geral", jobTitle: "Operadora" },
  workday: "2026-09-14",
  reason: "Não foi identificada produção para Joana Esteves em 14/09.",
  plan: "Trabalha — escala informada pela fonte · turno até 14:20",
  requestedAt: "2026-09-14T17:30:00.000Z",
  resolution: null,
  resolutionLabel: null,
  decidedAt: null,
  reviewer: null,
  classification: null,
  availability: { state: "READY", label: "Dados fechados" },
}
const LIST: PendingActionsSummary = { pending: [WORKDAY_ITEM], history: [], pendingCount: 1 }
const DETAIL: WorkdayReconciliationDetail = {
  ...WORKDAY_ITEM,
  evidenceSources: { interactions: true, indicatorCodes: ["TMA"] },
  shiftEnd: "14:20:00",
  justifiedReasons: [
    { code: "ATESTADO", label: "Atestado" },
    { code: "DAY_OFF", label: "Day off" },
    { code: "BANCO_HORAS", label: "Banco de horas" },
    { code: "FOLGA_EXTRAORDINARIA", label: "Folga extraordinária" },
    { code: "OTHER_JUSTIFIED", label: "Outro motivo justificado" },
  ],
  provisionableCodes: [
    { code: "DAY_OFF", label: "Day off" },
    { code: "BANCO_HORAS", label: "Banco de horas" },
    { code: "ATESTADO", label: "Atestado" },
    { code: "FOLGA_EXTRAORDINARIA", label: "Folga extraordinária" },
  ],
  resolutionException: null,
}

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Pendências — produção não identificada (PLANEJADO × OBSERVADO)", () => {
  it("lista a pendência de produção com dia e plano, abre o detalhe pela URL e classifica como 'Ausência justificada' com motivo (classificação auditável, sem exceção)", async () => {
    service.fetchPendingActions.mockResolvedValue(LIST)
    service.fetchWorkdayReconciliationDetail.mockResolvedValue(DETAIL)
    service.resolveWorkdayReconciliation.mockResolvedValue({ ...DETAIL, status: "DECIDED", resolution: "JUSTIFIED_ABSENCE", resolutionLabel: "Ausência justificada", decidedAt: "2026-09-16T10:00:00.000Z", reviewer: { personId: "sup-1", name: "Vanessa" }, classification: { id: "cls-1", classification: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO", label: "Ausência justificada · Atestado", supersededReason: null, supersededReasonLabel: null } })
    const onStateChange = vi.fn()
    const { rerender } = renderWithQuery(<PendingActionsView state={{ review: null, operator: null }} onStateChange={onStateChange} />)
    const row = await screen.findByTestId("pending-workday-row")
    expect(row.textContent).toContain("Joana Esteves")
    expect(row.textContent).toContain("Produção não identificada · 14/09/2026")
    fireEvent.click(row)
    expect(onStateChange).toHaveBeenCalledWith({ review: "workday:rec-1" })

    rerender(<PendingActionsView state={{ review: "workday:rec-1", operator: null }} onStateChange={onStateChange} />)
    const sheet = await screen.findByTestId("workday-reconciliation-sheet")
    expect(await screen.findByTestId("workday-plan")).toHaveTextContent("Trabalha — escala informada pela fonte · turno até 14:20")
    expect(sheet.textContent).toContain("interações registradas e indicador(es) TMA")
    // Confirmar só habilita depois de escolher o que aconteceu.
    expect(screen.getByTestId("workday-resolve")).toBeDisabled()
    expect(screen.getByTestId("workday-availability")).toHaveTextContent("Dados fechados")
    fireEvent.click(screen.getByLabelText(/Ausência justificada/))
    expect(await screen.findByTestId("workday-reason-options")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Atestado"))
    expect(sheet.textContent).toContain("não guarda diagnóstico, CID")
    fireEvent.click(screen.getByTestId("workday-resolve"))
    await waitFor(() => expect(service.resolveWorkdayReconciliation).toHaveBeenCalledWith("rec-1", { resolution: "JUSTIFIED_ABSENCE", reasonCode: "ATESTADO" }))
    expect(await screen.findByTestId("workday-resolved")).toHaveTextContent("Ausência justificada · Atestado")
    expect(screen.queryByTestId("workday-resolve")).not.toBeInTheDocument()
  })

  it("'Falta injustificada' é classificação (dia continua esperado) e o detalhe resolvido explica que nenhuma medição foi criada", async () => {
    service.fetchPendingActions.mockResolvedValue(LIST)
    service.fetchWorkdayReconciliationDetail.mockResolvedValue(DETAIL)
    service.resolveWorkdayReconciliation.mockResolvedValue({ ...DETAIL, status: "DECIDED", resolution: "UNJUSTIFIED_ABSENCE", resolutionLabel: "Falta injustificada", decidedAt: "2026-09-16T10:00:00.000Z", reviewer: { personId: "sup-1", name: "Vanessa" }, classification: { id: "cls-2", classification: "UNJUSTIFIED_ABSENCE", reasonCode: null, label: "Falta injustificada", supersededReason: null, supersededReasonLabel: null } })
    renderWithQuery(<PendingActionsView state={{ review: "workday:rec-1", operator: null }} onStateChange={vi.fn()} />)
    await screen.findByTestId("workday-plan")
    fireEvent.click(screen.getByLabelText(/Falta injustificada/))
    expect(screen.queryByTestId("workday-reason-options")).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId("workday-resolve"))
    await waitFor(() => expect(service.resolveWorkdayReconciliation).toHaveBeenCalledWith("rec-1", { resolution: "UNJUSTIFIED_ABSENCE" }))
    expect(await screen.findByTestId("workday-resolved")).toHaveTextContent("Nenhuma medição foi criada")
  })

  it("'Trabalhou — dados não chegaram' envia a resolução sem motivo e o detalhe diz que nenhum indicador foi criado; resolvida automaticamente mostra 'pela INIA'", async () => {
    service.fetchPendingActions.mockResolvedValue(LIST)
    service.fetchWorkdayReconciliationDetail.mockResolvedValue(DETAIL)
    service.resolveWorkdayReconciliation.mockResolvedValue({ ...DETAIL, status: "DECIDED", resolution: "WORKED_DATA_MISSING", resolutionLabel: "Trabalhou — dados não chegaram", decidedAt: "2026-09-16T10:00:00.000Z", reviewer: { personId: "sup-1", name: "Vanessa" } })
    renderWithQuery(<PendingActionsView state={{ review: "workday:rec-1", operator: null }} onStateChange={vi.fn()} />)
    await screen.findByTestId("workday-plan")
    fireEvent.click(screen.getByLabelText(/Trabalhou — dados não chegaram/))
    fireEvent.click(screen.getByTestId("workday-resolve"))
    await waitFor(() => expect(service.resolveWorkdayReconciliation).toHaveBeenCalledWith("rec-1", { resolution: "WORKED_DATA_MISSING" }))
    expect(await screen.findByText(/por Vanessa/)).toBeInTheDocument()
    expect(screen.getByTestId("workday-resolved")).toHaveTextContent("Nenhum indicador foi criado pela INIA")
    cleanup()
    service.fetchWorkdayReconciliationDetail.mockResolvedValue({ ...DETAIL, status: "DECIDED", resolution: "PRODUCTION_RECEIVED_AFTER_ALERT", resolutionLabel: "Produção recebida após o alerta", decidedAt: "2026-09-16T20:00:00.000Z" })
    renderWithQuery(<PendingActionsView state={{ review: "workday:rec-1", operator: null }} onStateChange={vi.fn()} />)
    expect(await screen.findByText(/automaticamente pela INIA/)).toBeInTheDocument()
  })
})
