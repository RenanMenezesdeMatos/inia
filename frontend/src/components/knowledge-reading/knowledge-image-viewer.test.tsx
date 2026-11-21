// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"

import { KnowledgeDocumentImage } from "./knowledge-document-image"
import type { ViewerImage } from "./knowledge-image-viewer"

afterEach(cleanup)

const images: ViewerImage[] = [
  { key: "a", src: "/img/a", page: 2, width: 800, height: 400, caption: "Manual · p. 2", description: "1. Acesse o portal do cliente." },
  { key: "b", src: "/img/b", page: 3, width: 800, height: 400, caption: "Manual · p. 3" },
  { key: "c", src: "/img/c", page: 5, width: 800, height: 400, caption: "Manual · p. 5", description: "3. Clique em Salvar." },
]

function openAt(index: number) {
  const image = images[index]!
  render(<KnowledgeDocumentImage src={image.src} page={image.page} width={image.width} height={image.height} caption={image.caption} gallery={{ images, index }} />)
  fireEvent.click(screen.getByRole("button", { name: `Ampliar a imagem da página ${image.page} (imagem ${index + 1} de 3)` }))
  return screen.getByRole("dialog")
}

const shownSrc = (dialog: HTMLElement) => within(dialog).getByRole("img").getAttribute("src")

describe("imagem ampliada com o conjunto do material", () => {
  it("abre na imagem clicada, diz 'imagem X de Y' e mostra o texto da base junto dela", () => {
    const dialog = openAt(0)
    expect(within(dialog).getByRole("heading", { name: "Imagem 1 de 3 · Página 2" })).toBeTruthy()
    expect(shownSrc(dialog)).toBe("/img/a")
    expect(within(dialog).getByTestId("knowledge-image-viewer-description").textContent).toContain("1. Acesse o portal do cliente.")
    expect(within(dialog).getByText("Imagem 1 de 3", { selector: "[aria-live]" })).toBeTruthy()
  })

  it("setas na tela vão à próxima e à anterior; nas pontas ficam desligadas", () => {
    const dialog = openAt(0)
    const previous = within(dialog).getByRole("button", { name: "Imagem anterior" })
    const next = within(dialog).getByRole("button", { name: "Próxima imagem" })
    expect(previous.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(previous)
    expect(shownSrc(dialog)).toBe("/img/a")
    fireEvent.click(next)
    expect(shownSrc(dialog)).toBe("/img/b")
    expect(within(dialog).getByRole("heading", { name: "Imagem 2 de 3 · Página 3" })).toBeTruthy()
    fireEvent.click(next)
    expect(shownSrc(dialog)).toBe("/img/c")
    expect(next.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(next)
    expect(shownSrc(dialog)).toBe("/img/c")
    fireEvent.click(previous)
    expect(shownSrc(dialog)).toBe("/img/b")
  })

  it("← e → do teclado trocam a imagem; Esc fecha", async () => {
    const dialog = openAt(1)
    fireEvent.keyDown(dialog, { key: "ArrowRight" })
    expect(shownSrc(dialog)).toBe("/img/c")
    fireEvent.keyDown(dialog, { key: "ArrowRight" })
    expect(shownSrc(dialog)).toBe("/img/c")
    fireEvent.keyDown(dialog, { key: "ArrowLeft" })
    fireEvent.keyDown(dialog, { key: "ArrowLeft" })
    expect(shownSrc(dialog)).toBe("/img/a")
    fireEvent.keyDown(dialog, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    // Ao fechar, o foco volta para a miniatura que abriu, e quem usa teclado continua de onde estava.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ampliar a imagem da página 3 (imagem 2 de 3)" })))
  })

  it("o gesto de passar para o lado no toque troca a imagem; toque curto ou rolagem não", () => {
    const dialog = openAt(0)
    const stage = within(dialog).getByTestId("knowledge-image-viewer-stage")
    const swipe = (from: [number, number], to: [number, number]) => {
      // `changedTouches` nos dois: o bloqueio de rolagem do modal (react-remove-scroll) também lê o toque.
      const start = [{ clientX: from[0], clientY: from[1] }]
      const end = [{ clientX: to[0], clientY: to[1] }]
      fireEvent.touchStart(stage, { touches: start, changedTouches: start, targetTouches: start })
      fireEvent.touchEnd(stage, { touches: [], changedTouches: end, targetTouches: [] })
    }
    swipe([300, 200], [120, 210])
    expect(shownSrc(dialog)).toBe("/img/b")
    swipe([300, 200], [290, 200])
    expect(shownSrc(dialog)).toBe("/img/b")
    swipe([300, 100], [240, 400])
    expect(shownSrc(dialog)).toBe("/img/b")
    swipe([120, 200], [300, 190])
    expect(shownSrc(dialog)).toBe("/img/a")
  })

  it("imagem sem texto da base junto dela não ganha descrição", () => {
    const dialog = openAt(1)
    expect(within(dialog).queryByTestId("knowledge-image-viewer-description")).toBeNull()
  })

  it("o foco fica dentro do modal e o botão de fechar tem nome em português", () => {
    const dialog = openAt(0)
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.click(within(dialog).getByRole("button", { name: "Fechar a imagem ampliada" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("imagem sozinha (sem conjunto) abre sem setas nem contador", () => {
    render(<KnowledgeDocumentImage src="/img/x" page={4} width={600} height={300} caption="Imagem da página 4." description="Confira o protocolo." />)
    fireEvent.click(screen.getByRole("button", { name: "Ampliar a imagem da página 4" }))
    const dialog = screen.getByRole("dialog")
    expect(within(dialog).getByRole("heading", { name: "Página 4" })).toBeTruthy()
    expect(within(dialog).queryByRole("button", { name: "Próxima imagem" })).toBeNull()
    expect(within(dialog).getByText("Confira o protocolo.")).toBeTruthy()
  })
})
