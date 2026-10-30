import { BehaviorController } from "../../animation/behavior-controller"
import { PULL_HORIZON_SECONDS } from "../../animation/behavior/blink"
import type { AvatarConversationState, AvatarDriver, ConversationCue } from "../../animation/types"
import { DEFAULT_AVATAR_TUNING } from "../../animation/types"
import { ARTICULATION, MAX_JAW } from "../articulation"
import { AudioFeatureExtractor } from "../audio-features"
import { DEFAULT_LOUDNESS_BASE, DEFAULT_LOUDNESS_GAIN, DEFAULT_STRESS_GAIN } from "../coarticulation"
import { isBilabial, PHONES } from "../phones"
import { accentShapeOf, type AccentShape } from "../prosody"
import { createTranscriptPhonemizer } from "../pt-br/g2p"
import { createSpeechLipsyncEngine, type SpeechLipsyncEngineOptions } from "../speech-lipsync-engine"
import type { AlignedPhone, PhoneSymbol, SpeechFrame } from "../types"
import { createSpeechFrame, MOUTH_CHANNEL_KEYS } from "../types"
import { loadReferenceWords, replaySteps, type ReplayDriverOptions, type ReplaySchedule } from "./load-fixture"

/**
 * DINÂMICA da boca sobre uma captura real (apoio de TESTE e do laboratório
 * `scripts/dev/lipsync-dynamics.ts`): reproduz a captura intercalando a CHEGADA dos pacotes com a
 * amostragem no instante OUVIDO — exatamente o que o avatar mostraria ao vivo — e mede:
 *
 * - defasagem boca × som: correlação cruzada da mandíbula com o envelope (linear) da banda de
 *   vogais, recalculado por um extrator à parte; lag > 0 = o som vem depois da boca;
 * - modulação silábica: profundidade por SÍLABA = maior abertura dentro do núcleo vocálico − menor
 *   abertura entre o centro do núcleo anterior e o centro deste (o vale da consoante/transição);
 *   picos locais por segundo só informam (platôs geram micro-picos sem profundidade nenhuma);
 * - saltos: variação > 0,2 da mandíbula em 20 ms (≈ 1 quadro);
 * - selo bilabial: lipClose ≥ 0,9 perto de todo p/b/m alinhado, e por quanto tempo;
 * - reescrita visível: o que foi mostrado ao vivo × a linha do tempo final;
 * - contraste por classe: mandíbula no centro de cada fone × alvo da tabela de articulação, e
 *   arredondamento (max(round, pucker)) no centro;
 * - prosódia: pulsos de ênfase por segundo (picos de `SpeechFrame.emphasis` > 0,3), e por TIPO
 *   de acento no pico (subida/queda/pico pela direção do F0; quantos são nucleares).
 *
 * `measureBehavior` toca a fala MOSTRADA (a trilha gravada aqui, quadro a quadro) no
 * `BehaviorController` com várias sementes e mede a resposta por tipo de acento (cabeça para
 * baixo/para cima, sobrancelha) e a piscada relativa ao fim de frase (pausas ≥ 150 ms da linha do
 * tempo final + o fim da fala).
 */

export const DYNAMICS_STEP_SECONDS = 0.005

/** Grupos de fones do contraste (mesmos da avaliação de 2026-10-07). */
export const CONTRAST_GROUPS: Readonly<Record<string, readonly PhoneSymbol[]>> = Object.freeze({
  "a (aberto)": ["a"],
  "é/ó": ["E", "O"],
  "ê/ô": ["e", "o"],
  "i/u": ["i", "u"],
  "ã/nasais": ["6~", "e~", "i~", "o~", "u~"],
  "s/z/x/j": ["s", "z", "S", "Z"],
  "f/v": ["f", "v"],
  "t/d/n/l": ["t", "d", "n", "l"],
  "p/b/m": ["p", "b", "m"],
})

/** Vogais NÃO arredondadas: aqui o arredondamento visível é vazamento dos vizinhos. */
export const UNROUNDED_VOWELS: readonly PhoneSymbol[] = ["a", "6", "e", "E", "i", "6~", "e~", "i~"]

export type ContrastSample = { jaw: number; target: number; rounding: number; durationMs: number }
export type ContrastAccumulator = Record<string, ContrastSample[]>

