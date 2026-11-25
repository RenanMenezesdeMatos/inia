/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useFollowLatest } from "./use-follow-latest"

/** Lista de 200 px de altura com conteúdo de altura controlada (o jsdom não tem layout). */
let contentHeight = 0
let viewportHeight = 200
let resized: (() => void)[] = []

function List() {
  const { setViewport, away, followLatest } = useFollowLatest()
  const attach = (element: HTMLDivElement | null) => {
    if (element && !Object.getOwnPropertyDescriptor(element, "scrollHeight")) {
      let top = 0
      Object.defineProperties(element, {
        scrollHeight: { get: () => contentHeight },
        clientHeight: { get: () => viewportHeight },
        scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, contentHeight - viewportHeight)) } },
      })
    }
    setViewport(element)
  }
  return <><div ref={attach} data-testid="viewport"><div /></div>{away ? <button type="button" onClick={followLatest}>Ir para a resposta mais recente</button> : null}</>
}

const viewport = () => screen.getByTestId("viewport")
const grow = (height: number) => act(() => { contentHeight = height; resized.forEach((callback) => callback()) })
/** Rolagem da pessoa (com o gesto da roda). */
const scrollTo = (top: number) => { fireEvent.wheel(viewport()); viewport().scrollTop = top; fireEvent.scroll(viewport()) }
const jump = () => screen.queryByRole("button", { name: "Ir para a resposta mais recente" })

beforeEach(() => {
  contentHeight = 400
  viewportHeight = 200
  resized = []
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized.push(callback) }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("Acompanhar a resposta", () => {
  it("no fim, a lista segue a resposta enquanto ela cresce e enquanto o painel muda de tamanho", () => {
    render(<List />)
    grow(900)
    expect(viewport().scrollTop).toBe(700)
    act(() => { viewportHeight = 120; resized.forEach((callback) => callback()) })
    expect(viewport().scrollTop).toBe(780)
    expect(jump()).not.toBeInTheDocument()
  })

  it("quem sobe (mesmo pouco) fica onde está e ganha a volta; a volta retoma o acompanhamento", () => {
    render(<List />)
    grow(900)
    scrollTo(690)
    grow(1000)
    expect(viewport().scrollTop).toBe(690)
    fireEvent.click(jump()!)
    expect(viewport().scrollTop).toBe(800)
    expect(jump()).not.toBeInTheDocument()
    grow(1200)
    expect(viewport().scrollTop).toBe(1000)
  })

  it("subir SEM gesto (o conteúdo encolheu e cresceu antes de o evento chegar) não é a pessoa: continua acompanhando", () => {
    vi.spyOn(performance, "now").mockReturnValue(1_000_000)
    render(<List />)
    grow(900)
    viewport().scrollTop = 100
    fireEvent.scroll(viewport())
    expect(viewport().scrollTop).toBe(700)
    expect(jump()).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it("rolar de volta até perto do fim também retoma", () => {
    render(<List />)
    grow(900)
    scrollTo(300)
    expect(jump()).toBeInTheDocument()
    scrollTo(690)
    expect(jump()).not.toBeInTheDocument()
    grow(1000)
    expect(viewport().scrollTop).toBe(800)
  })

  it("recolher e reabrir devolve a posição de leitura", () => {
    render(<List />)
    grow(900)
    scrollTo(300)
    act(() => { viewportHeight = 0; resized.forEach((callback) => callback()) })
    viewport().scrollTop = 0
    act(() => { viewportHeight = 200; resized.forEach((callback) => callback()) })
    expect(viewport().scrollTop).toBe(300)
  })
})
