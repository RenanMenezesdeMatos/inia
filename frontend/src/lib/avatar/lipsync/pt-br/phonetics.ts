import type { PhoneSymbol } from "../types"
import { PHONES } from "../phones"
import { CLITICS, CLOSED_SUFFIX_EXCEPTIONS, OPEN_STRESSED_WORDS, PHONE_LEXICON } from "./lexicon"
import { stressedSyllableIndex } from "./stress"
import { isFrontVowelChar, isVowelChar, preprocessOrthography, syllabifyOrthography, type GraphemeUnit, type OrthoSyllable } from "./syllabify"

/**
 * Palavra (UMA palavra falada, já normalizada) → sílabas de fones, com as regras do PT-BR que mudam
 * o que a boca faz:
 * - vogal + m/n em coda → vogal NASAL e a consoante some (campo = [ˈkɐ̃pu]: o único fechamento de
 *   lábios é o do p; "bem"/"também" terminam em [ẽj̃], nunca em [m]);
 * - átonas finais: e → [i], o → [u], a → [ɐ] (tarde, juntos, mentora); clíticos idem (de, que, o);
 * - t/d antes de [i] fonético → [tʃ]/[dʒ] (tia, tarde, gente, de, ritmo — o i epentético também);
 * - l em coda → [w] (Brasil, alto, sol); s em coda sonoriza antes de consoante sonora (mesmo);
 * - r forte no início, depois de n/l/s e no rr (rato, honra, carro); tepe no resto (caro, prato);
 * - ditongos: ou → [o] sempre, ei → [e] antes de r/ʃ/ʒ (primeiro, beijo, peixe).
 * O "s" final da palavra depende da palavra seguinte (sândi: "os amigos" [uzɐˈmigus]) — por isso o
 * contexto `nextInitial`.
 */

export type SyllableRole = "stressed" | "pretonic" | "posttonic" | "final" | "clitic" | "epenthetic"

export type PhoneSyllable = {
  phones: PhoneSymbol[]
  /** Fones que a fala pode omitir (vogal epentética do léxico, `(i)`), na mesma ordem de `phones`. */
  optional?: boolean[]
  /** Índice do núcleo em `phones` (-1 se não houver). */
  nucleus: number
  role: SyllableRole
}

export type WordPhonemizeContext = {
  /**
   * Primeira letra da próxima palavra falada quando NÃO há pausa entre elas (sândi do -s final);
   * null = pausa, fim do texto ou desconhecida.
   */
  nextInitial: string | null
}

const NO_CONTEXT: WordPhonemizeContext = { nextInitial: null }

// ---------------------------------------------------------------------------
// Léxico de fones
// ---------------------------------------------------------------------------

const lexiconCache = new Map<string, PhoneSyllable[]>()

function isPhoneSymbol(value: string): value is PhoneSymbol {
  return Object.prototype.hasOwnProperty.call(PHONES, value)
}

