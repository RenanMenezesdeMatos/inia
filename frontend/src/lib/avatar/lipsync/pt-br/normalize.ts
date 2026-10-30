import type { PauseStrength } from "../types"
import {
  ABBREVIATIONS,
  ABBREVIATIONS_WITH_PAUSE,
  ACRONYMS_AS_WORDS,
  COMMON_UPPERCASE_WORDS,
  FEMININE_NOUNS,
  LETTER_NAMES,
  MASCULINE_A_NOUNS,
  PHONE_LEXICON,
  UNIT_WORDS,
} from "./lexicon"
import { CURRENCIES, cardinalWords, currencyWords, dateWords, isScaleWord, numberWords, ordinalWords, parseNumber, timeWords } from "./numbers"

/**
 * Texto (transcript do Gemini Live, resposta do chat) → palavras FALADAS, token a token.
 *
 * Cada token é um trecho entre espaços do texto original; a normalização o transforma no que a voz
 * diz ("8h30" → "oito e trinta", "R$ 10,50" → "dez reais e cinquenta centavos", "TMA" → "tê eme
 * á", "INIA" → "inia") e guarda a pontuação como informação de PAUSA (",;:" curta, ".!?…" longa) e
 * de pergunta. Emoji, URL, e-mail e marcação Markdown não são falados.
 *
 * Incremental por construção: com `final: false`, só devolve tokens COMPLETOS — seguidos de espaço,
 * ou terminados em pontuação inequívoca — e diz até onde consumiu (`consumed`); o resto fica para o
 * próximo fragmento. Números e símbolos de moeda esperam o token seguinte (concordância "duas horas",
 * "R$ 2 mil", "10 %"), e um token sem pausa espera a inicial FALADA do seguinte (`waitsForNextPiece`)
 * — assim cortar o texto em qualquer posição dá o mesmo resultado que o texto inteiro.
 */

export type SpeechToken = {
  /** Texto original (sem a pontuação periférica). Grupos juntam os tokens com espaço ("R$ 10,50"). */
  text: string
  /** Palavras faladas, minúsculas. */
  words: string[]
  /** Pontuação normalizada depois do token ("!", ",", "?", "..."), para `normalizeForSpeech`. */
  punctuation: string
  pauseAfter: PauseStrength
  questionEnd: boolean
  /**
   * Letra inicial da palavra seguinte quando não há pausa entre as duas (sândi do -s final: "os
   * amigos" [uz]). null = pausa, fim ou ainda desconhecida.
   */
  nextInitial: string | null
  /** Posição no texto de entrada [start, end), incluindo a pontuação. */
  start: number
  end: number
}

export type TokenizeOptions = {
  /** O texto acabou (fim do turno): tudo o que sobrou é completo. Padrão: true. */
  final?: boolean
  /** O texto começa no início de uma linha (marcadores de lista Markdown). Padrão: true. */
  atLineStart?: boolean
}

export type TokenizeResult = {
  tokens: SpeechToken[]
  /** Quantos caracteres da entrada foram consumidos; o restante é um token ainda incompleto. */
  consumed: number
}

// ---------------------------------------------------------------------------
// Caracteres
// ---------------------------------------------------------------------------

const WHITESPACE = /\s/
const LEADING_PUNCT = new Set(['"', "'", "“", "”", "‘", "’", "«", "»", "(", "[", "{", "<", ">", "¿", "¡", "!", "*", "_", "~", "`", "|", "#", "•", "·", "–", "—", "…"])
const TRAILING_PUNCT = new Set([".", ",", ";", ":", "!", "?", "…", '"', "'", "“", "”", "‘", "’", "»", ")", "]", "}", ">", "*", "_", "~", "`", "|", "–", "—", "-"])
const PAUSE_ONLY = /^[\s\-–—…./|:;,!?]+$/

/** Emoji e seus modificadores (tom de pele, variação, ZWJ, keycap). Construtor: alvo ES2017 no tsc. */
const EMOJI = new RegExp("[\\p{Extended_Pictographic}\\u{1F3FB}-\\u{1F3FF}\\u{FE0F}\\u{200D}\\u{20E3}]", "gu")
const NON_LETTER = new RegExp("[^\\p{L}\\p{M}]", "gu")
const ONLY_LETTERS = new RegExp("^[\\p{L}\\p{M}]+$", "u")
const ALNUM_RUNS = new RegExp("\\d+|[\\p{L}\\p{M}]+", "gu")
const HAS_DIGIT_AND_LETTER = new RegExp("^(?=.*\\d)(?=.*\\p{L})[\\p{L}\\p{M}\\d]+$", "u")

