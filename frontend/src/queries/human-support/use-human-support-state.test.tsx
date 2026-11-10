/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HumanSupportStateProvider, operatorNeedsWait, useHumanSupportState } from "./use-human-support-state"

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
})
