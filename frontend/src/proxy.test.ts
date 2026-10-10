import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { config, proxy } from "./proxy"

/**
 * O proxy cobre TODAS as páginas: as autenticadas recebem a guarda de sessão e a CSP; login, wiki e raiz recebem só a CSP.
 * Página sem CSP com nonce ficaria sem proteção; página dinâmica com CSP de outro nonce teria os próprios scripts bloqueados.
 */
function request(path: string, cookies: Record<string, string> = {}) {
  const headers = new Headers()
  const cookie = Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ")
  if (cookie) headers.set("cookie", cookie)
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers })
}

function sessionToken(payload: Record<string, unknown>) {
  const segment = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `header.${segment}.signature`
}

function nonceIn(policy: string | null) {
  return policy?.match(/'nonce-([^']+)'/)?.[1]
}

describe("proxy — CSP com nonce em todas as páginas", () => {
  it.each(["/", "/auth/login", "/auth/forgot-password", "/wiki", "/wiki/seguranca", "/admin/workflows/abc", "/operator", "/perfil/editar", "/materiais/1"])(
    "o matcher alcança %s",
    (path) => expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true),
  )

  it.each(["/_next/static/chunks/app.js", "/_next/image?url=%2Fx.png&w=64&q=75", "/favicon.ico"])("arquivos do build ficam fora: %s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(false)
  })

  it("página pública: CSP na resposta e o MESMO nonce no cabeçalho repassado ao Next e ao RootLayout", () => {
    const response = proxy(request("/auth/login"))
    const policy = response.headers.get("content-security-policy")
    const nonce = nonceIn(policy)
    expect(nonce).toBeTruthy()
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce)
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policy)
    expect(response.headers.get("location")).toBeNull()
  })

  it("nonce novo a cada requisição", () => {
    const first = nonceIn(proxy(request("/wiki")).headers.get("content-security-policy"))
    const second = nonceIn(proxy(request("/wiki")).headers.get("content-security-policy"))
    expect(first).not.toBe(second)
  })

  it("área autenticada sem sessão continua indo para o login; com troca de senha pendente, para a criação de senha", () => {
    expect(proxy(request("/admin")).headers.get("location")).toBe("http://localhost:3000/auth/login")
    const pending = proxy(request("/operator", { inia_session: sessionToken({ pc: true }) }))
    expect(pending.headers.get("location")).toBe("http://localhost:3000/auth/create-password")
  })

  it("área autenticada com sessão: CSP e o caminho para o layout da Administração", () => {
    const response = proxy(request("/admin/conversations", { inia_session: sessionToken({ sub: "x" }) }))
    expect(nonceIn(response.headers.get("content-security-policy"))).toBeTruthy()
    expect(response.headers.get("x-middleware-request-x-inia-pathname")).toBe("/admin/conversations")
  })

  it("um x-nonce mandado pelo navegador é sobrescrito", () => {
    const forged = request("/wiki")
    forged.headers.set("x-nonce", "forjado")
    const response = proxy(forged)
    expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe("forjado")
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonceIn(response.headers.get("content-security-policy")))
  })
})
