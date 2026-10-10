import { AudioFeatureExtractor, type FeatureFrameStore } from "../audio-features"
import { PHONES, isBilabial } from "../phones"
import { phonemizeText } from "../pt-br/g2p"
import { SpeechLandmarks } from "../speech-landmarks"
import { createSpeechLipsyncEngine, type SpeechLipsyncEngineOptions } from "../speech-lipsync-engine"
import type { AlignedPhone, PhoneSymbol, SpeechLipsyncEngine } from "../types"
import { createSpeechFrame } from "../types"
import { replayIntoEngine, type ReplayDriverOptions, type ReplaySchedule } from "./load-fixture"

/**
 * Métricas objetivas do lip-sync sobre uma captura real (apoio de TESTE e do laboratório
 * `scripts/dev/lipsync-metrics.ts`). As características de referência são recalculadas à parte
 * (mesmo extrator, instância própria) e só as MEDIDAS do sinal decidem se um fone "caiu no lugar":
 *
 * - bilabial num vale: [p]/[b] com energia total ≥ 6 dB abaixo da média dos núcleos vizinhos; [m] é
 *   vozeado e quase não baixa a energia total — o correlato acústico do lábio fechado nele é a
 *   queda da banda de F2 (1–3 kHz), então vale a maior das duas quedas;
 * - vogal-núcleo em quadro vozeado e forte (vozeamento ≥ 0,5 e energia ≥ nível − 20 dB);
 * - fricativa surda ([s], [S], [f], [tS]) cobrindo quadro com razão de alta frequência ≥ 0,3;
 * - pausas do áudio (≥ 150 ms) cobertas por fone de pausa e numa fronteira de palavra;
 * - fim de frase ("." "!" "?") terminando junto de uma pausa do áudio (é o que mede deriva);
 * - boca em repouso depois do áudio e no miolo das pausas longas.
 */

export type BilabialCheck = { phone: PhoneSymbol; word: string; time: number; dipDb: number; ok: boolean }

export type FixtureMetrics = {
  id: string
  cpuMs: number
  bilabials: { total: number; onDip: number; ratio: number; checks: BilabialCheck[] }
  vowels: { total: number; voiced: number; ratio: number }
  fricatives: { total: number; onHighBand: number; ratio: number; misses: string[] }
  pauses: { detected: number; covered: number; midWord: number; maxOffset: number }
  sentenceEnds: { total: number; onPause: number; worstOffset: number }
  lastWordEndError: number
  rest: { afterAudioMaxJaw: number; afterAudioMaxLipClose: number; speakingAfterAudio: boolean; pauseMaxJaw: number; pauseMaxLipClose: number }
  audioOnlyPhones: number
}

const REFERENCE_PAUSE_SECONDS = 0.15
const SENTENCE_PAUSE_TOLERANCE_SECONDS = 0.12

export type MeasureOptions = SpeechLipsyncEngineOptions & { replay?: ReplayDriverOptions }

/** Características de referência por captura (as mesmas para todo atraso de texto): calculadas uma vez. */
const referenceFeatures = new WeakMap<ReplaySchedule, { store: FeatureFrameStore; landmarks: SpeechLandmarks }>()

function referenceFeaturesOf(schedule: ReplaySchedule): { store: FeatureFrameStore; landmarks: SpeechLandmarks } {
  let features = referenceFeatures.get(schedule)
  if (!features) {
    const extractor = new AudioFeatureExtractor()
    for (const step of schedule.steps) if (step.kind === "audio") extractor.push(step.chunk.pcm, step.chunk.startAt, step.chunk.sampleRate)
    extractor.flush()
    const landmarks = new SpeechLandmarks(extractor.store)
    landmarks.update(true)
    features = { store: extractor.store, landmarks }
    referenceFeatures.set(schedule, features)
  }
  return features
}

