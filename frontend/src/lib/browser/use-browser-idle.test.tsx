/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useBrowserIdle } from "./use-browser-idle"

afterEach(() => {
  vi.useRealTimers()
  delete (window as { requestIdleCallback?: unknown }).requestIdleCallback
})

describe("useBrowserIdle — algo caro só depois do idle do navegador", () => {
  it("espera o navegador ficar ocioso; depois de verdadeiro, fica verdadeiro", () => {
    let fire: (() => void) | null = null
    ;(window as { requestIdleCallback?: unknown }).requestIdleCallback = (callback: () => void) => {
      fire = callback
      return 1
    }
    const { result, rerender } = renderHook(() => useBrowserIdle())
    expect(result.current).toBe(false)
    act(() => fire!())
    expect(result.current).toBe(true)
    rerender()
    expect(result.current).toBe(true)
  })

  it("sem requestIdleCallback (Safari): um instante depois da página carregada", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useBrowserIdle())
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current).toBe(true)
  })

  it("pedido explícito (`now`) vale na hora e não volta atrás quando o pedido some", () => {
    ;(window as { requestIdleCallback?: unknown }).requestIdleCallback = () => 1
    const { result, rerender } = renderHook(({ now }) => useBrowserIdle({ now }), { initialProps: { now: false } })
    expect(result.current).toBe(false)
    rerender({ now: true })
    expect(result.current).toBe(true)
    rerender({ now: false })
    expect(result.current).toBe(true)
  })
})
