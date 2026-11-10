/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import { SupportRequestDialog } from "./request-dialog"

const service = vi.hoisted(() => ({ previewSupportRequest: vi.fn(), createSupportRequest: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  service.previewSupportRequest.mockReset()
  service.createSupportRequest.mockReset()
})

const shared = { question: "Qual o prazo da contestação?", answer: "Até **5 dias** úteis.", dislike: { reason: "WRONG_INFORMATION" as const, reasonLabel: "Informação errada", comment: "O prazo mudou." }, note: null }
const preview = (status: string, extra: Record<string, unknown> = {}) => ({ origin: "DISLIKE", interactionId: "a-1", ratingId: "r-1", sharedContext: shared, availability: { status, estimate: null, queueDeadline: null, ...extra } })

describe("janela de pedido de apoio", () => {
  it("mostra exatamente o que o Anjo verá e, sem Anjo em serviço, desabilita “Pedir ajuda”", async () => {
    service.previewSupportRequest.mockResolvedValue(preview("NONE_IN_SERVICE"))
    renderWithQuery(<SupportRequestDialog source={{ interactionId: "a-1", ratingId: "r-1" }} onOpenChange={vi.fn()} onCreated={vi.fn()} onOpenRoom={vi.fn()} />)
    expect(await screen.findByText("Nenhum Anjo em serviço agora.")).toBeInTheDocument()
    expect(screen.getByText("O Anjo verá: sua pergunta, a resposta da INIA, o motivo, seu comentário e o que você escrever.")).toBeInTheDocument()
    expect(screen.getByText("Qual o prazo da contestação?")).toBeInTheDocument()
    expect(screen.getByText("O prazo mudou.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Pedir ajuda" })).toBeDisabled()
    expect(service.previewSupportRequest).toHaveBeenCalledWith({ interactionId: "a-1", ratingId: "r-1" })
  })

  it("todos ocupados: espera estimada e prazo da fila; pedir envia a nota com a chave de idempotência", async () => {
    service.previewSupportRequest.mockResolvedValue(preview("ALL_BUSY", { estimate: { kind: "ABOUT", minutes: 4, basis: "SUBGROUP" }, queueDeadline: "2026-11-09T17:35:00.000Z" }))
    const created = { id: "req-1" }
    service.createSupportRequest.mockResolvedValue(created)
    const onCreated = vi.fn()
    renderWithQuery(<SupportRequestDialog source={{ interactionId: "a-1", ratingId: "r-1" }} onOpenChange={vi.fn()} onCreated={onCreated} onOpenRoom={vi.fn()} />)
    expect(await screen.findByText("Todos os Anjos estão em atendimento.")).toBeInTheDocument()
    expect(screen.getByText(/Espera estimada: cerca de 4 min/)).toBeInTheDocument()
    expect(screen.getByText(/Seu pedido fica na fila até/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Nota para o Anjo (opcional)"), { target: { value: "  É sobre a fatura.  " } })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pedir ajuda" }))
    })
    expect(service.createSupportRequest).toHaveBeenCalledWith({ clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/), interactionId: "a-1", ratingId: "r-1", note: "É sobre a fatura." })
    expect(onCreated).toHaveBeenCalledWith(created)
  })

  it("pedido já aberto: mostra o aviso e o caminho para o pedido", async () => {
    service.previewSupportRequest.mockResolvedValue(preview("AVAILABLE_NOW"))
    service.createSupportRequest.mockRejectedValue(new ApiError("Você já tem um pedido de apoio aberto.", 409, "HUMAN_SUPPORT_REQUEST_ALREADY_OPEN"))
    const onOpenRoom = vi.fn()
    renderWithQuery(<SupportRequestDialog source={{}} onOpenChange={vi.fn()} onCreated={vi.fn()} onOpenRoom={onOpenRoom} />)
    await waitFor(() => expect(screen.getByRole("button", { name: "Pedir ajuda" })).toBeEnabled())
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Pedir ajuda" }))
    })
    expect(screen.getByRole("alert")).toHaveTextContent("Você já tem um pedido de apoio aberto.")
    fireEvent.click(screen.getByRole("button", { name: "Ver meu pedido de apoio" }))
    expect(onOpenRoom).toHaveBeenCalled()
  })
})
