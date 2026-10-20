import { describe, expect, it } from "vitest"
import { queryTableMarkdown } from "./query-common.js"

describe("tabela em Markdown com dado da integração (auditoria de segurança 17/10/2026, DATA-13)", () => {
  it("nome vindo do feed não vira link, ênfase nem HTML, e a barra vertical não quebra a tabela", () => {
    const card = { columns: [{ key: "person", label: "Pessoa", numeric: false }, { key: "value", label: "TMA", numeric: true }], rows: [{ cells: { person: "[Clique aqui](https://site-externo) **Ana** <b>|x", value: "312 s (20%)" } }] }
    const markdown = queryTableMarkdown(card as never)
    expect(markdown).toContain("\\[Clique aqui\\](https://site-externo) \\*\\*Ana\\*\\* \\<b\\>/x")
    expect(markdown).toContain("312 s (20%)")
    expect(markdown.split("\n")[2]!.split(" | ")).toHaveLength(2)
  })
})
