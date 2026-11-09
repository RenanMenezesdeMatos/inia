/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { StrictMode, useEffect, useState, type ReactNode } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { TooltipProvider } from "@/components/ui/tooltip"

import { useFeedbackWorkspace, type IniaVoiceEngine } from "./feedback-application/feedback-workspace-context"
import { FollowupWorkspaceShell } from "./followup-workspace-shell"

/** matchMedia controlado: `desktop` decide o `(min-width: 768px)`; o resto (reduced motion) não casa. */
let desktop = true
const stubMatchMedia = () => {
  window.matchMedia = (query: string) => ({ matches: desktop && query === "(min-width: 768px)", media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })
}

/** AudioContext mínimo (o jsdom não tem Web Audio): o bastante para `prime()` e `close()`. */
class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: AudioContextState = "running"
  currentTime = 0
  destination = {}
  close = vi.fn(async () => { this.state = "closed" })
  resume = vi.fn(async () => {})
  constructor() { FakeAudioContext.instances.push(this) }
  createGain() { return { gain: { value: 1, setTargetAtTime: () => {} }, connect: () => {}, disconnect: () => {} } }
}

const feedLife = { mounts: 0, unmounts: 0 }
let captured: IniaVoiceEngine | null = null
function Feed() {
  const workspace = useFeedbackWorkspace()
  useEffect(() => {
    captured = workspace?.voice ?? null
    feedLife.mounts += 1
    return () => { feedLife.unmounts += 1 }
  }, [workspace?.voice])
  return <p>Feed do acompanhamento</p>
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><TooltipProvider>{children}</TooltipProvider></QueryClientProvider>
}
const shell = <FollowupWorkspaceShell feed={<Feed />} renderChat={() => <div>Chat da INIA</div>} />

beforeAll(installJsdomStubs)
beforeEach(() => {
  desktop = true
  stubMatchMedia()
  feedLife.mounts = 0
  feedLife.unmounts = 0
  captured = null
  FakeAudioContext.instances = []
  vi.stubGlobal("AudioContext", FakeAudioContext)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("FollowupWorkspaceShell — feed montado uma vez", () => {
  it.each([["desktop", true], ["mobile", false]])("%s: com o layout conhecido só existe a cópia visível do feed", (_label, isDesktop) => {
    desktop = isDesktop
    render(<Providers>{shell}</Providers>)
    expect(screen.getAllByText("Feed do acompanhamento")).toHaveLength(1)
    expect(feedLife.mounts).toBe(1)
  })

  it("hidratação: as duas cópias do servidor hidratam, a escondida sai e a visível não remonta", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    container.innerHTML = renderToString(<Providers>{shell}</Providers>)
    // Servidor sem layout: o feed vai nas duas posições, como sempre.
    expect(container.textContent?.match(/Feed do acompanhamento/g)).toHaveLength(2)

    const root = await act(async () => hydrateRoot(container, <Providers>{shell}</Providers>))
    expect(screen.getAllByText("Feed do acompanhamento")).toHaveLength(1)
    expect(feedLife).toEqual({ mounts: 2, unmounts: 1 })
    act(() => root.unmount())
    container.remove()
  })
})

describe("FollowupWorkspaceShell — áudio", () => {
  it("sair do Acompanhamento fecha o AudioContext aberto no clique (mesmo no StrictMode)", () => {
    const view = render(<StrictMode><Providers>{shell}</Providers></StrictMode>)
    // O clique no feed libera o áudio: o contexto nasce aqui — depois do desmonta-e-monta do StrictMode, que não o fecha.
    act(() => captured!.playback.prime())
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0]!.close).not.toHaveBeenCalled()

    view.unmount()
    expect(FakeAudioContext.instances[0]!.close).toHaveBeenCalledTimes(1)
    // Fechar não é terminal: um novo prime() cria outro contexto.
    captured!.playback.prime()
    expect(FakeAudioContext.instances).toHaveLength(2)
  })
})
