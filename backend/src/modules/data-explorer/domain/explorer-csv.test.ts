import { describe, expect, it } from "vitest"
import { createInstantFormatter, csvHeaderLine, csvRowLine, csvValue, neutralizeFormula } from "./explorer-csv.js"

const format = createInstantFormatter("America/Fortaleza")
const text = { type: "TEXT" } as const

describe("proteção contra fórmula na planilha", () => {
  it.each([
    "=1+1",
    "=HYPERLINK(\"http://malicioso\",\"clique\")",
    "=cmd|'/c calc'!A1",
    "+55119",
    "-2+3",
    "@SUM(A1)",
    "\t=1+1",
    "\r=1+1",
    "\n=1+1",
    " =1+1",
    "   @SUM(A1)",
    "\u0001=1+1",
    "\u0085=1+1",
    "\u200b=1+1",
    "\u202e=1+1",
    "\uFF1D1+1",
    "\uFF0B1",
    "\uFF0D1",
    "\uFF20SUM(A1)",
  ])("neutraliza %j", (value) => {
    expect(neutralizeFormula(value).startsWith("'")).toBe(true)
    // Dentro de aspas ou não, a célula começa pelo apóstrofo.
    expect(csvValue(text, value, format).replace(/^"/, "").startsWith("'")).toBe(true)
  })

  it.each([
    ["Fulano,=1+1", "Fulano,'=1+1"],
    ["Fulano, =1+1", "Fulano, '=1+1"],
    ["Fulano\t=1+1", "Fulano\t'=1+1"],
    ["Fulano;@SUM(A1)", "Fulano;'@SUM(A1)"],
    ["Fulano|+1", "Fulano|'+1"],
    ["linha 1\n=1+1", "linha 1\n'=1+1"],
    ["a,\uFF1D1+1", "a,'\uFF1D1+1"],
    ["=1,=2", "'=1,'=2"],
  ])("fórmula depois de um separador dentro do texto: %j", (value, expected) => {
    expect(neutralizeFormula(value)).toBe(expected)
  })

  it("texto com vírgula ou tabulação sai entre aspas", () => {
    expect(csvValue(text, "Silva, Ana", format)).toBe(`"Silva, Ana"`)
    expect(csvValue(text, "a\tb", format)).toBe(`"a\tb"`)
  })

  it("não altera texto comum", () => {
    for (const value of ["Fatura", "OP-10234", "a=b", "1+1", "maria@empresa", "Segunda via", "Silva, Ana", "2,5"]) expect(neutralizeFormula(value)).toBe(value)
  })

  it("número validado continua número, com vírgula; texto que parece número negativo é neutralizado", () => {
    expect(csvValue({ type: "NUMBER" }, "-5.25", format)).toBe("-5,25")
    expect(csvValue({ type: "NUMBER" }, "1200", format)).toBe("1200")
    expect(csvValue(text, "-5.25", format)).toBe(`'-5.25`)
    // Se um valor numérico vier fora do formato, cai na regra do texto.
    expect(csvValue({ type: "NUMBER" }, "=1+1", format)).toBe(`'=1+1`)
  })

  it("rótulo do cabeçalho passa pela mesma regra", () => {
    expect(csvHeaderLine([{ label: "=perigo" }, { label: "Nome" }])).toBe(`\uFEFF'=perigo;Nome\r\n`)
  })
})

describe("formato do arquivo", () => {
  it("escapa separador, aspas e quebra de linha", () => {
    expect(csvValue(text, `a;b`, format)).toBe(`"a;b"`)
    expect(csvValue(text, `diz "oi"`, format)).toBe(`"diz ""oi"""`)
    expect(csvValue(text, "linha 1\nlinha 2", format)).toBe(`"linha 1\nlinha 2"`)
  })

  it("linha com vazio, booleano e instante no fuso da organização", () => {
    const line = csvRowLine([{ type: "TEXT" }, { type: "BOOLEAN" }, { type: "BOOLEAN" }, { type: "DATETIME" }, { type: "DATE" }], ["x", "true", null, "2026-03-10T02:30:00.000Z", "2026-03-09"], format)
    expect(line).toBe("x;sim;;2026-03-09 23:30:00;2026-03-09\r\n")
  })

  it("começa com BOM e separa por ponto e vírgula", () => {
    expect(csvHeaderLine([{ label: "A" }, { label: "B" }])).toBe("\uFEFFA;B\r\n")
  })
})
