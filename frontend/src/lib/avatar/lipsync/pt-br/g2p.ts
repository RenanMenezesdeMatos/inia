import type { G2PWord, PhoneToken, TranscriptPhonemizer } from "../types"
import { PHONES } from "../phones"
import { tokenizeForSpeech, type SpeechToken } from "./normalize"
import { phonemizeWord, type PhoneSyllable, type SyllableRole } from "./phonetics"

/**
 * G2P do PT-BR por regras: texto (ou fragmentos do `outputTranscription`) → palavras → sílabas →
 * fones com tonicidade e priori de duração. Sem dependências e sem oráculo externo: normalização em
 * `normalize.ts`, silabação em `syllabify.ts`, tonicidade em `stress.ts`, regras de fone em
 * `phonetics.ts`, exceções em `lexicon.ts`.
 *
 * Duração (`durationPriorMs`) = base do fone (`phones.ts`) × tonicidade × posição:
 * núcleo tônico ×1,45; pretônico ×0,9; pós-tônico medial ×0,75; átona final ×0,6 (as reduzidas
 * [i]/[u]/[ɐ] do fim da palavra, que às vezes nem soam); clítico ×0,75; [i] epentético ×0,5. A última
 * sílaba antes de uma pausa (pontuação) alonga ×1,3 na rima. É uma PRIORI para o alinhador — o áudio
 * decide o tempo real.
 */

export type PhonemizeOptions = {
  /** Índices iniciais, para continuar a numeração entre fragmentos do mesmo turno. */
  startWordIndex?: number
  startSyllableIndex?: number
}

const NUCLEUS_FACTOR: Readonly<Record<SyllableRole, number>> = {
  stressed: 1.45,
  pretonic: 0.9,
  posttonic: 0.75,
  final: 0.6,
  clitic: 0.75,
  epenthetic: 0.5,
}
const STRESSED_CONSONANT_FACTOR = 1.1
const EPENTHETIC_CONSONANT_FACTOR = 0.9
const STRESSED_GLIDE_FACTOR = 1.15
const PRE_PAUSE_RHYME_FACTOR = 1.3
const PRE_PAUSE_ONSET_FACTOR = 1.1

type Counters = { wordIndex: number; syllableIndex: number }

function durationPrior(syllable: PhoneSyllable, position: number, prePause: boolean): number {
  const info = PHONES[syllable.phones[position]!]
  let factor = 1
  if (position === syllable.nucleus) factor = NUCLEUS_FACTOR[syllable.role]
  else if (info.class === "glide" || info.class === "vowel") {
    if (syllable.role === "stressed") factor = STRESSED_GLIDE_FACTOR
    else if (syllable.role === "epenthetic") factor = EPENTHETIC_CONSONANT_FACTOR
  } else if (syllable.role === "stressed") factor = STRESSED_CONSONANT_FACTOR
  else if (syllable.role === "epenthetic") factor = EPENTHETIC_CONSONANT_FACTOR
  if (prePause) factor *= syllable.nucleus >= 0 && position >= syllable.nucleus ? PRE_PAUSE_RHYME_FACTOR : PRE_PAUSE_ONSET_FACTOR
  return Math.max(info.minDurationMs, Math.round(info.baseDurationMs * factor * 10) / 10)
}

function tokenSyllables(token: SpeechToken): PhoneSyllable[] {
  const syllables: PhoneSyllable[] = []
  token.words.forEach((word, index) => {
    const nextInitial = index < token.words.length - 1 ? (token.words[index + 1]![0] ?? null) : token.nextInitial
    syllables.push(...phonemizeWord(word, { nextInitial }))
  })
  return syllables
}

function buildWords(tokens: readonly SpeechToken[], counters: Counters): G2PWord[] {
  const words: G2PWord[] = []
  for (const token of tokens) {
    const syllables = tokenSyllables(token)
    if (syllables.length === 0) {
      // Nada articulável ("hmm"): a pausa fica com a palavra anterior.
      const previous = words[words.length - 1]
      if (previous && token.pauseAfter !== "none" && (token.pauseAfter === "long" || previous.pauseAfter === "none")) previous.pauseAfter = token.pauseAfter
      if (previous && token.questionEnd) previous.questionEnd = true
      continue
    }
    const phones: PhoneToken[] = []
    const last = syllables.length - 1
    syllables.forEach((syllable, syllableIndex) => {
      const prePause = token.pauseAfter !== "none" && syllableIndex === last
      syllable.phones.forEach((phone, position) => {
        phones.push({
          phone,
          wordIndex: counters.wordIndex,
          syllableIndex: counters.syllableIndex,
          nucleus: position === syllable.nucleus,
          stressed: syllable.role === "stressed",
          durationPriorMs: durationPrior(syllable, position, prePause),
          ...(syllable.optional?.[position] ? { optional: true } : {}),
        })
      })
      counters.syllableIndex += 1
    })
    words.push({ text: token.text, spoken: token.words.join(" "), phones, pauseAfter: token.pauseAfter, questionEnd: token.questionEnd })
    counters.wordIndex += 1
  }
  return words
}

export function phonemizeText(text: string, options: PhonemizeOptions = {}): G2PWord[] {
  const { tokens } = tokenizeForSpeech(text, { final: true })
  return buildWords(tokens, { wordIndex: options.startWordIndex ?? 0, syllableIndex: options.startSyllableIndex ?? 0 })
}

/**
 * G2P incremental para o `outputTranscription` do Gemini Live: os fragmentos cortam palavras em
 * qualquer lugar ("men" + "tora") e costumam começar com espaço (" sou", " a INIA,"). `push` só
 * devolve palavras COMPLETAS — seguidas de espaço/pontuação no texto acumulado, ou quando o próximo
 * fragmento começa com espaço —; números e moeda esperam a palavra seguinte (concordância). Índices
 * de palavra e sílaba continuam monotônicos entre fragmentos; `reset` volta a zero.
 *
 * Uma palavra sem pontuação depois também espera a PRIMEIRA letra da seguinte (sândi do -s final,
 * pontuação solta " —" que dá a pausa dela) — com o Gemini isso não atrasa nada, porque o espaço e a
 * palavra seguinte chegam no mesmo fragmento. Resultado: cortar o texto em qualquer posição dá
 * exatamente os mesmos fones que fonemizar o texto inteiro (há teste para isso).
 */
export function createTranscriptPhonemizer(): TranscriptPhonemizer {
  let buffer = ""
  let atLineStart = true
  const counters: Counters = { wordIndex: 0, syllableIndex: 0 }

  function run(final: boolean): G2PWord[] {
    if (buffer.length === 0) return []
    const { tokens, consumed } = tokenizeForSpeech(buffer, { final, atLineStart })
    if (consumed > 0) {
      atLineStart = /\n\s*$/.test(buffer.slice(0, consumed))
      buffer = buffer.slice(consumed)
    }
    return buildWords(tokens, counters)
  }

  return {
    push(fragment: string): G2PWord[] {
      if (fragment.length === 0) return []
      buffer += fragment
      return run(false)
    },
    flush(): G2PWord[] {
      const words = run(true)
      buffer = ""
      return words
    },
    reset(): void {
      buffer = ""
      atLineStart = true
      counters.wordIndex = 0
      counters.syllableIndex = 0
    },
  }
}
