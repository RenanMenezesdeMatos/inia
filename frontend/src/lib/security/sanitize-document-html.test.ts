// @vitest-environment jsdom

import { describe, expect, it } from "vitest"

import { sanitizeDocumentHtml } from "./sanitize-document-html"

describe("sanitizeDocumentHtml", () => {
  it("preserva a estrutura de um documento e remove scripts, handlers e estilos", () => {
    const html = '<h1 style="color:red">Título</h1><p onclick="alert(1)">Texto <strong>forte</strong></p><script>alert(1)</script><style>p{}</style>'
    expect(sanitizeDocumentHtml(html)).toBe("<h1>Título</h1><p>Texto <strong>forte</strong></p>")
  })

  it("mantém tabelas com colspan numérico", () => {
    const html = '<table><tr><td colspan="2" data-x="1">a</td><td colspan="abc">b</td></tr></table>'
    expect(sanitizeDocumentHtml(html)).toBe('<table><tbody><tr><td colspan="2">a</td><td>b</td></tr></tbody></table>')
  })

  it("só deixa links http(s)/mailto e sempre abre em nova aba", () => {
    expect(sanitizeDocumentHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>")
    expect(sanitizeDocumentHtml('<a href="https://example.com">x</a>')).toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>')
  })

  it("aceita apenas imagens embutidas como data URI", () => {
    const safeImage = "data:image/png;base64,aGVsbG8="
    expect(sanitizeDocumentHtml(`<img src="${safeImage}" alt="Figura 1">`)).toBe(`<img src="${safeImage}" alt="Figura 1">`)
    expect(sanitizeDocumentHtml('<img src="https://example.com/a.png">')).toBe("")
    expect(sanitizeDocumentHtml('<img src="javascript:alert(1)">')).toBe("")
  })

  it("desembrulha tags desconhecidas sem perder o texto", () => {
    expect(sanitizeDocumentHtml("<section><span>texto</span></section>")).toBe("texto")
  })
})
