/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import AppRouteError from "@/app/(app)/error"
import RootRouteError from "@/app/error"
import { ApiError } from "@/lib/api/api-client"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { recorded: true } }), { status: 201 }))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("fronteira de erro de rota", () => {
  it.each([
    ["área autenticada", AppRouteError],
    ["raiz", RootRouteError],
  ])("%s: tela de 500 da INIA, sem a mensagem interna, registra no servidor e 'Tentar novamente' chama o retry do Next", async (_, Boundary) => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    const retry = vi.fn()
    const error = new Error("Cannot read properties of undefined (reading 'items')")

    render(<Boundary error={error} retry={retry} />)

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("Algo deu errado por aqui.")
    expect(alert).toHaveTextContent("INIA-INTERFACE-RENDERIZACAO")
    expect(alert).toHaveTextContent("Procure o administrador e informe o código e a referência abaixo.")
    expect(screen.queryByText(/Cannot read properties/)).not.toBeInTheDocument()
    expect(logged).toHaveBeenCalledWith(error)
    // A referência só vira "registrada no servidor" depois do 201 da API.
    await waitFor(() => expect(screen.getByText("registrada no servidor")).toBeInTheDocument())
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as { code: string; reference: string; message: string }
    expect(body.code).toBe("INIA-INTERFACE-RENDERIZACAO")
    expect(body.reference).toMatch(/^web-/)
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it("sem confirmação do servidor a referência continua LOCAL (nunca promete busca no servidor)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    render(<RootRouteError error={new Error("quebrou")} retry={() => {}} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText("local — ainda não enviada ao servidor")).toBeInTheDocument()
  })

  it("401 da API: tela de login com retorno seguro para a mesma tela, sem 'Tentar novamente'", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    window.history.replaceState(null, "", "/supervisor/equipe?aba=x")
    render(<AppRouteError error={new ApiError("Sessão ausente ou expirada.", 401, "UNAUTHENTICATED", undefined, { reference: "req-12345678" })} retry={() => {}} />)
    expect(screen.getByRole("heading", { name: "Entre para continuar." })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Fazer login" })).toHaveAttribute("href", "/auth/login?voltar=%2Fsupervisor%2Fequipe%3Faba%3Dx")
    expect(screen.queryByRole("button", { name: "Tentar novamente" })).not.toBeInTheDocument()
    expect(screen.getByText("req-12345678")).toBeInTheDocument()
    // Falha registrada pela própria API: o navegador não grava de novo.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("403: acesso restrito, voltar ao início e procurar o administrador com código e referência", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    render(<AppRouteError error={new ApiError("Você não tem permissão para este recurso.", 403, "FORBIDDEN", undefined, { reference: "req-abcdefgh" })} retry={() => {}} />)
    expect(screen.getByRole("heading", { name: "Acesso restrito." })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Voltar ao início" })).toHaveAttribute("href", "/")
    expect(screen.getByText("Procure o administrador e informe o código e a referência abaixo.")).toBeInTheDocument()
    expect(screen.getByText("FORBIDDEN")).toBeInTheDocument()
  })

  it("400: 'Voltar e corrigir' volta à tela anterior (o que foi digitado fica lá)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {})
    window.history.pushState(null, "", "/a")
    window.history.pushState(null, "", "/b")
    render(<AppRouteError error={new ApiError("Dados inválidos.", 400, "VALIDATION_ERROR")} retry={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: "Voltar e corrigir" }))
    expect(back).toHaveBeenCalled()
  })
})
