/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { HumanSupportStateValueProvider } from "@/queries/human-support/use-human-support-state"
import type { OperatorRequestView, OperatorView } from "@/schemas/human-support/state.schema"
import { supportPillText } from "./support-entry"
import { SupportRoom } from "./support-room"

const service = vi.hoisted(() => ({ signalSupportTyping: vi.fn(async () => undefined), acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })), cancelSupportRequest: vi.fn(), closeSupportRequestAsOperator: vi.fn(), fetchSupportMessages: vi.fn(async () => ({ messages: [], hasMore: false })), sendSupportMessage: vi.fn(), evaluateSupportAttendance: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  service.signalSupportTyping.mockClear()
})

const waiting: OperatorRequestView = {
  id: "req-1", protocol: "AP-7K2QX9", status: "WAITING", endCause: null, origin: "BUTTON", createdAt: "2026-11-09T17:00:00.000Z", queuedAt: "2026-11-09T17:00:00.000Z", queueExpiresAt: "2026-11-09T17:20:00.000Z",
  sharedContext: { question: null, answer: null, dislike: null, note: "Fatura" }, anjo: null,
  messages: [{ id: "m1", seq: 1, authorKind: "SYSTEM", authorName: null, body: "Pedido criado. Procurando um Anjo…", systemCode: "QUEUED", occurredAt: "2026-11-09T17:00:00.000Z" }],
  hasOlder: false, canCancel: true, canClose: false, peerReceipts: { deliveredSeq: 0, readSeq: 0 }, peerTypingMs: null,
}
const view = (operator: Partial<OperatorView>): OperatorView => ({ enabled: true, availability: { status: "NONE_AVAILABLE", estimate: { kind: "NO_HISTORY" }, queueDeadline: null }, openRequest: null, pendingEvaluations: [], ...operator })

