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
})
