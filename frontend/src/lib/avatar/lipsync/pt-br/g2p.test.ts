import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { PHONES } from "../phones"
import type { G2PWord, PhoneSymbol } from "../types"
import { createTranscriptPhonemizer, phonemizeText } from "./g2p"

/**
 * Expectativas escritas à mão a partir da fonética do PT-BR (sem oráculo externo): X-SAMPA do
 * inventário de `phones.ts`, sílabas separadas por " . ", tônica prefixada por "'". Cada palavra é
 * fonemizada ISOLADA (sem palavra seguinte), então o -s final é [s] — o sândi tem teste próprio.
 */

/** Uma palavra G2P → "p r i . 'm e . r u". */
function transcribe(word: G2PWord): string {
  const syllables: string[] = []
  let current = Number.NaN
  for (const token of word.phones) {
    if (token.syllableIndex !== current) {
      syllables.push(token.stressed ? "'" : "")
      current = token.syllableIndex
    }
    const index = syllables.length - 1
    syllables[index] += (syllables[index] === "" || syllables[index] === "'" ? "" : " ") + token.phone
  }
  return syllables.join(" . ")
}

function transcribeText(text: string): string[] {
  return phonemizeText(text).map(transcribe)
}

function single(text: string): string {
  const words = transcribeText(text)
  expect(words).toHaveLength(1)
  return words[0]!
}

function phonesOf(text: string): PhoneSymbol[] {
  return phonemizeText(text).flatMap((word) => word.phones.map((token) => token.phone))
}

type Fixture = { id: string; transcript: string; events: { t: number; transcript?: string }[] }

function loadFixture(id: string): Fixture {
  return JSON.parse(readFileSync(new URL(`../__fixtures__/gemini-live/${id}.json`, import.meta.url), "utf8")) as Fixture
}

const FIXTURE_IDS = ["frase-01-apresentacao", "frase-02-proposta", "frase-03-escolha", "frase-04-amanha", "frase-05-labiais", "resposta-longa"]

// ---------------------------------------------------------------------------
// Palavras
// ---------------------------------------------------------------------------

