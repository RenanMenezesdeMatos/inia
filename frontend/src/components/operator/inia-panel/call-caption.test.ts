import { describe, expect, it } from "vitest"

import { captionAt, captionPhrases } from "./call-caption"

describe("legenda da chamada", () => {
  it("quebra em frases curtas, na pontuação e em até 8 palavras; nada se perde", () => {
    const text = "Seu tempo médio caiu de 455 para 402 segundos e já está abaixo da meta. Continue assim!"
    const phrases = captionPhrases(text)
    expect(phrases.every((phrase) => phrase.text.split(" ").length <= 8)).toBe(true)
    expect(phrases.map((phrase) => phrase.text).join(" ")).toBe(text)
    expect(phrases.at(-1)).toEqual({ text: "Continue assim!", endWord: 17 })
  })

  it("segue o ritmo da voz e fica no último trecho até ela terminar", () => {
    const text = "Primeira frase aqui. Segunda frase ali."
    expect(captionAt(text, 0)).toBe("Primeira frase aqui.")
    expect(captionAt(text, 3)).toBe("Segunda frase ali.")
    expect(captionAt(text, 99)).toBe("Segunda frase ali.")
    expect(captionAt("", 0)).toBe("")
  })

  it("texto que chega aos pedaços: os trechos já fechados não mudam; marcas de Markdown não aparecem", () => {
    const partial = captionPhrases("Olá, **Marcela**. Vou olhar seus indicadores de")
    const full = captionPhrases("Olá, **Marcela**. Vou olhar seus indicadores de hoje com calma, agora mesmo.")
    expect(full[0]).toEqual(partial[0])
    expect(full.map((phrase) => phrase.text).join(" ")).not.toContain("*")
  })
})
