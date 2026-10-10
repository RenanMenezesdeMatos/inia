import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

import type {
  G2PWord,
  PauseStrength,
  PhoneSymbol,
  PhoneToken,
  ScheduledAudioChunk,
  SpeechLipsyncEngine,
  TranscriptFragment,
  TranscriptPhonemizer,
} from "../types"
import { PHONES } from "../phones"

/**
 * Apoio de TESTE (só Node): lê as capturas reais do Gemini Live (`gemini-live/*.json` + `.wav`) e
 * reconstrói a sequência de chegada de chunks/fragmentos com o MESMO agendamento colado do
 * transporte — primeiro chunk em `startAt` = chegada, os demais em `max(fim do anterior, chegada)`.
 * O relógio do AudioContext da reprodução é o relógio do pedido (ms → s) mais `clockOffset`.
 *
 * Também traz um G2P de letras simplificado, SÓ para testes (o G2P de verdade é `pt-br/g2p.ts`):
 * basta para dar sílabas, núcleos, tonicidade e fones plausíveis aos textos das capturas.
 */

export const FIXTURE_DIR = path.join(__dirname, "gemini-live")

export type FixtureEvent =
  | { t: number; audioBytes: number; mime: string }
  | { t: number; transcript: string }
  | { t: number; turnComplete: true }
  | { t: number; generationComplete: true }

export type Fixture = {
  id: string
  prompt: string
  transcript: string
  sampleRate: number
  events: FixtureEvent[]
  /** Todo o áudio do turno (−1..1), na ordem de chegada. */
  pcm: Float32Array
}

export type ReplayStep =
  | { kind: "audio"; at: number; chunk: ScheduledAudioChunk }
  | { kind: "transcript"; at: number; fragment: TranscriptFragment }
  | { kind: "generationComplete"; at: number }
  | { kind: "turnComplete"; at: number }

export type ReplaySchedule = {
  fixture: Fixture
  steps: ReplayStep[]
  /** Início do primeiro chunk e fim do último (relógio do contexto). */
  audioStart: number
  audioEnd: number
  /** Início/fim da fala de verdade (primeira/última amostra acima do ruído). */
  speechStart: number
  speechEnd: number
}

export function listFixtureIds(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort()
}