export type DynamicsMetrics = {
  id: string
  speechSeconds: number
  syllablesPerSecond: number
  lag: { bestMs: number; r: number; byLag: Array<{ lagMs: number; r: number }> }
  /**
   * `depthP50/P10`: por sílaba (todas, inclusive hiato e i/u, onde a mandíbula quase não precisa
   * mexer); `idealDepthP50`: o mesmo, se toda meta da tabela fosse atingida exatamente (o teto);
   * `peakDepthP50`: por pico local > 0,08 contra o vale anterior (definição da avaliação de 2026-10-07).
   */
  jaw: { meanSpeaking: number; nearlyClosedRatio: number; peaksPerSecond: number; depthP50: number; depthP10: number; idealDepthP50: number; peakDepthP50: number }
  /** `max` = maior velocidade instantânea (1/s); `maxStep20ms` = maior |Δjaw| em qualquer janela de 20 ms. */
  velocity: { max: number; maxStep20ms: number; pops: number }
  bilabials: { total: number; sealed: number; sealMsP10: number; sealMsP50: number }
  rewrite: { maxJawDelta: number; framesOver: number; audioOnlyFrames: number }
  emphasis: { pulsesPerSecond: number; wordsPerSecond: number; byShape: Record<AccentShape, number>; nuclear: number; nuclearFalls: number }
  /** Picos de acento (instante ouvido, tipo, nuclear) — base das métricas de comportamento. */
  accents: AccentPeak[]
  /** Início das pausas de frase (≥ 150 ms) depois do começo da fala, e o fim da fala. */
  boundaries: number[]
  /** A fala mostrada ao vivo, quadro a quadro (passo `DYNAMICS_STEP_SECONDS`), para tocar no comportamento. */
  track: SpeechTrack
  /** Por fone, no centro do intervalo, da linha do tempo final. */
  contrast: ContrastAccumulator
  unroundedRounding: number[]
}

export type DynamicsOptions = SpeechLipsyncEngineOptions & { replay?: ReplayDriverOptions }

export type AccentPeak = { t: number; shape: AccentShape; direction: number; nuclear: boolean; pulse: number }

/** Pausa a partir da qual há fronteira de frase (a mesma do acento nuclear no motor). */
export const PHRASE_BOUNDARY_SECONDS = 0.15

/** Trilha da fala mostrada: um `SpeechFrame` por passo, em typed arrays. */
export type SpeechTrack = {
  start: number
  step: number
  count: number
  speaking: Uint8Array
  energy: Float32Array
  emphasis: Float32Array
  accentDirection: Float32Array
  accentNuclear: Uint8Array
  phraseTime: Float32Array
  question: Uint8Array
  mouth: Float32Array
}

type Shown = { t: number; jaw: number; lip: number; speaking: boolean; source: SpeechFrame["debugSource"]; emphasis: number; accentDirection: number; accentNuclear: boolean }

