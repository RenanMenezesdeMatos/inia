import { describe, expect, it } from "vitest"

import { parseArticle } from "./knowledge-article-content"

describe("parseArticle", () => {
  it("reconhece títulos, parágrafos com quebra de linha preservada, listas e regra", () => {
    const text = "# Título\r\n\r\n**Área:** X  \r\n**Versão:** 1.0\r\n\r\n- a\r\n- b\r\n\r\n1. um\r\n2. dois\r\n\r\n---"
    expect(parseArticle(text)).toEqual([
      { kind: "heading", level: 1, text: "Título" },
      { kind: "paragraph", lines: ["**Área:** X", "**Versão:** 1.0"] },
      { kind: "bullets", items: ["a", "b"] },
      { kind: "numbered", items: ["um", "dois"], start: 1 },
      { kind: "rule" },
    ])
  })

  it("só trata como tabela quando a segunda linha é a separadora", () => {
    expect(parseArticle("| A | B |\n|---|---|\n| 1 | 2 |")).toEqual([{ kind: "table", header: ["A", "B"], rows: [["1", "2"]] }])
    expect(parseArticle("preço | valor")).toEqual([{ kind: "paragraph", lines: ["preço | valor"] }])
  })

  it("mantém blocos de código intactos e citações agrupadas", () => {
    expect(parseArticle("```\nlinha 1\n\nlinha 2\n```\n> nota\n> continuação")).toEqual([
      { kind: "code", code: "linha 1\n\nlinha 2" },
      { kind: "quote", lines: ["nota", "continuação"] },
    ])
  })

  it("junta linha indentada ao item de lista anterior", () => {
    expect(parseArticle("- item longo\n  que continua")).toEqual([{ kind: "bullets", items: ["item longo que continua"] }])
  })
})
