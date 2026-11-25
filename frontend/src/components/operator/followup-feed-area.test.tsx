/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FollowupFeedArea } from "./followup-feed-area"

let observed: Element[] = []
let resized: (() => void)[] = []
let disconnected = 0
const feed = { mounts: 0, renders: 0 }
function Feed() {
  useEffect(() => {
    feed.mounts += 1
  }, [])
  useEffect(() => {
    feed.renders += 1
  })
  return <p>Feed do acompanhamento</p>
}

/** Onde a área está na janela e a altura do documento (o jsdom não tem layout). */
const place = (top: number, documentHeight = 2_000) => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top } as DOMRect)
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: documentHeight })
}
const area = () => screen.getByTestId("followup-feed-area")
const renderFeed = () => render(<FollowupFeedArea><Feed /></FollowupFeedArea>)

beforeEach(() => {
  observed = []
  resized = []
  disconnected = 0
  feed.mounts = 0
  feed.renders = 0
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized.push(callback) }
    observe(element: Element) { observed.push(element) }
    disconnect() { disconnected += 1 }
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document.documentElement, "scrollHeight")
})

describe("Um scroll só: a página rola primeiro, depois o feed", () => {
  it("com o cabeçalho à vista o feed não prende o gesto; embaixo das abas ele volta a rolar, e voltar ao topo devolve o gesto à página", () => {
    place(439)
    renderFeed()
    expect(area()).toHaveAttribute("data-page-first")
    // A trava é só de CSS, na rolagem do feed, enquanto o atributo existe.
    expect(area()).toHaveClass("data-page-first:[&_[data-slot=scroll-area-viewport]]:overflow-y-hidden!")
    place(120)
    fireEvent.scroll(window)
    expect(area()).not.toHaveAttribute("data-page-first")
    place(300)
    fireEvent.scroll(window)
    expect(area()).toHaveAttribute("data-page-first")
  })

  it("com a página no fim o feed rola mesmo sem chegar à linha das abas: nunca fica travado", () => {
    place(300, window.innerHeight)
    renderFeed()
    expect(area()).not.toHaveAttribute("data-page-first")
  })

  it("cabeçalho que muda de altura (sem rolagem) e janela redimensionada reavaliam", () => {
    place(120)
    renderFeed()
    expect(area()).not.toHaveAttribute("data-page-first")
    expect(observed).toEqual([area(), document.body])
    place(300)
    act(() => resized.forEach((callback) => callback()))
    expect(area()).toHaveAttribute("data-page-first")
    place(120)
    fireEvent(window, new Event("resize"))
    expect(area()).not.toHaveAttribute("data-page-first")
  })

  it("o feed monta uma vez e não renderiza de novo por causa da rolagem; ao sair, nada fica ouvindo", () => {
    place(439)
    const { unmount } = renderFeed()
    const element = area()
    place(120)
    fireEvent.scroll(window)
    place(300)
    fireEvent.scroll(window)
    expect(feed).toEqual({ mounts: 1, renders: 1 })
    unmount()
    expect(disconnected).toBe(1)
    place(120)
    fireEvent.scroll(window)
    fireEvent(window, new Event("resize"))
    expect(element).toHaveAttribute("data-page-first")
  })
})