export function measureDynamics(schedule: ReplaySchedule, options: DynamicsOptions = {}): DynamicsMetrics {
  const steps = replaySteps(schedule, options.replay)
  const engine = createSpeechLipsyncEngine(options)
  const turnId = steps.find((step) => step.kind === "audio")?.kind === "audio" ? (steps.find((step) => step.kind === "audio") as Extract<(typeof steps)[number], { kind: "audio" }>).chunk.turnId : 1
  engine.beginTurn(turnId)
  const frame = createSpeechFrame()
  // `endOfText` no PRIMEIRO de generationComplete/turnComplete, como o transporte e `replayIntoEngine`
  // (só no turnComplete, que chega segundos depois, a fala sem transcrição ficava esse tempo todo na
  // boca "ao vivo" — o que o avatar nunca mostra).
  let textEnded = false
  const deliver = (step: (typeof steps)[number]) => {
    if (step.kind === "audio") engine.pushAudio(step.chunk)
    else if (step.kind === "transcript") engine.pushTranscript(step.fragment)
    else if (!textEnded && options.replay?.endOfText !== false) {
      textEnded = true
      engine.endOfText(turnId)
    }
  }

  // Ao vivo: chegada e amostragem no mesmo relógio (as capturas usam o relógio do pedido).
  const shown: Shown[] = []
  const track = createTrack(schedule.audioStart, Math.floor((schedule.audioEnd + 0.3 - schedule.audioStart) / DYNAMICS_STEP_SECONDS) + 1)
  let s = 0
  for (let t = schedule.audioStart; t <= schedule.audioEnd + 0.3; t += DYNAMICS_STEP_SECONDS) {
    while (s < steps.length && steps[s]!.at <= t) deliver(steps[s++]!)
    engine.sample(t, frame)
    shown.push({ t, jaw: frame.mouth.jaw, lip: frame.mouth.lipClose, speaking: frame.speaking, source: frame.debugSource, emphasis: frame.emphasis, accentDirection: frame.accentDirection, accentNuclear: frame.accentNuclear })
    recordFrame(track, shown.length - 1, frame)
  }
  track.count = Math.min(track.count, shown.length)
  while (s < steps.length) deliver(steps[s++]!)

  // Reescrita visível: a linha do tempo final nos mesmos instantes.
  let maxJawDelta = 0
  let framesOver = 0
  for (const point of shown) {
    engine.sample(point.t, frame)
    const delta = Math.abs(frame.mouth.jaw - point.jaw)
    if (delta > maxJawDelta) maxJawDelta = delta
    if (delta > 0.05) framesOver++
  }

  // Envelope de referência (banda de vogais, linear), de um extrator próprio.
  const extractor = new AudioFeatureExtractor()
  for (const step of schedule.steps) if (step.kind === "audio") extractor.push(step.chunk.pcm, step.chunk.startAt, step.chunk.sampleRate)
  extractor.flush()
  const store = extractor.store
  // Sem áudio não há envelope de referência: o índice seria −1 e a correlação viraria NaN sem aviso.
  if (store.count === 0) throw new Error("measureDynamics: o roteiro não tem áudio — não há envelope para comparar a boca.")
  const envelopeAt = (t: number) => Math.pow(10, store.vowelBandDb[Math.min(store.count - 1, store.lowerBound(t))]! / 20)
  const speech = shown.filter((p) => p.t >= schedule.speechStart && p.t <= schedule.speechEnd)
  const jaw = speech.map((p) => p.jaw)
  let bestMs = 0
  let bestR = -1
  const byLag: Array<{ lagMs: number; r: number }> = []
  for (let lagMs = -150; lagMs <= 150; lagMs += 5) {
    const r = pearson(jaw, speech.map((p) => envelopeAt(p.t + lagMs / 1000)))
    byLag.push({ lagMs, r })
    if (r > bestR) {
      bestR = r
      bestMs = lagMs
    }
  }

  const speechSeconds = schedule.speechEnd - schedule.speechStart
  const phones = engine.debugSnapshot().phones
  const nuclei = phones.filter((p) => p.nucleus && PHONES[p.phone].class === "vowel")

  // Modulação silábica (o que foi mostrado; a amostra em t já leva a antecipação da boca).
  let peaks = 0
  const peakDepths: number[] = []
  let lastTrough = jaw[0] ?? 0
  for (let i = 1; i < jaw.length - 1; i++) {
    if (jaw[i]! < jaw[i - 1]! && jaw[i]! <= jaw[i + 1]!) lastTrough = jaw[i]!
    if (jaw[i]! > jaw[i - 1]! && jaw[i]! >= jaw[i + 1]! && jaw[i]! > 0.08) {
      peaks++
      peakDepths.push(jaw[i]! - lastTrough)
    }
  }
  peakDepths.sort((a, b) => a - b)
  const anticipation = options.anticipationSeconds ?? 0.02
  const shownAt = (t: number) => Math.round((t - anticipation - schedule.audioStart) / DYNAMICS_STEP_SECONDS)
  const depths: number[] = []
  const idealDepths: number[] = []
  for (let k = 1; k < nuclei.length; k++) {
    const previous = nuclei[k - 1]!
    const nucleus = nuclei[k]!
    let idealValley = Math.min(jawTargetOf(previous), jawTargetOf(nucleus))
    for (const phone of phones) if (phone.start >= previous.end && phone.end <= nucleus.start) idealValley = Math.min(idealValley, jawTargetOf(phone))
    idealDepths.push(jawTargetOf(nucleus) - idealValley)
    let peak = 0
    for (let i = Math.max(0, shownAt(nucleus.start)); i <= shownAt(nucleus.end) && i < shown.length; i++) peak = Math.max(peak, shown[i]!.jaw)
    let valley = Number.POSITIVE_INFINITY
    for (let i = Math.max(0, shownAt(center(previous))); i <= shownAt(center(nucleus)) && i < shown.length; i++) valley = Math.min(valley, shown[i]!.jaw)
    if (Number.isFinite(valley)) depths.push(Math.max(0, peak - valley))
  }
  depths.sort((a, b) => a - b)
  idealDepths.sort((a, b) => a - b)

  // Velocidade e saltos (20 ms ≈ 1 quadro a 50–60 Hz).
  let maxVelocity = 0
  for (let i = 1; i < shown.length; i++) maxVelocity = Math.max(maxVelocity, Math.abs(shown[i]!.jaw - shown[i - 1]!.jaw) / DYNAMICS_STEP_SECONDS)
  let pops = 0
  let maxStep20ms = 0
  const hop = Math.round(0.02 / DYNAMICS_STEP_SECONDS)
  for (let i = hop; i < shown.length; i++) maxStep20ms = Math.max(maxStep20ms, Math.abs(shown[i]!.jaw - shown[i - hop]!.jaw))
  for (let i = hop; i < shown.length; i += hop) if (Math.abs(shown[i]!.jaw - shown[i - hop]!.jaw) > 0.2) pops++

  // Selo bilabial.
  const bilabials = phones.filter((p) => p.source === "aligned" && isBilabial(p.phone))
  let sealed = 0
  const sealMs: number[] = []
  for (const phone of bilabials) {
    let maxLip = 0
    let duration = 0
    for (const point of shown) {
      if (point.t < phone.start - 0.03 || point.t > phone.end + 0.03) continue
      maxLip = Math.max(maxLip, point.lip)
      if (point.lip >= 0.8) duration += DYNAMICS_STEP_SECONDS
    }
    if (maxLip >= 0.9) sealed++
    sealMs.push(duration * 1000)
  }
  sealMs.sort((a, b) => a - b)

  const speaking = speech.filter((p) => p.speaking)
  const meanSpeaking = speaking.reduce((acc, p) => acc + p.jaw, 0) / Math.max(1, speaking.length)
  const nearlyClosedRatio = speaking.filter((p) => p.jaw < 0.05).length / Math.max(1, speaking.length)

  // Pulsos de ênfase, com o tipo do acento no pico.
  const accents: AccentPeak[] = []
  for (let i = 1; i < speech.length - 1; i++) {
    const point = speech[i]!
    if (point.emphasis > speech[i - 1]!.emphasis && point.emphasis >= speech[i + 1]!.emphasis && point.emphasis > 0.3) {
      accents.push({ t: point.t, shape: accentShapeOf(point.accentDirection), direction: point.accentDirection, nuclear: point.accentNuclear, pulse: point.emphasis })
    }
  }
  const pulses = accents.length
  const byShape: Record<AccentShape, number> = { rise: 0, fall: 0, peak: 0 }
  for (const accent of accents) byShape[accent.shape] += 1 / speechSeconds
  const nuclear = accents.filter((accent) => accent.nuclear)
  const words = spokenWordCount(schedule.fixture.id, schedule.fixture.transcript)

  // Contraste por classe, no centro do fone (sample() já soma a antecipação: desconta).
  const contrast: ContrastAccumulator = Object.fromEntries(Object.keys(CONTRAST_GROUPS).map((group) => [group, []]))
  const unroundedRounding: number[] = []
  // Fronteiras de frase: pausas longas o bastante (as do acento nuclear) depois do começo da fala.
  const boundaries: number[] = []
  for (const phone of phones) {
    if (phone.phone === "_" && phone.end - phone.start >= PHRASE_BOUNDARY_SECONDS && phone.start > schedule.speechStart + 0.2 && phone.start < schedule.speechEnd - 0.05) boundaries.push(phone.start)
  }
  boundaries.push(schedule.speechEnd)

  for (const phone of phones) {
    const group = groupOf(phone.phone)
    const unrounded = UNROUNDED_VOWELS.includes(phone.phone)
    if (!group && !unrounded) continue
    engine.sample(center(phone) - anticipation, frame)
    const rounding = Math.max(frame.mouth.round, frame.mouth.pucker)
    if (group) contrast[group]!.push({ jaw: frame.mouth.jaw, target: ARTICULATION[phone.phone].target.jaw ?? 0, rounding, durationMs: (phone.end - phone.start) * 1000 })
    if (unrounded) unroundedRounding.push(rounding)
  }

  return {
    id: schedule.fixture.id,
    speechSeconds,
    syllablesPerSecond: nuclei.length / speechSeconds,
    lag: { bestMs, r: bestR, byLag },
    jaw: {
      meanSpeaking,
      nearlyClosedRatio,
      peaksPerSecond: peaks / speechSeconds,
      depthP50: percentile(depths, 0.5),
      depthP10: percentile(depths, 0.1),
      idealDepthP50: percentile(idealDepths, 0.5),
      peakDepthP50: percentile(peakDepths, 0.5),
    },
    velocity: { max: maxVelocity, maxStep20ms, pops },
    bilabials: { total: bilabials.length, sealed, sealMsP10: percentile(sealMs, 0.1), sealMsP50: percentile(sealMs, 0.5) },
    rewrite: { maxJawDelta, framesOver, audioOnlyFrames: shown.filter((p) => p.source === "audio-only").length },
    emphasis: { pulsesPerSecond: pulses / speechSeconds, wordsPerSecond: words / speechSeconds, byShape, nuclear: nuclear.length, nuclearFalls: nuclear.filter((accent) => accent.shape === "fall").length },
    accents,
    boundaries,
    track,
    contrast,
    unroundedRounding,
  }
}

