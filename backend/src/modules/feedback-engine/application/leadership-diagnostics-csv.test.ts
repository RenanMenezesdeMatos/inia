import { describe, expect, it } from "vitest"
import { METHOD_NOTE, toCsv } from "./leadership-diagnostics.js"

const linesOf = (csv: string) => csv.replace(/^\uFEFF/, "").split("\r\n").filter((line) => line.trim())

describe("exportação CSV do Diagnóstico", () => {
  it("cada linha do preâmbulo é UMA célula: com `;` ou aspas (método, filtros) ela sai entre aspas, começando por `\"#`", () => {
    const lines = linesOf(toCsv(["Pessoa", "Chamadas"], [["Ana", 3]], ["Diagnóstico INIA — people", `Filtros: ${JSON.stringify({ teamId: "t1" })}`, "x; =1+1", METHOD_NOTE]))

    expect(lines[0]).toBe("# Diagnóstico INIA — people")
    expect(lines[1]).toBe('"# Filtros: {""teamId"":""t1""}"')
    // O `;` não abre célula nova (achado C12).
    expect(lines[2]).toBe('"# x; =1+1"')
    expect(lines[3]!.startsWith('"# Método:')).toBe(true)
    // Quem lê o arquivo acha o cabeçalho pulando as linhas `#` e `"#`.
    const body = lines.filter((line) => !/^"?#/.test(line))
    expect(body).toEqual(["Pessoa;Chamadas", "Ana;3"])
  })

  it("texto que viraria fórmula na planilha é neutralizado; número fica como está", () => {
    const [, row] = linesOf(toCsv(["Assunto", "Total"], [["=HYPERLINK(\"x\")", -5]], []))
    expect(row).toBe('"\'=HYPERLINK(""x"")";-5')
  })
})
