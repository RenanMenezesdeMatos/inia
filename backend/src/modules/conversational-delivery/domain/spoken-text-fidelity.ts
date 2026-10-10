/**
 * FIDELIDADE DA FALA DO RECADO (`SPOKEN_TEXT_FIDELITY_V1`). O recado é falado pelo modelo de áudio nativo da conversa (mesma
 * voz e jeito da INIA), que é CONVERSACIONAL — pode trocar, pular ou acrescentar palavras. Antes de o áudio ser guardado, a
 * transcrição do próprio áudio é comparada, palavra a palavra, com o texto exato da entrega. Sem LLM, sem similaridade
 * semântica: alinhamento por edição sobre palavras normalizadas.
 *
 * Tolerância só para o que a transcrição automática erra sozinha (uma palavra aqui e ali). Não passa: qualquer número trocado,
 * acrescentado ou omitido; trecho acrescentado (> 2 palavras seguidas); trecho omitido (> 3 palavras seguidas); mais de 10%
 * de palavras diferentes. Reprovou = o áudio não é usado (quem chama cai na leitura do TTS, que não reescreve).
 */
export const SPOKEN_TEXT_FIDELITY_VERSION = "SPOKEN_TEXT_FIDELITY_V1"
export const MAX_ERROR_RATE = 0.1
export const MAX_INSERTED_RUN = 2
export const MAX_DELETED_RUN = 3

export type SpokenTextFidelity = {
  version: typeof SPOKEN_TEXT_FIDELITY_VERSION
  ok: boolean
  expectedWords: number
  spokenWords: number
  edits: number
  errorRate: number
  longestInsertedRun: number
  longestDeletedRun: number
  numberMismatch: boolean
  reasons: string[]
}

const UNITS = ["zero", "um", "dois", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"]
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"]
const HUNDREDS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"]
const NUMBER_WORDS = new Set([...UNITS, ...TENS.filter(Boolean), ...HUNDREDS.filter(Boolean), "cem", "mil", "milhao", "milhoes", "uma", "duas", "catorze", "duzentas", "trezentas", "quatrocentas", "quinhentas", "seiscentas", "setecentas", "oitocentas", "novecentas"])

function belowThousand(value: number): string[] {
  if (value < 20) return [UNITS[value]!]
  if (value < 100) return value % 10 === 0 ? [TENS[value / 10]!] : [TENS[Math.floor(value / 10)]!, "e", UNITS[value % 10]!]
  if (value === 100) return ["cem"]
  const rest = value % 100
  return rest === 0 ? [HUNDREDS[Math.floor(value / 100)]!] : [HUNDREDS[Math.floor(value / 100)]!, "e", ...belowThousand(rest)]
}

/** Inteiro por extenso (pt-BR, sem acento) — 0 a 999.999.999. Número maior fica como dígitos (comparação literal). */
export function spellNumber(value: number): string[] {
  if (!Number.isInteger(value) || value < 0 || value > 999_999_999) return [String(value)]
  if (value < 1000) return belowThousand(value)
  const millions = Math.floor(value / 1_000_000)
  const thousands = Math.floor((value % 1_000_000) / 1000)
  const rest = value % 1000
  const parts: string[][] = []
  if (millions) parts.push([...(millions === 1 ? ["um"] : belowThousand(millions)), millions === 1 ? "milhao" : "milhoes"])
  if (thousands) parts.push(thousands === 1 ? ["mil"] : [...belowThousand(thousands), "mil"])
  if (rest) parts.push(belowThousand(rest))
  return parts.flatMap((part, index) => (index > 0 && index === parts.length - 1 && (rest < 100 || rest % 100 === 0) ? ["e", ...part] : part))
}

/** Palavras comparáveis: minúsculas, sem acento, sem pontuação; números por extenso; "e" de ligação some (a fala varia). */
export function comparableWords(text: string): string[] {
  const normalized = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/%/g, " por cento ")
    .replace(/r\$\s*/g, " ")
    .replace(/(\d)[.](?=\d{3}\b)/g, "$1")
  const words: string[] = []
  for (const token of normalized.split(/[^a-z0-9]+/).filter(Boolean)) {
    if (/^\d+$/.test(token)) words.push(...(token.length > 9 || (token.length > 1 && token.startsWith("0")) ? [...token].flatMap((digit) => spellNumber(Number(digit))) : spellNumber(Number(token))))
    else words.push(token)
  }
  // Gênero do numeral não muda o número ("uma"/"um", "duas"/"dois", "duzentas"/"duzentos").
  return words.filter((word) => word !== "e").map((word) => FEMININE_NUMERALS[word] ?? word)
}