// ---------------------------------------------------------------------------
// Comportamento: cabeça/sobrancelha por tipo de acento e piscada × fim de frase
// ---------------------------------------------------------------------------

/** Janela "no fim da frase" para a piscada: de antes da pausa (pós-tônica do nuclear) ao começo dela. */
export const BLINK_BOUNDARY_BEFORE_SECONDS = 0.3
export const BLINK_BOUNDARY_AFTER_SECONDS = 0.4
const BEHAVIOR_FPS = 60
const LEAD_IN_SECONDS = 1.5
/**
 * A taxa de piscadas é medida no turno + isto depois dele: a atração pelo fim de frase só ADIANTA
 * piscadas (no máx. `PULL_HORIZON_SECONDS`), então medir só "falando" contaria como piscada a mais a
 * que só veio antes — com falas de 4 s isso inflava a taxa em ~25%.
 */
export const BLINK_RATE_TAIL_SECONDS = PULL_HORIZON_SECONDS
const TAIL_SECONDS = BLINK_RATE_TAIL_SECONDS + 0.5

export type BehaviorOptions = { seeds?: number; prosodicBlinks?: boolean }

export type AccentResponseStats = { n: number; headDeg: number; brow: number }

export type BehaviorMetrics = {
  seeds: number
  speakingSeconds: number
  /**
   * Resposta média por tipo: cabeça (graus, + = para baixo; extremo até 0,35 s depois do pico menos o
   * nível de 0,25–0,1 s antes) e sobrancelha (pico − antes). "nuclear" = nuclear NÃO ascendente.
   */
  response: Record<AccentShape | "nuclear", AccentResponseStats>
  blinks: {
    count: number
    /** No turno + `BLINK_RATE_TAIL_SECONDS` (ver acima). */
    perMinute: number
    /** Só durante a fala (informativo: inclui as piscadas adiantadas do pós-turno). */
    perMinuteSpeaking: number
    /** Fração das piscadas (falando) que começam na janela de fim de frase. */
    nearBoundary: number
    /** O que daria o acaso: fração do tempo de fala coberta pelas janelas. */
    chance: number
    /** Mediana de (início da piscada − fronteira mais próxima), s. */
    medianOffset: number
    /** Piscadas que começam com um acento forte pulsando (olho fechado no meio da ênfase). */
    duringAccent: number
  }
}