describe("sala de apoio do operador", () => {
  it("na fila: estado sem nada de pausa de Anjo, prazo como horário, aviso de quem lê e cancelar com confirmação", async () => {
    const cancelled = { ...waiting, status: "CANCELLED" as const, endCause: "OPERATOR_CANCELLED", canCancel: false, messages: [...waiting.messages, { id: "m2", seq: 2, authorKind: "SYSTEM" as const, authorName: null, body: "Você cancelou o pedido.", systemCode: "CANCELLED_BY_OPERATOR", occurredAt: "2026-11-09T17:05:00.000Z" }] }
    service.cancelSupportRequest.mockResolvedValue(cancelled)
    const refresh = vi.fn()
    render(<HumanSupportStateValueProvider value={{ operator: view({ openRequest: waiting }), refresh }}><SupportRoom onBack={vi.fn()} /></HumanSupportStateValueProvider>)
    expect(screen.getByText("Procurando um Anjo…")).toBeInTheDocument()
    expect(screen.getByText("Nenhum Anjo disponível no momento. Aguarde: seu pedido está na fila.")).toBeInTheDocument()
    expect(screen.getByText(/Seu pedido fica na fila até/)).toBeInTheDocument()
    expect(screen.getByText(/A INIA não lê esta conversa/)).toBeInTheDocument()
    expect(screen.getByText("O Anjo verá quando receber o pedido.")).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/pausa|Lanche|Reunião/i)
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pedido" }))
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Cancelar pedido" }).at(-1)!)
    })
    expect(service.cancelSupportRequest).toHaveBeenCalledWith("req-1")
    expect(refresh).toHaveBeenCalled()
  })

  it("Anjo recebeu e ainda não respondeu: mostra quem recebeu e que aguarda a primeira resposta", () => {
    const assigned: OperatorRequestView = { ...waiting, status: "IN_PROGRESS", queueExpiresAt: null, anjo: { name: "Ana", avatarUrl: null, awaitingFirstResponse: true }, canCancel: false, canClose: true }
    render(<HumanSupportStateValueProvider value={{ operator: view({ openRequest: assigned }) }}><SupportRoom onBack={vi.fn()} /></HumanSupportStateValueProvider>)
    expect(screen.getByText("Ana (Anjo) recebeu seu pedido. Aguardando a primeira resposta.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Encerrar atendimento" })).toBeInTheDocument()
  })

  it("quando o pedido termina: busca o fim da conversa e mostra a avaliação enquanto a janela está aberta", async () => {
    const assigned: OperatorRequestView = { ...waiting, status: "IN_PROGRESS", anjo: { name: "Ana", avatarUrl: null, awaitingFirstResponse: false }, canCancel: false, canClose: true }
    service.fetchSupportMessages.mockResolvedValue({ messages: [{ id: "m9", seq: 9, authorKind: "SYSTEM", authorName: null, body: "Atendimento encerrado pelo Anjo.", systemCode: "ENDED_BY_ANJO", occurredAt: "2026-11-09T17:30:00.000Z" }], hasMore: false } as never)
    const { rerender } = render(<HumanSupportStateValueProvider value={{ operator: view({ openRequest: assigned }) }}><SupportRoom onBack={vi.fn()} /></HumanSupportStateValueProvider>)
    const pending = { attendanceId: "att-1", requestId: "req-1", protocol: "AP-7K2QX9", anjoName: "Ana", openUntil: "2026-11-10T17:30:00.000Z", current: { resolved: null, stars: null } }
    await act(async () => {
      rerender(<HumanSupportStateValueProvider value={{ operator: view({ openRequest: null, pendingEvaluations: [pending] }) }}><SupportRoom onBack={vi.fn()} /></HumanSupportStateValueProvider>)
    })
    expect(await screen.findByText(/Atendimento encerrado pelo Anjo\./)).toBeInTheDocument()
    expect(screen.getByText("Atendimento encerrado")).toBeInTheDocument()
    expect(screen.getByText("Sua dúvida foi resolvida?")).toBeInTheDocument()
    expect(screen.getByText("Avalie o atendimento de Ana")).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Mensagem para o Anjo" })).not.toBeInTheDocument()
  })

  it("selo \"avalie\" só com avaliação ainda sem resposta; a já respondida continua alterável, mas não pede atenção", () => {
    const pending = (current: { resolved: "YES" | "PARTIAL" | "NO" | null; stars: number | null }) => ({ attendanceId: "att-1", requestId: "req-1", protocol: "AP-7K2QX9", anjoName: "Ana", openUntil: "2026-11-10T17:00:00.000Z", current })
    expect(supportPillText(view({ pendingEvaluations: [pending({ resolved: null, stars: null })] }))).toBe("Apoio · encerrado — avalie")
    expect(supportPillText(view({ pendingEvaluations: [pending({ resolved: "YES", stars: null })] }))).toBeNull()
    expect(supportPillText(view({ pendingEvaluations: [pending({ resolved: null, stars: 4 })] }))).toBeNull()
  })

  it("aberta pelo selo \"avalie\" sem o pedido em memória (página recarregada): mostra a avaliação, não a sala vazia", () => {
    const awaiting = { attendanceId: "att-9", requestId: "req-9", protocol: "AP-JWHS9N", anjoName: "Ricardo", openUntil: "2026-11-11T08:47:00.000Z", current: { resolved: null, stars: null } }
    render(<HumanSupportStateValueProvider value={{ operator: view({ pendingEvaluations: [awaiting] }) }}><SupportRoom onBack={vi.fn()} /></HumanSupportStateValueProvider>)
    expect(screen.queryByText("Você não tem um pedido de apoio aberto.")).toBeNull()
    expect(screen.getByText("AP-JWHS9N")).toBeInTheDocument()
    expect(screen.getByText("Sua dúvida foi resolvida?")).toBeInTheDocument()
  })

  it("tiques nas mensagens do operador (lida, entregue, enviada), \"Ana está digitando…\" e o aviso de digitação ao escrever", async () => {
    const op = (seq: number) => ({ id: `m${seq}`, seq, authorKind: "OPERATOR" as const, authorName: "Bruno", body: `minha ${seq}`, systemCode: null, occurredAt: "2026-11-09T17:02:00.000Z" })
    const talking: OperatorRequestView = {
      ...waiting, status: "IN_PROGRESS", queueExpiresAt: null, anjo: { name: "Ana", avatarUrl: null, awaitingFirstResponse: false }, canCancel: false, canClose: true,
      messages: [...waiting.messages, op(2), op(3), op(4)], peerReceipts: { deliveredSeq: 3, readSeq: 2 }, peerTypingMs: 5_000,
    }
    const { container } = render(<HumanSupportStateValueProvider value={{ operator: view({ openRequest: talking }) }}><SupportRoom onBack={vi.fn()} /></HumanSupportStateValueProvider>)
    const receipt = (seq: number) => container.querySelector(`[data-seq="${seq}"] [data-receipt]`)?.getAttribute("data-receipt")
    expect([receipt(2), receipt(3), receipt(4)]).toEqual(["read", "delivered", "sent"])
    expect(screen.getByText("Ana está digitando…")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Mensagem para o Anjo"), { target: { value: "Ok, aguardo" } })
    await waitFor(() => expect(service.signalSupportTyping).toHaveBeenCalledWith("req-1", true))
  })

  it("na fila não há \"digitando\": escrever não avisa ninguém", async () => {
    render(<HumanSupportStateValueProvider value={{ operator: view({ openRequest: waiting }) }}><SupportRoom onBack={vi.fn()} /></HumanSupportStateValueProvider>)
    fireEvent.change(screen.getByLabelText("Mensagem para o Anjo"), { target: { value: "Alguém aí?" } })
    await act(async () => { await Promise.resolve() })
    expect(service.signalSupportTyping).not.toHaveBeenCalledWith(expect.anything(), true)
  })
})

