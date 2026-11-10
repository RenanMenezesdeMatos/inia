/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/services/human-support/human-support-service", () => ({ signalSupportTyping: vi.fn() }))

import { TYPING_IDLE_MS, TYPING_REFRESH_MS, useTypingSignal } from "./use-typing-signal"

/** "Digitando" (migration 184): avisa ao começar, renova a cada 4 s, para com 5 s sem tecla, campo vazio ou ao sair — nunca manda o texto. */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("useTypingSignal", () => {
  it("começar avisa uma vez; teclas seguidas não repetem até 4 s; 5 s parado = parei", async () => {
    const send = vi.fn<(requestId: string, typing: boolean) => Promise<void>>(async () => undefined)
    const { result } = renderHook(() => useTypingSignal("req-1", send))
    act(() => result.current.onInput("O"))
    act(() => result.current.onInput("Oi"))
    await flush()
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith("req-1", true)
    act(() => vi.advanceTimersByTime(TYPING_REFRESH_MS))
    act(() => result.current.onInput("Oi, tud"))
    await flush()
    expect(send).toHaveBeenCalledTimes(2)
    act(() => vi.advanceTimersByTime(TYPING_IDLE_MS))
    await flush()
    expect(send).toHaveBeenLastCalledWith("req-1", false)
    expect(send.mock.calls.every(([, typing]) => typeof typing === "boolean")).toBe(true)
  })

  it("apagar tudo = parei; enviar não manda 'parei' (o servidor já tirou); sair escrevendo = parei", async () => {
    const send = vi.fn<(requestId: string, typing: boolean) => Promise<void>>(async () => undefined)
    const { result, unmount } = renderHook(() => useTypingSignal("req-1", send))
    act(() => result.current.onInput("abc"))
    act(() => result.current.onInput(""))
    await flush()
    expect(send.mock.calls).toEqual([["req-1", true], ["req-1", false]])
    act(() => result.current.onInput("de novo"))
    act(() => result.current.onSent())
    act(() => vi.advanceTimersByTime(TYPING_IDLE_MS * 2))
    await flush()
    expect(send.mock.calls).toEqual([["req-1", true], ["req-1", false], ["req-1", true]])
    act(() => result.current.onInput("mais"))
    unmount()
    await flush()
    expect(send.mock.calls.at(-1)).toEqual(["req-1", false])
  })

  it("sem atendimento em andamento (null): nada sai", async () => {
    const send = vi.fn<(requestId: string, typing: boolean) => Promise<void>>(async () => undefined)
    const { result } = renderHook(() => useTypingSignal(null, send))
    act(() => result.current.onInput("na fila"))
    await flush()
    expect(send).not.toHaveBeenCalled()
  })
})
