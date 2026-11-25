/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { useEffect, useState, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { useFeedbackWorkspace, type FeedbackWorkspace } from "../feedback-application/feedback-workspace-context"
import { useIniaPanel } from "./inia-panel-context"
import { IniaPanelShell } from "./inia-panel-shell"

const close = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("../feedback-application/feedback-workspace-context", async (original) => ({
  ...(await original<typeof import("../feedback-application/feedback-workspace-context")>()),
  createIniaVoiceEngine: () => ({ playback: { close, prime: () => {} }, lipsync: {}, driver: {} }),
}))
vi.mock("@/services/feedback-applications/feedback-applications-service", async (original) => ({ ...(await original<Record<string, unknown>>()), fetchFeedbackInvite: vi.fn(async () => null) }))

let wide = true
const media = new Set<() => void>()
/** Alargar ou estreitar a janela com a tela montada. */
const setWide = (value: boolean) => act(() => {
  wide = value
  media.forEach((notify) => notify())
})
const browser = { width: window.innerWidth }
beforeEach(() => {
  installJsdomStubs()
  wide = true
  media.clear()
  vi.stubGlobal("matchMedia", (query: string) => ({ get matches() { return query.includes("min-width") && wide }, media: query, addEventListener: (_: string, notify: () => void) => media.add(notify), removeEventListener: (_: string, notify: () => void) => media.delete(notify) }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  close.mockClear()
  Object.assign(window, { innerWidth: browser.width })
})

const mounts = { chat: 0 }
let workspace: FeedbackWorkspace | null = null
function Chat({ hidden }: { hidden: boolean }) {
  const panel = useIniaPanel()!
  const current = useFeedbackWorkspace()
  useEffect(() => {
    workspace = current
  }, [current])
  useEffect(() => {
    mounts.chat += 1
  }, [])
  const { registerActions, setOpen } = panel
  useEffect(() => {
    registerActions({ expand: () => setOpen(true), collapse: () => setOpen(false) })
    return () => registerActions(null)
  }, [registerActions, setOpen])
  return <><textarea aria-label="campo" data-hidden={hidden} /><button type="button" data-chat-collapse="" onClick={() => setOpen(false)}>recolher</button></>
}

function Profile({ startClosedOnNarrow, onShowFeed = () => {} }: { startClosedOnNarrow?: boolean; onShowFeed?: () => void }) {
  const [tab, setTab] = useState("followup")
  return (
    <IniaPanelShell renderChat={(chat) => <Chat {...chat} />} startClosedOnNarrow={startClosedOnNarrow} feedVisible={tab === "followup"} onShowFeed={onShowFeed}>
      <button type="button" onClick={() => setTab("indicators")}>Indicadores</button>
      <button type="button" data-inia-edge-tab="">aba</button>
      <p>{tab}</p>
    </IniaPanelShell>
  )
}
const withQuery = (ui: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
const panelState = () => screen.getByRole("complementary", { name: "INIA", hidden: true }).getAttribute("data-state")

describe("painel da INIA no perfil", () => {
  it("abre expandido; trocar de aba do perfil não desmonta o chat nem perde o rascunho", () => {
    mounts.chat = 0
    render(withQuery(<Profile />))
    expect(panelState()).toBe("open")
    fireEvent.change(screen.getByLabelText("campo"), { target: { value: "rascunho" } })
    fireEvent.click(screen.getByRole("button", { name: "Indicadores" }))
    expect(screen.getByText("indicators")).toBeInTheDocument()
    expect(screen.getByLabelText("campo")).toHaveValue("rascunho")
    expect(mounts.chat).toBe(1)
  })

  it("recolher e reabrir: só por pedido, com o chat montado, a página ocupando o espaço e o foco acompanhando", () => {
    render(withQuery(<Profile />))
    const page = document.querySelector("[data-inia-page]")!
    expect(page).toHaveAttribute("data-inia-page", "panel-open")
    fireEvent.click(screen.getByRole("button", { name: "recolher" }))
    expect(panelState()).toBe("collapsed")
    expect(page).toHaveAttribute("data-inia-page", "panel-collapsed")
    expect(screen.getByLabelText("campo")).toHaveAttribute("data-hidden", "true")
    expect(screen.getByRole("button", { name: "aba" })).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: "Indicadores" }))
    expect(panelState()).toBe("collapsed")
    act(() => workspace!.revealChat())
    expect(panelState()).toBe("open")
    expect(screen.getByRole("button", { name: "recolher" })).toHaveFocus()
  })

  it("janela estreita: quem veio ver um item ou outra aba começa com o painel recolhido; no Acompanhamento, aberto", () => {
    wide = false
    const { unmount } = render(withQuery(<Profile startClosedOnNarrow />))
    expect(panelState()).toBe("collapsed")
    unmount()
    render(withQuery(<Profile />))
    expect(panelState()).toBe("open")
  })

  it("\"Ler feedback\" de outra aba abre o Acompanhamento e, na janela estreita, tira o painel da frente", () => {
    wide = false
    const onShowFeed = vi.fn()
    render(withQuery(<Profile onShowFeed={onShowFeed} />))
    fireEvent.click(screen.getByRole("button", { name: "Indicadores" }))
    act(() => workspace!.readFeedback({ kind: "PUBLISHED_FEEDBACK", id: "f1" }))
    expect(onShowFeed).toHaveBeenCalledTimes(1)
    expect(panelState()).toBe("collapsed")
    expect(workspace!.readTarget?.key).toContain("f1")
  })

  describe("janela estreita: o destino que chega com a tela aberta", () => {
    /** O que o perfil passa: aba + item da URL. */
    const at = (destination: string, startClosedOnNarrow: boolean, chat = true) => withClient(
      <IniaPanelShell renderChat={chat ? (props) => <Chat {...props} /> : undefined} startClosedOnNarrow={startClosedOnNarrow} destination={destination} feedVisible={destination.startsWith("followup")} onShowFeed={() => {}}>
        <button type="button" role="tab" aria-selected="true">aba do perfil</button>
        <button type="button" data-inia-edge-tab="">aba</button>
      </IniaPanelShell>,
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const withClient = (ui: ReactNode) => <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    const settle = () => act(async () => {})

    it("item do sino ou outra aba: o painel sai da frente; a pessoa que o reabre fica com ele até o destino mudar de novo", async () => {
      wide = false
      const { rerender } = render(at("followup:", false))
      expect(panelState()).toBe("open")
      rerender(at("followup:FEEDBACK:1", true))
      await settle()
      expect(panelState()).toBe("collapsed")

      act(() => workspace!.revealChat())
      expect(panelState()).toBe("open")
      // Renderizar de novo com o mesmo destino (dados, contadores) não recolhe.
      rerender(at("followup:FEEDBACK:1", true))
      await settle()
      expect(panelState()).toBe("open")

      // Outro item da mesma aba é outro destino.
      rerender(at("followup:FEEDBACK:2", true))
      await settle()
      expect(panelState()).toBe("collapsed")
      act(() => workspace!.revealChat())
      rerender(at("pending:", true))
      await settle()
      expect(panelState()).toBe("collapsed")
    })

    it("voltar ao Acompanhamento sem item (a conversa da INIA chega por ali) não recolhe", async () => {
      wide = false
      const { rerender } = render(at("pending:", true))
      expect(panelState()).toBe("collapsed")
      act(() => workspace!.revealChat())
      rerender(at("followup:", false))
      await settle()
      expect(panelState()).toBe("open")
    })

    it("o contexto que chega depois da primeira pintura decide o começo, sem recolher na frente da pessoa; a mesma URL não recolhe de novo", async () => {
      wide = false
      const { rerender } = render(at("pending:", false, false))
      rerender(at("pending:", true))
      expect(panelState()).toBe("collapsed")
      expect(document.body).toHaveFocus()
      act(() => workspace!.revealChat())
      // A aba some e volta (disponibilidade do Apoio): a URL é a mesma.
      rerender(at("pending:", false))
      rerender(at("pending:", true))
      await settle()
      expect(panelState()).toBe("open")
    })

    it("janela larga: o painel fica ao lado e nada muda", async () => {
      const { rerender } = render(at("followup:", false))
      rerender(at("indicators:", true))
      await settle()
      expect(panelState()).toBe("open")
    })

    it("foco: quem está fora do painel fica onde está; quem tocou num link dentro dele vai para a aba do perfil que se abriu", async () => {
      wide = false
      const outside = document.body.appendChild(document.createElement("button"))
      const { rerender } = render(at("followup:", false))
      outside.focus()
      rerender(at("followup:FEEDBACK:1", true))
      await settle()
      expect(panelState()).toBe("collapsed")
      expect(outside).toHaveFocus()
      outside.remove()

      act(() => workspace!.revealChat())
      screen.getByRole("button", { name: "recolher" }).focus()
      rerender(at("people:", true))
      await settle()
      expect(screen.getByRole("tab", { name: "aba do perfil" })).toHaveFocus()
    })
  })

  describe("janela estreita: a página coberta pelo painel", () => {
    const page = () => document.querySelector("[data-inia-page]")!

    it("fica inerte só enquanto o painel a cobre: recolher, reabrir, alargar e estreitar acompanham; o que está fora dela não", () => {
      wide = false
      const portal = document.body.appendChild(document.createElement("div"))
      render(withQuery(<Profile />))
      expect(page()).toHaveAttribute("inert")
      expect(portal).not.toHaveAttribute("inert")
      expect(document.body).not.toHaveAttribute("inert")
      expect(screen.getByRole("complementary", { name: "INIA", hidden: true })).not.toHaveAttribute("inert")
      fireEvent.click(screen.getByRole("button", { name: "recolher" }))
      expect(page()).not.toHaveAttribute("inert")
      act(() => workspace!.revealChat())
      expect(page()).toHaveAttribute("inert")
      setWide(true)
      expect(panelState()).toBe("open")
      expect(page()).not.toHaveAttribute("inert")
      setWide(false)
      expect(page()).toHaveAttribute("inert")
      portal.remove()
    })

    it("começando recolhido, na janela larga, ou sem o painel, nunca fica inerte", () => {
      wide = false
      const { unmount } = render(withQuery(<Profile startClosedOnNarrow />))
      expect(page()).not.toHaveAttribute("inert")
      unmount()
      const alone = render(withQuery(<IniaPanelShell feedVisible onShowFeed={() => {}}><p>página</p></IniaPanelShell>))
      expect(page()).not.toHaveAttribute("inert")
      alone.unmount()
      wide = true
      render(withQuery(<Profile />))
      expect(page()).not.toHaveAttribute("inert")
    })

    it("ao fechar a sessão de feedback, o foco não vai para um botão coberto: fica no painel", () => {
      wide = false
      vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList)
      render(withQuery(<IniaPanelShell renderChat={(chat) => <Chat {...chat} />} feedVisible onShowFeed={() => {}}><button type="button" data-feedback-action="k1">ouvir</button><button type="button" data-inia-edge-tab="">aba</button></IniaPanelShell>))
      act(() => void expect(workspace!.focusFeedbackTrigger("k1")).toBe(true))
      expect(screen.getByRole("button", { name: "recolher" })).toHaveFocus()
      fireEvent.click(screen.getByRole("button", { name: "recolher" }))
      act(() => void expect(workspace!.focusFeedbackTrigger("k1")).toBe(true))
      expect(screen.getByRole("button", { name: "ouvir" })).toHaveFocus()
      vi.restoreAllMocks()
    })
  })

  it("\"Ler feedback\" na janela estreita: o foco vai para o feedback pedido, não para a aba da borda", () => {
    wide = false
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as unknown as DOMRectList)
    render(withQuery(<IniaPanelShell renderChat={(chat) => <Chat {...chat} />} feedVisible onShowFeed={() => {}}><button type="button" data-feedback-action="PUBLISHED_FEEDBACK:f1">ouvir</button><button type="button" data-inia-edge-tab="">aba</button></IniaPanelShell>))
    screen.getByRole("button", { name: "recolher" }).focus()
    act(() => workspace!.readFeedback({ kind: "PUBLISHED_FEEDBACK", id: "f1" }))
    expect(panelState()).toBe("collapsed")
    expect(screen.getByRole("button", { name: "aba" })).not.toHaveFocus()
    expect(screen.getByRole("button", { name: "ouvir" })).toHaveFocus()
    // Recolher pelo botão continua levando o foco à aba.
    act(() => workspace!.revealChat())
    fireEvent.click(screen.getByRole("button", { name: "recolher" }))
    expect(screen.getByRole("button", { name: "aba" })).toHaveFocus()
    vi.restoreAllMocks()
  })

  describe("largura do painel", () => {
    const handle = () => screen.getByRole("separator", { name: "Largura do painel da INIA" })
    const chosen = () => screen.getByRole("complementary", { name: "INIA" }).style.getPropertyValue("--inia-panel-wide")
    const at = (viewport: number) => {
      Object.assign(window, { innerWidth: viewport })
      render(withQuery(<Profile />))
    }
    const limits = () => [handle().getAttribute("aria-valuemin"), handle().getAttribute("aria-valuenow"), handle().getAttribute("aria-valuemax")].map(Number)

    it("o teclado parte da largura real (28% da tela), não do padrão: a seta da direita estreita e a da esquerda alarga", () => {
      at(1280)
      expect(limits()).toEqual([340, 358, 486])
      fireEvent.keyDown(handle(), { key: "ArrowRight" })
      expect(chosen()).toContain("340px")
      expect(limits()).toEqual([340, 340, 486])
      fireEvent.keyDown(handle(), { key: "ArrowLeft" })
      expect(limits()).toEqual([340, 364, 486])
    })

    it("Home e End vão ao mínimo e ao teto real (38% da tela, até 520), sem faixa morta", () => {
      at(1024)
      expect(limits()).toEqual([340, 340, 389])
      fireEvent.keyDown(handle(), { key: "End" })
      expect(limits()).toEqual([340, 389, 389])
      fireEvent.keyDown(handle(), { key: "ArrowLeft" })
      expect(limits()).toEqual([340, 389, 389])
      fireEvent.keyDown(handle(), { key: "Home" })
      expect(limits()).toEqual([340, 340, 389])
      act(() => {
        Object.assign(window, { innerWidth: 1920 })
        window.dispatchEvent(new Event("resize"))
      })
      fireEvent.keyDown(handle(), { key: "End" })
      expect(limits()).toEqual([340, 520, 520])
    })

    it("tela em que 38% é menos que o mínimo: o primeiro toque na alça não encolhe o painel", () => {
      at(880)
      expect(limits()).toEqual([340, 340, 340])
      fireEvent.keyDown(handle(), { key: "ArrowLeft" })
      expect(chosen()).toBe("min(340px, max(340px, 38vw))")
    })

    it("no toque, arrastar a alça não vira rolagem", () => {
      at(1280)
      expect(handle()).toHaveClass("touch-none")
    })
  })

  it("pessoa sem o painel: só a página, na mesma coluna", () => {
    render(withQuery(<IniaPanelShell feedVisible onShowFeed={() => {}}><p>página</p></IniaPanelShell>))
    expect(screen.queryByRole("complementary", { name: "INIA" })).toBeNull()
    expect(document.querySelector("[data-inia-page]")).toHaveAttribute("data-inia-page", "no-panel")
  })

  it("servidor: a página e o lugar do painel, sem o chat; ao hidratar, o chat monta uma vez e nada remonta na página", async () => {
    mounts.chat = 0
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const container = document.body.appendChild(document.createElement("div"))
    container.innerHTML = renderToString(withQuery(<Profile />))
    expect(container.querySelector("textarea")).toBeNull()
    const text = container.querySelector("p")
    const root = await act(async () => hydrateRoot(container, withQuery(<Profile />)))
    expect(container.querySelector("p")).toBe(text)
    expect(container.querySelector("textarea")).not.toBeNull()
    expect(mounts.chat).toBe(1)
    expect(error).not.toHaveBeenCalled()
    act(() => root.unmount())
    container.remove()
    error.mockRestore()
  })

  it("sair do perfil fecha o AudioContext aberto no clique", () => {
    const { unmount } = render(withQuery(<Profile />))
    unmount()
    expect(close).toHaveBeenCalled()
  })
})