export function measureFixture(schedule: ReplaySchedule, options: MeasureOptions = {}): { metrics: FixtureMetrics; engine: SpeechLipsyncEngine } {
  const engine = createSpeechLipsyncEngine(options)
  const started = performance.now()
  replayIntoEngine(engine, schedule, options.replay)
  const cpuMs = performance.now() - started

  const { store, landmarks } = referenceFeaturesOf(schedule)

  const phones = engine.debugSnapshot({ frames: false }).phones
  const words = phonemizeText(schedule.fixture.transcript)
  const wordText = (index: number) => (index >= 0 && index < words.length ? words[index].text : "?")
  const level = percentileEnergy(store, 0.85)

  const aligned = phones.filter((p) => p.source === "aligned")
  const nuclei = aligned.filter((p) => p.nucleus && PHONES[p.phone].class === "vowel")

  // Bilabiais.
  const checks: BilabialCheck[] = []
  for (const phone of aligned) {
    if (!isBilabial(phone.phone)) continue
    const c = center(phone)
    const before = lastBefore(nuclei, c)
    const after = nuclei.find((n) => center(n) > c)
    const neighbors = [before, after].filter((n): n is AlignedPhone => n !== undefined)
    if (neighbors.length === 0) continue
    const dip = (column: Float32Array) => {
      const reference = neighbors.reduce((acc, n) => acc + valueAt(store, column, center(n)), 0) / neighbors.length
      const inside = Math.min(valueAt(store, column, c - 0.01), valueAt(store, column, c), valueAt(store, column, c + 0.01))
      return reference - inside
    }
    const dipDb = phone.phone === "m" ? Math.max(dip(store.energyDb), dip(store.midBandDb)) : dip(store.energyDb)
    checks.push({ phone: phone.phone, word: wordText(phone.wordIndex), time: c - schedule.audioStart, dipDb, ok: dipDb >= 6 })
  }
  const onDip = checks.filter((check) => check.ok).length

  // Vogais-núcleo.
  const voiced = nuclei.filter((phone) => {
    const f = nearestFrame(store, center(phone))
    return store.voicing[f] >= 0.5 && store.energyDb[f] >= level - 20
  }).length

  // Fricativas surdas.
  const fricatives = aligned.filter((p) => p.phone === "s" || p.phone === "S" || p.phone === "f" || p.phone === "tS")
  const fricativeMisses: string[] = []
  let onHighBand = 0
  for (const phone of fricatives) {
    let peak = 0
    for (let f = store.lowerBound(phone.start); f < store.count && store.time[f] <= phone.end; f++) peak = Math.max(peak, store.highBandRatio[f])
    if (peak >= 0.3) onHighBand++
    else fricativeMisses.push(`${phone.phone}@${wordText(phone.wordIndex)}(${(center(phone) - schedule.audioStart).toFixed(2)})`)
  }

  // Pausas do áudio.
  const audioPauses = landmarks.pauses.filter((p) => p.end - p.start >= REFERENCE_PAUSE_SECONDS)
  let covered = 0
  let midWord = 0
  let maxOffset = 0
  for (const pause of audioPauses) {
    let overlap = 0
    let nearest = Number.POSITIVE_INFINITY
    for (const phone of phones) {
      if (phone.phone !== "_") continue
      overlap += Math.max(0, Math.min(pause.end, phone.end) - Math.max(pause.start, phone.start))
      nearest = Math.min(nearest, Math.abs(center(phone) - (pause.start + pause.end) / 2))
    }
    if (overlap >= 0.6 * (pause.end - pause.start)) covered++
    if (Number.isFinite(nearest)) maxOffset = Math.max(maxOffset, nearest)
    const mid = (pause.start + pause.end) / 2
    const left = lastBefore(phones.filter((p) => p.phone !== "_"), mid)
    const right = phones.find((p) => p.phone !== "_" && center(p) > mid)
    if (left && right && left.wordIndex >= 0 && left.wordIndex === right.wordIndex) midWord++
  }

  // Fins de frase × pausas.
  let sentenceTotal = 0
  let sentenceOnPause = 0
  let worstOffset = 0
  const lastWord = words.length - 1
  words.forEach((word, index) => {
    if (word.pauseAfter !== "long" || index === lastWord) return
    const end = Math.max(...aligned.filter((p) => p.wordIndex === index).map((p) => p.end))
    if (!Number.isFinite(end)) return
    sentenceTotal++
    let best = Number.POSITIVE_INFINITY
    for (const pause of landmarks.pauses) best = Math.min(best, Math.abs(pause.start - end))
    worstOffset = Math.max(worstOffset, best)
    if (best <= SENTENCE_PAUSE_TOLERANCE_SECONDS) sentenceOnPause++
  })
  const lastWordIndex = Math.max(...aligned.filter((p) => p.wordIndex >= 0).map((p) => p.wordIndex))
  const lastWordEnd = Math.max(...aligned.filter((p) => p.wordIndex === lastWordIndex).map((p) => p.end))

  // Repouso.
  const frame = createSpeechFrame()
  let afterAudioMaxJaw = 0
  let afterAudioMaxLipClose = 0
  let speakingAfterAudio = false
  for (let t = schedule.speechEnd + 0.15; t <= schedule.audioEnd + 0.5; t += 0.01) {
    engine.sample(t, frame)
    afterAudioMaxJaw = Math.max(afterAudioMaxJaw, frame.mouth.jaw)
    afterAudioMaxLipClose = Math.max(afterAudioMaxLipClose, frame.mouth.lipClose)
    speakingAfterAudio = speakingAfterAudio || frame.speaking
  }
  let pauseMaxJaw = 0
  let pauseMaxLipClose = 0
  for (const pause of audioPauses) {
    if (pause.end - pause.start < 0.35) continue
    for (let t = pause.start + 0.15; t <= pause.end - 0.15; t += 0.01) {
      engine.sample(t, frame)
      pauseMaxJaw = Math.max(pauseMaxJaw, frame.mouth.jaw)
      pauseMaxLipClose = Math.max(pauseMaxLipClose, frame.mouth.lipClose)
    }
  }

  const metrics: FixtureMetrics = {
    id: schedule.fixture.id,
    cpuMs,
    bilabials: { total: checks.length, onDip, ratio: ratio(onDip, checks.length), checks },
    vowels: { total: nuclei.length, voiced, ratio: ratio(voiced, nuclei.length) },
    fricatives: { total: fricatives.length, onHighBand, ratio: ratio(onHighBand, fricatives.length), misses: fricativeMisses },
    pauses: { detected: audioPauses.length, covered, midWord, maxOffset },
    sentenceEnds: { total: sentenceTotal, onPause: sentenceOnPause, worstOffset },
    lastWordEndError: lastWordEnd - schedule.speechEnd,
    rest: { afterAudioMaxJaw, afterAudioMaxLipClose, speakingAfterAudio, pauseMaxJaw, pauseMaxLipClose },
    audioOnlyPhones: phones.filter((p) => p.source === "audio-only" && p.phone !== "_").length,
  }
  return { metrics, engine }
}

