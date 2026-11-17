// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import { sanitizeRichText } from "./sanitize-rich-text"

describe("sanitizeRichText", () => {
  it("mantém apenas formatação permitida", () => {
    expect(sanitizeRichText('<h2 onclick="alert(1)">Título</h2><strong>Texto</strong><script>alert(1)</script>')).toBe("<h2>Título</h2><strong>Texto</strong>alert(1)")
  })

  it("remove imagens externas e preserva imagens de dados permitidas", () => {
    const safeImage = "data:image/png;base64,aGVsbG8="
    expect(sanitizeRichText(`<img src="https://example.com/a.png"><img src="${safeImage}">`)).toContain(safeImage)
    expect(sanitizeRichText('<img src="javascript:alert(1)">')).toBe("")
  })

  it("imagem só com a URL de dados inteira em base64, como o servidor (H-FE-1)", () => {
    const valid = "data:image/png;base64,aGVsbG8="
    expect(sanitizeRichText(`<img src="${valid}">`)).toBe(`<img src="${valid}" alt="Imagem do comunicado">`)
    for (const source of [
      `${valid}" onerror="x`,
      "data:image/png;base64,aGVs bG8=",
      "data:image/png;base64,aGVsbG8=)url(https://evil",
      "data:image/png;base64,aGVsbG8===",
      "data:image/png;base64,",
      "DATA:IMAGE/PNG;BASE64,aGVsbG8=",
      "data:image/gif;base64,R0lGODlh",
      "data:image/svg+xml;base64,PHN2Zz4=",
    ]) {
      const html = sanitizeRichText(`<img src='${source}'>`)
      expect(html, source).toBe("")
    }
  })
})

