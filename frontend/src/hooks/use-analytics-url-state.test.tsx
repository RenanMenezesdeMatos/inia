/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useAnalyticsUrlState } from "./use-analytics-url-state"

// A URL real do jsdom é a fonte de verdade: `useSearchParams` lê `window.location` a cada render,
// como o App Router faz depois de `pushState`/`replaceState`.
vi.mock("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

function waitForPopState() {
  return new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }))
}

describe("useAnalyticsUrlState — pessoa focal da Estrutura na URL", () => {
  it("navegar na estrutura usa pushState (Back/Forward funcionam); filtros continuam com replaceState", async () => {
    window.history.replaceState(null, "", "/supervisor?tab=structure")
    const { result, rerender } = renderHook(() => useAnalyticsUrlState())
    expect(result.current.state.tab).toBe("structure")
    expect(result.current.state.structurePersonId).toBeNull()
    const before = window.history.length

    act(() => result.current.update({ structurePersonId: "coord-1" }, { history: "push" }))
    rerender()
    expect(window.location.search).toContain("structurePersonId=coord-1")
    expect(window.history.length).toBe(before + 1)
    expect(result.current.state.structurePersonId).toBe("coord-1")

    act(() => result.current.update({ structurePersonId: "sup-1" }, { history: "push" }))
    rerender()
    expect(result.current.state.structurePersonId).toBe("sup-1")
    expect(window.history.length).toBe(before + 2)

    // Trocar competência não é "página": não cria entrada no histórico.
    act(() => result.current.update({ period: "2026-08" }))
    rerender()
    expect(window.history.length).toBe(before + 2)
    expect(window.location.search).toContain("period=2026-08")

    // Back do navegador: volta ao Coordenador, depois à raiz (sem pessoa focal).
    const popped = waitForPopState()
    window.history.back()
    await popped
    rerender()
    expect(result.current.state.structurePersonId).toBe("coord-1")
    const poppedAgain = waitForPopState()
    window.history.back()
    await poppedAgain
    rerender()
    expect(result.current.state.structurePersonId).toBeNull()
    expect(result.current.state.tab).toBe("structure")
  })

  it("refresh/deep link: a pessoa focal vem da URL, e voltar à raiz remove o parâmetro", () => {
    window.history.replaceState(null, "", "/supervisor?tab=structure&structurePersonId=sup-9")
    const { result, rerender } = renderHook(() => useAnalyticsUrlState())
    expect(result.current.state.structurePersonId).toBe("sup-9")
    act(() => result.current.update({ structurePersonId: null }, { history: "push" }))
    rerender()
    expect(window.location.search).not.toContain("structurePersonId")
    expect(result.current.state.structurePersonId).toBeNull()
  })
})