function ratio(part: number, total: number): number {
  return total === 0 ? 1 : part / total
}

function center(phone: AlignedPhone): number {
  return (phone.start + phone.end) / 2
}

function lastBefore(list: readonly AlignedPhone[], time: number): AlignedPhone | undefined {
  for (let k = list.length - 1; k >= 0; k--) if (center(list[k]) < time) return list[k]
  return undefined
}

function nearestFrame(store: FeatureFrameStore, t: number): number {
  const f = Math.min(store.count - 1, store.lowerBound(t))
  return f > 0 && Math.abs(store.time[f - 1] - t) < Math.abs(store.time[f] - t) ? f - 1 : f
}

function valueAt(store: FeatureFrameStore, column: Float32Array, t: number): number {
  return column[nearestFrame(store, t)]
}

/** Nível de fala: percentil da energia dos quadros com som, calculado à parte do motor. */
function percentileEnergy(store: FeatureFrameStore, p: number): number {
  const energies: number[] = []
  for (let f = 0; f < store.count; f++) if (store.energyDb[f] > -70) energies.push(store.energyDb[f])
  energies.sort((a, b) => a - b)
  return energies[Math.floor(energies.length * p)] ?? -20
}

/**
 * Tempos de palavra × uma referência (o mesmo áudio com o texto em dia): o texto atrasado não pode
 * mudar ONDE uma palavra cai quando ela é alinhada. Só entram palavras alinhadas nos dois começando
 * pelo MESMO fone — uma palavra retomada no meio (o começo dela tocou em modo só-áudio) não é erro de
 * posição.
 */
