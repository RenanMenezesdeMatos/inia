/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { useEffect } from "react"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { OperatorIndicatorsData, OperatorProfile } from "@/schemas/operator"

import { OperatorFollowupWorkspace } from "./operator-followup-workspace"

const chatLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }))
vi.mock("./operator-inia-chat", () => ({
  OperatorIniaChat: () => {
    useEffect(() => {
      chatLifecycle.mounts += 1
      return () => {
        chatLifecycle.unmounts += 1
      }
    }, [])
    return <div data-testid="inia-chat">chat</div>
  },
}))
vi.mock("./operator-daily-feedback-feed", () => ({ OperatorDailyFeedbackFeed: () => <div>feed do Acompanhamento</div> }))
vi.mock("@/queries/feedback-applications/use-feedback-applications", () => ({ useFeedbackInviteQuery: () => ({ data: null }) }))

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  chatLifecycle.mounts = 0
  chatLifecycle.unmounts = 0
})

const OPERATOR = { name: "Camila Souza" } as unknown as OperatorProfile
const INDICATORS = {} as OperatorIndicatorsData

describe("Tela pequena (o matchMedia do jsdom não casa com 1024 px): uma coluna por vez, com alternância", () => {
  it("alternar não desmonta nada: a conversa, a voz e a posição de leitura ficam; a coluna inativa sai da vista", () => {
    renderWithQuery(<OperatorFollowupWorkspace indicators={INDICATORS} operator={OPERATOR} />)
    const toggle = screen.getByRole("tablist", { name: "Alternar entre o Acompanhamento e a INIA" })
    const feedTab = within(toggle).getByRole("tab", { name: "Acompanhamento" })
    const chatTab = within(toggle).getByRole("tab", { name: "INIA" })
    expect(feedTab).toHaveAttribute("aria-selected", "true")
    const feedPanel = screen.getByText("feed do Acompanhamento").closest('[role="tabpanel"]')!
    const chatPanel = screen.getByTestId("inia-chat").closest('[role="tabpanel"]')!
    expect(feedPanel).toHaveAttribute("data-state", "active")
    expect(chatPanel).toHaveAttribute("data-state", "inactive")

    fireEvent.mouseDown(chatTab)
    expect(chatTab).toHaveAttribute("aria-selected", "true")
    expect(feedPanel).toHaveAttribute("data-state", "inactive")
    expect(chatPanel).toHaveAttribute("data-state", "active")
    expect(screen.getByText("feed do Acompanhamento")).toBeInTheDocument()
    expect(chatLifecycle.mounts).toBe(1)
    expect(chatLifecycle.unmounts).toBe(0)
  })
})

describe("Um scroll só: a página rola primeiro, depois as colunas", () => {
  const placeWorkspace = (top: number, documentHeight = 2000) => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top } as DOMRect)
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: documentHeight })
  }
  const workspace = (container: HTMLElement) => container.querySelector(".h-full.min-h-0.w-full")!
  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 0 })
  })

  it("com o cabeçalho à vista as colunas não prendem o gesto; embaixo das abas elas voltam a rolar", () => {
    placeWorkspace(439)
    const { container } = renderWithQuery(<OperatorFollowupWorkspace indicators={INDICATORS} operator={OPERATOR} />)
    expect(workspace(container)).toHaveAttribute("data-page-first")
    placeWorkspace(120)
    fireEvent.scroll(window)
    expect(workspace(container)).not.toHaveAttribute("data-page-first")
    placeWorkspace(300)
    fireEvent.scroll(window)
    expect(workspace(container)).toHaveAttribute("data-page-first")
  })

  it("com a página no fim as colunas rolam mesmo sem chegar à linha das abas: nunca ficam travadas", () => {
    placeWorkspace(300, window.innerHeight)
    const { container } = renderWithQuery(<OperatorFollowupWorkspace indicators={INDICATORS} operator={OPERATOR} />)
    expect(workspace(container)).not.toHaveAttribute("data-page-first")
  })
})
