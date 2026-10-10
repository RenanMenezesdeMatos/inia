import { describe, expect, it } from "vitest"
import { stressedSyllableIndex } from "./stress"
import { preprocessOrthography, syllabify, syllablesToText } from "./syllabify"

/** Silabação fonológica: "(i)" = sílaba epentética; o número é a tônica (contando epentéticas). */
function analyze(word: string): [string, number] {
  const syllables = syllabify(word)
  return [syllablesToText(syllables), stressedSyllableIndex(preprocessOrthography(word.toLowerCase()), syllables)]
}

describe("syllabify + stressedSyllableIndex", () => {
  it.each([
    // Dígrafos que ficam entre sílabas (a coda redundante some nas regras de fone).
    ["carro", "car-ro", 0],
    ["passo", "pas-so", 0],
    ["descer", "des-cer", 1],
    ["nascer", "nas-cer", 1],
    ["chave", "cha-ve", 0],
    ["filho", "fi-lho", 0],
    ["banho", "ba-nho", 0],
    // Epêntese: coda obstruinte e ataque inicial ilegal.
    ["ritmo", "ri-t(i)-mo", 0],
    ["advogado", "a-d(i)-vo-ga-do", 3],
    ["pneu", "p(i)-neu", 1],
    ["psicologia", "p(i)-si-co-lo-gi-a", 4],
    ["status", "(i)s-ta-tus", 2],
    ["atleta", "a-t(i)-le-ta", 2],
    ["táxi", "tá-k(i)-si", 0],
    // Encontros consonantais legítimos no ataque.
    ["prato", "pra-to", 0],
    ["aprender", "a-pren-der", 2],
    // Ditongos × hiatos.
    ["pai", "pai", 0],
    ["céu", "céu", 0],
    ["muito", "mui-to", 0],
    ["rainha", "ra-i-nha", 1],
    ["saída", "sa-í-da", 1],
    ["ruim", "ru-im", 1],
    ["cair", "ca-ir", 1],
    ["benefícios", "be-ne-fí-ci-os", 2],
    ["contínuo", "con-tí-nu-o", 1],
    // Ditongos nasais.
    ["irmão", "ir-mão", 1],
    ["mãe", "mãe", 0],
    ["põe", "põe", 0],
    ["sabão", "sa-bão", 1],
    // qu/gu.
    ["quando", "quan-do", 0],
    ["água", "á-gua", 0],
    ["guerra", "guer-ra", 0],
    ["aqui", "a-qui", 1],
    ["cinquenta", "cin-quen-ta", 1],
    // x resolvido antes da silabação; h mudo.
    ["caixa", "cai-cha", 0],
    ["exame", "e-za-me", 1],
    ["texto", "tes-to", 0],
    ["próximo", "prós-si-mo", 0],
    ["hoje", "o-je", 0],
    ["homem", "o-mem", 0],
    // Tonicidade: acento, til, paroxítona por terminação, oxítona no resto.
    ["mentora", "men-to-ra", 1],
    ["falam", "fa-lam", 0],
    ["fácil", "fá-cil", 0],
    ["útil", "ú-til", 0],
    ["júri", "jú-ri", 0],
    ["lápis", "lá-pis", 0],
    ["revisar", "re-vi-sar", 2],
    ["amanhã", "a-ma-nhã", 2],
    ["você", "vo-cê", 1],
    ["café", "ca-fé", 1],
    ["Brasil", "bra-sil", 1],
    ["aqui", "a-qui", 1],
    ["jovens", "jo-vens", 0],
  ] as const)("%s → %s (tônica %d)", (word, syllables, stress) => {
    expect(analyze(word)).toEqual([syllables, stress])
  })

  it("palavra sem vogal não tem sílabas nem tônica", () => {
    expect(syllabify("hmm")).toEqual([])
    expect(stressedSyllableIndex("hmm", [])).toBe(-1)
  })

  it("x: léxico [ks]/[s], inicial [ʃ], ex+vogal [z], antes de consoante [s], resto [ʃ]", () => {
    expect(preprocessOrthography("táxi")).toBe("táksi")
    expect(preprocessOrthography("fixo")).toBe("fikso")
    expect(preprocessOrthography("máximo")).toBe("mássimo")
    expect(preprocessOrthography("xícara")).toBe("chícara")
    expect(preprocessOrthography("exemplo")).toBe("ezemplo")
    expect(preprocessOrthography("inexistente")).toBe("inezistente")
    expect(preprocessOrthography("explicar")).toBe("esplicar")
    expect(preprocessOrthography("peixe")).toBe("peiche")
    expect(preprocessOrthography("tórax")).toBe("tóraks")
  })
})