const URL = /^(?:https?:\/\/|www\.)/i
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|br|org|net|io|ai|gov|edu|app|dev)(?:\.br)?(?:\/\S*)?$/i
const LIST_MARKER = /^(?:[-*•+]|\d{1,2}[.)]|#{1,6}|>)$/
const CURRENCY_SYMBOL = /^(R\$|US\$|\$|€|£)$/
const CURRENCY_WITH_NUMBER = /^(R\$|US\$|\$|€|£)(.+)$/
const ORDINAL = /^(\d{1,3})\.?([ºª°])$/
const PERCENT = /^([+\-−]?[\d.,]*\d)%$/
const TIMES = /^(\d+)[xX]$/
const NUMBER_WITH_UNIT = /^([\d.,]*\d)([a-zA-Z]{1,3})$/
const MARKDOWN_LINK_TAIL = /\]\(.*$/
const INNER_SEPARATOR = /[-/–—;!?+&=]/
const INNER_SEPARATOR_SPLIT = /([-/–—;!?+&=])/
const INNER_NUMERIC_SEPARATOR = /[,:]/
const INNER_NUMERIC_SEPARATOR_SPLIT = /[,:]/
/** Separadores que não se falam; "+", "&" e "=" viram "mais", "e", "igual a". */
const SILENT_SEPARATOR = /^[-/–—;!?]$/

const VOWEL_LETTERS = /[aeiouáàâãéêíóôõú]/

type Piece = {
  raw: string
  start: number
  end: number
  core: string
  trailing: string
  followedByWhitespace: boolean
  lineStart: boolean
  /** Quebras de linha no espaço depois da peça (0, 1 ou 2+): fim de item de lista/título = pausa. */
  breakAfter: 0 | 1 | 2
}

function scanPieces(text: string, atLineStart: boolean): Piece[] {
  const pieces: Piece[] = []
  let index = 0
  let lineStart = atLineStart
  while (index < text.length) {
    const char = text[index]!
    if (WHITESPACE.test(char)) {
      if (char === "\n") lineStart = true
      index += 1
      continue
    }
    const start = index
    while (index < text.length && !WHITESPACE.test(text[index]!)) index += 1
    const raw = text.slice(start, index)
    let after = index
    let newlines = 0
    while (after < text.length && WHITESPACE.test(text[after]!)) {
      if (text[after] === "\n") newlines += 1
      after += 1
    }
    const breakAfter = newlines >= 2 ? 2 : newlines === 1 ? 1 : 0
    pieces.push({ ...splitPunctuation(raw), raw, start, end: index, followedByWhitespace: index < text.length, lineStart, breakAfter })
    lineStart = false
  }
  return pieces
}

function splitPunctuation(raw: string): { core: string; trailing: string } {
  let start = 0
  let end = raw.length
  // Primeiro a pontuação final: um "—" ou "..." solto vira pausa, não some como pontuação inicial.
  while (end > start && TRAILING_PUNCT.has(raw[end - 1]!)) end -= 1
  while (start < end) {
    const char = raw[start]!
    const next = raw[start + 1]
    const signedNumber = (char === "-" || char === "+" || char === "−") && next !== undefined && next >= "0" && next <= "9"
    if (signedNumber || !(LEADING_PUNCT.has(char) || char === "-" || char === "+")) break
    start += 1
  }
  let core = raw.slice(start, end)
  let trailing = raw.slice(end)
  // "Sr." / "etc.": o ponto é da abreviação, não fim de frase.
  if (trailing.startsWith(".") && ABBREVIATIONS.has(`${core}.`.toLowerCase())) {
    core = `${core}.`
    trailing = trailing.slice(1)
  }
  // "[texto](https://…)" → "texto".
  if (core.includes("](")) core = core.replace(MARKDOWN_LINK_TAIL, "")
  return { core, trailing }
}

function pauseOf(punctuation: string): PauseStrength {
  if (/[.!?…]/.test(punctuation)) return "long"
  if (/[,;:–—-]/.test(punctuation)) return "short"
  return "none"
}

/** Só a pontuação que importa para a fala, na ordem ("?!", ",", "..."). */
function speechPunctuation(trailing: string): string {
  return trailing.replace(/[^.,;:!?…]/g, "").replace(/…/g, "...")
}

/** Último token do texto ainda pode continuar no próximo fragmento? ("10," + "50", "e-" + "mail"). */
function endsUnambiguously(piece: Piece): boolean {
  // Sem pontuação final: palavra que pode continuar, ou só pontuação de abertura ("(", "“").
  if (piece.trailing.length === 0) return false
  if (/[!?;…)"”»]/.test(piece.trailing)) return true
  if (/[.,:]/.test(piece.trailing)) return !/\d$/.test(piece.core)
  return false
}

// ---------------------------------------------------------------------------
// Palavras
// ---------------------------------------------------------------------------

function isAllCaps(core: string): boolean {
  return core.length > 0 && core === core.toUpperCase() && core !== core.toLowerCase() && ONLY_LETTERS.test(core)
}

function hasDiacritic(word: string): boolean {
  return word.normalize("NFD") !== word
}

function spellLetters(letters: string): string[] {
  const words: string[] = []
  for (const char of letters.toLowerCase()) {
    const name = LETTER_NAMES[char]
    if (name) words.push(...name.split(" "))
    else if (VOWEL_LETTERS.test(char)) words.push(char)
  }
  return words
}

function isFeminineNoun(word: string | undefined): boolean {
  if (!word) return false
  const lower = word.toLowerCase()
  if (FEMININE_NOUNS.has(lower)) return true
  if (MASCULINE_A_NOUNS.has(lower) || !ONLY_LETTERS.test(lower)) return false
  return /(?:ção|ções|são|sões|dade|dades|agem|agens|as?)$/.test(lower)
}

type WordContext = {
  /** Núcleo do token seguinte (concordância de gênero). */
  nextCore: string | undefined
  /** Núcleo do token depois do seguinte ("2 mil vendas": o gênero vem de "vendas"). */
  afterNextCore: string | undefined
  /** Última palavra falada antes ("às" 2 → "duas"). */
  previousWord: string | undefined
}

function numberIsFeminine(context: WordContext): boolean {
  const previous = context.previousWord
  if (previous === "às" || previous === "à" || previous === "as" || previous === "das" || previous === "pelas") return true
  if (context.nextCore?.toLowerCase() === "mil") return isFeminineNoun(context.afterNextCore)
  return isFeminineNoun(context.nextCore)
}

/** Núcleo de um token (sem pontuação periférica) → palavras faladas. */
function coreToWords(core: string, context: WordContext): string[] {
  if (core.length === 0) return []
  const lower = core.toLowerCase()
  const abbreviation = ABBREVIATIONS.get(lower)
  if (abbreviation) return abbreviation.split(" ")

  const time = timeWords(core)
  if (time) return time
  const date = dateWords(core)
  if (date) return date
  let match = ORDINAL.exec(core)
  if (match) return ordinalWords(Number(match[1]), match[2] === "ª")
  match = PERCENT.exec(core)
  if (match) {
    const parsed = parseNumber(match[1]!)
    if (parsed) return [...numberWords(parsed), "por", "cento"]
  }
  match = TIMES.exec(core)
  if (match) {
    const count = Number(match[1])
    return [...cardinalWords(count, true), count === 1 ? "vez" : "vezes"]
  }
  const parsed = parseNumber(core)
  if (parsed) return numberWords(parsed, numberIsFeminine(context))
  match = NUMBER_WITH_UNIT.exec(core)
  if (match) {
    // "4G"/"5G" não são gramas: unidade de uma letra só vale minúscula.
    const unitText = match[2]!
    const unit = unitText.length === 1 && unitText !== unitText.toLowerCase() ? undefined : UNIT_WORDS.get(unitText.toLowerCase())
    const value = parseNumber(match[1]!)
    if (unit && value) {
      const singular = !value.digitString && value.integer === 1 && value.fraction === null
      return [...numberWords(value, unit.feminine === true), singular ? unit.singular : unit.plural]
    }
  }

  const currencyAlone = CURRENCY_SYMBOL.exec(core)
  if (currencyAlone) return [CURRENCIES[currencyAlone[1]!]!.plural]

  const withoutEmoji = core.replace(EMOJI, "")
  if (withoutEmoji.length === 0) return []
  if (URL.test(withoutEmoji) || EMAIL.test(withoutEmoji) || DOMAIN.test(withoutEmoji)) return []

  if (PHONE_LEXICON.has(withoutEmoji.toLowerCase())) return [withoutEmoji.toLowerCase()]
  // Separadores DENTRO do token ("e/ou", "a+b", "9,5/10", "Olá,Mundo"): cada parte é falada. Vírgula
  // e dois-pontos só separam depois dos outros, porque dentro de uma parte podem ser de número/hora.
  const separator = INNER_SEPARATOR.test(withoutEmoji) ? INNER_SEPARATOR_SPLIT : INNER_NUMERIC_SEPARATOR.test(withoutEmoji) ? INNER_NUMERIC_SEPARATOR_SPLIT : null
  if (separator && withoutEmoji.length > 1) {
    return withoutEmoji
      .split(separator)
      .filter((part) => part.length > 0 && !SILENT_SEPARATOR.test(part))
      .flatMap((part) => coreToWords(part, context))
  }
  switch (withoutEmoji) {
    case "&":
      return ["e"]
    case "+":
      return ["mais"]
    case "=":
      return ["igual", "a"]
    case "%":
      return ["por", "cento"]
    default:
      break
  }
  if (HAS_DIGIT_AND_LETTER.test(withoutEmoji)) return alphanumericWords(withoutEmoji)
  return letterWords(withoutEmoji)
}

/** "B2B" → "bê dois bê", "4G" → "quatro gê", "Covid19" → "covid dezenove". */
function alphanumericWords(core: string): string[] {
  const words: string[] = []
  for (const run of core.match(ALNUM_RUNS) ?? []) {
    if (/^\d/.test(run)) words.push(...cardinalWords(Number(run)))
    else if (run.length === 1 || isAllCaps(run)) words.push(...spellLetters(run))
    else words.push(...letterWords(run))
  }
  return words
}

/** Palavra de letras: sigla (lida ou soletrada), letra isolada ou palavra comum. */
function letterWords(core: string): string[] {
  const cleaned = core.replace(/['’`´]/g, "")
  const lower = cleaned.toLowerCase().replace(NON_LETTER, "")
  if (lower.length === 0) return []
  const asWord = ACRONYMS_AS_WORDS.get(cleaned)
  if (asWord) return asWord.split(" ")
  if (cleaned.length === 1) {
    // "A INIA" (artigo), "É", "O": palavras; consoante sozinha é nome de letra ("plano B").
    if (/^[aeoàáéê]$/.test(lower)) return [lower]
    return spellLetters(lower)
  }
  const plural = /^([A-Z]{2,5})s$/.exec(cleaned)
  if (plural && !ACRONYMS_AS_WORDS.has(plural[1]!)) {
    const spelled = spellLetters(plural[1]!)
    spelled[spelled.length - 1] += "s"
    return spelled
  }
  if (isAllCaps(cleaned)) {
    if (COMMON_UPPERCASE_WORDS.has(lower) || hasDiacritic(lower)) return [lower]
    if (cleaned.length <= 4 || !VOWEL_LETTERS.test(lower)) return spellLetters(lower)
  }
  return [lower]
}

// ---------------------------------------------------------------------------
// Agrupamento e tokenização
// ---------------------------------------------------------------------------

type Group = {
  /** Quantas peças o grupo consome. */
  count: number
  text: string
  words: string[]
}

function currencyGroup(pieces: readonly Piece[], index: number): Group | null {
  const piece = pieces[index]!
  let symbol: string
  let numberText: string
  let count: number
  let textParts: string[]
  const alone = CURRENCY_SYMBOL.exec(piece.core)
  if (alone && piece.trailing === "") {
    const next = pieces[index + 1]
    if (!next) return null
    symbol = alone[1]!
    numberText = next.core
    count = 2
    textParts = [piece.core, next.core]
  } else {
    const combined = CURRENCY_WITH_NUMBER.exec(piece.core)
    if (!combined) return null
    symbol = combined[1]!
    numberText = combined[2]!
    count = 1
    textParts = [piece.core]
  }
  const parsed = parseNumber(numberText)
  const currency = CURRENCIES[symbol]
  if (!parsed || !currency) return null
  const last = pieces[index + count - 1]!
  const scalePiece = last.trailing === "" ? pieces[index + count] : undefined
  const scale = scalePiece && isScaleWord(scalePiece.core) ? scalePiece.core : null
  if (scale && scalePiece) {
    count += 1
    textParts.push(scalePiece.core)
  }
  return { count, text: textParts.join(" "), words: currencyWords(currency, parsed, scale) }
}

const NEUTRAL_CONTEXT: WordContext = { nextCore: undefined, afterNextCore: undefined, previousWord: undefined }
const LOWERCASE_LETTER = /^[a-zà-öø-ÿ]$/

/**
 * Letra inicial da palavra FALADA que começa na peça `index` (sândi do -s final). O gênero não muda
 * a inicial ("um/uma", "dois/duas"), então o contexto neutro basta; dinheiro usa o grupo inteiro
 * ("R$ 10" começa com "dez").
 */
function spokenInitialAt(pieces: readonly Piece[], index: number): string | null {
  const piece = pieces[index]
  if (!piece || piece.core.length === 0) return null
  const first = piece.core[0]!
  // Caminho rápido: palavra comum em minúsculas começa com a própria letra.
  if (LOWERCASE_LETTER.test(first) && ONLY_LETTERS.test(piece.core) && !ABBREVIATIONS.has(piece.core)) return first
  const group = currencyGroup(pieces, index)
  const words = group ? group.words : coreToWords(piece.core, NEUTRAL_CONTEXT)
  return words[0]?.[0] ?? null
}

/** Peças seguintes que precisam estar completas antes de decidir esta (0 = decide sozinha). */
function lookaheadNeeded(pieces: readonly Piece[], index: number): number {
  const piece = pieces[index]!
  if (piece.trailing !== "") return 0
  if (CURRENCY_SYMBOL.test(piece.core)) {
    const next = pieces[index + 1]
    return next && next.trailing !== "" ? 1 : 2
  }
  if (CURRENCY_WITH_NUMBER.test(piece.core)) return 1
  if (parseNumber(piece.core)) {
    // "2 mil" ainda não diz o gênero: espera o substantivo depois de "mil".
    const next = pieces[index + 1]
    return next && next.trailing === "" && next.core.toLowerCase() === "mil" ? 2 : 1
  }
  return 0
}

const SANDHI_FINAL = /[szx]$/
/** Início de peça cuja inicial FALADA só se sabe com a peça inteira (número, sigla, moeda, sinal). */
const UNCERTAIN_INITIAL = /^[\dA-ZÀ-ÖØ-Þ$€£+\-−]/

/**
 * Palavra sem pausa depois ainda depende do que vem a seguir? Só no modo incremental:
 * - nada depois ainda (o fragmento terminou em espaço): pode chegar pontuação solta (" —") que dá a
 *   pausa desta palavra, e a inicial da próxima decide o sândi do -s;
 * - a próxima peça só tem pontuação por enquanto ("(" ou "—" ainda sem espaço depois);
 * - -s final e a próxima começa com dígito/maiúscula ainda incompleta: "1" pode virar "um" ou
 *   "treze", "S" pode virar "ésse" (SMS) — a inicial FALADA ainda não é conhecida.
 * Com o `outputTranscription` do Gemini (" palavra" por fragmento) isso quase nunca atrasa nada: o
 * espaço e a palavra seguinte chegam juntos.
 */
function waitsForNextPiece(pieces: readonly Piece[], nextIndex: number, completeCount: number, words: readonly string[]): boolean {
  const next = pieces[nextIndex]
  if (!next) return true
  if (next.core.length === 0 || PAUSE_ONLY.test(next.core)) return nextIndex >= completeCount
  if (!SANDHI_FINAL.test(words[words.length - 1] ?? "") || !UNCERTAIN_INITIAL.test(next.core)) return false
  if (nextIndex >= completeCount) return true
  // "R$" sozinho: a inicial é a do número que vem depois ("R$ 10" = "dez reais").
  return CURRENCY_SYMBOL.test(next.core) && nextIndex + lookaheadNeeded(pieces, nextIndex) >= completeCount
}

export function tokenizeForSpeech(text: string, options: TokenizeOptions = {}): TokenizeResult {
  const final = options.final ?? true
  const pieces = scanPieces(text, options.atLineStart ?? true)
  let completeCount = pieces.length
  if (!final && pieces.length > 0) {
    const last = pieces[pieces.length - 1]!
    if (!last.followedByWhitespace && !endsUnambiguously(last)) completeCount -= 1
  }

  type Pending = SpeechToken & { nextPiece: number }
  const tokens: Pending[] = []
  let index = 0
  while (index < completeCount) {
    const piece = pieces[index]!
    if (!final && index + lookaheadNeeded(pieces, index) >= completeCount) break

    if (piece.lineStart && LIST_MARKER.test(piece.raw)) {
      index += 1
      continue
    }

    const previousToken = tokens[tokens.length - 1]
    const context: WordContext = {
      nextCore: pieces[index + 1]?.core,
      afterNextCore: pieces[index + 2]?.core,
      previousWord: previousToken?.words[previousToken.words.length - 1],
    }
    let group = currencyGroup(pieces, index)
    if (!group && piece.trailing === "" && pieces[index + 1]?.core === "%" && parseNumber(piece.core)) {
      const parsed = parseNumber(piece.core)
      if (parsed) group = { count: 2, text: `${piece.core} %`, words: [...numberWords(parsed), "por", "cento"] }
    }
    if (!group) {
      const onlyPunctuation = piece.core.length === 0 || PAUSE_ONLY.test(piece.core)
      group = { count: 1, text: piece.core, words: onlyPunctuation ? [] : coreToWords(piece.core, context) }
    }

    const lastPiece = pieces[index + group.count - 1]!
    const trailing = lastPiece.trailing + (group.words.length === 0 && PAUSE_ONLY.test(piece.core) ? piece.core : "")
    let pauseAfter = pauseOf(trailing)
    const abbreviation = ABBREVIATIONS_WITH_PAUSE.has(lastPiece.core.toLowerCase())
    if (abbreviation && pauseAfter === "none") pauseAfter = "short"
    // Quebra de linha sem pontuação (item de lista, título Markdown): a voz respira ali também.
    if (pauseAfter === "none" && lastPiece.breakAfter > 0) pauseAfter = lastPiece.breakAfter === 2 ? "long" : "short"
    const questionEnd = trailing.includes("?")
    const punctuation = speechPunctuation(trailing) || (pauseAfter === "short" ? "," : pauseAfter === "long" ? "." : "")

    if (group.words.length === 0) {
      // Pontuação solta, emoji, URL: a pausa passa para a palavra anterior deste lote.
      if (previousToken && pauseAfter !== "none") {
        if (pauseAfter === "long" || previousToken.pauseAfter === "none") {
          previousToken.pauseAfter = pauseAfter
          previousToken.punctuation = punctuation
        }
        previousToken.questionEnd = previousToken.questionEnd || questionEnd
      }
    } else {
      if (!final && pauseAfter === "none" && waitsForNextPiece(pieces, index + group.count, completeCount, group.words)) break
      tokens.push({
        text: group.text,
        words: group.words,
        punctuation,
        pauseAfter,
        questionEnd,
        nextInitial: null,
        start: piece.start,
        end: lastPiece.end,
        nextPiece: index + group.count,
      })
    }
    index += group.count
  }

  const result: SpeechToken[] = tokens.map(({ nextPiece, ...token }) => ({
    ...token,
    nextInitial: token.pauseAfter === "none" ? spokenInitialAt(pieces, nextPiece) : null,
  }))
  const consumed = index < pieces.length ? pieces[index]!.start : text.length
  return { tokens: result, consumed }
}

/**
 * Texto → forma falada, com a pontuação de pausa preservada ("Olá! às 8h30" → "olá! às oito e
 * trinta"). Minúsculas; emoji, URLs e Markdown somem.
 */
export function normalizeForSpeech(text: string): string {
  return tokenizeForSpeech(text, { final: true })
    .tokens.map((token) => token.words.join(" ") + token.punctuation)
    .join(" ")
}