/** Toca a trilha mostrada no `BehaviorController` (várias sementes) e mede a resposta. */
export function measureBehavior(metrics: readonly DynamicsMetrics[], options: BehaviorOptions = {}): BehaviorMetrics {
  const seeds = options.seeds ?? 40
  const sums: Record<AccentShape | "nuclear", { n: number; head: number; brow: number }> = {
    rise: { n: 0, head: 0, brow: 0 },
    fall: { n: 0, head: 0, brow: 0 },
    peak: { n: 0, head: 0, brow: 0 },
    nuclear: { n: 0, head: 0, brow: 0 },
  }
  let speakingSeconds = 0
  let rateSeconds = 0
  let rateCount = 0
  let blinkCount = 0
  let near = 0
  let duringAccent = 0
  let windowSeconds = 0
  const offsets: number[] = []
  const dt = 1 / BEHAVIOR_FPS
  for (const m of metrics) {
    const track = m.track
    const firstSpeaking = firstIndex(track.speaking)
    if (firstSpeaking < 0) continue
    // Período "falando": da primeira fala ouvida até a janela de fim de frase da última.
    const from = track.start + firstSpeaking * track.step
    const to = track.start + lastIndex(track.speaking) * track.step + BLINK_BOUNDARY_AFTER_SECONDS
    windowSeconds += seeds * coverage(m.boundaries, from, to)
    for (let seed = 1; seed <= seeds; seed++) {
      const controller = new BehaviorController({ seed: seed * 7919 + m.id.length, prosodicBlinks: options.prosodicBlinks })
      controller.debug.blink.recordHistory = true
      const driver = new TrackDriver(track)
      const t0 = track.start - LEAD_IN_SECONDS
      const frames = Math.round((track.count * track.step + LEAD_IN_SECONDS + TAIL_SECONDS) / dt)
      const head = new Float64Array(frames)
      const brow = new Float64Array(frames)
      const blinkClock: number[] = []
      for (let f = 0; f < frames; f++) {
        const t = t0 + f * dt
        driver.time = t
        driver.state = t < track.start ? "thinking" : t <= track.start + track.count * track.step ? "speaking" : "idle"
        const before = controller.debug.blink.history.length
        const frame = controller.update(driver, dt, t * 1000)
        if (controller.debug.blink.history.length > before) blinkClock.push(t)
        head[f] = (frame.bones.Head.x + frame.bones.Neck.x) / (Math.PI / 180)
        brow[f] = ((frame.blendshapes.browOuterUpLeft ?? 0) + (frame.blendshapes.browOuterUpRight ?? 0)) / 2
      }
      const indexOf = (t: number) => Math.max(0, Math.min(frames - 1, Math.round((t - t0) / dt)))
      for (const accent of m.accents) {
        const baseFrom = indexOf(accent.t - 0.25)
        const baseTo = indexOf(accent.t - 0.1)
        let headBase = 0
        let browBase = 0
        for (let f = baseFrom; f <= baseTo; f++) {
          headBase += head[f]!
          browBase += brow[f]!
        }
        headBase /= baseTo - baseFrom + 1
        browBase /= baseTo - baseFrom + 1
        let headExtreme = 0
        let browPeak = 0
        for (let f = indexOf(accent.t - 0.05); f <= indexOf(accent.t + 0.35); f++) {
          const delta = head[f]! - headBase
          if (Math.abs(delta) > Math.abs(headExtreme)) headExtreme = delta
          browPeak = Math.max(browPeak, brow[f]! - browBase)
        }
        // "nuclear" = o nuclear que acena para baixo (não ascendente); o ascendente fica em "subida".
        for (const key of accent.nuclear && accent.shape !== "rise" ? [accent.shape, "nuclear" as const] : [accent.shape]) {
          sums[key].n++
          sums[key].head += headExtreme
          sums[key].brow += browPeak
        }
      }
      speakingSeconds += to - from
      const rateTo = track.start + lastIndex(track.speaking) * track.step + BLINK_RATE_TAIL_SECONDS
      rateSeconds += rateTo - from
      for (const at of blinkClock) if (at >= from && at <= rateTo) rateCount++
      for (const at of blinkClock) {
        if (at < from || at > to) continue
        blinkCount++
        const nearest = nearestBoundary(m.boundaries, at)
        offsets.push(at - nearest)
        if (at >= nearest - BLINK_BOUNDARY_BEFORE_SECONDS && at <= nearest + BLINK_BOUNDARY_AFTER_SECONDS) near++
        const index = Math.round((at - track.start) / track.step)
        if (index >= 0 && index < track.count && track.emphasis[index]! > 0.5) duringAccent++
      }
    }
  }
  offsets.sort((a, b) => a - b)
  const stats = (key: AccentShape | "nuclear"): AccentResponseStats => ({ n: sums[key].n / seeds, headDeg: sums[key].head / Math.max(1, sums[key].n), brow: sums[key].brow / Math.max(1, sums[key].n) })
  return {
    seeds,
    speakingSeconds: speakingSeconds / seeds,
    response: { rise: stats("rise"), fall: stats("fall"), peak: stats("peak"), nuclear: stats("nuclear") },
    blinks: {
      count: blinkCount / seeds,
      perMinute: (60 * rateCount) / Math.max(1e-9, rateSeconds),
      perMinuteSpeaking: (60 * blinkCount) / Math.max(1e-9, speakingSeconds),
      nearBoundary: near / Math.max(1, blinkCount),
      chance: windowSeconds / Math.max(1e-9, speakingSeconds),
      medianOffset: percentile(offsets, 0.5),
      duringAccent: duringAccent / Math.max(1, blinkCount),
    },
  }
}

