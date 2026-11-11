/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { StrictMode } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAnjoWorkspaceState } from "./use-anjo-workspace-state"
import { HumanSupportStateProvider, useHumanSupportState } from "./use-human-support-state"

/**
 * Travas do navegador (Web Locks) do Apoio com Anjo: a trava chega DEPOIS da montagem (assíncrona, como no navegador). Uma montagem
 * que já saiu quando a trava chega precisa devolvê-la — senão a própria aba fica "aberta em outra aba" (Área do Anjo) ou sem líder
 * (estado do operador). O React monta duas vezes em desenvolvimento (StrictMode), o que reproduz o caso.
 */
const service = vi.hoisted(() => ({ fetchHumanSupportState: vi.fn(), signalSupportTyping: vi.fn(async () => undefined), acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })) }))
vi.mock("@/services/human-support/human-support-service", () => service)

type Callback = (lock: { name: string } | null) => Promise<unknown> | unknown
type Options = { ifAvailable?: boolean; signal?: AbortSignal }
/** Fila por nome como a do navegador: a decisão sai depois da chamada (assíncrona); `signal` tira da fila quem ainda espera. */
function fakeLocks() {
  const held = new Set<string>()
  const waiting = new Map<string, Array<() => void>>()
  const request = (name: string, optionsOrCallback: Options | Callback, maybeCallback?: Callback) => {
    const options: Options = typeof optionsOrCallback === "function" ? {} : optionsOrCallback
    const callback = (typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback)!
    return new Promise((resolve, reject) => {
      let granted = false
      const grant = () => {
        granted = true
        held.add(name)
        Promise.resolve(callback({ name })).then((value) => {
          held.delete(name)
          waiting.get(name)?.shift()?.()
          resolve(value)
        }, reject)
      }
      options.signal?.addEventListener("abort", () => {
        if (granted) return
        waiting.set(name, (waiting.get(name) ?? []).filter((entry) => entry !== grant))
        reject(new DOMException("Aborted", "AbortError"))
      })
      setTimeout(() => {
        if (options.signal?.aborted) return
        if (!held.has(name)) grant()
        else if (options.ifAvailable) Promise.resolve(callback(null)).then(resolve, reject)
        else waiting.set(name, [...(waiting.get(name) ?? []), grant])
      }, 0)
    })
  }
  return { held, request }
}

class FakeChannel {
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage() {}
  close() {}
}

let locks: ReturnType<typeof fakeLocks>
beforeEach(() => {
  locks = fakeLocks()
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true })
  vi.stubGlobal("BroadcastChannel", FakeChannel)
  const state = {
    version: "1",
    operator: { enabled: true, availability: null, openRequest: null, pendingEvaluations: [] },
    anjo: { presence: { status: "AVAILABLE", pauseReason: null, connected: true, since: "2026-11-10T11:00:00.000Z", scheduled: null }, capacity: { max: 2, used: 0 }, attendances: [], pendingClassifications: [] },
  }
  // A chamada curta responde na hora; a longa (Área do Anjo) fica aberta até a tela sair — como no servidor, sem laço.
  service.fetchHumanSupportState.mockImplementation(({ wait, signal }: { wait: number; signal: AbortSignal }) =>
    wait > 0 ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))) : Promise.resolve(state),
  )
})
afterEach(() => {
  cleanup()
  service.fetchHumanSupportState.mockReset()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, "locks")
})

function AnjoProbe() {
  const { anjo, blocked } = useAnjoWorkspaceState()
  return <p>{blocked ? "outra aba" : anjo ? "área aberta" : "carregando"}</p>
}

function OperatorProbe() {
  const { operator } = useHumanSupportState()
  return <p>{operator ? "estado carregado" : "carregando"}</p>
}

describe("travas do navegador do Apoio com Anjo", () => {
  it("Área do Anjo: a montagem dupla não deixa a própria aba presa em \"aberta em outra aba\"; sair devolve a trava", async () => {
    const view = render(<StrictMode><AnjoProbe /></StrictMode>)
    expect(await screen.findByText("área aberta")).toBeInTheDocument()
    expect(screen.queryByText("outra aba")).toBeNull()
    view.unmount()
    await waitFor(() => expect(locks.held.has("inia-anjo-workspace")).toBe(false))
  })

  it("Área do Anjo: com a trava presa por outra aba, depois da espera curta mostra \"aberta em outra aba\" e não chama o servidor", async () => {
    let releaseOther: () => void = () => {}
    void locks.request("inia-anjo-workspace", () => new Promise<void>((resolve) => { releaseOther = resolve }))
    render(<AnjoProbe />)
    expect(await screen.findByText("outra aba", undefined, { timeout: 3_000 })).toBeInTheDocument()
    expect(service.fetchHumanSupportState).not.toHaveBeenCalled()
    releaseOther()
  })

  it("estado do operador: a montagem dupla ainda elege uma líder (o estado chega)", async () => {
    render(<StrictMode><HumanSupportStateProvider><OperatorProbe /></HumanSupportStateProvider></StrictMode>)
    expect(await screen.findByText("estado carregado")).toBeInTheDocument()
  })
})
