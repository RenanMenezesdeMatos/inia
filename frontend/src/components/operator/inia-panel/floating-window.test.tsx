/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useEffect, useState } from "react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { FloatingWindow, type WindowPlace } from "./floating-window"
import { LARGE_WINDOW, MINI_WINDOW } from "./use-inia-stage"

const viewport = (width: number, height: number) => Object.assign(window, { innerWidth: width, innerHeight: height })
const browser = { width: window.innerWidth, height: window.innerHeight }
const resizeBrowser = (width: number, height: number) => act(() => {
  viewport(width, height)
  window.dispatchEvent(new Event("resize"))
})

let setMode: (mode: "mini" | "large") => void = () => {}
/** A mesma fiação do palco: UMA janela para a pequena e para a maior. */
function Stage({ start = "large", mini: miniStart = { x: 1532, y: 784, w: 300 }, large: largeStart = { x: 300, y: 300, w: 640 } }: { start?: "mini" | "large"; mini?: WindowPlace; large?: WindowPlace }) {
  const [mode, set] = useState(start)
  const [mini, setMini] = useState(miniStart)
  const [large, setLarge] = useState(largeStart)
  useEffect(() => {
    setMode = set
  }, [])
  return <FloatingWindow name="INIA" place={mode === "large" ? large : mini} onPlace={mode === "large" ? setLarge : setMini} {...(mode === "large" ? LARGE_WINDOW : MINI_WINDOW)}>INIA</FloatingWindow>
}

const box = () => {
  const { left, top, width, height } = screen.getByRole("dialog", { name: "INIA" }).style
  return { left: parseFloat(left), top: parseFloat(top), width: parseFloat(width), right: parseFloat(left) + parseFloat(width), bottom: parseFloat(top) + parseFloat(height) }
}
/** Inteira dentro da tela, sem passar por cima da barra do app (56 px). */
const expectInside = () => {
  const { left, top, right, bottom } = box()
  expect(left).toBeGreaterThanOrEqual(0)
  expect(top).toBeGreaterThanOrEqual(56)
  expect(right).toBeLessThanOrEqual(window.innerWidth)
  expect(bottom).toBeLessThanOrEqual(window.innerHeight)
}
const pointer = (target: Element | Window, type: string, x: number, y: number) => act(() => void target.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }), { pointerType: "mouse" })))
const corner = () => screen.getByRole("dialog", { name: "INIA" }).querySelector("[aria-hidden][data-no-drag]")!

beforeEach(() => void viewport(1366, 768))
afterEach(() => {
  cleanup()
  viewport(browser.width, browser.height)
})

describe("Janela da INIA: nunca sai da tela", () => {
  it("zoom de 200% ou janela baixa: a altura também limita (controles e alça de tamanho à vista)", () => {
    render(<Stage />)
    expect(box()).toMatchObject({ left: 300, width: 640 })
    resizeBrowser(683, 330)
    expectInside()
    resizeBrowser(320, 240)
    expectInside()
  })

  it("puxar o canto até o máximo numa tela baixa para na altura que cabe, e o contorno mostra esse tamanho", () => {
    viewport(1366, 650)
    render(<Stage />)
    pointer(corner(), "pointerdown", 900, 600)
    pointer(window, "pointermove", 1_900, 900)
    const outline = screen.getByRole("dialog", { name: "INIA" }).querySelector<HTMLElement>(".border-dashed")!
    expect(parseFloat(outline.style.height)).toBeLessThanOrEqual(650 - 60 - 12)
    pointer(window, "pointerup", 1_900, 900)
    expectInside()
    expect(box().width).toBe(parseFloat(outline.style.width))
    // Onde cabe, o limite continua sendo o do tamanho máximo.
    cleanup()
    viewport(1920, 1080)
    render(<Stage />)
    pointer(corner(), "pointerdown", 900, 600)
    pointer(window, "pointermove", 2_900, 900)
    pointer(window, "pointerup", 2_900, 900)
    expect(box().width).toBe(1_100)
    expectInside()
  })

  it("pequena ↔ maior é a mesma janela: cada lugar é reajustado à tela de agora ao voltar a ele", () => {
    viewport(1920, 1000)
    render(<Stage start="mini" large={{ x: 1100, y: 500, w: 640 }} />)
    act(() => setMode("large"))
    resizeBrowser(1024, 700)
    expectInside()
    act(() => setMode("mini"))
    expectInside()
    resizeBrowser(800, 420)
    act(() => setMode("large"))
    expectInside()
  })

  it("arrastar e as setas do teclado param na borda; o lugar escolhido dentro da tela não muda", () => {
    render(<Stage large={{ x: 300, y: 200, w: 640 }} />)
    const win = screen.getByRole("dialog", { name: "INIA" })
    const handle = screen.getByRole("button", { name: "Mover INIA. Use as setas do teclado." })
    fireEvent.keyDown(handle, { key: "ArrowLeft" })
    expect(box()).toMatchObject({ left: 284, top: 200 })
    for (let i = 0; i < 40; i += 1) fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true })
    expectInside()
    pointer(win, "pointerdown", 400, 300)
    pointer(window, "pointermove", -2_000, -2_000)
    expectInside()
    pointer(window, "pointermove", 5_000, 5_000)
    pointer(window, "pointerup", 5_000, 5_000)
    expectInside()
    const settled = box()
    resizeBrowser(1366, 768)
    expect(box()).toEqual(settled)
  })
})