const WORDS: ReadonlyArray<readonly [string, string]> = [
  // Frases das fixtures do Gemini Live.
  ["olá", "o . 'l a"],
  ["você", "v o . 's e"],
  ["juntos", "'Z u~ . t u s"],
  ["mentora", "m e~ . 't o . r 6"],
  ["simples", "'s i~ . p l i s"],
  ["primeiro", "p r i . 'm e . r u"], // ei → [e] antes de r
  ["ouvir", "o . 'v i r"], // ou → [o]
  ["prefere", "p r e . 'f E . r i"], // é aberto lexical
  ["benefícios", "b e . n e . 'f i . s j u s"], // pós-tônica vira ditongo crescente
  ["atendimento", "a . t e~ . dZ i . 'm e~ . t u"],
  ["amanhã", "a . m 6~ . 'J 6~"],
  ["oito", "'o j . t u"],
  ["meia", "'m e j . 6"],
  ["revisar", "R e . v i . 'z a r"],
  ["próximos", "'p r O . s i . m u s"], // x lexical [s]
  ["passos", "'p a . s u s"],
  ["aprender", "a . p r e~ . 'd e r"],
  ["fevereiro", "f e . v e . 'r e . r u"],
  ["vendas", "'v e~ . d 6 s"],
  ["sou", "'s o"],
  ["estou", "i s . 't o"], // es- inicial pretônico → [i]
  // Nasais: coda m/n só nasaliza, NUNCA fecha os lábios.
  ["campo", "'k 6~ . p u"],
  ["também", "t 6~ . 'b e~ j~"],
  ["bem", "'b e~ j~"],
  ["bom", "'b o~"],
  ["sim", "'s i~"],
  ["tempo", "'t e~ . p u"],
  ["antes", "'6~ . tS i s"],
  ["homem", "'o~ . m e~ j~"],
  ["falam", "'f a . l 6~ w~"],
  ["irmão", "i r . 'm 6~ w~"],
  ["mãe", "'m 6~ j~"],
  ["muito", "'m u~ j~ . t u"], // nasalização lexical
  ["ninguém", "n i~ . 'g e~ j~"],
  ["órfão", "'O r . f 6~ w~"],
  ["ainda", "a . 'i~ . d 6"],
  // Palatalização de t/d antes de [i] (inclusive o e final reduzido).
  ["tarde", "'t a r . dZ i"],
  ["gente", "'Z e~ . tS i"],
  ["cidade", "s i . 'd a . dZ i"],
  ["noite", "'n o j . tS i"],
  ["tia", "'tS i . 6"],
  ["de", "dZ i"],
  ["pede", "'p E . dZ i"],
  // Coda l → [w]; s intervocálico e coda sonorizada.
  ["brasil", "b r a . 'z i w"],
  ["alto", "'a w . t u"],
  ["sol", "'s O w"],
  ["papel", "p a . 'p E w"],
  ["fácil", "'f a . s i w"],
  ["casa", "'k a . z 6"],
  ["mesmo", "'m e z . m u"],
  ["desde", "'d e z . dZ i"],
  ["israel", "i z . R a . 'E w"],
  // Róticos: forte no início/rr/depois de n, tepe no resto.
  ["carro", "'k a . R u"],
  ["rato", "'R a . t u"],
  ["honra", "'o~ . R 6"],
  ["prato", "'p r a . t u"],
  ["caro", "'k a . r u"],
  ["guerra", "'g E . R 6"],
  // Dígrafos e h mudo.
  ["chave", "'S a . v i"],
  ["filho", "'f i . L u"],
  ["banho", "'b 6~ . J u"],
  ["hoje", "'o . Z i"],
  ["nascer", "n a . 's e r"],
  ["tchau", "'tS a w"],
  // qu/gu.
  ["quando", "'k w 6~ . d u"],
  ["quero", "'k E . r u"],
  ["aqui", "a . 'k i"],
  ["queijo", "'k e . Z u"],
  ["guitarra", "g i . 't a . R 6"],
  ["água", "'a . g w 6"],
  ["cinquenta", "s i~ . 'k w e~ . t 6"],
  ["tranquilo", "t r 6~ . 'k w i . l u"],
  // x.
  ["exame", "e . 'z 6~ . m i"],
  ["texto", "'t e s . t u"],
  ["táxi", "'t a . k i . s i"],
  ["caixa", "'k a j . S 6"],
  ["peixe", "'p e . S i"], // ei → [e] antes de ʃ
  ["lixo", "'l i . S u"],
  ["exceto", "i . 's E . t u"],
  // i epentético em coda obstruinte / ataque ilegal.
  ["ritmo", "'R i . tS i . m u"],
  ["advogado", "a . dZ i . v o . 'g a . d u"],
  ["pneu", "p i . 'n e w"],
  ["psicologia", "p i . s i . k o . l o . 'Z i . 6"],
  ["absoluto", "a . b i . s o . 'l u . t u"],
  ["obrigado", "o . b r i . 'g a . d u"],
  // Ditongos, hiatos e glides.
  ["pouco", "'p o . k u"],
  ["beijo", "'b e . Z u"],
  ["ideia", "i . 'd E j . 6"],
  ["rainha", "R a . 'i~ . J 6"],
  ["saída", "s a . 'i . d 6"],
  ["médio", "'m E . dZ j u"],
  ["contínuos", "k o~ . 'tS i . n w u s"],
  ["sugestões", "s u . Z e s . 't o~ j~ s"],
  // Estrangeirismos e siglas do produto.
  ["feedback", "'f i . dZ i . b E . k i"],
  ["e-mail", "i . 'm e j w"],
  ["online", "o~ . 'l a j . n i"],
  ["ok", "o . 'k e j"],
  ["app", "'E . p i"],
  ["WhatsApp", "w a t . 's a . p i"],
  ["Vivo", "'v i . v u"],
  ["INIA", "i . 'n i . 6"],
  ["status", "i s . 't a . t u s"],
  // Vogal tônica aberta sem acento (léxico/sufixo) × fechada.
  ["jovem", "'Z O . v e~ j~"],
  ["escola", "i s . 'k O . l 6"],
  ["gostosa", "g o s . 't O . z 6"],
  ["joia", "'Z O j . 6"],
  ["pessoa", "p e . 's o . 6"],
  ["ele", "'e . l i"],
]