export type WordTimingComparison = {
  compared: number
  /** Palavras com |Δ início| acima do limite. */
  beyond: number
  maxDeltaMs: number
  p90DeltaMs: number
  /** Palavras alinhadas na referência que não foram alinhadas aqui (tocaram em modo só-áudio). */
  missing: number
  worst: Array<{ wordIndex: number; deltaMs: number }>
}

export function compareWordTimings(reference: readonly AlignedPhone[], phones: readonly AlignedPhone[], limitMs = 60): WordTimingComparison {
  const starts = (list: readonly AlignedPhone[]) => {
    const map = new Map<number, AlignedPhone>()
    for (const phone of list) if (phone.wordIndex >= 0 && phone.source === "aligned" && !map.has(phone.wordIndex)) map.set(phone.wordIndex, phone)
    return map
  }
  const ref = starts(reference)
  const got = starts(phones)
  const deltas: Array<{ wordIndex: number; deltaMs: number }> = []
  for (const [wordIndex, phone] of got) {
    const other = ref.get(wordIndex)
    if (other && other.phone === phone.phone) deltas.push({ wordIndex, deltaMs: Math.abs(phone.start - other.start) * 1000 })
  }
  const sorted = deltas.map((d) => d.deltaMs).sort((a, b) => a - b)
  return {
    compared: deltas.length,
    beyond: deltas.filter((d) => d.deltaMs > limitMs).length,
    maxDeltaMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    p90DeltaMs: sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : 0,
    missing: [...ref.keys()].filter((w) => !got.has(w)).length,
    worst: deltas.filter((d) => d.deltaMs > limitMs).sort((a, b) => b.deltaMs - a.deltaMs),
  }
}

