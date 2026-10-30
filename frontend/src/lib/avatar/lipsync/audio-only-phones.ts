import type { FeatureFrameStore } from "./audio-features"
import { HOP_SECONDS, lowerBoundBy, type Nucleus, type SpeechLandmarks } from "./speech-landmarks"
import type { AlignedPhone, PhoneSymbol } from "./types"

/**
 * Fones "só áudio": o que a boca faz quando o áudio vai tocar e o texto correspondente ainda não
 * chegou (transcrição atrasada) ou nunca vem (transcrição incompleta). Sem texto não há QUAL fone —
 * só o QUANDO e quanto a boca abre: vogal neutra nos núcleos com a abertura ESTIMADA do áudio,
 * consoante coronal genérica no vale entre eles (fricção = [s]), pausa no silêncio longo.
 *
 * Calibrado em 2026-10-08 contra o alinhamento com o texto das 14 capturas com transcrição completa
 * (914 núcleos, 771 trechos consonantais; `docs/dev/memoria/conversa-voz-e-avatar.md`):
 * - abertura da vogal: a razão banda de F2 (1–3 kHz) ÷ banda de vogais sobe com F1 — vogal aberta —
 *   e a loudness relativa também; a regressão dos dois acerta a mandíbula da vogal alinhada com
 *   r = 0,70 (ajustada numa voz e testada na outra: 0,70–0,73). Antes, quase todo núcleo virava
 *   "a" e a boca sem texto abria 1,7× a boca com texto;
 * - consoante: a fala real fica ~91 ms entre as vogais e o trecho em que o envelope de vogais está
 *   3 dB abaixo dos dois núcleos vizinhos dá essa duração (erro médio −2 ms) — antes, 35 ms
 *   grudados no vale e a vogal engolia metade da consoante seguinte;
 * - toda consoante não-fricativa tem mandíbula real 0,14–0,16 qualquer que seja a profundidade do
 *   vale; o vale fundo era [p], mas só 32% deles são bilabiais — selar os lábios sem saber errava
 *   2 em 3, então nenhum fone só-áudio fecha os lábios;
 * - silêncio < 80 ms entre vogais é oclusão (pausa de verdade em 3–9%); ≥ 80 ms é pausa (87–100%).
 */

/** Abertura da vogal pelo áudio: mandíbula-base ≈ intercepto + loudness relativa (dB) + razão F2 (dB). */
const OPENING_INTERCEPT = 0.5825
const OPENING_PER_LOUDNESS_DB = 0.0114
const OPENING_PER_F2_RATIO_DB = 0.0205
/** Faixa das vogais da tabela (u … a). */
const OPENING_MIN = 0.18
const OPENING_MAX = 0.62
/** Quadros de cada lado na média da razão F2 do núcleo. */
const OPENING_RADIUS_FRAMES = 2
/** Consoante = onde o envelope de vogais fica isto abaixo do núcleo vizinho mais fraco (dB). */
const CONSONANT_DROP_DB = 3
/** A consoante não come a vogal: deixa isto de cada núcleo (s). */
const NUCLEUS_GUARD_SECONDS = 0.02
/** Silêncio a partir do qual o trecho entre vogais é pausa, não oclusão (s). */
const PAUSE_SILENCE_SECONDS = 0.08
const FRICATION_RATIO = 0.35
/** Trecho sem núcleo: a fala vozeada abre como o núcleo mais próximo, se ele está a até isto (s). */
const NEAREST_NUCLEUS_REACH_SECONDS = 0.3
/** Vogal neutra (lábios soltos, mandíbula pela estimativa) e consoante genérica (coronal, mandíbula 0,15). */
const GENERIC_VOWEL: PhoneSymbol = "6"
const GENERIC_CONSONANT: PhoneSymbol = "d"
const FRICATIVE: PhoneSymbol = "s"