/** Driver que entrega a trilha gravada no instante pedido (relógio do contexto = `time`). */
class TrackDriver implements AvatarDriver {
  state: AvatarConversationState = "thinking"
  readonly tuning = { ...DEFAULT_AVATAR_TUNING }
  time = 0
  constructor(private readonly track: SpeechTrack) {}

  sampleSpeech(out: SpeechFrame): void {
    const track = this.track
    const index = Math.round((this.time - track.start) / track.step)
    if (index < 0 || index >= track.count) {
      out.speaking = false
      for (const key of MOUTH_CHANNEL_KEYS) out.mouth[key] = 0
      out.energy = 0
      out.emphasis = 0
      out.accentDirection = 0
      out.accentNuclear = false
      out.phraseTime = 0
      out.question = false
      return
    }
    out.speaking = track.speaking[index] === 1
    out.energy = track.energy[index]!
    out.emphasis = track.emphasis[index]!
    out.accentDirection = track.accentDirection[index]!
    out.accentNuclear = track.accentNuclear[index] === 1
    out.phraseTime = track.phraseTime[index]!
    out.question = track.question[index] === 1
    for (let c = 0; c < MOUTH_CHANNEL_KEYS.length; c++) out.mouth[MOUTH_CHANNEL_KEYS[c]!] = track.mouth[index * MOUTH_CHANNEL_KEYS.length + c]!
  }

