/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock("@/lib/auth/session-navigation", () => ({ loadSessionDocument: vi.fn() }))

import { LoginForm } from "./login-form"
import { fetchLoginOptions, login, networkRetryMessage } from "@/services/auth/auth-service"

/** Login pela rede na tela (achados QA-02 e QA-04 da run-9). */
beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("opções do login lidas no servidor (QA-02)", () => {
  it("falha da API: registra no log do servidor e devolve checked=false (nunca cai em silêncio no e-mail)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed") }))
    expect(await fetchLoginOptions()).toEqual({ networkLogin: false, checked: false })
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(502, {})))
    expect(await fetchLoginOptions()).toEqual({ networkLogin: false, checked: false })
    expect(logged).toHaveBeenCalledTimes(2)
    expect(String(logged.mock.calls[0]?.[0])).toContain("login_options_unavailable")
  })
  it("resposta certa: checked=true", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { data: { networkLogin: true } })))
    expect(await fetchLoginOptions()).toEqual({ networkLogin: true, checked: true })
  })
  it("sem conseguir conferir: a tela avisa e oferece a matrícula de rede e o e-mail", () => {
    renderWithQuery(<LoginForm optionsUnavailable />)
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível conferir agora o tipo de login")
    expect(screen.getByLabelText("E-mail corporativo")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Entrar com a matrícula de rede" }))
    expect(screen.getByLabelText("Matrícula de rede")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Entrar com e-mail e senha" }))
    expect(screen.getByLabelText("E-mail corporativo")).toBeInTheDocument()
  })
  it("conferido e desligado: sem aviso e sem link de matrícula", () => {
    renderWithQuery(<LoginForm />)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /matrícula/ })).not.toBeInTheDocument()
  })
})

describe("matrícula travada (QA-04)", () => {
  const message = "Muitas tentativas com senha errada. Aguarde alguns minutos antes de tentar de novo — insistir pode bloquear a sua conta de rede."
  it("mantém a mensagem do backend (aviso da conta de rede) e acrescenta quando libera", async () => {
    const retryAt = new Date(Date.now() + 9 * 60_000).toISOString()
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: { code: "LOGIN_TOO_MANY_ATTEMPTS", message, details: { retryAt } } })))
    const error = (await login({ matricula: "G0055350", password: "x" }).catch((caught: unknown) => caught)) as Error
    expect(error.message).toContain("insistir pode bloquear a sua conta de rede")
    expect(error.message).toMatch(/Libera em 9 minutos\.$/)
  })
  it("e-mail travado continua com a mensagem de minutos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: { code: "LOGIN_TOO_MANY_ATTEMPTS", message: "x", details: { retryAt: new Date(Date.now() + 60_000).toISOString() } } })))
    const error = (await login({ email: "a@inia.local", password: "x" }).catch((caught: unknown) => caught)) as Error
    expect(error.message).toBe("Muitas tentativas de acesso. Tente novamente em 1 minuto.")
  })
  it("limite por IP + matrícula (429 RATE_LIMITED): a mensagem do backend, nunca a genérica", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: { code: "RATE_LIMITED", message: "Muitas tentativas de acesso com esta matrícula." } })))
    await expect(login({ matricula: "G0055350", password: "x" })).rejects.toThrow("Muitas tentativas de acesso com esta matrícula.")
  })
  it("sem horário, só a mensagem do backend", () => {
    expect(networkRetryMessage(message, null)).toBe(message)
  })
})
