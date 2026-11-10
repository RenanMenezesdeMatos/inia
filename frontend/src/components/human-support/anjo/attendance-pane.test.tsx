/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { ApiError } from "@/lib/api/api-client"
import type { AnjoAttendanceView, MessageView } from "@/schemas/human-support/state.schema"

import { resetAcknowledgementsForTests } from "@/queries/human-support/receipt-acks"

import { AttendancePane } from "./attendance-pane"

/** Um atendimento na área do Anjo (design_draft.md seções 7, 10 e 14). */
const service = vi.hoisted(() => ({ signalSupportTyping: vi.fn(async () => undefined), acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })), fetchSupportMessages: vi.fn(), sendSupportMessage: vi.fn(), closeSupportRequestAsAnjo: vi.fn() }))
vi.mock("@/services/human-support/human-support-service", () => service)

beforeAll(installJsdomStubs)
afterEach(() => cleanup())

const NOW = Date.parse("2026-11-09T15:00:00.000Z")
const at = (minutesBefore: number, seconds = 0) => new Date(NOW - minutesBefore * 60_000 - seconds * 1000).toISOString()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function attendance(overrides: Partial<AnjoAttendanceView> = {}): AnjoAttendanceView {
  return {
    id: "att-1",
    requestId: "req-1",
    protocol: "AP-7K2QX9",
    operatorName: "Bruno",
    teamName: "Grupo X",
    subteamName: null,
    startedAt: at(3, 20),
    firstAnjoMessageAt: null,
    lastSeq: 2,
    operatorAbsentSince: null,
    sharedContext: { question: "Linha 1\nLinha 2 <b>sem html</b>", answer: null, dislike: { reason: "WRONG_INFORMATION", reasonLabel: "Informação errada", comment: "O prazo mudou." }, note: null },
    peerReceipts: { deliveredSeq: 0, readSeq: 0 },
    peerTypingMs: null,
    ...overrides,
  }
}

const message = (seq: number, overrides: Partial<MessageView> = {}): MessageView => ({ id: `m-${seq}`, seq, authorKind: "OPERATOR", authorName: "Bruno", body: `mensagem ${seq}`, systemCode: null, occurredAt: at(3), ...overrides })

const renderPane = (overrides: Partial<AnjoAttendanceView> = {}, props: { onRefresh?: () => void; now?: number } = {}) => {
  const onApplyAnjo = vi.fn()
  const onRefresh = props.onRefresh ?? vi.fn()
  const view = render(<AttendancePane attendance={attendance(overrides)} now={props.now ?? NOW} onApplyAnjo={onApplyAnjo} onRefresh={onRefresh} />)
  return { ...view, onApplyAnjo, onRefresh }
}

// Tela grande: o contexto começa aberto, à esquerda da conversa.
const wideScreen = (matches: boolean) => vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({ matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }))

beforeEach(() => {
  wideScreen(true)
  resetAcknowledgementsForTests()
  for (const mock of Object.values(service)) mock.mockReset()
  service.fetchSupportMessages.mockResolvedValue({ messages: [message(1, { authorKind: "SYSTEM", authorName: null, body: "Você recebeu este atendimento.", systemCode: "ANJO_ASSIGNED" }), message(2)], hasMore: false })
})