describe("phonemizeText — palavras", () => {
  it.each(WORDS)("%s → %s", (text, expected) => {
    expect(single(text)).toBe(expected)
  })

  it("tem pelo menos 60 expectativas por palavra", () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(60)
  })

  it("m/n em coda nunca viram fechamento de lábios", () => {
    for (const word of ["campo", "também", "bem", "sim", "tempo", "um", "com", "ontem", "embora", "sempre"]) {
      const phones = phonesOf(word)
      expect(phones, word).not.toContain("m")
      expect(phones, word).not.toContain("n")
    }
    // Onset m continua bilabial.
    expect(phonesOf("mapa")).toEqual(["m", "a", "p", "6"])
    expect(phonesOf("campo").filter((phone) => phone === "p")).toHaveLength(1)
  })

  it("clíticos são átonos e reduzem a vogal", () => {
    for (const [word, expected] of [["de", "dZ i"], ["o", "u"], ["e", "i"], ["que", "k i"], ["a", "6"], ["um", "u~"], ["com", "k o~"], ["da", "d 6"]] as const) {
      const [g2p] = phonemizeText(word)
      expect(transcribe(g2p!), word).toBe(expected)
      expect(g2p!.phones.every((token) => !token.stressed), word).toBe(true)
    }
  })

  it("toda palavra lexical tem exatamente uma sílaba tônica", () => {
    for (const [text] of WORDS) {
      if (text === "de") continue // clítico: átono por definição
      const [word] = phonemizeText(text)
      const stressedSyllables = new Set(word!.phones.filter((token) => token.stressed).map((token) => token.syllableIndex))
      expect(stressedSyllables.size, text).toBe(1)
      const nuclei = word!.phones.filter((token) => token.stressed && token.nucleus)
      expect(nuclei, text).toHaveLength(1)
      expect(PHONES[nuclei[0]!.phone].class, text).toBe("vowel")
    }
  })

  it("uma palavra escrita pode virar várias faladas (normalização)", () => {
    const [time] = phonemizeText("8h30")
    expect(time!.text).toBe("8h30")
    expect(time!.spoken).toBe("oito e trinta")
    expect(transcribe(time!)).toBe("'o j . t u . i . 't r i~ . t 6")
    const [tma] = phonemizeText("TMA")
    expect(tma!.spoken).toBe("tê eme á")
    // Nome da letra "eme" nasaliza a tônica antes de m, como "tema": [ˈẽmi].
    expect(transcribe(tma!)).toBe("'t e . 'e~ . m i . 'a")
  })

  it("palavra sem vogal (interjeição) não gera fones nem palavra", () => {
    const words = phonemizeText("Hmm, certo.")
    expect(words.map((word) => word.text)).toEqual(["certo"])
    expect(words[0]!.pauseAfter).toBe("long")
  })
})

// ---------------------------------------------------------------------------
// Frase: sândi, pausas, pergunta, índices, durações
// ---------------------------------------------------------------------------