export function loadFixture(id: string): Fixture {
  const json = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${id}.json`), "utf8")) as Omit<Fixture, "pcm">
  const wav = readFileSync(path.join(FIXTURE_DIR, `${id}.wav`))
  return { ...json, pcm: decodeWavPcm16(wav) }
}

/** WAV PCM16 mono → Float32 (−1..1). Procura o bloco `data` em vez de assumir 44 bytes de cabeçalho. */
export function decodeWavPcm16(buffer: Buffer): Float32Array {
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === "data") {
      const samples = Math.floor(size / 2)
      const out = new Float32Array(samples)
      for (let i = 0; i < samples; i++) out[i] = buffer.readInt16LE(offset + 8 + i * 2) / 32768
      return out
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error("WAV sem bloco data")
}

export type ReplayOptions = {
  turnId?: number
  /** Soma ao relógio (s): evita que o código dependa de "tempo 0". */
  clockOffset?: number
}

export function buildReplaySchedule(fixture: Fixture, options: ReplayOptions = {}): ReplaySchedule {
  const turnId = options.turnId ?? 1
  const clockOffset = options.clockOffset ?? 0
  const sampleRate = fixture.sampleRate
  const steps: ReplayStep[] = []
  let sampleCursor = 0
  let scheduledEnd: number | null = null
  let audioStart = Number.NaN
  for (const event of fixture.events) {
    const at = event.t / 1000 + clockOffset
    if ("audioBytes" in event) {
      const samples = event.audioBytes / 2
      const pcm = fixture.pcm.slice(sampleCursor, sampleCursor + samples)
      sampleCursor += samples
      const startAt: number = scheduledEnd === null ? at : Math.max(scheduledEnd, at)
      if (Number.isNaN(audioStart)) audioStart = startAt
      scheduledEnd = startAt + samples / sampleRate
      steps.push({ kind: "audio", at, chunk: { turnId, pcm, sampleRate, startAt, receivedAt: at } })
    } else if ("transcript" in event) {
      steps.push({
        kind: "transcript",
        at,
        fragment: { turnId, text: event.transcript, receivedAt: at, audioScheduledUntil: scheduledEnd ?? at },
      })
    } else if ("generationComplete" in event) {
      steps.push({ kind: "generationComplete", at })
    } else if ("turnComplete" in event) {
      steps.push({ kind: "turnComplete", at })
    }
  }
  const audioEnd = scheduledEnd ?? clockOffset
  const { first, last } = speechBounds(fixture.pcm, sampleRate)
  return {
    fixture,
    steps,
    audioStart,
    audioEnd,
    // Agendamento colado sem buracos nas capturas: amostra i toca em audioStart + i/sr.
    speechStart: audioStart + first / sampleRate,
    speechEnd: audioStart + last / sampleRate,
  }
}

export type ReplayDriverOptions = {
  /**
   * Atraso (s) na chegada de TODOS os fragmentos de texto — simula transcrição atrasada em relação
   * ao áudio. `audioScheduledUntil` é recalculado para a nova chegada.
   */
  transcriptDelay?: number
  /**
   * Atraso EXTRA aleatório por fragmento, uniforme em [0, jitter] (s), somado a `transcriptDelay`.
   * A ordem dos fragmentos é mantida (o Live nunca entrega texto fora de ordem): cada fragmento
   * chega no máximo junto do anterior. Determinístico por `jitterSeed`.
   */
  transcriptJitter?: number
  jitterSeed?: number
  /**
   * Chama `endOfText` no PRIMEIRO de `generationComplete`/`turnComplete` (padrão: sim) — como o
   * transporte (`gemini-realtime-transport.ts › completeText`). O Live manda a última transcrição
   * antes do `generationComplete`; o `turnComplete` pode vir segundos depois.
   */
  endOfText?: boolean
  /** Para a reprodução (sem `endOfText`) depois do primeiro passo com `at >= stopAt`. */
  stopAt?: number
  /** Chamado depois de cada passo entregue ao motor. */
  onStep?: (step: ReplayStep, engine: SpeechLipsyncEngine) => void
}

/** Passos na ordem de chegada, com o atraso de texto aplicado (ordenação estável). */
export function replaySteps(schedule: ReplaySchedule, options: ReplayDriverOptions = {}): ReplayStep[] {
  const delay = options.transcriptDelay ?? 0
  const jitter = options.transcriptJitter ?? 0
  if (delay === 0 && jitter === 0) return schedule.steps
  const random = mulberry32(options.jitterSeed ?? 1)
  const audio = schedule.steps.filter((step): step is Extract<ReplayStep, { kind: "audio" }> => step.kind === "audio")
  const scheduledUntilAt = (at: number): number => {
    let end = Number.NaN
    for (const step of audio) {
      if (step.at > at) break
      end = step.chunk.startAt + step.chunk.pcm.length / step.chunk.sampleRate
    }
    return Number.isNaN(end) ? at : end
  }
  let previousTextAt = Number.NEGATIVE_INFINITY
  const shifted = schedule.steps.map((step): ReplayStep => {
    if (step.kind !== "transcript") return step
    const at = Math.max(previousTextAt, step.at + delay + jitter * random())
    previousTextAt = at
    return { kind: "transcript", at, fragment: { ...step.fragment, receivedAt: at, audioScheduledUntil: scheduledUntilAt(at) } }
  })
  const lastTranscript = Math.max(...shifted.filter((step) => step.kind === "transcript").map((step) => step.at))
  const moved = shifted.map((step): ReplayStep => (step.kind === "turnComplete" || step.kind === "generationComplete" ? { ...step, at: Math.max(step.at, lastTranscript) } : step))
  return moved
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.at - b.step.at || a.index - b.index)
    .map(({ step }) => step)
}

/** PRNG determinístico (mulberry32) para o jitter dos testes. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Entrega a captura ao motor exatamente na ordem de chegada. */
export function replayIntoEngine(engine: SpeechLipsyncEngine, schedule: ReplaySchedule, options: ReplayDriverOptions = {}): void {
  const turnId = schedule.steps.find((step) => step.kind === "audio")?.kind === "audio" ? (schedule.steps.find((step) => step.kind === "audio") as Extract<ReplayStep, { kind: "audio" }>).chunk.turnId : 1
  engine.beginTurn(turnId)
  let textEnded = false
  for (const step of replaySteps(schedule, options)) {
    if (options.stopAt !== undefined && step.at >= options.stopAt) break
    if (step.kind === "audio") engine.pushAudio(step.chunk)
    else if (step.kind === "transcript") engine.pushTranscript(step.fragment)
    else if (!textEnded && options.endOfText !== false) {
      textEnded = true
      engine.endOfText(turnId)
    }
    options.onStep?.(step, engine)
  }
}

/** Primeira/última amostra com |x| acima de ~−40 dBFS (ruído de fundo das capturas fica bem abaixo). */
function speechBounds(pcm: Float32Array, sampleRate: number): { first: number; last: number } {
  const threshold = 0.01
  // Exige um trecho (5 ms) acima do limiar, para não parar num clique isolado.
  const run = Math.round(sampleRate * 0.005)
  let first = 0
  for (let i = 0, count = 0; i < pcm.length; i++) {
    count = Math.abs(pcm[i]) > threshold ? count + 1 : Math.max(0, count - 1)
    if (count >= run / 4) {
      first = Math.max(0, i - run)
      break
    }
  }
  let last = pcm.length
  for (let i = pcm.length - 1, count = 0; i >= 0; i--) {
    count = Math.abs(pcm[i]) > threshold ? count + 1 : Math.max(0, count - 1)
    if (count >= run / 4) {
      last = Math.min(pcm.length, i + run)
      break
    }
  }
  return { first, last }
}

// ---------------------------------------------------------------------------
// G2P de letras (SÓ PARA TESTES)
// ---------------------------------------------------------------------------

const VOWELS = "aáàâãeéêiíoóôõuúü"
const ACCENTED = "áàâãéêíóôõú"
const FUNCTION_WORDS = new Set([
  "o", "a", "os", "as", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "e", "que", "se", "me", "te",
  "lhe", "por", "com", "sem", "um", "uns", "ao", "aos", "à", "às", "pra", "pro", "para", "sua", "seu", "seus", "suas",
])

function isVowelChar(c: string | undefined): boolean {
  return c !== undefined && VOWELS.includes(c)
}

/** Divide a palavra (minúscula, só letras) em sílabas ortográficas aproximadas. */
function syllabify(word: string): string[] {
  const chars = [...word]
  const nuclei: Array<[number, number]> = []
  let i = 0
  while (i < chars.length) {
    if (isVowelChar(chars[i]) && !(chars[i] === "u" && (chars[i - 1] === "q" || chars[i - 1] === "g") && "eiéêí".includes(chars[i + 1] ?? ""))) {
      const start = i
      i++
      // Ditongo decrescente: vogal + i/u átono (não antes de nh / coda nasal).
      if ((chars[i] === "i" || chars[i] === "u") && !isVowelChar(chars[i + 1]) && !(chars[i + 1] === "n" && chars[i + 2] === "h")) i++
      else if (chars[start] === "ã" && (chars[i] === "o" || chars[i] === "e")) i++
      else if (chars[start] === "õ" && chars[i] === "e") i++
      nuclei.push([start, i])
    } else i++
  }
  if (nuclei.length <= 1) return [word]
  const syllables: string[] = []
  let cursor = 0
  for (let n = 0; n < nuclei.length; n++) {
    const [, end] = nuclei[n]
    if (n === nuclei.length - 1) {
      syllables.push(chars.slice(cursor).join(""))
      break
    }
    const nextStart = nuclei[n + 1][0]
    const between = chars.slice(end, nextStart).join("")
    let split = end
    if (between.length === 0) split = end
    else if (between.length === 1) split = end
    else {
      const lastTwo = between.slice(-2)
      const cluster = /^[pbtdkgfvc][rl]$/.test(lastTwo) || ["ch", "lh", "nh", "qu", "gu"].includes(lastTwo)
      split = nextStart - (cluster ? 2 : 1)
    }
    syllables.push(chars.slice(cursor, split).join(""))
    cursor = split
  }
  return syllables
}

function stressedSyllable(word: string, syllables: string[]): number {
  if (FUNCTION_WORDS.has(word)) return -1
  for (let s = 0; s < syllables.length; s++) {
    if ([...syllables[s]].some((c) => ACCENTED.includes(c) && c !== "ã" && c !== "õ")) return s
  }
  for (let s = 0; s < syllables.length; s++) {
    if (syllables[s].includes("ã") || syllables[s].includes("õ")) return s
  }
  if (syllables.length === 1) return 0
  if (/(a|e|o|as|es|os|am|em|ens)$/.test(word)) return syllables.length - 2
  return syllables.length - 1
}

function vowelPhone(c: string, stressed: boolean, final: boolean, nasal: boolean): PhoneSymbol {
  const base = c.normalize("NFD")[0]
  if (nasal || c === "ã" || c === "õ") {
    if (base === "a") return "6~"
    if (base === "e") return "e~"
    if (base === "i") return "i~"
    if (base === "o") return "o~"
    return "u~"
  }
  if (c === "á" || c === "à") return "a"
  if (c === "â") return "6"
  if (c === "é") return "E"
  if (c === "ê") return "e"
  if (c === "ó") return "O"
  if (c === "ô") return "o"
  if (c === "í") return "i"
  if (c === "ú") return "u"
  if (base === "a") return stressed ? "a" : "6"
  if (base === "e") return final ? "i" : "e"
  if (base === "o") return final ? "u" : "o"
  if (base === "i") return "i"
  return "u"
}

/** Fones (sem núcleo marcado) de uma sílaba ortográfica. */
function syllablePhones(syl: string, next: string | undefined, stressed: boolean, finalSyllable: boolean, wordInitial: boolean): Array<{ phone: PhoneSymbol; nucleus: boolean }> {
  const out: Array<{ phone: PhoneSymbol; nucleus: boolean }> = []
  const chars = [...syl]
  let nucleusDone = false
  const nasalCoda = /[mn]$/.test(syl) || (/[mn]s$/.test(syl)) || (next !== undefined && /^[mn]/.test(next) && /[aâeêoô]$/.test(syl) && stressed)
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    const n1 = chars[i + 1]
    const n2 = chars[i + 2]
    if (isVowelChar(c)) {
      if (c === "u" && (chars[i - 1] === "q" || chars[i - 1] === "g") && isVowelChar(n1)) continue
      if (!nucleusDone) {
        const finalVowel = finalSyllable && !stressed && !/[aáâã]/.test(c)
        const nasal = nasalCoda && !isVowelChar(n1)
        out.push({ phone: vowelPhone(c, stressed, finalVowel, nasal || c === "ã" || c === "õ"), nucleus: true })
        nucleusDone = true
      } else {
        const nasalGlide = chars.slice(0, i).some((x) => x === "ã" || x === "õ")
        if (c === "i" || c === "e") out.push({ phone: nasalGlide ? "j~" : "j", nucleus: false })
        else out.push({ phone: nasalGlide ? "w~" : "w", nucleus: false })
      }
      continue
    }
    const prevIsVowel = isVowelChar(chars[i - 1])
    const nextIsVowel = isVowelChar(n1)
    switch (c) {
      case "p": out.push({ phone: "p", nucleus: false }); break
      case "b": out.push({ phone: "b", nucleus: false }); break
      case "t":
      case "d": {
        const beforeI = n1 === "i" || n1 === "í" || (n1 === "e" && finalSyllable && !stressed && i + 2 >= chars.length) || n1 === undefined
        out.push({ phone: c === "t" ? (beforeI ? "tS" : "t") : beforeI ? "dZ" : "d", nucleus: false })
        break
      }
      case "c":
        if (n1 === "h") { out.push({ phone: "S", nucleus: false }); i++ }
        else if (n1 === "e" || n1 === "i" || n1 === "é" || n1 === "ê" || n1 === "í") out.push({ phone: "s", nucleus: false })
        else out.push({ phone: "k", nucleus: false })
        break
      case "ç": out.push({ phone: "s", nucleus: false }); break
      case "q": out.push({ phone: "k", nucleus: false }); break
      case "k": out.push({ phone: "k", nucleus: false }); break
      case "g":
        out.push({ phone: n1 === "e" || n1 === "i" || n1 === "é" || n1 === "ê" || n1 === "í" ? "Z" : "g", nucleus: false })
        break
      case "j": out.push({ phone: "Z", nucleus: false }); break
      case "f": out.push({ phone: "f", nucleus: false }); break
      case "v": out.push({ phone: "v", nucleus: false }); break
      case "s":
        if (n1 === "s") { out.push({ phone: "s", nucleus: false }); i++ }
        else if (prevIsVowel && nextIsVowel) out.push({ phone: "z", nucleus: false })
        else out.push({ phone: "s", nucleus: false })
        break
      case "z": out.push({ phone: i === chars.length - 1 ? "s" : "z", nucleus: false }); break
      case "x": out.push({ phone: "S", nucleus: false }); break
      case "m":
        if (nextIsVowel) out.push({ phone: "m", nucleus: false })
        break
      case "n":
        if (n1 === "h") { out.push({ phone: "J", nucleus: false }); i++ }
        else if (nextIsVowel) out.push({ phone: "n", nucleus: false })
        break
      case "l":
        if (n1 === "h") { out.push({ phone: "L", nucleus: false }); i++ }
        else if (nextIsVowel) out.push({ phone: "l", nucleus: false })
        else out.push({ phone: "w", nucleus: false })
        break
      case "r":
        if (n1 === "r") { out.push({ phone: "R", nucleus: false }); i++ }
        else if (wordInitial && i === 0) out.push({ phone: "R", nucleus: false })
        else if (!nextIsVowel && !prevIsVowel) out.push({ phone: "r", nucleus: false })
        else if (!nextIsVowel) out.push({ phone: "R", nucleus: false })
        else out.push({ phone: "r", nucleus: false })
        break
      case "h": break
      case "w": out.push({ phone: "w", nucleus: false }); break
      case "y": out.push({ phone: "j", nucleus: false }); break
      default: break
    }
    void n2
  }
  if (!out.some((p) => p.nucleus)) out.push({ phone: "6", nucleus: true })
  return out
}

function pauseAfterOf(punctuation: string): PauseStrength {
  if (/[.!?…]/.test(punctuation)) return "long"
  if (/[,;:]/.test(punctuation)) return "short"
  return "none"
}

/**
 * G2P de letras para testes: palavra por palavra, com sílabas ortográficas, tonicidade pela regra
 * de acento/terminação e prioris de duração do inventário (tônica ×1,4, átona final ×0,7,
 * pré-pausa ×1,2).
 */
export function testPhonemizeText(text: string, startWordIndex = 0, startSyllableIndex = 0): G2PWord[] {
  const words: G2PWord[] = []
  let wordIndex = startWordIndex
  let syllableIndex = startSyllableIndex
  const tokens = text.match(/[^\s]+/g) ?? []
  for (const token of tokens) {
    const match = token.match(/^([^A-Za-zÀ-ÿ0-9]*)([A-Za-zÀ-ÿ0-9-]+)([^A-Za-zÀ-ÿ0-9]*)$/)
    const core = (match ? match[2] : token).toLocaleLowerCase("pt-BR").replace(/[^a-zà-ÿ]/g, "")
    const punctuation = match ? match[3] : ""
    if (!core) continue
    const syllables = syllabify(core)
    const stress = stressedSyllable(core, syllables)
    const pauseAfter = pauseAfterOf(punctuation)
    const phones: PhoneToken[] = []
    syllables.forEach((syl, s) => {
      const stressed = s === stress
      const finalSyllable = s === syllables.length - 1
      for (const { phone, nucleus } of syllablePhones(syl, syllables[s + 1], stressed, finalSyllable, s === 0)) {
        let factor = stressed ? 1.35 : finalSyllable ? 0.75 : 1
        if (finalSyllable && pauseAfter !== "none") factor *= 1.2
        phones.push({
          phone,
          wordIndex,
          syllableIndex,
          nucleus,
          stressed: stressed && nucleus,
          durationPriorMs: PHONES[phone].baseDurationMs * factor,
        })
      }
      syllableIndex++
    })
    words.push({ text: token, spoken: core, phones, pauseAfter, questionEnd: punctuation.includes("?") })
    wordIndex++
  }
  return words
}

/** Versão incremental do G2P de teste (mesmo contrato do G2P real). */
export function createTestPhonemizer(): TranscriptPhonemizer {
  let buffer = ""
  let wordIndex = 0
  let syllableIndex = 0
  const emit = (text: string): G2PWord[] => {
    const words = testPhonemizeText(text, wordIndex, syllableIndex)
    if (words.length > 0) {
      wordIndex = words[words.length - 1].phones[0].wordIndex + 1
      syllableIndex = words[words.length - 1].phones[words[words.length - 1].phones.length - 1].syllableIndex + 1
    }
    return words
  }
  return {
    push(fragment) {
      buffer += fragment
      const lastSpace = buffer.search(/\s\S*$/)
      if (lastSpace < 0) return []
      const complete = buffer.slice(0, lastSpace)
      buffer = buffer.slice(lastSpace)
      return emit(complete)
    },
    flush() {
      const rest = buffer
      buffer = ""
      return emit(rest)
    },
    reset() {
      buffer = ""
      wordIndex = 0
      syllableIndex = 0
    },
  }
}

/** Alinhamento de referência (Whisper) das capturas — ver `fixture-metrics.ts › compareWithReference`. */
export function loadReferenceWords(): Record<string, Array<{ word: string; start: number; end: number; p: number }>> {
  const file = path.join(__dirname, "reference", "whisper-words.json")
  return (JSON.parse(readFileSync(file, "utf8")) as { fixtures: Record<string, Array<{ word: string; start: number; end: number; p: number }>> }).fixtures
}
