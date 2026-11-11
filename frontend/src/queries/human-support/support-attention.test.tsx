/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { newMessageTitle } from "@/lib/attention/attention-alert"
import type { MessageView, OperatorRequestView, OperatorView, StateResponse } from "@/schemas/human-support/state.schema"

import { ANJO_MESSAGE_TOAST_ID, HumanSupportStateProvider, unreadAnjoMessages, useHumanSupportState, useRegisterSupportChat, useSupportRoomOnScreen } from "./use-human-support-state"

/**
 * MENSAGEM NOVA DO ANJO FORA DA VISTA DO OPERADOR: título piscando e som com a página fora da vista; aviso na tela com "Abrir conversa"
 * com a página vista e a sala fechada; nada com a sala na tela. A chamada de estado é substituída por um poller falso que o teste
 * alimenta (o mesmo `onState` da aba líder).
 */
const poller = vi.hoisted(() => ({ onState: null as null | ((state: { operator: OperatorView | null }) => void) }))
vi.mock("./state-poller", () => ({
  startStatePoller: (options: { onState: (state: StateResponse) => void }) => {
    poller.onState = options.onState as never
    return { stop: () => undefined, refresh: () => undefined }
  },
}))
const toasts = vi.hoisted(() => ({ show: vi.fn(), dismiss: vi.fn() }))
vi.mock("sonner", () => ({ toast: Object.assign(toasts.show, { dismiss: toasts.dismiss }) }))
vi.mock("@/services/human-support/human-support-service", () => ({ acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })) }))

const tones: string[] = []
class FakeAudioContext {
  state = "running"
  currentTime = 0
  destination = {}
  resume = vi.fn(async () => undefined)
  close = vi.fn(async () => undefined)
  createGain() {
    return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
  }
  createOscillator() {
    tones.push("tone")
    return { type: "sine", frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() }
  }
}

const message = (seq: number, authorKind: MessageView["authorKind"] = "ANJO"): MessageView => ({ id: `m${seq}`, seq, authorKind, authorName: authorKind === "ANJO" ? "Ana" : "Larissa", body: `msg ${seq}`, systemCode: null, occurredAt: "2026-11-10T15:00:00.000Z" })
const request = (messages: MessageView[], readSeq = 0): OperatorRequestView => ({
  id: "req-1", protocol: "AP-1", status: "IN_PROGRESS", endCause: null, origin: "BUTTON", createdAt: "2026-11-10T14:59:00.000Z", queuedAt: "2026-11-10T14:59:00.000Z", queueExpiresAt: null,
  sharedContext: { question: null, answer: null, dislike: null, note: "Cliente na linha" }, anjo: { name: "Ana", avatarUrl: null, awaitingFirstResponse: false }, messages, hasOlder: false,
  canCancel: false, canClose: true, peerReceipts: { deliveredSeq: 0, readSeq: 0 }, peerTypingMs: null, readSeq,
})
const view = (open: OperatorRequestView | null): OperatorView => ({ enabled: true, availability: null, openRequest: open, pendingEvaluations: [] })
const push = (open: OperatorRequestView | null) => act(() => poller.onState?.({ operator: view(open) }))

let pageSeen = true
beforeEach(() => {
  tones.length = 0
  pageSeen = true
  vi.spyOn(document, "hasFocus").mockImplementation(() => pageSeen)
  vi.stubGlobal("AudioContext", FakeAudioContext)
  document.title = "INIA"
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  toasts.show.mockReset()
  toasts.dismiss.mockReset()
  poller.onState = null
})

function Probe({ chat = false, room = false }: { chat?: boolean; room?: boolean }) {
  const { unreadFromAnjo, roomOpenRequest } = useHumanSupportState()
  return (
    <>
      <p>novas: {unreadFromAnjo}</p>
      <p>pedidos para abrir: {roomOpenRequest}</p>
      {chat ? <Chat /> : null}
      {room ? <Room /> : null}
    </>
  )
}
function Chat() {
  useRegisterSupportChat()
  return null
}
function Room() {
  const { operator } = useHumanSupportState()
  const open = operator?.openRequest ?? null
  useSupportRoomOnScreen(open?.id ?? null, open ? Math.max(...open.messages.map((entry) => entry.seq)) : 0, open !== null)
  return null
}