const FEMININE_NUMERALS: Record<string, string> = { uma: "um", duas: "dois", duzentas: "duzentos", trezentas: "trezentos", quatrocentas: "quatrocentos", quinhentas: "quinhentos", seiscentas: "seiscentos", setecentas: "setecentos", oitocentas: "oitocentos", novecentas: "novecentos", catorze: "quatorze" }

const isNumberWord = (word: string) => NUMBER_WORDS.has(word) || /^\d+$/.test(word)

type Op = "MATCH" | "SUBSTITUTE" | "INSERT" | "DELETE"

function align(expected: string[], spoken: string[]): { op: Op; expected?: string | undefined; spoken?: string | undefined }[] {
  const rows = expected.length + 1
  const cols = spoken.length + 1
  const cost = new Uint32Array(rows * cols)
  for (let i = 0; i < rows; i++) cost[i * cols] = i
  for (let j = 0; j < cols; j++) cost[j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = expected[i - 1] === spoken[j - 1] ? 0 : 1
      cost[i * cols + j] = Math.min(cost[(i - 1) * cols + j - 1]! + same, cost[(i - 1) * cols + j]! + 1, cost[i * cols + j - 1]! + 1)
    }
  }
  const ops: { op: Op; expected?: string | undefined; spoken?: string | undefined }[] = []
  let i = expected.length
  let j = spoken.length
  while (i > 0 || j > 0) {
    const here = cost[i * cols + j]!
    if (i > 0 && j > 0 && here === cost[(i - 1) * cols + j - 1]! + (expected[i - 1] === spoken[j - 1] ? 0 : 1)) {
      ops.push({ op: expected[i - 1] === spoken[j - 1] ? "MATCH" : "SUBSTITUTE", expected: expected[i - 1], spoken: spoken[j - 1] })
      i--
      j--
    } else if (i > 0 && here === cost[(i - 1) * cols + j]! + 1) {
      ops.push({ op: "DELETE", expected: expected[i - 1] })
      i--
    } else {
      ops.push({ op: "INSERT", spoken: spoken[j - 1] })
      j--
    }
  }
  return ops.reverse()
}

function longestRun(ops: { op: Op }[], kind: Op): number {
  let longest = 0
  let current = 0
  for (const entry of ops) {
    current = entry.op === kind ? current + 1 : 0
    longest = Math.max(longest, current)
  }
  return longest
}

export function verifySpokenText(expectedText: string, spokenTranscript: string): SpokenTextFidelity {
  const expected = comparableWords(expectedText)
  const spoken = comparableWords(spokenTranscript)
  const ops = align(expected, spoken)
  const edits = ops.filter((entry) => entry.op !== "MATCH").length
  const errorRate = expected.length === 0 ? (spoken.length === 0 ? 0 : 1) : edits / expected.length
  const longestInsertedRun = longestRun(ops, "INSERT")
  const longestDeletedRun = longestRun(ops, "DELETE")
  const numberMismatch = ops.some((entry) => entry.op !== "MATCH" && ((entry.expected && isNumberWord(entry.expected)) || (entry.spoken && isNumberWord(entry.spoken))))
  const reasons: string[] = []
  if (expected.length === 0 || spoken.length === 0) reasons.push("EMPTY")
  if (errorRate > MAX_ERROR_RATE) reasons.push("ERROR_RATE")
  if (longestInsertedRun > MAX_INSERTED_RUN) reasons.push("INSERTED_PASSAGE")
  if (longestDeletedRun > MAX_DELETED_RUN) reasons.push("OMITTED_PASSAGE")
  if (numberMismatch) reasons.push("NUMBER_MISMATCH")
  return { version: SPOKEN_TEXT_FIDELITY_VERSION, ok: reasons.length === 0, expectedWords: expected.length, spokenWords: spoken.length, edits, errorRate: Math.round(errorRate * 1000) / 1000, longestInsertedRun, longestDeletedRun, numberMismatch, reasons }
}