  drainCues(): ConversationCue[] {
    return []
  }
}

function createTrack(start: number, count: number): SpeechTrack {
  return {
    start,
    step: DYNAMICS_STEP_SECONDS,
    count,
    speaking: new Uint8Array(count),
    energy: new Float32Array(count),
    emphasis: new Float32Array(count),
    accentDirection: new Float32Array(count),
    accentNuclear: new Uint8Array(count),
    phraseTime: new Float32Array(count),
    question: new Uint8Array(count),
    mouth: new Float32Array(count * MOUTH_CHANNEL_KEYS.length),
  }
}

function recordFrame(track: SpeechTrack, index: number, frame: SpeechFrame): void {
  if (index >= track.count) return
  track.speaking[index] = frame.speaking ? 1 : 0
  track.energy[index] = frame.energy
  track.emphasis[index] = frame.emphasis
  track.accentDirection[index] = frame.accentDirection
  track.accentNuclear[index] = frame.accentNuclear ? 1 : 0
  track.phraseTime[index] = frame.phraseTime
  track.question[index] = frame.question ? 1 : 0
  for (let c = 0; c < MOUTH_CHANNEL_KEYS.length; c++) track.mouth[index * MOUTH_CHANNEL_KEYS.length + c] = frame.mouth[MOUTH_CHANNEL_KEYS[c]!]
}

function firstIndex(values: Uint8Array): number {
  for (let i = 0; i < values.length; i++) if (values[i] === 1) return i
  return -1
}

function lastIndex(values: Uint8Array): number {
  for (let i = values.length - 1; i >= 0; i--) if (values[i] === 1) return i
  return -1
}

function nearestBoundary(boundaries: readonly number[], t: number): number {
  let best = boundaries[0]!
  for (const boundary of boundaries) if (Math.abs(boundary - t) < Math.abs(best - t)) best = boundary
  return best
}

/** Segundos de [from, to] cobertos pelas janelas de fim de frase (união). */
function coverage(boundaries: readonly number[], from: number, to: number): number {
  let covered = 0
  let cursor = from
  for (const boundary of [...boundaries].sort((a, b) => a - b)) {
    const start = Math.max(cursor, boundary - BLINK_BOUNDARY_BEFORE_SECONDS, from)
    const end = Math.min(to, boundary + BLINK_BOUNDARY_AFTER_SECONDS)
    if (end > start) {
      covered += end - start
      cursor = end
    }
  }
  return covered
}

// ---------------------------------------------------------------------------
// Fala sem texto: a boca só-áudio × a boca com o texto
// ---------------------------------------------------------------------------

/**
 * A mesma captura com a transcrição COMPLETA no lugar da que veio (só para as `*-texto-incompleto`):
 * o texto do pedido ("Diga exatamente: …", que a referência do Whisper confirma ter sido dito inteiro),
 * entregue de uma vez no instante do primeiro fragmento. É a referência do que a boca e a ênfase
 * deveriam ser naquele áudio; `null` se a captura não é desse tipo.
 */
export function withCompleteTranscript(schedule: ReplaySchedule): ReplaySchedule | null {
  const text = /"(.+)"/.exec(schedule.fixture.prompt)?.[1]
  if (!schedule.fixture.id.endsWith("-texto-incompleto") || !text) return null
  const first = schedule.steps.findIndex((step) => step.kind === "transcript")
  const steps = schedule.steps
    .filter((step, index) => step.kind !== "transcript" || index === first)
    .map((step) => (step.kind === "transcript" ? { ...step, fragment: { ...step.fragment, text } } : step))
  return { ...schedule, fixture: { ...schedule.fixture, transcript: text }, steps }
}

export type AudioOnlyComparison = { id: string; textJaw: number; audioOnlyJaw: number; r: number; meanAbsError: number; pops: number }

/**
 * Captura com transcrição completa lida duas vezes — com o texto e SEM texto nenhum — e as duas bocas
 * finais comparadas durante a fala (média, correlação, erro médio), mais os trancos do que seria
 * mostrado ao vivo sem texto. É a régua da boca só-áudio (texto atrasado, faltando ou incompleto).
 */
