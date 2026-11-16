/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { TransferCandidates } from "@/schemas/human-support/monitoring.schema"

import { TransferDialog } from "./transfer-dialog"

const service = vi.hoisted(() => ({ fetchTransferCandidates: vi.fn(), transferSupportAttendance: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

const CANDIDATES: TransferCandidates = {
  currentAnjoName: "Ana Souza",
  candidates: [
    { personId: "11111111-1111-4111-8111-111111111111", name: "Bruno Lima", status: "AVAILABLE", connected: true, used: 0, capacity: 2, canReceive: true, reason: null },
    { personId: "22222222-2222-4222-8222-222222222222", name: "Carla Dias", status: "PAUSED", connected: true, used: 0, capacity: 2, canReceive: false, reason: "Em pausa" },
    { personId: "33333333-3333-4333-8333-333333333333", name: "Ana Souza", status: "AVAILABLE", connected: true, used: 1, capacity: 2, canReceive: false, reason: "Atende este pedido agora" },
  ],
}

beforeAll(() => installJsdomStubs())
beforeEach(() => {
  vi.clearAllMocks()
  service.fetchTransferCandidates.mockResolvedValue(CANDIDATES)
})
afterEach(() => cleanup())

async function open() {
  renderWithQuery(<TransferDialog requestId="req-1" protocol="AP-7" />)
  fireEvent.click(screen.getByRole("button", { name: /Transferir atendimento/ }))
  await screen.findByText("Bruno Lima")
}

describe("Transferir atendimento", () => {
  it("lista os Anjos, desabilita quem não pode receber e já marca o primeiro que pode", async () => {
    await open()
    expect(screen.getByText(/Hoje com Ana Souza/)).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /Bruno Lima/ })).toBeChecked()
    expect(screen.getByRole("radio", { name: /Carla Dias/ })).toBeDisabled()
    expect(screen.getByText("Em pausa")).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /Ana Souza/ })).toBeDisabled()
    expect(screen.getByRole("radio", { name: /Devolver à frente da fila/ })).toBeEnabled()
  })

  it("exige motivo e envia com o Anjo escolhido", async () => {
    service.transferSupportAttendance.mockResolvedValue({})
    await open()
    const submit = screen.getByRole("button", { name: "Transferir" })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo da transferência"), { target: { value: "  " } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo da transferência"), { target: { value: " Saiu para reunião " } })
    fireEvent.click(submit)
    await waitFor(() => expect(service.transferSupportAttendance).toHaveBeenCalledWith("req-1", { toAnjoPersonId: CANDIDATES.candidates[0]!.personId, reason: "Saiu para reunião" }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Atendimento AP-7 transferido para Bruno Lima."))
  })

  it("sem ninguém que possa receber, sugere a fila e envia sem Anjo", async () => {
    service.fetchTransferCandidates.mockResolvedValue({ ...CANDIDATES, candidates: CANDIDATES.candidates.slice(1) })
    service.transferSupportAttendance.mockResolvedValue({})
    renderWithQuery(<TransferDialog requestId="req-1" protocol="AP-7" />)
    fireEvent.click(screen.getByRole("button", { name: /Transferir atendimento/ }))
    await screen.findByText(/Nenhum Anjo deste Grupo\/Subgrupo pode receber agora/)
    expect(screen.getByRole("radio", { name: /Devolver à frente da fila/ })).toBeChecked()
    fireEvent.change(screen.getByLabelText("Motivo da transferência"), { target: { value: "Fim do turno" } })
    fireEvent.click(screen.getByRole("button", { name: "Devolver à fila" }))
    await waitFor(() => expect(service.transferSupportAttendance).toHaveBeenCalledWith("req-1", { toAnjoPersonId: null, reason: "Fim do turno" }))
  })

  it("mostra a recusa do servidor sem fechar", async () => {
    service.transferSupportAttendance.mockRejectedValueOnce(new ApiError("Este Anjo não pode receber agora: sem vaga.", 409, "HUMAN_SUPPORT_TRANSFER_TARGET_UNAVAILABLE"))
    await open()
    fireEvent.change(screen.getByLabelText("Motivo da transferência"), { target: { value: "Saiu" } })
    fireEvent.click(screen.getByRole("button", { name: "Transferir" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("sem vaga")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})
