/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Sessão encerrada no SERVIDOR (sair de todos os aparelhos em outro lugar, senha provisória nova, conta desativada): os
 * `redirect("/auth/login")` das páginas e do proxy chegam por navegação do roteador, no mesmo documento. A tela de acesso limpa o
 * React Query e carrega um documento novo (uma vez só) — senão o Voltar restaurava do cache do roteador a conta anterior.
 */
const documentLoad = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth/session-navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/session-navigation")>()), loadSessionDocument: documentLoad }))

import { SessionDocumentBoundary } from "./session-document-boundary"

function documentLoadedAt(url: string | null) {
  vi.spyOn(performance, "getEntriesByType").mockReturnValue(url ? ([{ name: url }] as unknown as PerformanceEntryList) : [])
}

function renderAtLogin() {
  window.history.replaceState(null, "", "/auth/login")
  const client = new QueryClient()
  client.setQueryData(["auth", "me"], { name: "Marta Lima" })
  render(
    <QueryClientProvider client={client}>
      <SessionDocumentBoundary />
    </QueryClientProvider>,
  )
  return client
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  documentLoad.mockReset()
})

describe("tela de acesso — fronteira de sessão no destino", () => {
  it("chegou ao login pelo roteador vindo da área logada: limpa o cache e carrega um documento novo, substituindo o histórico", () => {
    documentLoadedAt("http://localhost/supervisor/casos/1")
    const client = renderAtLogin()
    expect(client.getQueryData(["auth", "me"])).toBeUndefined()
    expect(documentLoad).toHaveBeenCalledTimes(1)
    expect(documentLoad).toHaveBeenCalledWith(`${window.location.origin}/auth/login`, { replace: true })
  })

  it("documento que já nasceu na tela de acesso (inclusive depois do recarregamento): nada acontece — sem laço", () => {
    documentLoadedAt("http://localhost/auth/login?motivo=inatividade")
    const client = renderAtLogin()
    expect(documentLoad).not.toHaveBeenCalled()
    expect(client.getQueryData(["auth", "me"])).toEqual({ name: "Marta Lima" })
  })

  it("navegador sem a entrada de navegação: não recarrega (nunca entra em laço)", () => {
    documentLoadedAt(null)
    renderAtLogin()
    expect(documentLoad).not.toHaveBeenCalled()
  })
})
