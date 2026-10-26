/**
 * MEDIDA DE LEITURA do texto entregue (`READABILITY_PT_V1`, `PLAIN_LANGUAGE_V1`): frases, palavras por frase e o índice de Flesch
 * adaptado ao português (Martins et al., 1996: 248,835 − 1,015 × palavras/frase − 84,6 × sílabas/palavra). As sílabas são APROXIMADAS
 * por grupos de vogais, então o índice serve para comparar textos do motor entre si, nunca como nota exata. Só acompanha: não é meta
 * nem trava, e nada decide por ele (a extensão das frases é do redator).
 * Faixas usuais do índice: 75–100 muito fácil, 50–75 fácil, 25–50 difícil, 0–25 muito difícil.
 */
export const READABILITY_VERSION = "READABILITY_PT_V1" as const

export type Readability = { version: typeof READABILITY_VERSION; sentences: number; words: number; wordsPerSentence: number; fleschPt: number }

const WORD = /[\p{L}\p{N}]+/gu
const VOWEL_GROUP = /[aáàâãeéêiíoóôõuúü]+/g

/** Sílabas aproximadas: cada grupo de vogais conta uma (ditongo = 1); três ou mais vogais seguidas contam uma a menos que o grupo. */
function syllablesOf(word: string): number {
  const groups = word.toLowerCase().match(VOWEL_GROUP) ?? []
  return Math.max(1, groups.reduce((total, group) => total + (group.length <= 2 ? 1 : group.length - 1), 0))
}

/** Texto do motor em markdown simples: negrito e marcadores de lista saem; cada linha (item de lista, parágrafo) fecha frase. */
export function readabilityOf(text: string): Readability | null {
  const plain = text.replace(/\*\*/g, "").replace(/^\s*(?:[-*]|\d+\.)\s+/gm, "")
  // A frase também acaba numa fala citada que fecha com a pontuação dela (“…fraude.” Depois…) — desde `LITERAL_QUOTES_V1` o ponto do redator
  // não se repete depois da fala.
  const sentences = plain.split(/\n+|(?<=[.!?…]["”»’]?)\s+/u).filter((sentence) => (sentence.match(WORD) ?? []).length > 0)
  const words = plain.match(WORD) ?? []
  if (sentences.length === 0 || words.length === 0) return null
  const wordsPerSentence = words.length / sentences.length
  const syllablesPerWord = words.reduce((total, word) => total + syllablesOf(word), 0) / words.length
  const fleschPt = 248.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord
  return { version: READABILITY_VERSION, sentences: sentences.length, words: words.length, wordsPerSentence: Math.round(wordsPerSentence * 10) / 10, fleschPt: Math.round(fleschPt) }
}