describe("mensagem nova do Anjo fora da vista do operador", () => {
  it("página fora da vista: o título pisca com o nome do Anjo até a pessoa voltar, a aba líder toca o som e o selo conta a mensagem", () => {
    render(<HumanSupportStateProvider><Probe /></HumanSupportStateProvider>)
    fireEvent.pointerDown(document.body)
    push(request([message(1)], 1))
    expect(document.title).toBe("INIA")
    expect(tones).toHaveLength(0)

    pageSeen = false
    push(request([message(1), message(2, "OPERATOR"), message(3)], 1))
    expect(document.title).toBe(newMessageTitle("Ana"))
    expect(tones.length).toBeGreaterThan(0)
    expect(screen.getByText("novas: 1")).toBeInTheDocument()
    expect(toasts.show).not.toHaveBeenCalled()

    pageSeen = true
    act(() => {
      window.dispatchEvent(new Event("focus"))
    })
    expect(document.title).toBe("INIA")
  })

  it("página vista com a sala fechada: som e aviso na tela; 'Abrir conversa' abre a sala no chat desta página", () => {
    render(<HumanSupportStateProvider><Probe chat /></HumanSupportStateProvider>)
    push(request([message(1)], 1))
    push(request([message(1), message(2)], 1))
    expect(document.title).toBe("INIA")
    expect(tones.length).toBeGreaterThan(0)
    expect(toasts.show).toHaveBeenCalledWith("Ana respondeu no apoio", expect.objectContaining({ id: ANJO_MESSAGE_TOAST_ID, action: expect.objectContaining({ label: "Abrir conversa" }) }))
    const action = toasts.show.mock.calls[0]![1].action as { onClick: () => void }
    act(() => action.onClick())
    expect(screen.getByText("pedidos para abrir: 1")).toBeInTheDocument()
  })

  it("sem chat nesta página, 'Abrir conversa' leva ao Acompanhamento do próprio perfil com a sala aberta", () => {
    const navigate = vi.fn()
    render(<HumanSupportStateProvider profileHref="/profile/p1" onNavigate={navigate}><Probe /></HumanSupportStateProvider>)
    push(request([message(1)], 1))
    push(request([message(1), message(2)], 1))
    const action = toasts.show.mock.calls[0]![1].action as { onClick: () => void }
    act(() => action.onClick())
    expect(navigate).toHaveBeenCalledWith("/profile/p1?tab=followup&iniaSupport=room")
  })

  it("sala na tela com a página vista: nada avisa e a mensagem conta como vista", () => {
    render(<HumanSupportStateProvider><Probe room /></HumanSupportStateProvider>)
    push(request([message(1)], 1))
    push(request([message(1), message(2)], 1))
    expect(toasts.show).not.toHaveBeenCalled()
    expect(tones).toHaveLength(0)
    expect(screen.getByText("novas: 0")).toBeInTheDocument()
  })

  it("já lida (em outro aparelho): o 'lida' do servidor cobre a mensagem e nada avisa; mensagens do próprio operador nunca avisam", () => {
    pageSeen = false
    render(<HumanSupportStateProvider><Probe /></HumanSupportStateProvider>)
    push(request([message(1)], 1))
    push(request([message(1), message(2)], 2))
    push(request([message(1), message(2), message(3, "OPERATOR")], 2))
    expect(document.title).toBe("INIA")
    expect(tones).toHaveLength(0)
    expect(screen.getByText("novas: 0")).toBeInTheDocument()
  })

  it("contagem: só mensagens do Anjo depois do maior 'lida' (servidor ou desta aba)", () => {
    const open = request([message(1), message(2, "OPERATOR"), message(3), message(4, "SYSTEM"), message(5)], 1)
    expect(unreadAnjoMessages(open)).toBe(2)
    expect(unreadAnjoMessages(open, 3)).toBe(1)
    expect(unreadAnjoMessages(null)).toBe(0)
  })
})
