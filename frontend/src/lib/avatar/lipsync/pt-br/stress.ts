import type { OrthoSyllable } from "./syllabify"

/**
 * Tonicidade do PT-BR pela ortografia:
 * 1. acento agudo/circunflexo marca a tônica (você, próximo, benefícios);
 * 2. senão, o til (amanhã, irmão — "órfão" já caiu na regra 1);
 * 3. senão, terminação em a/e/o(+s), am, em, ens → paroxítona (mentora, juntos, falam, homem);
 * 4. senão (i/u(+s), im, um, om, r, l, z, n, ps, ditongo decrescente, outra consoante) → oxítona
 *    (revisar, Brasil, aqui, comprei).
 * Sílabas epentéticas não contam (rit-mo continua paroxítona).
 */

const ACUTE_OR_CIRCUMFLEX = /[áéíóúâêô]/
const TILDE = /[ãõ]/
const PAROXYTONE_ENDING = /(?:[aeo]s?|am|em|ens)$/

/**
 * Índice (em `syllables`, contando epentéticas) da sílaba tônica; -1 sem sílaba. `word` é a forma
 * pré-processada (sem h mudo, x resolvido) — a terminação é lida dela.
 */
export function stressedSyllableIndex(word: string, syllables: readonly OrthoSyllable[]): number {
  const real: number[] = []
  syllables.forEach((syllable, index) => {
    if (!syllable.epenthetic) real.push(index)
  })
  if (real.length === 0) return -1
  for (let k = real.length - 1; k >= 0; k--) {
    const syllable = syllables[real[k]!]!
    if (ACUTE_OR_CIRCUMFLEX.test(syllable.vowel) || (syllable.glide !== null && ACUTE_OR_CIRCUMFLEX.test(syllable.glide))) return real[k]!
  }
  for (let k = real.length - 1; k >= 0; k--) {
    if (TILDE.test(syllables[real[k]!]!.vowel)) return real[k]!
  }
  if (real.length === 1) return real[0]!
  return PAROXYTONE_ENDING.test(word) ? real[real.length - 2]! : real[real.length - 1]!
}