describe("AttendancePane", () => {
  it("até a primeira mensagem do Anjo: \"Sem resposta há N min\" contado do início do atendimento", async () => {
    renderPane()
    expect(screen.getByRole("status")).toHaveTextContent("Sem resposta há 3 min")
    expect(await screen.findByText("mensagem 2")).toBeInTheDocument()
    expect(screen.getByText("Você recebeu este atendimento.")).toHaveAttribute("data-author", "system")
    cleanup()
    renderPane({ firstAnjoMessageAt: at(1) })
    expect(screen.queryByText(/Sem resposta há/)).not.toBeInTheDocument()
  })

  it("o que o operador compartilhou é texto puro, com as quebras de linha", () => {
    renderPane()
    const card = screen.getByRole("region", { name: "O que o operador compartilhou" })
    expect(within(card).getByText(/Linha 1/)).toHaveClass("whitespace-pre-wrap")
    expect(within(card).getByText(/<b>sem html<\/b>/)).toBeInTheDocument()
    expect(card.querySelector("b")).toBeNull()
    expect(within(card).getByText("Informação errada")).toBeInTheDocument()
    expect(within(card).getByText("O prazo mudou.")).toBeInTheDocument()
  })

  it("busca só as mensagens novas quando o último seq do atendimento sobe", async () => {
    const { rerender, onApplyAnjo, onRefresh } = renderPane()
    await screen.findByText("mensagem 2")
    service.fetchSupportMessages.mockResolvedValueOnce({ messages: [message(3, { body: "chegou agora" })], hasMore: false })
    rerender(<AttendancePane attendance={attendance({ lastSeq: 3 })} now={NOW} onApplyAnjo={onApplyAnjo} onRefresh={onRefresh} />)
    expect(await screen.findByText("chegou agora")).toBeInTheDocument()
    expect(service.fetchSupportMessages).toHaveBeenLastCalledWith("req-1", { after: 2 })
  })

  it("\"Encerrar: operador sem a INIA aberta\" só depois de 5 min de ausência", () => {
    renderPane({ operatorAbsentSince: at(2) })
    expect(screen.getByRole("button", { name: "Encerrar: operador sem a INIA aberta" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Encerrar atendimento" })).toBeEnabled()
    cleanup()
    renderPane({ operatorAbsentSince: null })
    expect(screen.getByRole("button", { name: "Encerrar: operador sem a INIA aberta" })).toBeDisabled()
    cleanup()
    renderPane({ operatorAbsentSince: at(5, 1) })
    expect(screen.getByRole("button", { name: "Encerrar: operador sem a INIA aberta" })).toBeEnabled()
  })

  it("encerrar por ausência: o servidor recusa (operador voltou) e a recusa aparece na confirmação", async () => {
    service.closeSupportRequestAsAnjo.mockRejectedValue(new ApiError("O operador está com a INIA aberta.", 409, "HUMAN_SUPPORT_OPERATOR_PRESENT"))
    const { onApplyAnjo, onRefresh } = renderPane({ operatorAbsentSince: at(6) })
    fireEvent.click(screen.getByRole("button", { name: "Encerrar: operador sem a INIA aberta" }))
    const dialog = await screen.findByRole("alertdialog")
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Encerrar" }))
    })
    expect(service.closeSupportRequestAsAnjo).toHaveBeenCalledWith("req-1", "OPERATOR_ABSENT")
    expect(within(dialog).getByRole("alert")).toHaveTextContent("O operador está com a INIA aberta.")
    expect(onApplyAnjo).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalled()
  })

  it("Enter envia com uma chave uuid; na falha o texto fica e o erro aparece; reenviar o mesmo texto reaproveita a chave", async () => {
    service.sendSupportMessage.mockRejectedValueOnce(new Error("Sem conexão."))
    renderPane()
    await screen.findByText("mensagem 2")
    const field = screen.getByLabelText("Mensagem para o operador")
    fireEvent.change(field, { target: { value: "Olá, Bruno!" } })
    fireEvent.keyDown(field, { key: "Enter", shiftKey: true })
    expect(service.sendSupportMessage).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" })
    })
    expect(service.sendSupportMessage).toHaveBeenCalledWith("req-1", { clientMessageId: expect.stringMatching(UUID), body: "Olá, Bruno!" })
    expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão.")
    expect(field).toHaveValue("Olá, Bruno!")

    const firstKey = service.sendSupportMessage.mock.calls[0]![1].clientMessageId
    service.sendSupportMessage.mockResolvedValueOnce(message(3, { authorKind: "ANJO", authorName: "Ana", body: "Olá, Bruno!", occurredAt: at(0) }))
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }))
    })
    expect(service.sendSupportMessage.mock.calls[1]![1].clientMessageId).toBe(firstKey)
    expect(field).toHaveValue("")
    const log = screen.getByRole("log", { name: "Mensagens do atendimento" })
    await waitFor(() => expect(within(log).getByText("Olá, Bruno!")).toBeInTheDocument())
    expect(within(log).getByText("Você")).toBeInTheDocument()
    // A resposta do próprio Anjo tira o "Sem resposta há…" na hora.
    expect(screen.queryByText(/Sem resposta há/)).not.toBeInTheDocument()
  })

  it("pedido já encerrado: o erro do servidor aparece e a área busca o estado de novo", async () => {
    service.sendSupportMessage.mockRejectedValue(new ApiError("Este atendimento já foi encerrado", 409, "HUMAN_SUPPORT_REQUEST_ENDED"))
    const { onRefresh } = renderPane()
    const field = screen.getByLabelText("Mensagem para o operador")
    fireEvent.change(field, { target: { value: "Ainda está aí?" } })
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" })
    })
    expect(await screen.findByRole("alert")).toHaveTextContent("Este atendimento já foi encerrado")
    expect(field).toHaveValue("Ainda está aí?")
    expect(onRefresh).toHaveBeenCalled()
  })

  it("tiques nas mensagens do próprio Anjo: enviada, entregue e lida pelos recibos do operador; mensagem do operador sem tique", async () => {
    service.fetchSupportMessages.mockResolvedValue({ messages: [message(1), message(2, { authorKind: "ANJO", authorName: "Ana", occurredAt: at(2) }), message(3, { authorKind: "ANJO", authorName: "Ana", occurredAt: at(2) }), message(4, { authorKind: "ANJO", authorName: "Ana", occurredAt: at(1) })], hasMore: false })
    const { container } = renderPane({ lastSeq: 4, firstAnjoMessageAt: at(2), peerReceipts: { deliveredSeq: 3, readSeq: 2 } })
    await screen.findByText("mensagem 4")
    const receipt = (seq: number) => container.querySelector(`[data-seq="${seq}"] [data-receipt]`)
    expect(receipt(1)).toBeNull()
    expect(receipt(2)).toHaveAttribute("data-receipt", "read")
    expect(receipt(3)).toHaveAttribute("data-receipt", "delivered")
    expect(receipt(4)).toHaveAttribute("data-receipt", "sent")
    expect(within(container.querySelector('[data-seq="2"]') as HTMLElement).getByText("Lida")).toHaveClass("sr-only")
  })

  it("\"Bruno está digitando…\" com os três pontos, e some quando o prazo do aviso acaba", async () => {
    renderPane({ peerTypingMs: 80 })
    expect(await screen.findByText("Bruno está digitando…")).toHaveAttribute("role", "status")
    expect(screen.getByTestId("peer-typing").querySelector('[data-slot="typing-dots"]')).not.toBeNull()
    await waitFor(() => expect(screen.queryByTestId("peer-typing")).not.toBeInTheDocument())
  })

  it("escrever avisa \"digitando\" ao operador (nunca o texto); enviar não manda \"parei\"", async () => {
    service.sendSupportMessage.mockResolvedValue(message(3, { authorKind: "ANJO", authorName: "Ana", body: "Oi" }))
    renderPane()
    await screen.findByText("mensagem 2")
    const field = screen.getByLabelText("Mensagem para o operador")
    fireEvent.change(field, { target: { value: "Oi" } })
    await waitFor(() => expect(service.signalSupportTyping).toHaveBeenCalledWith("req-1", true))
    fireEvent.keyDown(field, { key: "Enter" })
    await waitFor(() => expect(service.sendSupportMessage).toHaveBeenCalled())
    expect(service.signalSupportTyping).not.toHaveBeenCalledWith("req-1", false)
  })

  it("tela grande: contexto à esquerda e conversa à direita; recolher libera a largura toda para a conversa e fica a linha da pergunta", async () => {
    renderPane()
    await screen.findByText("mensagem 2")
    const article = screen.getByRole("article", { name: "Atendimento AP-7K2QX9" })
    expect(article).toHaveAttribute("data-context", "open")
    const grid = screen.getByRole("region", { name: "Conversa com Bruno" }).parentElement!
    expect(grid.className).toContain("lg:grid-cols-")
    const card = () => screen.getByRole("region", { name: "O que o operador compartilhou" })
    expect(card().compareDocumentPosition(screen.getByRole("region", { name: "Conversa com Bruno" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(within(card()).getByRole("button", { name: "Recolher o que o operador compartilhou" }))
    expect(within(card()).queryByText("Informação errada")).not.toBeInTheDocument()
    expect(within(card()).getByText(/Linha 1/)).toHaveClass("truncate")
    expect(article).toHaveAttribute("data-context", "collapsed")
    expect(grid.className).not.toContain("lg:grid-cols-")
    // Recolher não muda nem perde nada do que foi compartilhado.
    fireEvent.click(within(card()).getByRole("button", { name: "Mostrar o que o operador compartilhou" }))
    expect(within(card()).getByText("Informação errada")).toBeInTheDocument()
    expect(within(card()).getByText("O prazo mudou.")).toBeInTheDocument()
  })

  it("tela pequena: uma coluna, o contexto começa recolhido e o campo de mensagem fica à vista", async () => {
    wideScreen(false)
    renderPane()
    await screen.findByText("mensagem 2")
    expect(screen.getByRole("article", { name: "Atendimento AP-7K2QX9" })).toHaveAttribute("data-context", "collapsed")
    expect(screen.getByRole("button", { name: "Mostrar o que o operador compartilhou" })).toBeInTheDocument()
    expect(screen.getByLabelText("Mensagem para o operador")).toBeInTheDocument()
  })

  it("tempo de atendimento no cabeçalho, desde o início do atendimento; sem início confiável, não inventa duração", () => {
    renderPane({ startedAt: new Date(Date.now() - 125_000).toISOString() })
    expect(screen.getByText("Tempo de atendimento")).toBeInTheDocument()
    expect(screen.getByTestId("attendance-timer")).toHaveTextContent(/^02:0[5-6]$/)
    cleanup()
    renderPane({ startedAt: "não é data" })
    expect(screen.queryByTestId("attendance-timer")).not.toBeInTheDocument()
    expect(screen.getByText("Início não informado")).toBeInTheDocument()
  })

  it("entregue assim que as mensagens chegam; lida só com esta aba de atendimento na tela e a janela em foco", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    vi.spyOn(document, "hasFocus").mockReturnValue(true)
    service.acknowledgeSupportMessages.mockResolvedValue({ deliveredSeq: 2, readSeq: 0 })
    render(<AttendancePane attendance={attendance()} now={NOW} active={false} onApplyAnjo={vi.fn()} onRefresh={vi.fn()} />)
    await waitFor(() => expect(service.acknowledgeSupportMessages).toHaveBeenCalledWith("req-1", { deliveredSeq: 2 }))
    expect(service.acknowledgeSupportMessages).not.toHaveBeenCalledWith("req-1", expect.objectContaining({ readSeq: 2 }))
    cleanup()
    render(<AttendancePane attendance={attendance()} now={NOW} active onApplyAnjo={vi.fn()} onRefresh={vi.fn()} />)
    await waitFor(() => expect(service.acknowledgeSupportMessages).toHaveBeenCalledWith("req-1", { deliveredSeq: 2, readSeq: 2 }))
    vi.restoreAllMocks()
  })
})

