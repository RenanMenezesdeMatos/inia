/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ErrorScreen } from "@/components/error-states/error-screen"
import { OfflineMonitor } from "@/components/error-states/offline-screen"
import type { Failure } from "@/lib/errors/failure"

const failure = (kind: Failure["kind"], extra: Partial<Failure> = {}): Failure => ({ kind, status: null, code: "INTERNAL_ERROR", reference: "ref-abcdefgh", referenceScope: "server", occurredAt: "2026-11-11T12:00:00.000Z", needsReport: false, ...extra })
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { recorded: true } }), { status: 201 }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("ErrorScreen", () => {
  it.each([
    ["400", "inia-400-quebra-cabeca.webp", "Algo não encaixou."],
    ["401", "inia-401-cracha.webp", "Entre para continuar."],
    ["403", "inia-403-cancela.webp", "Acesso restrito."],
    ["404", "inia-404-cabo.webp", "Essa página sumiu do mapa."],
    ["500", "inia-500-servidor.webp", "Algo deu errado por aqui."],
  ] as const)("%s: arte %s e título em HTML acessível", (kind, art, title) => {
    const { container } = render(<ErrorScreen failure={failure(kind)} />)
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument()
    expect(container.querySelector("img")).toHaveAttribute("data-error-art", art)
    expect(container.querySelector("img")).toHaveAttribute("alt", "")
  })

  it("arte que não carrega some; título, texto e ação continuam", () => {
    const { container } = render(<ErrorScreen failure={failure("500")} action={{ label: "Tentar novamente", onClick: () => {} }} />)
    fireEvent.error(container.querySelector("img")!)
    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("Algo deu errado por aqui.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument()
  })

  it("Copiar detalhes para suporte copia só código, referência, horário e contexto público", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<ErrorScreen failure={failure("500", { status: 500 })} />)
    fireEvent.click(screen.getByRole("button", { name: "Copiar detalhes para suporte" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Detalhes copiados" })).toBeInTheDocument())
    const copied = writeText.mock.calls[0]![0] as string
    expect(copied).toMatch(/Código: INTERNAL_ERROR\nReferência: ref-abcdefgh \(registrada no servidor\)\nHorário \(UTC\): 2026-11-11T12:00:00.000Z\nStatus: 500\nTela: \//)
  })

  it("contextual usa h2 (não disputa o título da página)", () => {
    render(<ErrorScreen variant="contextual" failure={failure("400")} />)
    expect(screen.getByRole("heading", { level: 2, name: "Algo não encaixou." })).toBeInTheDocument()
  })
})

describe("OfflineMonitor", () => {
  it("cobre a tela ao perder a conexão (sem desmontar a página), registra ao voltar e alterna as duas artes", async () => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(true)
    render(
      <>
        <input aria-label="rascunho" defaultValue="texto digitado" />
        <OfflineMonitor />
      </>,
    )
    const arts: string[] = []
    for (let round = 0; round < 2; round++) {
      online.mockReturnValue(false)
      act(() => {
        window.dispatchEvent(new Event("offline"))
      })
      expect(screen.getByRole("heading", { name: "Opa, perdemos a conexão." })).toBeInTheDocument()
      expect(screen.getByText("INIA-REDE-SEM-CONEXAO")).toBeInTheDocument()
      expect(screen.getByText("local — ainda não enviada ao servidor")).toBeInTheDocument()
      arts.push(document.querySelector("[data-offline-overlay] img")!.getAttribute("data-error-art")!)
      online.mockReturnValue(true)
      act(() => {
        window.dispatchEvent(new Event("online"))
      })
      expect(screen.queryByRole("heading", { name: "Opa, perdemos a conexão." })).not.toBeInTheDocument()
    }
    expect(new Set(arts)).toEqual(new Set(["inia-offline-roteador.webp", "inia-offline-celular.webp"]))
    expect(screen.getByLabelText("rascunho")).toHaveValue("texto digitado")
    // As duas quedas ficaram na fila e foram enviadas quando a rede voltou.
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/v1/client-errors"))).toHaveLength(2))
  })
})