/** "'f i . dZ (i) . b E . k i" → sílabas. Sem "'" = palavra átona; "(i)" = vogal epentética opcional. */
export function parseLexiconEntry(entry: string): PhoneSyllable[] {
  const raw = entry.split(".").map((chunk) => chunk.trim())
  const stressedIndex = raw.findIndex((chunk) => chunk.startsWith("'"))
  return raw.map((chunk, index) => {
    const symbols = chunk
      .replace(/^'/, "")
      .split(/\s+/)
      .filter((symbol) => symbol.length > 0)
    const optional = symbols.map((symbol) => /^\(.+\)$/.test(symbol))
    const phones = symbols.map((raw) => {
      const symbol = raw.replace(/^\((.+)\)$/, "$1")
      if (!isPhoneSymbol(symbol)) throw new Error(`Fone desconhecido no léxico: "${symbol}" em "${entry}"`)
      return symbol
    })
    const nucleus = phones.findIndex((symbol) => PHONES[symbol].class === "vowel")
    let role: SyllableRole
    if (stressedIndex < 0) role = "clitic"
    else if (index === stressedIndex) role = "stressed"
    else if (index < stressedIndex) role = "pretonic"
    else role = index === raw.length - 1 ? "final" : "posttonic"
    return optional.some(Boolean) ? { phones, nucleus, role, optional } : { phones, nucleus, role }
  })
}

function lexiconSyllables(word: string): PhoneSyllable[] | null {
  const cached = lexiconCache.get(word)
  if (cached) return cached
  const entry = PHONE_LEXICON.get(word)
  if (entry === undefined) return null
  const parsed = parseLexiconEntry(entry)
  lexiconCache.set(word, parsed)
  return parsed
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

const ACUTE = new Set(["á", "é", "í", "ó", "ú"])
const OPEN_SUFFIX = /(?:elas?|olas?|osas?|osos|oias?|(?:j|r|pl|cr)et[oa]s?)$/

/** Consoantes/vogais que sonorizam o s de coda ([z]): mesmo, desde, os amigos, Israel. */
const VOICING_TRIGGERS: ReadonlySet<PhoneSymbol> = new Set<PhoneSymbol>([
  "b", "d", "g", "v", "z", "Z", "dZ", "m", "n", "J", "l", "L", "r", "R", "j", "w", "j~", "w~",
])

function voicesSibilant(phone: PhoneSymbol | undefined): boolean {
  if (phone === undefined) return false
  return PHONES[phone].class === "vowel" || VOICING_TRIGGERS.has(phone)
}

/** Letra inicial da palavra seguinte sonoriza o -s final? (vogal, h mudo, consoante sonora). */
function initialVoicesSibilant(initial: string | null): boolean {
  if (initial === null) return false
  const char = initial.toLowerCase()
  if (isVowelChar(char) || char === "h" || char === "y") return true
  return char === "b" || char === "d" || char === "g" || char === "v" || char === "z" || char === "j" || char === "m" || char === "n" || char === "l" || char === "r" || char === "w"
}

function isOpenStressed(word: string): boolean {
  if (OPEN_STRESSED_WORDS.has(word)) return true
  return OPEN_SUFFIX.test(word) && !CLOSED_SUFFIX_EXCEPTIONS.has(word)
}

function baseVowelLetter(vowel: string): string {
  switch (vowel) {
    case "á":
    case "à":
    case "â":
    case "ã":
      return "a"
    case "é":
    case "ê":
      return "e"
    case "í":
      return "i"
    case "ó":
    case "ô":
    case "õ":
      return "o"
    case "ú":
    case "ü":
      return "u"
    default:
      return vowel
  }
}

function nasalOf(vowel: PhoneSymbol): PhoneSymbol {
  switch (vowel) {
    case "a":
    case "6":
      return "6~"
    case "e":
    case "E":
      return "e~"
    case "i":
      return "i~"
    case "o":
    case "O":
      return "o~"
    case "u":
      return "u~"
    default:
      return vowel
  }
}

type SyllableContext = {
  syllable: OrthoSyllable
  index: number
  role: SyllableRole
  isLastReal: boolean
  isLast: boolean
  next: OrthoSyllable | undefined
  firstRealIndex: number
  open: boolean
}

function codaHasNasal(syllable: OrthoSyllable): boolean {
  return syllable.coda.some((unit) => unit.g === "m" || unit.g === "n")
}

/** Núcleo (vogal + semivogal) da sílaba. */
function nucleusPhones(context: SyllableContext): PhoneSymbol[] {
  const { syllable, role, next } = context
  if (syllable.epenthetic) return ["i"]
  const letter = syllable.vowel
  const base = baseVowelLetter(letter)
  const nextOnset = next?.onset[0]?.g
  const codaNasal = codaHasNasal(syllable)
  const tilde = letter === "ã" || letter === "õ"
  const nasal =
    tilde ||
    codaNasal ||
    nextOnset === "nh" ||
    (role === "stressed" && syllable.glide === null && syllable.coda.length === 0 && !ACUTE.has(letter) && (nextOnset === "m" || nextOnset === "n"))

  let vowel: PhoneSymbol
  const reduced = (role === "final" || (role === "clitic" && context.isLastReal)) && syllable.glide === null
  if (letter === "à") vowel = "a"
  else if (letter === "á") vowel = "a"
  else if (letter === "â") vowel = "6"
  else if (letter === "é") vowel = "E"
  else if (letter === "ê") vowel = "e"
  else if (letter === "ó") vowel = "O"
  else if (letter === "ô") vowel = "o"
  else if (base === "a") vowel = role === "stressed" || role === "pretonic" || (role === "clitic" && !context.isLastReal) ? "a" : "6"
  else if (base === "e") {
    if (role === "stressed") vowel = context.open ? "E" : "e"
    else if (reduced && !nasal) vowel = "i"
    // Pretônica inicial es-/des- (estou, explicar, desculpa) → [i] no PT-BR corrente.
    else if (
      role === "pretonic" &&
      context.index === context.firstRealIndex &&
      syllable.glide === null &&
      syllable.coda[0]?.g === "s" &&
      (syllable.onset.length === 0 || (syllable.onset.length === 1 && syllable.onset[0].g === "d"))
    ) {
      vowel = "i"
    } else vowel = "e"
  } else if (base === "o") {
    if (role === "stressed") vowel = context.open ? "O" : "o"
    else if (reduced && !nasal) vowel = "u"
    else vowel = "o"
  } else if (base === "i") vowel = "i"
  else vowel = "u"

  // "-am"/"-em" finais têm semivogal nasal: falam [ɐ̃w̃], bem/também [ẽj̃], nuvens [ẽj̃s].
  if (nasal) {
    const nasalVowel = nasalOf(vowel)
    if (codaNasal && context.isLast && syllable.glide === null) {
      if (base === "a") return ["6~", "w~"]
      if (base === "e") return ["e~", "j~"]
    }
    if (syllable.glide !== null) return [nasalVowel, glidePhone(syllable.glide, true)]
    return [nasalVowel]
  }

  if (syllable.glide !== null) {
    // ou → [o] sempre (pouco, ouvir, sou); ei → [e] antes de r/ʃ/ʒ (primeiro, beijo, peixe).
    if (base === "o" && syllable.glide === "u") return [vowel]
    if (base === "e" && syllable.glide === "i" && next && next.onset.length > 0) {
      const onset = next.onset[0]
      if (onset.g === "r" || onset.g === "ch" || onset.g === "j" || (onset.g === "g" && isFrontVowelChar(next.vowel))) return [vowel]
    }
    return [vowel, glidePhone(syllable.glide, false)]
  }
  return [vowel]
}

function glidePhone(glide: string, nasal: boolean): PhoneSymbol {
  if (glide === "i" || glide === "e") return nasal ? "j~" : "j"
  return nasal ? "w~" : "w"
}

function isStrongRContext(previous: OrthoSyllable | undefined): boolean {
  if (!previous) return true
  const last = previous.coda[previous.coda.length - 1]?.g
  return last === "n" || last === "l" || last === "s" || last === "r" || last === "m" || last === "z"
}

/** Ataque da sílaba. `nucleus` = primeiro fone do núcleo (decide t/d palatal). */
function onsetPhones(syllable: OrthoSyllable, index: number, previous: OrthoSyllable | undefined, nucleus: PhoneSymbol): PhoneSymbol[] {
  const phones: PhoneSymbol[] = []
  const orthVowel = syllable.epenthetic ? null : syllable.vowel
  syllable.onset.forEach((unit: GraphemeUnit, position) => {
    const lastInOnset = position === syllable.onset.length - 1
    const followingFront = lastInOnset && isFrontVowelChar(orthVowel)
    const beforeI = lastInOnset && (nucleus === "i" || nucleus === "i~")
    switch (unit.g) {
      case "t":
        phones.push(beforeI ? "tS" : "t")
        break
      case "d":
        phones.push(beforeI ? "dZ" : "d")
        break
      case "c":
        phones.push(followingFront ? "s" : "k")
        break
      case "ç":
        phones.push("s")
        break
      case "g":
        phones.push(followingFront ? "Z" : "g")
        break
      case "gu":
        phones.push("g")
        if (unit.withGlide) phones.push("w")
        break
      case "qu":
        phones.push("k")
        if (unit.withGlide) phones.push("w")
        break
      case "k":
        phones.push("k")
        break
      case "j":
        phones.push("Z")
        break
      case "ch":
        phones.push("S")
        break
      case "lh":
        phones.push("L")
        break
      case "nh":
        phones.push("J")
        break
      case "r":
        phones.push(position === 0 && (index === 0 || isStrongRContext(previous)) ? "R" : "r")
        break
      case "s":
        // Intervocálico = [z] (casa); inicial, depois de coda ou de sílaba epentética = [s].
        phones.push(position === 0 && index > 0 && previous !== undefined && !previous.epenthetic && previous.coda.length === 0 ? "z" : "s")
        break
      case "z":
        phones.push("z")
        break
      case "x":
        phones.push("S")
        break
      case "u":
        phones.push("w")
        break
      case "i":
        phones.push("j")
        break
      case "p":
      case "b":
      case "f":
      case "v":
      case "m":
      case "n":
      case "l":
        phones.push(unit.g as PhoneSymbol)
        break
      default:
        break
    }
  })
  return phones
}

/** A próxima sílaba começa com som de s (ss, sc/sç, ç, c+e/i)? Então a coda s some. */
function nextStartsWithSibilant(next: OrthoSyllable | undefined): boolean {
  const onset = next?.onset[0]
  if (!onset || !next) return false
  if (onset.g === "s" || onset.g === "ç") return true
  return onset.g === "c" && next.onset.length === 1 && isFrontVowelChar(next.epenthetic ? null : next.vowel)
}

function codaPhones(syllable: OrthoSyllable, next: OrthoSyllable | undefined): PhoneSymbol[] {
  const phones: PhoneSymbol[] = []
  for (const unit of syllable.coda) {
    switch (unit.g) {
      case "l":
        phones.push("w")
        break
      case "s":
      case "z":
        if (!nextStartsWithSibilant(next)) phones.push("s")
        break
      case "r":
        if (next?.onset[0]?.g !== "r") phones.push("r")
        break
      default:
        // m/n: só nasalizam a vogal (nunca fecham os lábios).
        break
    }
  }
  return phones
}

/** Pós-tônica "i/u" + vogal final vira ditongo crescente: memória [mɔɾjɐ], benefícios, contínuos. */
function mergePosttonicGlides(syllables: PhoneSyllable[], ortho: readonly OrthoSyllable[], stressIndex: number): void {
  if (stressIndex < 0) return
  const last = syllables.length - 1
  const candidate = last - 1
  if (candidate <= stressIndex) return
  const first = ortho[candidate]
  const second = ortho[last]
  if (first.epenthetic || second.epenthetic || second.onset.length > 0) return
  if (first.coda.length > 0 || first.glide !== null || (first.vowel !== "i" && first.vowel !== "u")) return
  const merged = syllables[candidate]
  const nucleusPhone = merged.phones[merged.nucleus]
  if (nucleusPhone !== "i" && nucleusPhone !== "u") return
  const tail = syllables[last]
  const phones = [...merged.phones.slice(0, merged.nucleus), nucleusPhone === "i" ? ("j" as const) : ("w" as const), ...tail.phones]
  syllables.splice(candidate, 2, { phones, nucleus: merged.nucleus + 1 + tail.nucleus, role: tail.role })
}

/** Uma palavra falada → sílabas de fones. Palavra sem vogal (interjeição "hmm") → []. */
export function phonemizeWord(word: string, context: WordPhonemizeContext = NO_CONTEXT): PhoneSyllable[] {
  const lower = word.normalize("NFC").toLowerCase()
  const lexical = lexiconSyllables(lower)
  const syllables = lexical ? lexical.map((syllable) => ({ ...syllable, phones: [...syllable.phones] })) : ruleSyllables(lower)
  applyFinalSandhi(syllables, context.nextInitial)
  return syllables
}

function ruleSyllables(lower: string): PhoneSyllable[] {
  const orthography = preprocessOrthography(lower)
  const ortho = syllabifyOrthography(orthography, lower)
  if (ortho.length === 0) return []
  const clitic = CLITICS.has(lower)
  const stressIndex = clitic ? -1 : stressedSyllableIndex(orthography, ortho)
  let lastReal = -1
  let firstReal = -1
  ortho.forEach((syllable, index) => {
    if (!syllable.epenthetic) {
      lastReal = index
      if (firstReal < 0) firstReal = index
    }
  })
  const open = !clitic && isOpenStressed(lower)

  const roles: SyllableRole[] = ortho.map((syllable, index) => {
    if (syllable.epenthetic) return "epenthetic"
    if (index === stressIndex) return "stressed"
    if (stressIndex < 0) return "clitic"
    if (index < stressIndex) return "pretonic"
    return index === lastReal ? "final" : "posttonic"
  })

  const result: PhoneSyllable[] = ortho.map((syllable, index) => {
    const next = ortho[index + 1]
    const role = roles[index]
    // -el/-ol tônicos finais são abertos: papel, anel, sol, futebol.
    const openByCoda = role === "stressed" && index === lastReal && syllable.coda.some((unit) => unit.g === "l")
    const nucleus = nucleusPhones({
      syllable,
      index,
      role,
      isLastReal: index === lastReal,
      isLast: index === ortho.length - 1,
      next,
      firstRealIndex: firstReal,
      open: open || openByCoda,
    })
    const onset = onsetPhones(syllable, index, ortho[index - 1], nucleus[0])
    const coda = codaPhones(syllable, next)
    return { phones: [...onset, ...nucleus, ...coda], nucleus: onset.length, role }
  })

  // Sonorização do s de coda dentro da palavra (mesmo [ˈmezmu], desde).
  for (let index = 0; index < result.length - 1; index++) {
    const phones = result[index].phones
    const lastPhone = phones[phones.length - 1]
    if (lastPhone === "s" && voicesSibilant(result[index + 1].phones[0])) phones[phones.length - 1] = "z"
  }
  mergePosttonicGlides(result, ortho, stressIndex)
  return result
}

function applyFinalSandhi(syllables: PhoneSyllable[], nextInitial: string | null): void {
  const last = syllables[syllables.length - 1]
  if (!last) return
  const phones = last.phones
  const index = phones.length - 1
  if ((phones[index] === "s" || phones[index] === "z") && index > last.nucleus) phones[index] = initialVoicesSibilant(nextInitial) ? "z" : "s"
}
