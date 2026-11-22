/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"

const service = vi.hoisted(() => ({ fetchNetworkLoginStatus: vi.fn(), probeNetworkLoginServers: vi.fn(), setNetworkLoginEnabled: vi.fn() }))
vi.mock("@/services/access/network-login-service", () => service)

import { NetworkLoginView } from "./network-login-view"

const STATUS = {
  configured: true, domain: "empresa.local", servers: ["ldaps://dc1.empresa.local:636", "ldaps://dc2.empresa.local:636"], weakKeyAllowed: true, httpsRequiredButMissing: false, maxFailures: 3,
  enabled: false, changedAt: null, changedBy: null, emergencyAccounts: [{ accountId: "a1", name: "Administrador INIA", email: "admin@empresa.com", active: true, lastLoginAt: null }],
  ambiguousMatriculas: [] as { matricula: string; accounts: number }[],
}

beforeAll(installJsdomStubs)
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe("Login pela rede", () => {
  it("liga depois da confirmação", async () => {
    service.fetchNetworkLoginStatus.mockResolvedValue(STATUS)
    service.setNetworkLoginEnabled.mockResolvedValue({ ...STATUS, enabled: true })
    renderWithQuery(<NetworkLoginView />)
    fireEvent.click(await screen.findByRole("button", { name: "Ligar o login pela rede" }))
    fireEvent.click(await screen.findByRole("button", { name: "Ligar" }))
    await waitFor(() => expect(service.setNetworkLoginEnabled.mock.calls[0]?.[0]).toBe(true))
    expect(await screen.findByRole("button", { name: "Desligar o login pela rede" })).toBeInTheDocument()
  })
  it("sem conta de emergência habilitada o botão fica travado e diz o que falta", async () => {
    service.fetchNetworkLoginStatus.mockResolvedValue({ ...STATUS, emergencyAccounts: [] })
    renderWithQuery(<NetworkLoginView />)
    expect(await screen.findByRole("button", { name: "Ligar o login pela rede" })).toBeDisabled()
    expect(screen.getByText(/Crie ao menos uma conta de emergência/)).toBeInTheDocument()
  })
  it("matrícula repetida: lista as matrículas e o botão fica travado dizendo o que falta", async () => {
    service.fetchNetworkLoginStatus.mockResolvedValue({ ...STATUS, ambiguousMatriculas: [{ matricula: "G0055350", accounts: 2 }] })
    renderWithQuery(<NetworkLoginView />)
    expect(await screen.findByRole("button", { name: "Ligar o login pela rede" })).toBeDisabled()
    expect(screen.getByText(/Corrija as matrículas repetidas/)).toBeInTheDocument()
    expect(screen.getByText("G0055350 · 2 contas")).toBeInTheDocument()
  })
  it("carregando = esqueleto do kit; erro = estado de erro com Tentar novamente; sem permissão = estado de acesso negado", async () => {
    service.fetchNetworkLoginStatus.mockReturnValue(new Promise(() => undefined))
    const loading = renderWithQuery(<NetworkLoginView />)
    expect(screen.getByRole("status")).toHaveTextContent("Carregando o login pela rede…")
    loading.unmount()
    service.fetchNetworkLoginStatus.mockRejectedValue(new Error("rede"))
    const failing = renderWithQuery(<NetworkLoginView />)
    expect(await screen.findByRole("button", { name: "Tentar novamente" })).toBeInTheDocument()
    failing.unmount()
    service.fetchNetworkLoginStatus.mockRejectedValue(new ApiError("Sem permissão.", 403, "FORBIDDEN"))
    renderWithQuery(<NetworkLoginView />)
    expect(await screen.findByText(/Só quem administra os acessos da organização inteira/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument()
  })
  it("sem conta de emergência: estado vazio do kit", async () => {
    service.fetchNetworkLoginStatus.mockResolvedValue({ ...STATUS, emergencyAccounts: [] })
    renderWithQuery(<NetworkLoginView />)
    expect(await screen.findByText("Nenhuma conta de emergência")).toBeInTheDocument()
  })
  it("confere os servidores e mostra a chave de cada um", async () => {
    service.fetchNetworkLoginStatus.mockResolvedValue(STATUS)
    service.probeNetworkLoginServers.mockResolvedValue({ servers: [
      { url: "ldaps://dc1.empresa.local:636", reachable: true, trusted: true, keyBits: 1024, validUntil: "2027-04-09T04:26:56.000Z", error: null },
      { url: "ldaps://dc2.empresa.local:636", reachable: false, trusted: false, keyBits: null, validUntil: null, error: "Sem resposta no tempo limite." },
    ] })
    renderWithQuery(<NetworkLoginView />)
    fireEvent.click(await screen.findByRole("button", { name: "Conferir servidores" }))
    expect(await screen.findByText("Responde e a cadeia confere")).toBeInTheDocument()
    expect(screen.getByText("1024 bits")).toBeInTheDocument()
    expect(screen.getByText("Sem resposta")).toBeInTheDocument()
  })
})
