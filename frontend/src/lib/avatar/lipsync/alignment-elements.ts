import { emissionClassOf } from "./emission-model"
import { PHONES } from "./phones"
import type { G2PWord, PhoneSymbol } from "./types"

/**
 * Palavras do G2P → sequência linear de ELEMENTOS para o alinhador (um fone ou uma pausa
 * opcional), cada um com classe acústica, duração esperada e o que custa pular.
 *
 * Por que opcional: o G2P é por regras e a fala do Gemini é conversacional. Átonas finais somem
 * ("passos" → [ˈpasus] quase [ˈpass]), o -r do infinitivo cai ("revisar" → [xeviˈza]), glides se
 * fundem na vogal. Em vez de errar a posição de tudo que vem depois, o alinhador pode pular esses
 * fones com um custo pequeno — a evidência acústica decide. Pausas depois de cada palavra também
 * são opcionais, com custo pela pontuação: "." quase sempre pausa (pular custa), vírgula às vezes,
 * sem pontuação só com evidência forte (hesitação/respiração) e nunca curta — senão o fechamento de
 * uma oclusiva ([p] de "os próximos") viraria "pausa".
 */

export type AlignmentElement = {
  phone: PhoneSymbol
  cls: number
  /** Palavra do turno (−1 para pausa). */
  wordIndex: number
  stressed: boolean
  nucleus: boolean
  /** Duração esperada (ms) antes da taxa de fala. */
  expectedMs: number
  /** Duração mínima (ms) quando presente. */
  minMs: number
  maxMs: number
  /** Dispersão log-normal da duração. */
  sigma: number
  optional: boolean
  /** Custo de pular (só opcionais). */
  skipCost: number
  /** Custo de estar presente (pausa sem pontuação). */
  presentCost: number
  /** Primeiro elemento de uma palavra (bom ponto para retomar depois de texto atrasado). */
  wordStart: boolean
  /** Pausa: força da pontuação (0 nenhuma, 2 curta, 3 longa); −1 nos fones. */
  punctuation: number
}

const REDUCIBLE_FINAL_VOWELS = new Set<PhoneSymbol>(["i", "u", "6", "i~", "u~"])
const PAUSE_CLASS = emissionClassOf("_")

/** Pausa opcional por pontuação. */
function pauseElement(punctuation: 0 | 2 | 3): AlignmentElement {
  const long = punctuation === 3
  const short = punctuation === 2
  return {
    phone: "_",
    cls: PAUSE_CLASS,
    wordIndex: -1,
    stressed: false,
    nucleus: false,
    expectedMs: long ? 320 : short ? 200 : 220,
    minMs: long ? 50 : short ? 60 : 130,
    maxMs: 8000,
    sigma: 0.9,
    optional: true,
    skipCost: long ? 1.5 : short ? 0.3 : 0,
    presentCost: long ? 0 : short ? 0.2 : 2.2,
    wordStart: false,
    punctuation,
  }
}

/** Pausa/silêncio antes da primeira palavra do turno (sem custo nenhum). */
export function leadingPause(): AlignmentElement {
  return { ...pauseElement(3), skipCost: 0, presentCost: 0, expectedMs: 200, minMs: 10 }
}

export function buildElements(words: readonly G2PWord[], out: AlignmentElement[] = []): AlignmentElement[] {
  for (const word of words) {
    const phones = word.phones.filter((token) => token.phone !== "_")
    const lastSyllable = phones.length > 0 ? phones[phones.length - 1].syllableIndex : -1
    phones.forEach((token, index) => {
      const info = PHONES[token.phone]
      const isLast = index === phones.length - 1
      const finalSyllable = token.syllableIndex === lastSyllable
      let optional = false
      let skipCost = 0
      if (token.optional) {
        // Vogal epentética do léxico ("fid[i]back"): a voz em inglês do Gemini costuma não tê-la.
        optional = true
        skipCost = 0.6
      } else if (!token.stressed && finalSyllable && token.nucleus && REDUCIBLE_FINAL_VOWELS.has(token.phone) && phones.length > 1) {
        // Átona final reduzida/desvozeada.
        optional = true
        skipCost = 1.2
      } else if (isLast && (token.phone === "r" || token.phone === "R") && phones.length > 2) {
        // -r do infinitivo / coda final: cai muito na fala do Gemini.
        optional = true
        skipCost = 0.4
      } else if (info.class === "glide") {
        optional = true
        skipCost = 0.8
      } else if (token.phone === "r") {
        optional = true
        skipCost = 1.2
      }
      out.push({
        phone: token.phone,
        cls: emissionClassOf(token.phone),
        wordIndex: token.wordIndex,
        stressed: token.stressed,
        nucleus: token.nucleus,
        expectedMs: token.durationPriorMs,
        minMs: optional ? 10 : Math.min(info.minDurationMs, token.durationPriorMs * 0.6),
        maxMs: Math.max(token.durationPriorMs * 4, 160),
        sigma: info.class === "vowel" ? 0.45 : 0.5,
        optional,
        skipCost,
        presentCost: 0,
        wordStart: index === 0,
        punctuation: -1,
      })
    })
    out.push(pauseElement(word.pauseAfter === "long" ? 3 : word.pauseAfter === "short" ? 2 : 0))
  }
  return out
}
