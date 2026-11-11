/** @vitest-environment jsdom */
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { isDarkTheme } from "@/lib/browser/use-stored-theme-is-dark"
import GlobalError from "./global-error"

vi.mock("./globals.css", () => ({}))

describe("erro no layout raiz (global-error)", () => {
  it("traz o próprio documento em português, com o aviso e sem a mensagem interna", () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error("providers quebrou: token=abc")} retry={() => {}} />)

    // O React 19 leva o <title> para o <head> do documento.
    // (A arte vira um <link rel="preload"> no <head>; o título continua lá.)
    expect(html).toMatch(/^<html lang="pt-BR"><head>.*<title>INIA<\/title><\/head><body[^>]*>/)
    expect(html).toContain("Algo deu errado por aqui.")
    expect(html).toContain("inia-500-servidor.webp")
    expect(html).toContain("Tentar novamente")
    expect(html).not.toContain("token=abc")
    // No servidor (e na hidratação) nasce claro, como a página de erro padrão.
    expect(html).not.toContain("class=\"dark\"")
  })

  it("tema: a escolha guardada pelo next-themes vale; 'system', vazio ou desconhecido seguem o sistema", () => {
    expect(isDarkTheme("dark", false)).toBe(true)
    expect(isDarkTheme("light", true)).toBe(false)
    expect(isDarkTheme("system", true)).toBe(true)
    expect(isDarkTheme("system", false)).toBe(false)
    expect(isDarkTheme(null, true)).toBe(true)
    expect(isDarkTheme("roxo", false)).toBe(false)
  })
})
