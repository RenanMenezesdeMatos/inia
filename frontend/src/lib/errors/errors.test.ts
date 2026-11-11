/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, apiGet, apiPost } from "@/lib/api/api-client"
import { safeReturnPath, loginWithReturn } from "@/lib/auth/safe-return"
import { describeFailure, kindForStatus, publicRoute, supportDetails } from "@/lib/errors/failure"
import { offlineArtFor } from "@/lib/errors/offline-art"

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("api-client: código, referência e origem da falha", () => {
  it("toda chamada leva um x-request-id; o erro JSON da API traz código e a referência devolvida", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Sem permissão.", reference: "srv-ref-1234" } }), { status: 403, headers: { "content-type": "application/json", "x-inia-release": "abc123" } }))
    const error = (await apiGet("/api/v1/x").catch((caught: unknown) => caught)) as ApiError
    const sent = new Headers(fetchMock.mock.calls[0]![1].headers).get("x-request-id")
    expect(sent).toMatch(/^[0-9a-f-]{36}$/)
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", reference: "srv-ref-1234", referenceScope: "server", release: "abc123" })
  })

  it("502 em HTML sem x-inia-release (IIS sem a API): INIA-PROXY-INDISPONIVEL com a referência enviada (achável no log do IIS)", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502 - Web server received an invalid response</html>", { status: 502, headers: { "content-type": "text/html" } }))
    const error = (await apiGet("/api/v1/x").catch((caught: unknown) => caught)) as ApiError
    const sent = new Headers(fetchMock.mock.calls[0]![1].headers).get("x-request-id")
    expect(error).toMatchObject({ status: 502, code: "INIA-PROXY-INDISPONIVEL", reference: sent, referenceScope: "proxy" })
    expect(describeFailure(error).kind).toBe("500")
  })

  it("sem resposta: offline = INIA-REDE-SEM-CONEXAO (referência local); online = INIA-REDE-API-INALCANCAVEL", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"))
    const online = vi.spyOn(window.navigator, "onLine", "get")
    online.mockReturnValue(false)
    const offline = (await apiPost("/api/v1/x", { a: 1 }).catch((caught: unknown) => caught)) as ApiError
    expect(offline).toMatchObject({ status: 0, code: "INIA-REDE-SEM-CONEXAO", referenceScope: "local" })
    expect(describeFailure(offline).kind).toBe("offline")
    online.mockReturnValue(true)
    const unreachable = (await apiGet("/api/v1/x").catch((caught: unknown) => caught)) as ApiError
    expect(unreachable).toMatchObject({ status: 0, code: "INIA-REDE-API-INALCANCAVEL", referenceScope: "proxy" })
  })

  it("2xx que não é o JSON da INIA (portal de rede): INIA-INTERFACE-RESPOSTA-INVALIDA", async () => {
    fetchMock.mockResolvedValue(new Response("<html>login da rede</html>", { status: 200, headers: { "content-type": "text/html" } }))
    await expect(apiGet("/api/v1/x")).rejects.toMatchObject({ code: "INIA-INTERFACE-RESPOSTA-INVALIDA" })
  })

  it("mock antigo sem content-type continua lendo o código do corpo (compatibilidade)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: "X_CONFLICT", message: "Conflito." } }) })
    await expect(apiGet("/api/v1/x")).rejects.toMatchObject({ status: 409, code: "X_CONFLICT", message: "Conflito." })
  })
})

describe("tela por status", () => {
  it.each([[400, "400"], [422, "400"], [409, "400"], [401, "401"], [403, "403"], [404, "404"], [410, "404"], [429, "500"], [500, "500"], [503, "500"]] as const)("%s → %s", (status, kind) => {
    expect(kindForStatus(status)).toBe(kind)
  })

  it("erro do servidor da interface usa o digest como referência (procurado no log do INIA-Interface)", () => {
    const failure = describeFailure(Object.assign(new Error("x"), { digest: "1234567890" }))
    expect(failure).toMatchObject({ code: "INIA-INTERFACE-SERVIDOR", reference: "1234567890", referenceScope: "interface", needsReport: false })
  })

  it("detalhes copiados: só código, referência, horário, status e rota pública (sem query nem id)", () => {
    const failure = describeFailure(new ApiError("x", 500, "INTERNAL_ERROR", { segredo: "não" }, { reference: "ref-12345678" }), () => new Date("2026-11-11T12:00:00Z"))
    const text = supportDetails(failure, { route: publicRoute("/admin/agents/3f2b8c1a-1111-2222-3333-444455556666?email=a@b.com"), release: "v1", recorded: false })
    expect(text).toContain("Código: INTERNAL_ERROR")
    expect(text).toContain("Referência: ref-12345678 (registrada no servidor)")
    expect(text).toContain("Horário (UTC): 2026-11-11T12:00:00.000Z")
    expect(text).toContain("Tela: /admin/agents/:id")
    expect(text).not.toContain("email")
    expect(text).not.toContain("segredo")
  })
})

describe("artes de sem conexão", () => {
  it("alternam entre ocorrências novas e ficam fixas para a mesma ocorrência", () => {
    window.localStorage.clear()
    const first = offlineArtFor("ocorrencia-1")
    const second = offlineArtFor("ocorrencia-2")
    const third = offlineArtFor("ocorrencia-3")
    expect(new Set([first, second])).toEqual(new Set(["/brand/error-states/inia-offline-roteador.webp", "/brand/error-states/inia-offline-celular.webp"]))
    expect(third).toBe(first)
    // Re-render da mesma ocorrência (inclusive o render duplo do StrictMode): mesma arte.
    expect(offlineArtFor("ocorrencia-1")).toBe(first)
    expect(offlineArtFor("ocorrencia-2")).toBe(second)
  })
})

describe("retorno seguro depois do login", () => {
  it.each([
    ["/supervisor?aba=equipe", "/supervisor?aba=equipe"],
    ["//evil.example/x", null],
    ["https://evil.example", null],
    ["/\\evil.example", null],
    ["/auth/login?voltar=/x", null],
    ["/", null],
    ["javascript:alert(1)", null],
  ])("%s → %s", (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected)
  })

  it("monta o link de login com o caminho codificado", () => {
    expect(loginWithReturn("/admin/users?x=1")).toBe("/auth/login?voltar=%2Fadmin%2Fusers%3Fx%3D1")
    expect(loginWithReturn("/auth/login")).toBe("/auth/login")
  })
})
