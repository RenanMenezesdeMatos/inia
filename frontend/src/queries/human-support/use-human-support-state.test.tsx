/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { channelMessageForAccount, HumanSupportStateProvider, operatorNeedsWait, useHumanSupportState } from "./use-human-support-state"

const service = vi.hoisted(() => ({ fetchHumanSupportState: vi.fn(), signalSupportTyping: vi.fn(async () => undefined), acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })) }))
vi.mock("@/services/human-support/human-support-service", () => service)
afterEach(() => {
  cleanup()
  service.fetchHumanSupportState.mockReset()
})

function Probe() {
  const { operator, refresh } = useHumanSupportState()
  return <button type="button" onClick={refresh}>{operator ? (operator.enabled ? "ligado" : "desligado") : "carregando"}</button>
}

describe("estado do Apoio com Anjo do operador", () => {
  it("uma chamada curta ao montar (sem esperar: nada acontecendo); refresh busca de novo", async () => {
    service.fetchHumanSupportState.mockResolvedValue({ version: "1", operator: { enabled: true, availability: null, openRequest: null, pendingEvaluations: [] }, anjo: null })
    render(<HumanSupportStateProvider><Probe /></HumanSupportStateProvider>)
    expect(await screen.findByText("ligado")).toBeInTheDocument()
    expect(service.fetchHumanSupportState).toHaveBeenCalledTimes(1)
    expect(service.fetchHumanSupportState.mock.calls[0]![0]).toMatchObject({ wait: 0, workspace: "none" })
    await act(async () => {
      screen.getByRole("button").click()
    })
    expect(service.fetchHumanSupportState).toHaveBeenCalledTimes(2)
  })

  it("desligado (sem sessão) não chama nada", () => {
    render(<HumanSupportStateProvider enabled={false}><Probe /></HumanSupportStateProvider>)
    expect(service.fetchHumanSupportState).not.toHaveBeenCalled()
    expect(screen.getByText("carregando")).toBeInTheDocument()
  })

  it("chamada longa só com pedido aberto ou avaliação pendente", () => {
    expect(operatorNeedsWait({ enabled: true, availability: null, openRequest: null, pendingEvaluations: [] })).toBe(false)
    expect(operatorNeedsWait({ enabled: true, availability: null, openRequest: { id: "r" } as never, pendingEvaluations: [] })).toBe(true)
    expect(operatorNeedsWait({ enabled: true, availability: null, openRequest: null, pendingEvaluations: [{} as never] })).toBe(true)
  })

  it("aba seguidora só aceita o estado repassado pela líder da MESMA conta (canal do navegador inteiro)", async () => {
    // Canal falso com entrega manual; trava do navegador que nunca chega: esta aba fica seguidora e não chama o servidor.
    const channels: Array<{ onmessage: ((event: MessageEvent) => void) | null }> = []
    class FakeChannel {
      onmessage: ((event: MessageEvent) => void) | null = null
      constructor() {
        channels.push(this)
      }
      postMessage() {}
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel)
    Object.defineProperty(navigator, "locks", { value: { request: () => new Promise(() => {}) }, configurable: true })
    try {
      render(<HumanSupportStateProvider accountId="conta-a"><Probe /></HumanSupportStateProvider>)
      const deliver = (data: unknown) => act(() => channels.forEach((channel) => channel.onmessage?.({ data } as MessageEvent)))
      const operator = { enabled: true, availability: null, openRequest: null, pendingEvaluations: [] }
      deliver({ type: "state", accountId: "conta-b", operator, reconnecting: false })
      deliver({ type: "state", operator, reconnecting: false })
      expect(screen.getByText("carregando")).toBeInTheDocument()
      deliver({ type: "state", accountId: "conta-a", operator, reconnecting: false })
      expect(screen.getByText("ligado")).toBeInTheDocument()
      expect(service.fetchHumanSupportState).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      Reflect.deleteProperty(navigator, "locks")
    }
  })

  it("mensagem do canal sem conta, de outra conta ou com a conta desta aba desconhecida é ignorada", () => {
    expect(channelMessageForAccount({ accountId: "a" }, "a")).toBe(true)
    expect(channelMessageForAccount({ accountId: "b" }, "a")).toBe(false)
    expect(channelMessageForAccount({}, "a")).toBe(false)
    expect(channelMessageForAccount({ accountId: "" }, null)).toBe(false)
  })
})