export function formatMetrics(m: FixtureMetrics): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`
  return [
    `${m.id}  cpu ${m.cpuMs.toFixed(1)} ms  só-áudio ${m.audioOnlyPhones}`,
    `  bilabiais no vale ${m.bilabials.onDip}/${m.bilabials.total} (${pct(m.bilabials.ratio)})  vogais vozeadas ${m.vowels.voiced}/${m.vowels.total} (${pct(m.vowels.ratio)})  fricativas na alta ${m.fricatives.onHighBand}/${m.fricatives.total} (${pct(m.fricatives.ratio)})`,
    `  pausas cobertas ${m.pauses.covered}/${m.pauses.detected}  no meio da palavra ${m.pauses.midWord}  maior desvio ${(m.pauses.maxOffset * 1000).toFixed(0)} ms  fins de frase na pausa ${m.sentenceEnds.onPause}/${m.sentenceEnds.total} (pior ${(m.sentenceEnds.worstOffset * 1000).toFixed(0)} ms)`,
    `  última palavra − fim da fala ${(m.lastWordEndError * 1000).toFixed(0)} ms  repouso pós-áudio jaw ${m.rest.afterAudioMaxJaw.toFixed(3)} lip ${m.rest.afterAudioMaxLipClose.toFixed(3)} falando ${m.rest.speakingAfterAudio}  pausas jaw ${m.rest.pauseMaxJaw.toFixed(3)} lip ${m.rest.pauseMaxLipClose.toFixed(3)}`,
    `  erros bilabiais: ${m.bilabials.checks.filter((c) => !c.ok).map((c) => `${c.phone}@${c.word}(${c.time.toFixed(2)}s ${c.dipDb.toFixed(1)}dB)`).join(" ") || "—"}`,
    `  erros fricativas: ${m.fricatives.misses.join(" ") || "—"}`,
  ].join("\n")
}

/**
 * Erro de início de palavra contra o alinhamento de REFERÊNCIA independente (Whisper,
 * `tools/avatar/whisper-word-reference.py` → `reference/whisper-words.json`). As palavras do texto da
 * captura são casadas com as reconhecidas por edição de sequência (mesma palavra normalizada ou
 * parecida o bastante); números escritos × falados e palavras que só um dos dois tem ficam de fora.
 * Tempos da referência = segundos desde a primeira amostra do WAV (= `audioStart` do agendamento colado).
 *
 * Os tempos do Whisper erram dezenas de ms (atenção cruzada, quadros de 20 ms): a referência serve para
 * achar palavra trocada/deslocada e viés sistemático, não para medir 10 ms.
 */
export type ReferenceWord = { word: string; start: number; end: number; p: number }

export type ReferenceComparison = {
  matched: number
  /** Palavras casadas com início alinhado pelo texto (as que tocaram em só-áudio ficam de fora). */
  compared: number
  /** Erro com sinal (motor − referência), em ms: mediana mostra viés. */
  medianSignedMs: number
  medianAbsMs: number
  p90AbsMs: number
  maxAbsMs: number
  within50: number
  within100: number
  within300: number
  /** |erro| de cada palavra comparada (ms), para agregar entre capturas. */
  absErrorsMs: number[]
  worst: Array<{ word: string; errorMs: number }>
}

export function normalizeWord(text: string): string {
  return text
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

function similar(a: string, b: string): boolean {
  if (a === b) return a.length > 0
  if (a.length < 3 || b.length < 3) return false
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return prev[b.length] / Math.max(a.length, b.length) <= 0.34
}

/** Casa as palavras do texto (`text[i]`) com as da referência por edição de sequência. */
export function matchWords(text: readonly string[], reference: readonly string[]): Array<[number, number]> {
  const a = text.map(normalizeWord)
  const b = reference.map(normalizeWord)
  const n = a.length
  const m = b.length
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const match = similar(a[i - 1], b[j - 1]) ? score[i - 1][j - 1] + 1 : Number.NEGATIVE_INFINITY
      score[i][j] = Math.max(match, score[i - 1][j], score[i][j - 1])
    }
  }
  const pairs: Array<[number, number]> = []
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (similar(a[i - 1], b[j - 1]) && score[i][j] === score[i - 1][j - 1] + 1) {
      pairs.push([i - 1, j - 1])
      i--
      j--
    } else if (score[i - 1][j] >= score[i][j - 1]) i--
    else j--
  }
  return pairs.reverse()
}

export function compareWithReference(schedule: ReplaySchedule, phones: readonly AlignedPhone[], reference: readonly ReferenceWord[]): ReferenceComparison {
  const words = phonemizeText(schedule.fixture.transcript)
  const pairs = matchWords(
    words.map((word) => word.text),
    reference.map((word) => word.word),
  )
  const starts = new Map<number, number>()
  for (const phone of phones) if (phone.wordIndex >= 0 && phone.source === "aligned" && !starts.has(phone.wordIndex)) starts.set(phone.wordIndex, phone.start)
  const errors: Array<{ word: string; errorMs: number }> = []
  for (const [w, r] of pairs) {
    const start = starts.get(words[w].phones[0]?.wordIndex ?? w)
    if (start === undefined) continue
    errors.push({ word: words[w].text, errorMs: (start - schedule.audioStart - reference[r].start) * 1000 })
  }
  const signed = errors.map((e) => e.errorMs).sort((x, y) => x - y)
  const abs = errors.map((e) => Math.abs(e.errorMs)).sort((x, y) => x - y)
  const at = (list: number[], q: number) => (list.length === 0 ? 0 : list[Math.min(list.length - 1, Math.floor(list.length * q))])
  return {
    matched: pairs.length,
    compared: errors.length,
    medianSignedMs: at(signed, 0.5),
    medianAbsMs: at(abs, 0.5),
    p90AbsMs: at(abs, 0.9),
    maxAbsMs: abs.length > 0 ? abs[abs.length - 1] : 0,
    within50: errors.filter((e) => Math.abs(e.errorMs) <= 50).length,
    within100: errors.filter((e) => Math.abs(e.errorMs) <= 100).length,
    within300: errors.filter((e) => Math.abs(e.errorMs) <= 300).length,
    absErrorsMs: abs,
    worst: [...errors].sort((x, y) => Math.abs(y.errorMs) - Math.abs(x.errorMs)).slice(0, 4),
  }
}
