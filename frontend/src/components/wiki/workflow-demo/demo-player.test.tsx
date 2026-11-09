/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DemoGallery } from "./demo-gallery"
import { DemoPlayer } from "./demo-player"

const fetchSpy = vi.fn()

beforeEach(() => {
  fetchSpy.mockReset()
  vi.stubGlobal("fetch", fetchSpy)
  window.location.hash = ""
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()
  cleanup()
  vi.unstubAllGlobals()
})

const open = () => fireEvent.click(screen.getByRole("button", { name: /Ver exemplo na prática/ }))
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }))
const stepLabel = () => screen.getByTestId("demo-step-label").textContent
const currentNode = (container: HTMLElement) => container.querySelector('[aria-current="step"]')?.getAttribute("data-node")

describe("DemoPlayer", () => {
  it("começa fechado, identificado como demonstração, e abre com o contexto antes da primeira etapa", () => {
    render(<DemoPlayer slug="nota-ura-baixa" />)
    expect(screen.getByText(/dados fictícios/i)).toBeInTheDocument()
    expect(screen.queryByTestId("demo-intro")).not.toBeInTheDocument()
    open()
    expect(screen.getByText("Demonstração com dados fictícios")).toBeInTheDocument()
    expect(screen.getByTestId("demo-intro")).toHaveTextContent("Objetivo")
    expect(screen.getByTestId("demo-intro")).toHaveTextContent("Resultado esperado")
    expect(stepLabel()).toBe("Antes de começar")
  })

  it("anda com Próximo e Anterior, destaca o nó em foco e mostra o progresso", () => {
    const { container } = render(<DemoPlayer slug="nota-ura-baixa" />)
    open()
    click("Começar")
    expect(stepLabel()).toBe("Etapa 1 de 6")
    expect(currentNode(container)).toBe("gatilho")
    click(/Próximo/)
    expect(stepLabel()).toBe("Etapa 2 de 6")
    expect(currentNode(container)).toBe("condicao")
    expect(container.querySelector('[data-node="gatilho"]')).toHaveAttribute("data-state", "done")
    click(/Anterior/)
    expect(stepLabel()).toBe("Etapa 1 de 6")
    expect(screen.getByRole("progressbar", { name: "Progresso da demonstração" })).toHaveAttribute("aria-valuetext", "Etapa 1 de 6")
  })

  it("mostra configuração com os rótulos do produto, entrada, resultado e como reproduzir", () => {
    render(<DemoPlayer slug="nota-ura-baixa" />)
    open()
    click("Começar")
    click(/Próximo/)
    const config = screen.getByRole("region", { name: "Configuração ilustrativa: Condição" })
    expect(within(config).getByText("Baseado em")).toBeInTheDocument()
    expect(within(config).getByText("é menor ou igual a")).toBeInTheDocument()
    expect(within(config).getByText("exemplo")).toBeInTheDocument()
    expect(within(config).getByText("Ilustração da configuração")).toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Como reproduzir no módulo real" })).toHaveTextContent("Baseado em")
  })

  it("trocar de desfecho só troca as cenas: mantém a parte comum e volta ao último ponto em comum", () => {
    const { container } = render(<DemoPlayer slug="nota-ura-baixa" />)
    open()
    click("Começar")
    click(/Próximo/)
    click(/Próximo/)
    expect(currentNode(container)).toBe("analise")
    fireEvent.click(screen.getByRole("radio", { name: "Nota dentro do esperado" }))
    expect(currentNode(container)).toBe("gatilho")
    expect(stepLabel()).toBe("Etapa 1 de 3")
    click(/Próximo/)
    click(/Próximo/)
    expect(currentNode(container)).toBe("fim")
    expect(screen.getByText("Nenhuma mensagem")).toBeInTheDocument()
    expect(container.querySelector('[data-node="analise"]')).toHaveAttribute("data-state", "off-path")
  })

  it("o desfecho sem evidência termina sem entrega, e o sem dados de 09h/15h também", () => {
    const { container, unmount } = render(<DemoPlayer slug="nota-ura-baixa" />)
    open()
    fireEvent.click(screen.getByRole("radio", { name: "Nota baixa, sem evidência" }))
    click("Começar")
    for (let step = 0; step < 3; step += 1) click(/Próximo/)
    expect(currentNode(container)).toBe("feedback")
    expect(screen.getByText("O Caio não recebe uma orientação sem base")).toBeInTheDocument()
    unmount()

    const second = render(<DemoPlayer slug="dois-momentos-do-dia" />)
    open()
    fireEvent.click(screen.getByRole("radio", { name: "Sem dados no horário" }))
    click("Começar")
    click(/Próximo/)
    click(/Próximo/)
    expect(currentNode(second.container)).toBe("entrega")
    expect(screen.getByText("A Bianca não recebe nada neste horário")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Dois horários não garantem duas entregas" })).toBeInTheDocument()
  })

  it("as decisões da revisão humana só alternam cenas", () => {
    const { container } = render(<DemoPlayer slug="revisao-antes-da-entrega" />)
    open()
    click("Começar")
    for (let step = 0; step < 4; step += 1) click(/Próximo/)
    expect(currentNode(container)).toBe("revisao")
    click("Escalar")
    expect(currentNode(container)).toBe("escalonar")
    expect(screen.getByRole("radio", { name: "Escalar" })).toBeChecked()
    click(/Anterior/)
    click("Reprovar")
    expect(currentNode(container)).toBe("fim")
    expect(screen.getByText("Nada chega à Elisa")).toBeInTheDocument()
    click(/Anterior/)
    click("Aprovar")
    expect(currentNode(container)).toBe("entrega")
  })

  it("conclui e reinicia do começo, no primeiro desfecho", () => {
    const { container } = render(<DemoPlayer slug="dois-momentos-do-dia" />)
    open()
    fireEvent.click(screen.getByRole("radio", { name: "Disparo das 15:00" }))
    click("Começar")
    for (let step = 0; step < 3; step += 1) click(/Próximo/)
    click(/Concluir/)
    expect(screen.getByTestId("demo-done")).toHaveTextContent("Disparo das 15:00")
    expect(screen.getByRole("button", { name: /Próximo/ })).toBeDisabled()
    click(/Reiniciar/)
    expect(stepLabel()).toBe("Antes de começar")
    expect(screen.getByRole("radio", { name: "Disparo das 09:00" })).toBeChecked()
    expect(currentNode(container)).toBeUndefined()
  })

  it("navega pelo teclado e leva o foco ao título ao mudar de etapa", () => {
    render(<DemoPlayer slug="nota-ura-baixa" />)
    open()
    click("Começar")
    const player = screen.getByRole("group", { name: /Demonstração guiada/ })
    fireEvent.keyDown(player, { key: "ArrowRight" })
    expect(stepLabel()).toBe("Etapa 2 de 6")
    fireEvent.keyDown(player, { key: "ArrowLeft" })
    expect(stepLabel()).toBe("Etapa 1 de 6")
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Feedback por nota URA baixa", level: 3 }))
  })

  it("anuncia a etapa para leitores de tela", () => {
    render(<DemoPlayer slug="nota-ura-baixa" />)
    open()
    click("Começar")
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent("Etapa 1 de 6: Chega uma nota de uma chamada")
  })

  it("chegar pela âncora de uma etapa abre a demonstração nela", () => {
    window.location.hash = "#orientar-e-reavaliar--espera"
    const { container } = render(<DemoPlayer slug="orientar-e-reavaliar" />)
    expect(currentNode(container)).toBe("espera")
    expect(screen.getByRole("heading", { name: "A execução dorme por 7 dias" })).toBeInTheDocument()
  })

  it("chegar pela âncora do exemplo abre o contexto; âncora de outro exemplo não abre", () => {
    window.location.hash = "#nota-ura-baixa"
    const first = render(<DemoPlayer slug="nota-ura-baixa" />)
    expect(screen.getByTestId("demo-intro")).toBeInTheDocument()
    first.unmount()
    render(<DemoPlayer slug="destaques-do-mes" />)
    expect(screen.queryByTestId("demo-intro")).not.toBeInTheDocument()
  })
})

describe("DemoGallery", () => {
  it("filtra por objetivo, com o que inicia, quem recebe e os nós ensinados em cada cartão", () => {
    render(<DemoGallery />)
    expect(screen.getAllByRole("link", { name: /Ver exemplo na prática/ })).toHaveLength(6)
    fireEvent.click(screen.getByRole("radio", { name: "Reconhecer resultados" }))
    const links = screen.getAllByRole("link", { name: /Ver exemplo na prática/ })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute("href", "#destaques-do-mes")
    const card = links[0]!.closest("li")!
    expect(card).toHaveTextContent("O que inicia")
    expect(card).toHaveTextContent("Quem recebe")
    expect(card).toHaveTextContent("Selecionar colaboradores")
  })
})