export function measureAudioOnlyMouth(schedule: ReplaySchedule): AudioOnlyComparison {
  const finalJaw = (steps: ReplaySchedule["steps"]) => {
    const metrics = measureDynamics({ ...schedule, steps })
    const engine = createSpeechLipsyncEngine()
    const frame = createSpeechFrame()
    const turnId = steps.find((step) => step.kind === "audio")?.kind === "audio" ? (steps.find((step) => step.kind === "audio") as Extract<(typeof steps)[number], { kind: "audio" }>).chunk.turnId : 1
    engine.beginTurn(turnId)
    let ended = false
    for (const step of steps) {
      if (step.kind === "audio") engine.pushAudio(step.chunk)
      else if (step.kind === "transcript") engine.pushTranscript(step.fragment)
      else if (!ended) {
        ended = true
        engine.endOfText(turnId)
      }
    }
    const jaw: number[] = []
    for (let t = schedule.speechStart; t <= schedule.speechEnd; t += DYNAMICS_STEP_SECONDS) {
      engine.sample(t, frame)
      jaw.push(frame.mouth.jaw)
    }
    return { jaw, pops: metrics.velocity.pops }
  }
  const text = finalJaw(schedule.steps)
  const audioOnly = finalJaw(schedule.steps.filter((step) => step.kind !== "transcript"))
  const n = Math.min(text.jaw.length, audioOnly.jaw.length)
  let error = 0
  for (let i = 0; i < n; i++) error += Math.abs(text.jaw[i]! - audioOnly.jaw[i]!)
  return { id: schedule.fixture.id, textJaw: mean(text.jaw), audioOnlyJaw: mean(audioOnly.jaw), r: pearson(text.jaw, audioOnly.jaw), meanAbsError: error / Math.max(1, n), pops: audioOnly.pops }
}

/** Junta o contraste de várias capturas: média da mandíbula mostrada × média do alvo, por grupo. */
export function summarizeContrast(all: readonly DynamicsMetrics[]): Array<{ group: string; n: number; jaw: number; target: number; ratio: number; rounding: number; durationMs: number }> {
  return Object.keys(CONTRAST_GROUPS).map((group) => {
    const samples = all.flatMap((m) => m.contrast[group]!)
    const jaw = mean(samples.map((x) => x.jaw))
    const target = mean(samples.map((x) => x.target))
    return { group, n: samples.length, jaw, target, ratio: target > 0 ? jaw / target : Number.NaN, rounding: mean(samples.map((x) => x.rounding)), durationMs: mean(samples.map((x) => x.durationMs)) }
  })
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((a, b) => a + b, 0) / values.length
}

export function percentile(sorted: readonly number[], q: number): number {
  return sorted.length === 0 ? Number.NaN : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
}

/** Alvo de mandíbula que a linha do tempo usa para o fone (vogal escala com loudness/tônica). */
let referenceWords: ReturnType<typeof loadReferenceWords> | null = null

/**
 * Palavras FALADAS na captura (denominador do "bem abaixo das palavras/s"): o texto normalizado pelo
 * G2P — "2026" são cinco palavras ditas, não uma — ou, se a transcrição do Live veio incompleta, o da
 * referência independente (Whisper), que ouviu a fala toda. Vale o maior: o Whisper escreve números
 * em algarismos e pontuação ("2026 .09 .25"), que o G2P não reconstrói inteiros.
 */
export function spokenWordCount(id: string, transcript: string): number {
  referenceWords ??= loadReferenceWords()
  const count = (text: string) => {
    const phonemizer = createTranscriptPhonemizer()
    return [...phonemizer.push(text), ...phonemizer.flush()].reduce((acc, word) => acc + word.spoken.split(/\s+/).filter(Boolean).length, 0)
  }
  const reference = referenceWords[id]
  return Math.max(count(transcript), reference ? count(reference.map((word) => word.word).join(" ")) : 0)
}

function jawTargetOf(phone: AlignedPhone): number {
  // Fone só-áudio: o alvo é o estimado pelo áudio (é a meta que a linha do tempo persegue).
  let target = phone.jawTarget ?? ARTICULATION[phone.phone].target.jaw ?? 0
  const phoneClass = PHONES[phone.phone].class
  if (phoneClass === "vowel" || phoneClass === "glide") {
    target *= DEFAULT_LOUDNESS_BASE + DEFAULT_LOUDNESS_GAIN * Math.max(0, Math.min(1, phone.loudness))
    if (phone.stressed && phone.nucleus) target *= DEFAULT_STRESS_GAIN
  }
  return Math.min(MAX_JAW, target)
}

function groupOf(phone: PhoneSymbol): string | undefined {
  return Object.keys(CONTRAST_GROUPS).find((group) => CONTRAST_GROUPS[group]!.includes(phone))
}

function center(phone: AlignedPhone): number {
  return (phone.start + phone.end) / 2
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  let ma = 0
  let mb = 0
  for (let i = 0; i < n; i++) {
    ma += a[i]!
    mb += b[i]!
  }
  ma /= n
  mb /= n
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]! - ma
    const y = b[i]! - mb
    num += x * y
    da += x * x
    db += y * y
  }
  return num / Math.sqrt(da * db + 1e-12)
}
