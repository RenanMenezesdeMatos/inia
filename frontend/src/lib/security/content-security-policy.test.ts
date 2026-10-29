import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { buildContentSecurityPolicy, buildStyleReportOnlyPolicy, createCspNonce, EMPTY_STYLE_HASH, NEXT_NOT_FOUND_STYLE_HASH, originOf, resolveStyleMode, SONNER_STYLE_HASH } from "./content-security-policy"

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

  it("estilos isolados em produção (R-07): <style> só com nonce ou os hashes fixos (sonner, 404 do Next); 'unsafe-inline' só nos atributos style", () => {
    const hashes = `${SONNER_STYLE_HASH} ${EMPTY_STYLE_HASH} ${NEXT_NOT_FOUND_STYLE_HASH}`
    expect(directive(production, "style-src")).toBe(`style-src 'self' 'nonce-bm9uY2U=' ${hashes}`)
    expect(directive(production, "style-src-elem")).toBe(`style-src-elem 'self' 'nonce-bm9uY2U=' ${hashes}`)
    expect(directive(production, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'")
  })

  it("interruptor INIA_CSP_STYLES: desenvolvimento fica com a política antiga; REPORT_ONLY e RELAXED valem a antiga e o REPORT_ONLY relata a nova à parte", () => {
    expect(resolveStyleMode(undefined, false)).toBe("STRICT")
    expect(resolveStyleMode(undefined, true)).toBe("RELAXED")
    expect(resolveStyleMode(" report_only ", false)).toBe("REPORT_ONLY")
    expect(resolveStyleMode("qualquer-coisa", false)).toBe("STRICT")
    for (const styleMode of ["REPORT_ONLY", "RELAXED"] as const) {
      const policy = buildContentSecurityPolicy({ nonce: "bm9uY2U=", isDevelopment: false, apiOrigin: null, styleMode })
      expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'")
      expect(directive(policy, "style-src-elem")).toBeUndefined()
    }
    expect(directive(buildContentSecurityPolicy({ nonce: "bm9uY2U=", isDevelopment: true, apiOrigin: null }), "style-src")).toBe("style-src 'self' 'unsafe-inline'")
    expect(buildStyleReportOnlyPolicy("bm9uY2U=")).toBe([directive(production, "style-src"), directive(production, "style-src-elem"), directive(production, "style-src-attr")].join("; "))
  })

  it("o hash liberado é o do CSS que o sonner INSTALADO injeta (atualizar o sonner exige trocar SONNER_STYLE_HASH)", () => {
    const line = readFileSync(path.resolve(__dirname, "../../../node_modules/sonner/dist/index.mjs"), "utf8").split("\n").find((entry) => entry.startsWith('__insertCSS("'))
    expect(line).toBeDefined()
    const css = JSON.parse(line!.slice("__insertCSS(".length, line!.lastIndexOf(")"))) as string
    expect(SONNER_STYLE_HASH).toBe(`'sha256-${createHash("sha256").update(css, "utf8").digest("base64")}'`)
    expect(EMPTY_STYLE_HASH).toBe(`'sha256-${createHash("sha256").update("", "utf8").digest("base64")}'`)
  })

  it("o hash da 404 é o do CSS que o Next INSTALADO escreve na página padrão (atualizar o Next pode exigir trocar NEXT_NOT_FOUND_STYLE_HASH)", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../node_modules/next/dist/client/components/http-access-fallback/error-fallback.js"), "utf8")
    const css = source.match(/__html: `([^`]*)`/)?.[1]
    expect(css).toBeDefined()
    expect(NEXT_NOT_FOUND_STYLE_HASH).toBe(`'sha256-${createHash("sha256").update(css!, "utf8").digest("base64")}'`)
  })

  it("demais diretivas preservadas: blob: do avatar, API, Gemini Live e as travas de enquadramento/formulário", () => {
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
