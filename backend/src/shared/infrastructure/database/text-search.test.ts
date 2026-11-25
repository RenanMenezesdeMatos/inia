import { describe, expect, it } from "vitest"
import { foldedLikeWords, foldSql, foldText } from "./text-search.js"

describe("busca sem acento", () => {
  it("a tabela da coluna e a do termo são a mesma, letra a letra", () => {
    const [, from = "", to = ""] = /translate\(x, '([^']+)', '([^']+)'\)/.exec(foldSql("x")) ?? []
    expect([...from]).toHaveLength([...to].length)
    for (const [index, letter] of [...from].entries()) expect(foldText(letter), letter).toBe(to[index]!.toLowerCase())
  })

  it("acha nomes com letras de fora do português, e letra fora da tabela fica igual dos dois lados", () => {
    expect(foldText("Emine Şahin")).toBe("emine sahin")
    expect(foldText("JOSÉ Conceição")).toBe("jose conceicao")
    expect(foldText("e\u0301")).toBe("e")
    expect(foldText("Ðorđe")).toBe("ðorđe")
  })

  it("curingas viram texto e cada palavra é um trecho", () => {
    expect(foldedLikeWords("50%_a b\\c")).toEqual(["%50\\%\\_a%", "%b\\\\c%"])
    expect(foldedLikeWords("   ")).toEqual([])
  })
})
