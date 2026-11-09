import { describe, expect, it } from "vitest"
import { diffConfigField, diffText } from "./knowledge-version-diff.js"

describe("comparação de versões da base", () => {
  it("texto igual: nenhuma diferença", () => {
    expect(diffText("a\nb", "a\nb")).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 2 })
  })

  it("adicionado, removido e alterado, com o número da linha de cada lado", () => {
    const diff = diffText("um\ndois\ntrês\nquatro", "um\nDOIS\nquatro\ncinco")!
    expect(diff).toMatchObject({ added: 1, removed: 1, changed: 1, unchanged: 2 })
    expect(diff.rows).toEqual([
      { kind: "UNCHANGED", leftLine: 1, rightLine: 1, left: "um", right: "um" },
      { kind: "CHANGED", leftLine: 2, rightLine: 2, left: "dois", right: "DOIS" },
      { kind: "REMOVED", leftLine: 3, left: "três" },
      { kind: "UNCHANGED", leftLine: 4, rightLine: 3, left: "quatro", right: "quatro" },
      { kind: "ADDED", rightLine: 4, right: "cinco" },
    ])
  })

  it("texto vazio de um lado vira tudo adicionado ou removido; quebra de linha e espaço no fim não contam como mudança", () => {
    expect(diffText("", "a\nb")).toMatchObject({ added: 2, removed: 0 })
    expect(diffText("a\nb", "")).toMatchObject({ added: 0, removed: 2 })
    expect(diffText("a \r\nb\n", "a\nb")).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 2 })
  })

  it("linha em branco não é diferença: o mesmo texto de PDF e de DOCX só difere nos parágrafos, e cada linha mantém o número original", () => {
    expect(diffText("um\ndois\ntrês", "um\n\ndois\n\ntrês\n")).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 3 })
    expect(diffText("Linha comum.\nLinha do PDF.", "Linha comum.\n\nLinha do DOCX.")!.rows).toEqual([
      { kind: "UNCHANGED", leftLine: 1, rightLine: 1, left: "Linha comum.", right: "Linha comum." },
      { kind: "CHANGED", leftLine: 2, rightLine: 3, left: "Linha do PDF.", right: "Linha do DOCX." },
    ])
  })

  it("trechos iguais no começo e no fim não entram na conta do teto; além do teto, não compara", () => {
    const common = Array.from({ length: 5000 }, (_, index) => `linha ${index}`).join("\n")
    expect(diffText(`${common}\nx\n${common}`, `${common}\ny\n${common}`, 4)).toMatchObject({ changed: 1, unchanged: 10000 })
    expect(diffText("a\nb\nc", "d\ne\nf", 4)).toBeNull()
  })

  it("configuração: sem mudança, nada; conjunto em outra ordem é o mesmo; de vazio é adicionado e para vazio é removido", () => {
    expect(diffConfigField("orgScopes", "Alcance", ["A", "B"], ["B", "A"])).toBeNull()
    expect(diffConfigField("title", "Título", ["A"], ["B"])).toEqual({ field: "title", label: "Título", kind: "CHANGED", from: ["A"], to: ["B"] })
    expect(diffConfigField("x", "X", [], ["B"])?.kind).toBe("ADDED")
    expect(diffConfigField("x", "X", ["A"], [])?.kind).toBe("REMOVED")
  })
})
