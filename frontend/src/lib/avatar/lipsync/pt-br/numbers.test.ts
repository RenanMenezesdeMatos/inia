import { describe, expect, it } from "vitest"
import { CURRENCIES, cardinalWords, currencyWords, dateWords, digitWords, numberWords, ordinalWords, parseNumber, timeWords } from "./numbers"

const say = (words: readonly string[] | null) => (words === null ? null : words.join(" "))

describe("números por extenso", () => {
  it.each([
    [0, "zero"],
    [1, "um"],
    [16, "dezesseis"],
    [21, "vinte e um"],
    [100, "cem"],
    [101, "cento e um"],
    [110, "cento e dez"],
    [999, "novecentos e noventa e nove"],
    [1000, "mil"],
    [1001, "mil e um"],
    [1100, "mil e cem"],
    [1110, "mil cento e dez"],
    [1500, "mil e quinhentos"],
    [2026, "dois mil e vinte e seis"],
    [21000, "vinte e um mil"],
    [1_000_000, "um milhão"],
    [1_500_000, "um milhão e quinhentos mil"],
    [2_000_300, "dois milhões e trezentos"],
    [3_000_000_000, "três bilhões"],
  ])("cardinal %d → %s", (value, expected) => {
    expect(say(cardinalWords(value))).toBe(expected)
  })

  it("feminino concorda unidades e centenas, nunca milhão", () => {
    expect(say(cardinalWords(2, true))).toBe("duas")
    expect(say(cardinalWords(201, true))).toBe("duzentas e uma")
    expect(say(cardinalWords(2_000_000, true))).toBe("dois milhões")
    expect(say(cardinalWords(2200, true))).toBe("duas mil e duzentas")
  })

  it("ordinais", () => {
    expect(say(ordinalWords(1))).toBe("primeiro")
    expect(say(ordinalWords(1, true))).toBe("primeira")
    expect(say(ordinalWords(10))).toBe("décimo")
    expect(say(ordinalWords(23, true))).toBe("vigésima terceira")
    expect(say(ordinalWords(100))).toBe("centésimo")
  })

  it("parseNumber entende o formato brasileiro e protege protocolos", () => {
    expect(parseNumber("1.234,56")).toMatchObject({ integer: 1234, fraction: "56", decimalMark: "," })
    expect(parseNumber("3,5")).toMatchObject({ integer: 3, fraction: "5" })
    expect(parseNumber("2026")).toMatchObject({ integer: 2026, fraction: null })
    expect(parseNumber("-7")).toMatchObject({ integer: 7, negative: true })
    expect(parseNumber("0800")).toMatchObject({ digitString: "0800" })
    expect(parseNumber("12,")).toBeNull()
    expect(parseNumber("abc")).toBeNull()
    expect(say(numberWords(parseNumber("0,05")!))).toBe("zero vírgula zero cinco")
    expect(say(numberWords(parseNumber("0800")!))).toBe("zero oito zero zero")
    expect(say(digitWords("190"))).toBe("um nove zero")
  })

  it("dinheiro", () => {
    const real = CURRENCIES["R$"]!
    expect(say(currencyWords(real, parseNumber("10,50")!, null))).toBe("dez reais e cinquenta centavos")
    expect(say(currencyWords(real, parseNumber("1,00")!, null))).toBe("um real")
    expect(say(currencyWords(real, parseNumber("0,01")!, null))).toBe("um centavo")
    expect(say(currencyWords(real, parseNumber("1.000.000")!, null))).toBe("um milhão de reais")
    expect(say(currencyWords(real, parseNumber("2")!, "mil"))).toBe("dois mil reais")
    expect(say(currencyWords(real, parseNumber("1,5")!, "milhão"))).toBe("um vírgula cinco milhão de reais")
  })

  it("horas e datas", () => {
    expect(say(timeWords("8h30"))).toBe("oito e trinta")
    expect(say(timeWords("8:30"))).toBe("oito e trinta")
    expect(say(timeWords("8h"))).toBe("oito horas")
    expect(say(timeWords("1h"))).toBe("uma hora")
    expect(say(timeWords("2h05min"))).toBe("duas horas e cinco minutos")
    expect(timeWords("25h")).toBeNull()
    expect(timeWords("8h61")).toBeNull()
    expect(say(dateWords("1/5"))).toBe("primeiro de maio")
    expect(say(dateWords("24/09/2026"))).toBe("vinte e quatro de setembro de dois mil e vinte e seis")
    expect(dateWords("32/01")).toBeNull()
  })
})