/** Loudness 0..1 do trecho: energia média relativa ao nível de fala do turno. */
export function segmentLoudness(store: FeatureFrameStore, levelDb: number, start: number, end: number): number {
  let first = store.lowerBound(start - 0.005)
  let last = store.lowerBound(end + 0.005)
  if (last <= first) {
    first = Math.max(0, Math.min(store.count - 1, first))
    last = first + 1
  }
  let acc = 0
  let n = 0
  for (let f = first; f < last && f < store.count; f++) {
    acc += store.energyDb[f]!
    n++
  }
  if (n === 0) return 0
  return Math.max(0, Math.min(1, (acc / n - (levelDb - 30)) / 30))
}

/** Instante do menor envelope de vogais entre `a` e `b`. */
export function valleyBetween(store: FeatureFrameStore, a: number, b: number): number {
  let best = (a + b) / 2
  let bestValue = Number.POSITIVE_INFINITY
  for (let f = store.lowerBound(a); f < store.count && store.time[f]! <= b; f++) {
    if (store.vowelBandDb[f]! < bestValue) {
      bestValue = store.vowelBandDb[f]!
      best = store.time[f]!
    }
  }
  return best
}

/**
 * Fim natural de um trecho só-áudio que precisa cobrir até `until`: estende até o vale seguinte ao
 * último núcleo coberto, para não cortar uma sílaba ao meio. Sem núcleo no trecho mas com a próxima
 * sílaba logo adiante, não consolida nada ainda (devolve `from`): o instante ouvido anda ~40 ms por
 * pedaço de áudio, e consolidar meia sílaba classificava quadro a quadro — consoante vozeada virava
 * vogal; até a sílaba fechar, quem mostra o trecho é a prévia só-áudio do motor, que a vê inteira.
 * Com a próxima sílaba longe (pausa), vai até perto dela de uma vez. (E nunca entra na próxima
 * sílaba: consolidar só-áudio a mais rouba o lugar onde o texto atrasado retoma — "passos" sumia da
 * frase-04 com o texto 1,5 s atrasado.)
 */
export function audioOnlyEnd(store: FeatureFrameStore, landmarks: SpeechLandmarks, from: number, until: number): number {
  const frontier = store.count > 0 ? store.time[store.count - 1]! + HOP_SECONDS / 2 : from
  let to = Math.min(until, frontier)
  const nuclei = landmarks.nuclei
  let n = lowerBoundBy(nuclei, from)
  let last: Nucleus | null = null
  for (; n < nuclei.length && nuclei[n]!.time <= to; n++) last = nuclei[n]!
  if (!last && n < nuclei.length) {
    if (nuclei[n]!.time - to <= NEAREST_NUCLEUS_REACH_SECONDS) return from
    // Fim de frase: o resto da sílaba que se apaga e a pausa vão de uma vez até perto da próxima sílaba
    // (em pedaços de ~10 ms viravam dezenas de fones minúsculos que o limite de velocidade, que olha
    // ±3 fones, não conseguia suavizar — a boca fechava 0,5 em 20 ms).
    return Math.max(to, Math.min(frontier, nuclei[n]!.time - NEAREST_NUCLEUS_REACH_SECONDS))
  }
  if (last) {
    const next = nuclei[n]
    const valley = next ? valleyBetween(store, last.time, next.time) : Math.min(frontier, last.time + 0.12)
    to = Math.max(to, Math.min(frontier, valley))
  }
  return to
}

/**
 * Mandíbula-base estimada da vogal no núcleo (antes da escala por loudness da linha do tempo, como
 * o alvo da tabela): ver a calibração no topo.
 */
export function estimateOpening(store: FeatureFrameStore, landmarks: SpeechLandmarks, nucleus: Nucleus): number {
  let ratio = 0
  let n = 0
  for (let f = Math.max(0, nucleus.frame - OPENING_RADIUS_FRAMES); f <= nucleus.frame + OPENING_RADIUS_FRAMES && f < store.count; f++) {
    ratio += store.midBandDb[f]! - store.vowelBandDb[f]!
    n++
  }
  const opening = OPENING_INTERCEPT + OPENING_PER_LOUDNESS_DB * (nucleus.envDb - landmarks.speechLevelDb) + OPENING_PER_F2_RATIO_DB * (n > 0 ? ratio / n : 0)
  return Math.max(OPENING_MIN, Math.min(OPENING_MAX, opening))
}

