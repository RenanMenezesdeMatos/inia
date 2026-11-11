import { afterEach, describe, expect, it, vi } from "vitest"
import type { StateResponse } from "@/schemas/human-support/state.schema"
import { ApiError } from "@/lib/api/api-client"
import { startStatePoller } from "./state-poller"

/** Laço da chamada de estado: curta ao começar, longa só com algo acontecendo, reconexão, reserva e `refresh`. */
afterEach(() => vi.useRealTimers())
const state = (version: string, open = false, reconnect = false): StateResponse => ({
  version,
  ...(reconnect ? { reconnect: true as const } : {}),
  operator: { enabled: true, availability: null, openRequest: open ? ({ id: "r" } as never) : null, pendingEvaluations: [] },
  anjo: null,
})
const flush = () => vi.advanceTimersByTimeAsync(0)

describe("laço da chamada de estado", () => {
  it("chamada curta ao começar; sem nada acontecendo, espera um refresh (nenhuma chamada sozinha)", async () => {
    vi.useFakeTimers()
    const calls: { since?: string | null; wait?: number }[] = []
    const fetchState = vi.fn(async (input: { since?: string | null; wait?: number }) => {
      calls.push({ since: input.since ?? null, wait: input.wait ?? 0 })
      return state("1")
    })
    const poller = startStatePoller({ workspace: "none", shouldWait: (s) => Boolean(s.operator?.openRequest), onState: () => {}, onReconnecting: () => {}, fetchState: fetchState as never })
    await flush()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toEqual([{ since: null, wait: 0 }])
    poller.refresh()
    await flush()
    expect(calls).toHaveLength(2)
    poller.stop()
  })

  it("com pedido aberto: chamada longa com a versão; reconnect volta a chamar depois de 0,5–2 s", async () => {
    vi.useFakeTimers()
    const responses = [state("1", true), state("2", true, true), state("3", true)]
    const calls: { since: string | null; wait: number }[] = []
    const fetchState = vi.fn(async (input: { since?: string | null; wait?: number }) => {
      calls.push({ since: input.since ?? null, wait: input.wait ?? 0 })
      return responses.shift() ?? new Promise<StateResponse>(() => {})
    })
    const poller = startStatePoller({ workspace: "none", shouldWait: (s) => Boolean(s.operator?.openRequest), onState: () => {}, onReconnecting: () => {}, fetchState: fetchState as never, random: () => 0 })
    await flush()
    await flush()
    expect(calls.slice(0, 2)).toEqual([{ since: null, wait: 0 }, { since: "1", wait: 20 }])
    await vi.advanceTimersByTimeAsync(500)
    expect(calls[2]).toEqual({ since: "2", wait: 20 })
    poller.stop()
  })

  it("três falhas seguidas: 'Reconectando…' e modo de reserva (chamada curta a cada 3 s)", async () => {
    vi.useFakeTimers()
    let failing = 3
    const calls: number[] = []
    const reconnecting: boolean[] = []
    const fetchState = vi.fn(async (input: { wait?: number }) => {
      calls.push(input.wait ?? 0)
      if (failing > 0) {
        failing -= 1
        throw new Error("offline")
      }
      return state("9", true)
    })
    const poller = startStatePoller({ workspace: "none", shouldWait: () => true, onState: () => {}, onReconnecting: (value) => reconnecting.push(value), fetchState: fetchState as never, random: () => 0 })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(reconnecting.slice(0, 3)).toEqual([true, true, true])
    await vi.advanceTimersByTimeAsync(6_500)
    // Depois da terceira falha: só chamadas curtas, a cada 3 s, enquanto durar a reserva.
    expect(calls.slice(3).every((wait) => wait === 0)).toBe(true)
    expect(calls.length).toBeGreaterThanOrEqual(5)
    expect(reconnecting.at(-1)).toBe(false)
    poller.stop()
  })

  it("401 (sessão encerrada): para o laço e avisa, sem ficar tentando; 500 continua tentando", async () => {
    vi.useFakeTimers()
    const ended = vi.fn()
    const reconnecting: boolean[] = []
    const unauthorized = vi.fn(async () => {
      throw new ApiError("Erro 401", 401, null)
    })
    startStatePoller({ workspace: "anjo", shouldWait: () => true, onState: () => {}, onReconnecting: (value) => reconnecting.push(value), onSessionEnded: ended, fetchState: unauthorized as never })
    await flush()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(unauthorized).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledTimes(1)
    expect(reconnecting).not.toContain(true)

    const failing = vi.fn(async () => {
      throw new ApiError("Erro 500", 500, null)
    })
    const poller = startStatePoller({ workspace: "anjo", shouldWait: () => true, onState: () => {}, onReconnecting: () => {}, onSessionEnded: ended, fetchState: failing as never })
    await flush()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(failing.mock.calls.length).toBeGreaterThan(2)
    expect(ended).toHaveBeenCalledTimes(1)
    poller.stop()
  })
})
