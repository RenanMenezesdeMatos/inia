import { describe, expect, it } from "vitest"

import { createTestPhonemizer, testPhonemizeText } from "./__fixtures__/load-fixture"

const TEXT = "Bom dia, chegou às 10h e saiu às 18h. Tudo certo?"

describe("G2P de teste incremental (fixture)", () => {
  it("em pedaços numera palavras e sílabas igual ao texto inteiro, inclusive com tokens que viram uma letra só ('10h' → 'h')", () => {
    const phonemizer = createTestPhonemizer()
    const words = [...TEXT.match(/\S+\s*/g)!.flatMap((fragment) => phonemizer.push(fragment)), ...phonemizer.flush()]
    const whole = testPhonemizeText(TEXT)
    const shape = (list: typeof words) => list.map((word) => ({ spoken: word.spoken, phones: word.phones.map((phone) => [phone.wordIndex, phone.syllableIndex]) }))
    expect(shape(words)).toEqual(shape(whole))
  })

  it("sem palavras (só pontuação ou números) não emite nada e não mexe na numeração", () => {
    const phonemizer = createTestPhonemizer()
    expect(phonemizer.push("123 ... ")).toEqual([])
    const [first] = [...phonemizer.push("olá "), ...phonemizer.flush()]
    expect(first?.phones[0]).toMatchObject({ wordIndex: 0, syllableIndex: 0 })
  })
})
