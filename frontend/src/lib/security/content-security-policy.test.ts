import { describe, expect, it } from "vitest"

import { buildContentSecurityPolicy, createCspNonce, originOf } from "./content-security-policy"

function directive(policy: string, name: string) {
  return policy.split("; ").find((entry) => entry.startsWith(`${name} `))
}

describe("Content-Security-Policy da interface (R-07)", () => {
  const production = buildContentSecurityPolicy({ nonce: "bm9uY2U=", isDevelopment: false, apiOrigin: "https://inia.empresa.local" })

  it("script-src só com nonce + 'strict-dynamic' em produção — sem 'unsafe-inline' nem 'unsafe-eval'", () => {
    expect(directive(production, "script-src")).toBe("script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic'")
  })

  it("desenvolvimento acrescenta só 'unsafe-eval' (pilha de erros do React) e o WebSocket do recarregamento", () => {
    const development = buildContentSecurityPolicy({ nonce: "bm9uY2U=", isDevelopment: true, apiOrigin: null })
    expect(directive(development, "script-src")).toBe("script-src 'self' 'nonce-bm9uY2U=' 'strict-dynamic' 'unsafe-eval'")
    expect(directive(development, "connect-src")).toContain(" ws: wss:")
  })

  it("demais diretivas preservadas: estilos inline, blob: do avatar, API, Gemini Live e as travas de enquadramento/formulário", () => {
    expect(directive(production, "style-src")).toBe("style-src 'self' 'unsafe-inline'")
    expect(directive(production, "connect-src")).toBe(
      "connect-src 'self' blob: data: https://inia.empresa.local https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com",
    )
    expect(directive(production, "img-src")).toBe("img-src 'self' data: blob: https://inia.empresa.local")
    for (const fixed of ["default-src 'self'", "object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "worker-src 'self' blob:"]) {
      expect(production.split("; ")).toContain(fixed)
    }
  })

  it("nonce aleatório no formato que o Next extrai do cabeçalho", () => {
    const nonces = new Set(Array.from({ length: 50 }, createCspNonce))
    expect(nonces.size).toBe(50)
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/_-]{22}={0,2}$/)
  })

  it("originOf ignora caminho e valores inválidos", () => {
    expect(originOf("https://inia.empresa.local/api/v1")).toBe("https://inia.empresa.local")
    expect(originOf("não é url")).toBeNull()
    expect(originOf(undefined)).toBeNull()
  })
})