export function audioOnlyPhones(store: FeatureFrameStore, landmarks: SpeechLandmarks, from: number, to: number): AlignedPhone[] {
  const out: AlignedPhone[] = []
  const level = landmarks.speechLevelDb
  const silence = landmarks.silenceDb
  const push = (phone: PhoneSymbol, start: number, end: number, nucleus = false, jawTarget?: number) => {
    if (end - start < 0.004) return
    const last = out[out.length - 1]
    if (last && last.phone === phone && !nucleus && !last.nucleus) {
      last.end = end
      return
    }
    const aligned: AlignedPhone = { phone, start, end, stressed: false, nucleus, wordIndex: -1, source: "audio-only", loudness: phone === "_" ? 0 : segmentLoudness(store, level, start, end) }
    if (jawTarget !== undefined) aligned.jawTarget = jawTarget
    out.push(aligned)
  }
  /** Envelope de vogais suavizado (o dos núcleos); além do calculado, a banda crua. */
  const envAt = (f: number) => (f < landmarks.envCount ? landmarks.env[f]! : store.vowelBandDb[f]!)
  /** Consoante entre `a` e `b` (núcleos ou bordas): fricção, oclusão/coronal, ou pausa se o silêncio for longo. */
  const consonantOf = (start: number, end: number): PhoneSymbol => {
    let silent = 0
    let frication = 0
    for (let f = store.lowerBound(start); f < store.count && store.time[f]! < end; f++) {
      if (store.energyDb[f]! < silence) silent += HOP_SECONDS
      else if (store.highBandRatio[f]! > frication) frication = store.highBandRatio[f]!
    }
    if (silent >= PAUSE_SILENCE_SECONDS) return "_"
    return frication >= FRICATION_RATIO ? FRICATIVE : GENERIC_CONSONANT
  }
  /**
   * Trecho com o envelope `CONSONANT_DROP_DB` abaixo de `referenceDb` em volta de `center` (o menor
   * envelope de [lo, hi] quando omitido), dentro de [lo, hi]; null se o envelope não cai (hiato).
   */
  const consonantSpan = (lo: number, hi: number, referenceDb: number, center?: number): [number, number] | null => {
    if (hi <= lo) return null
    const threshold = referenceDb - CONSONANT_DROP_DB
    let c = -1
    if (center === undefined) {
      let lowest = Number.POSITIVE_INFINITY
      for (let f = store.lowerBound(lo); f < store.count && store.time[f]! <= hi; f++) {
        if (envAt(f) < lowest) {
          lowest = envAt(f)
          c = f
        }
      }
    } else {
      c = Math.min(store.count - 1, store.lowerBound(center))
    }
    if (c < 0 || envAt(c) >= threshold) return null
    let left = c
    while (left > 0 && store.time[left - 1]! >= lo && envAt(left - 1) < threshold) left--
    let right = c
    while (right + 1 < store.count && store.time[right + 1]! <= hi && envAt(right + 1) < threshold) right++
    return [Math.max(lo, store.time[left]! - HOP_SECONDS / 2), Math.min(hi, store.time[right]! + HOP_SECONDS / 2)]
  }

  /** Nenhuma sílaba logo depois de `t`: a fala termina (ou pausa) ali. */
  const speechEndsAt = (t: number): boolean => {
    const next = landmarks.nuclei[lowerBoundBy(landmarks.nuclei, t)]
    return !next || next.time - t > NEAREST_NUCLEUS_REACH_SECONDS
  }

  const nuclei: Nucleus[] = []
  for (let n = lowerBoundBy(landmarks.nuclei, from); n < landmarks.nuclei.length && landmarks.nuclei[n]!.time <= to; n++) nuclei.push(landmarks.nuclei[n]!)
  if (nuclei.length === 0) {
    // Fala sem núcleo no trecho (o instante ouvido anda ~40 ms entre dois pedaços de áudio, menos que
    // uma sílaba): classifica quadro a quadro; a parte vozeada abre como o núcleo mais próximo.
    const after = landmarks.nuclei[lowerBoundBy(landmarks.nuclei, to)]
    const before = landmarks.nuclei[lowerBoundBy(landmarks.nuclei, from) - 1]
    const nearest = after && after.time - to <= NEAREST_NUCLEUS_REACH_SECONDS ? after : before && from - before.time <= NEAREST_NUCLEUS_REACH_SECONDS ? before : undefined
    const opening = nearest ? estimateOpening(store, landmarks, nearest) : undefined
    let segmentStart = from
    let segmentPhone: PhoneSymbol | null = null
    const close = (end: number) => {
      if (segmentPhone) push(segmentPhone, segmentStart, end, false, segmentPhone === GENERIC_VOWEL ? opening : undefined)
    }
    for (let f = store.lowerBound(from); f < store.count && store.time[f]! <= to; f++) {
      const phone = classifyFrame(store, f, level, silence)
      if (phone !== segmentPhone) {
        close(Math.max(segmentStart, store.time[f]! - HOP_SECONDS / 2))
        segmentPhone = phone
        segmentStart = Math.max(from, store.time[f]! - HOP_SECONDS / 2)
      }
    }
    close(to)
    return out
  }
  // Vogal em cada núcleo; entre dois núcleos, a consoante centrada no vale (hiato: só a fronteira).
  let cursor = from
  for (let k = 0; k <= nuclei.length; k++) {
    const previous = k > 0 ? nuclei[k - 1] : null
    const next = k < nuclei.length ? nuclei[k] : null
    const lo = previous ? previous.time + NUCLEUS_GUARD_SECONDS : from
    const hi = next ? next.time - NUCLEUS_GUARD_SECONDS : to
    let span: [number, number] | null = null
    if (previous && next) {
      span = consonantSpan(lo, hi, Math.min(previous.envDb, next.envDb))
    } else if (next) {
      // Antes do primeiro núcleo: o começo do trecho, se ainda está abaixo do núcleo.
      span = consonantSpan(lo, hi, next.envDb, lo)
      if (span) span[0] = from
    } else if (previous) {
      // Depois do último núcleo: o fim do trecho, se já caiu. No fim da fala (nenhuma sílaba logo
      // depois), a queda sem fricção é a vogal se apagando, não consoante — virava um [d] e encurtava
      // a vogal final (o "cê" de "você", o acento mais forte da frase, perdia a cara de tônica).
      span = consonantSpan(lo, hi, previous.envDb, Math.max(lo, to - HOP_SECONDS))
      if (span) span[1] = to
      if (span && speechEndsAt(to) && consonantOf(span[0], span[1]) !== FRICATIVE) span = null
    }
    const vowelEnd = span ? span[0] : next ? (previous ? valleyBetween(store, previous.time, next.time) : from) : to
    if (previous) push(GENERIC_VOWEL, cursor, vowelEnd, true, estimateOpening(store, landmarks, previous))
    cursor = vowelEnd
    if (span) {
      push(consonantOf(span[0], span[1]), span[0], span[1])
      cursor = span[1]
    }
  }
  return out
}

function classifyFrame(store: FeatureFrameStore, f: number, level: number, silence: number): PhoneSymbol {
  const energy = store.energyDb[f]!
  if (energy < silence) return "_"
  if (store.highBandRatio[f]! >= FRICATION_RATIO) return FRICATIVE
  if (energy < level - 18) return GENERIC_CONSONANT
  return store.voicing[f]! > 0.5 ? GENERIC_VOWEL : GENERIC_CONSONANT
}