describe("phonemizeText — frase", () => {
  it("-s final sonoriza antes de vogal ou consoante sonora (sândi) e fica [s] antes de pausa/surda", () => {
    expect(transcribeText("os amigos")).toEqual(["u z", "a . 'm i . g u s"])
    expect(transcribeText("os pratos")).toEqual(["u s", "'p r a . t u s"])
    expect(transcribeText("vamos ver")).toEqual(["'v 6~ . m u z", "'v e r"])
    expect(transcribeText("às oito")).toEqual(["a z", "'o j . t u"])
    expect(transcribeText("vamos. Ver")[0]).toBe("'v 6~ . m u s")
  })

  it("pontuação vira pausa e pergunta", () => {
    const words = phonemizeText("Olá! Eu sou a INIA, sua mentora. Vamos aprender juntos?")
    expect(words.map((word) => word.pauseAfter)).toEqual(["long", "none", "none", "none", "short", "none", "long", "none", "none", "long"])
    expect(words.map((word) => word.questionEnd)).toEqual([false, false, false, false, false, false, false, false, false, true])
  })

  it("índices de palavra e sílaba são monotônicos e respeitam os índices iniciais", () => {
    const words = phonemizeText("Minha proposta é bem simples", { startWordIndex: 10, startSyllableIndex: 40 })
    expect(words.map((word) => word.phones[0]!.wordIndex)).toEqual([10, 11, 12, 13, 14])
    expect(words[0]!.phones[0]!.syllableIndex).toBe(40)
    const flat = words.flatMap((word) => word.phones)
    for (let index = 1; index < flat.length; index++) {
      expect(flat[index]!.syllableIndex - flat[index - 1]!.syllableIndex).toBeGreaterThanOrEqual(0)
      expect(flat[index]!.syllableIndex - flat[index - 1]!.syllableIndex).toBeLessThanOrEqual(1)
    }
    // mi~.J6 + pro.pos.t6 + E + be~j~ + si~.plis = 9 sílabas.
    expect(flat[flat.length - 1]!.syllableIndex).toBe(48)
  })

  it("priori de duração: tônica alonga, átona final encurta, pré-pausa alonga", () => {
    const [mentora] = phonemizeText("mentora")
    const stressed = mentora!.phones.find((token) => token.stressed && token.nucleus)
    expect(stressed?.phone).toBe("o")
    expect(stressed?.durationPriorMs).toBeCloseTo(PHONES.o.baseDurationMs * 1.45, 0)
    const final = mentora!.phones[mentora!.phones.length - 1]!
    expect(final.phone).toBe("6")
    expect(final.durationPriorMs).toBeCloseTo(PHONES["6"].baseDurationMs * 0.6, 0)

    const [beforePause] = phonemizeText("mentora.")
    const finalBeforePause = beforePause!.phones[beforePause!.phones.length - 1]!
    expect(finalBeforePause.durationPriorMs).toBeCloseTo(PHONES["6"].baseDurationMs * 0.6 * 1.3, 0)

    for (const token of phonemizeText("Vamos revisar os próximos passos com calma.").flatMap((word) => word.phones)) {
      expect(token.durationPriorMs).toBeGreaterThanOrEqual(PHONES[token.phone].minDurationMs)
      expect(token.durationPriorMs).toBeLessThan(400)
    }
  })

  it("texto vazio, só pontuação ou só emoji não gera palavras", () => {
    expect(phonemizeText("")).toEqual([])
    expect(phonemizeText("  ... — !! ")).toEqual([])
    expect(phonemizeText("👍🏽 🎉")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Incremental
// ---------------------------------------------------------------------------

function summary(words: readonly G2PWord[]): string[] {
  return words.map(
    (word) =>
      `${word.text}|${word.spoken}|${word.pauseAfter}|${word.questionEnd}|` +
      word.phones.map((token) => `${token.phone}:${token.wordIndex}:${token.syllableIndex}:${token.stressed ? 1 : 0}:${token.durationPriorMs}`).join(","),
  )
}

function pushAll(fragments: readonly string[]): { perPush: G2PWord[][]; flushed: G2PWord[] } {
  const phonemizer = createTranscriptPhonemizer()
  const perPush = fragments.map((fragment) => phonemizer.push(fragment))
  return { perPush, flushed: phonemizer.flush() }
}

describe("createTranscriptPhonemizer", () => {
  it("só devolve palavras completas e junta palavras cortadas entre fragmentos", () => {
    const phonemizer = createTranscriptPhonemizer()
    expect(phonemizer.push("Eu sou sua men").map((word) => word.text)).toEqual(["Eu", "sou", "sua"])
    expect(phonemizer.push("")).toEqual([])
    expect(phonemizer.push("tora")).toEqual([])
    const rest = phonemizer.push(" de")
    expect(rest.map((word) => word.text)).toEqual(["mentora"])
    expect(transcribe(rest[0]!)).toBe("m e~ . 't o . r 6")
    expect(phonemizer.flush().map((word) => word.text)).toEqual(["de"])
    expect(phonemizer.flush()).toEqual([])
  })

  it("próximo fragmento começando com espaço completa a palavra anterior", () => {
    const phonemizer = createTranscriptPhonemizer()
    expect(phonemizer.push("Olá! Como").map((word) => word.text)).toEqual(["Olá"])
    expect(phonemizer.push(" sua").map((word) => word.text)).toEqual(["Como"])
    expect(phonemizer.push(" mentora virtual,").map((word) => word.text)).toEqual(["sua", "mentora", "virtual"])
  })

  it("pontuação inequívoca fecha a palavra na hora; vírgula depois de dígito espera (decimal)", () => {
    const phonemizer = createTranscriptPhonemizer()
    expect(phonemizer.push("juntos?").map((word) => word.questionEnd)).toEqual([true])
    expect(phonemizer.push(" Custa R$ 10,").map((word) => word.text)).toEqual(["Custa"])
    // Dinheiro espera a palavra seguinte ficar completa ("R$ 2 mil" muda a leitura).
    expect(phonemizer.push("50 hoje")).toEqual([])
    expect(phonemizer.push(" e").map((word) => word.spoken)).toEqual(["dez reais e cinquenta centavos", "hoje"])
    expect(phonemizer.flush().map((word) => word.text)).toEqual(["e"])
  })

  it("números esperam a palavra seguinte para concordar em gênero", () => {
    const phonemizer = createTranscriptPhonemizer()
    // "às" termina em -s: espera o número inteiro para saber a inicial falada (sândi).
    expect(phonemizer.push("às 2")).toEqual([])
    const middle = phonemizer.push(" horas e 2 metas")
    expect(middle.map((word) => word.spoken)).toEqual(["às", "duas", "horas", "e"])
    expect(transcribe(middle[0]!)).toBe("a z")
    expect(phonemizer.flush().map((word) => word.spoken)).toEqual(["duas", "metas"])
  })

  it("índices continuam monotônicos entre fragmentos e voltam a zero no reset", () => {
    const phonemizer = createTranscriptPhonemizer()
    const words = [...phonemizer.push("Minha proposta"), ...phonemizer.push(" é bem"), ...phonemizer.push(" simples"), ...phonemizer.flush()]
    expect(words.map((word) => word.phones[0]!.wordIndex)).toEqual([0, 1, 2, 3, 4])
    expect(words[4]!.phones[0]!.syllableIndex).toBe(7)
    phonemizer.reset()
    const [again] = [...phonemizer.push("Olá"), ...phonemizer.flush()]
    expect(again!.phones[0]!.wordIndex).toBe(0)
    expect(again!.phones[0]!.syllableIndex).toBe(0)
  })

  it("reset descarta a palavra pendente", () => {
    const phonemizer = createTranscriptPhonemizer()
    phonemizer.push("men")
    phonemizer.reset()
    expect([...phonemizer.push("tora"), ...phonemizer.flush()].map((word) => word.text)).toEqual(["tora"])
  })

  it.each(FIXTURE_IDS)("%s: fragmentos reais do Gemini Live dão o mesmo resultado do texto inteiro", (id) => {
    const fixture = loadFixture(id)
    const fragments = fixture.events.filter((event) => event.transcript !== undefined).map((event) => event.transcript as string)
    expect(fragments.join("")).toBe(fixture.transcript)
    const { perPush, flushed } = pushAll(fragments)
    expect(summary([...perPush.flat(), ...flushed])).toEqual(summary(phonemizeText(fixture.transcript)))
    // Latência: depois de cada fragmento, no máximo UMA palavra (a que ainda pode continuar) fica
    // pendente — esperar a inicial da seguinte não custa nada com fragmentos " palavra".
    let emitted = 0
    let prefix = ""
    fragments.forEach((fragment, index) => {
      prefix += fragment
      emitted += perPush[index]!.length
      expect(phonemizeText(prefix).length - emitted, JSON.stringify(prefix.slice(-30))).toBeLessThanOrEqual(1)
    })
    expect(flushed.length).toBeLessThanOrEqual(1)
  })

  it("cortes em QUALQUER posição (caractere a caractere) não mudam o resultado", () => {
    const text =
      "Olá! A INIA revisa o TMA às 8h30, custa R$ 10,50 (15% a menos) e o Sr. Silva vai ver 2 mil vendas… E-mail? Ok — feedback no WhatsApp."
    const { perPush, flushed } = pushAll([...text])
    expect(summary([...perPush.flat(), ...flushed])).toEqual(summary(phonemizeText(text)))
  })

  it("cortes em pedaços irregulares da resposta longa não mudam o resultado", () => {
    const text = loadFixture("resposta-longa").transcript
    const fragments: string[] = []
    let seed = 7
    for (let index = 0; index < text.length; ) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const size = 1 + (seed % 9)
      fragments.push(text.slice(index, index + size))
      index += size
    }
    const { perPush, flushed } = pushAll(fragments)
    expect(summary([...perPush.flat(), ...flushed])).toEqual(summary(phonemizeText(text)))
  })
})

// ---------------------------------------------------------------------------
// Fixtures reais
// ---------------------------------------------------------------------------

describe("fixtures do Gemini Live", () => {
  it.each(FIXTURE_IDS)("%s: fones plausíveis e uma tônica por palavra lexical", (id) => {
    const { transcript } = loadFixture(id)
    const words = phonemizeText(transcript)
    const writtenWords = transcript.split(/\s+/).filter((word) => /[\p{L}\d]/u.test(word))
    expect(words.length).toBe(writtenWords.length)
    const syllables = new Set(words.flatMap((word) => word.phones.map((token) => token.syllableIndex)))
    const phoneCount = words.reduce((sum, word) => sum + word.phones.length, 0)
    // PT-BR tem ~2,3 fones por sílaba; a razão fora de [1,5; 3,5] indicaria regra quebrada.
    expect(phoneCount / syllables.size).toBeGreaterThan(1.5)
    expect(phoneCount / syllables.size).toBeLessThan(3.5)
    for (const word of words) {
      expect(word.phones.length, word.text).toBeGreaterThan(0)
      const nuclei = word.phones.filter((token) => token.nucleus)
      expect(nuclei.length, word.text).toBeGreaterThan(0)
      const stressedSyllables = new Set(word.phones.filter((token) => token.stressed).map((token) => token.syllableIndex))
      expect(stressedSyllables.size, word.text).toBeLessThanOrEqual(word.spoken.split(" ").length)
    }
    expect(words[words.length - 1]!.pauseAfter).toBe("long")
  })

  it("frase-01: transcrição completa", () => {
    const words = phonemizeText(loadFixture("frase-01-apresentacao").transcript)
    expect(words.map(transcribe)).toEqual([
      "o . 'l a",
      "'e w",
      "'s o",
      "6",
      "i . 'n i . 6",
      "'s u . 6",
      "m e~ . 't o . r 6",
      "'v 6~ . m u z",
      "a . p r e~ . 'd e r",
      "'Z u~ . t u s",
    ])
    expect(words[words.length - 1]!.questionEnd).toBe(true)
  })

  it("frase-05 (labiais): cada p/b/m escrito em ataque vira fechamento; coda m não", () => {
    const { transcript } = loadFixture("frase-05-labiais")
    const phones = phonesOf(transcript)
    const bilabials = phones.filter((phone) => phone === "p" || phone === "b" || phone === "m")
    // Posso passar um bom feedback? Vamos ver juntos o mapa das vendas e das metas de fevereiro.
    // p p b b m m p m → "um"/"bom" sem [m] final; "Vamos" e "metas" com [m] de ataque.
    expect(bilabials).toEqual(["p", "p", "b", "b", "m", "m", "p", "m"])
  })

  it("resposta longa: número de palavras e sílabas estável e fonemização < 5 ms", () => {
    const { transcript } = loadFixture("resposta-longa")
    const words = phonemizeText(transcript)
    const syllables = new Set(words.flatMap((word) => word.phones.map((token) => token.syllableIndex)))
    // 117 palavras, ~290 sílabas ≈ 55 s de fala a ~5,3 sílabas/s.
    expect(words.length).toBe(117)
    expect(syllables.size).toBeGreaterThan(250)
    expect(syllables.size).toBeLessThan(330)

    for (let warm = 0; warm < 3; warm++) phonemizeText(transcript)
    const samples: number[] = []
    for (let run = 0; run < 9; run++) {
      const started = performance.now()
      phonemizeText(transcript)
      samples.push(performance.now() - started)
    }
    samples.sort((a, b) => a - b)
    expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(5)
  })
})
