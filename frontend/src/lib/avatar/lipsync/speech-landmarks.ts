import type { FeatureFrameStore } from "./audio-features"

/**
 * Marcos acústicos da fala, calculados quadro a quadro assim que o chunk CHEGA (bem antes de ser
 * ouvido): nível de fala do turno, piso de silêncio adaptativo, pausas (energia abaixo do piso por
 * ≥ 120 ms) e núcleos silábicos (picos do envelope suavizado da banda de vogais + F2, com
 * proeminência mínima, distância mínima e vozeamento). É o "quando" do alinhador (`aligner.ts`).
 */

/** Raio (quadros de 10 ms) da suavização triangular do envelope de vogais. */
const ENV_RADIUS = 3
const ENV_WEIGHTS = [1, 2, 3, 4, 3, 2, 1].map((w) => w / 16)
/** Proeminência mínima (dB) para o detector de picos com histerese (sobre o sinal de detecção). */
export const PEAK_DELTA_DB = 3.5
/**
 * Peso da banda 1–3 kHz no sinal de detecção de núcleos (dB da banda de vogais + peso × dB de F2):
 * nasais e laterais quase não baixam a banda de vogais, mas afundam 10–20 dB em F2.
 */
const MID_BAND_WEIGHT = 0.5
const MIN_NUCLEUS_GAP_SECONDS = 0.075
export const MIN_PAUSE_SECONDS = 0.12
const DEFAULT_SPEECH_LEVEL_DB = -14
/** Quadros de fala exigidos antes de confiar no percentil do histograma de energia. */
const MIN_LEVEL_FRAMES = 40
export const HOP_SECONDS = 0.01

export type Nucleus = {
  time: number
  frame: number
  /** Envelope suavizado da banda de vogais no pico (dB). */
  envDb: number
  /** Proeminência (dB) = menor das quedas para os vales vizinhos. */
  prominenceDb: number
  voicing: number
}

export type SpeechPause = { start: number; end: number }

export class SpeechLandmarks {
  readonly nuclei: Nucleus[] = []
  readonly pauses: SpeechPause[] = []
  env = new Float32Array(1024)
  envCount = 0
  /** Primeiro/último quadro com fala (centro do quadro), NaN antes de haver fala. */
  firstSpeechTime = Number.NaN
  lastSpeechTime = Number.NaN
  speechLevelDb = DEFAULT_SPEECH_LEVEL_DB
  final = false

  private histogram = new Uint32Array(101)
  private histogramTotal = 0
  private processed = 0
  private silenceRunStart = -1
  private seekingMax = true
  private curMax = -Infinity
  private curMaxFrame = -1
  private curMin = Infinity
  private lastValley = -Infinity
  private lastPeakLeftProminence = 0
  private lastPeakDetect = 0

  constructor(private readonly store: FeatureFrameStore) {}

  /** Piso de silêncio adaptativo: ~30 dB abaixo do nível típico da fala, dentro de [−62, −38] dB. */
  get silenceDb(): number {
    return Math.min(-38, Math.max(-62, this.speechLevelDb - 30))
  }

  /** Até onde os núcleos já são definitivos (um pico ainda sem queda confirmada fica de fora). */
  get nucleusFrontier(): number {
    if (this.envCount === 0) return Number.NEGATIVE_INFINITY
    const envFrontier = this.store.time[this.envCount - 1]!
    if (this.seekingMax && this.curMaxFrame >= 0 && !this.final) return this.store.time[this.curMaxFrame]! - 0.001
    return envFrontier
  }

  /** Início de silêncio ainda aberto na fronteira (fim de fala provável), NaN se falando. */
  get openSilenceStart(): number {
    return this.silenceRunStart >= 0 ? this.store.time[this.silenceRunStart]! - HOP_SECONDS / 2 : Number.NaN
  }

  reset(): void {
    this.nuclei.length = 0
    this.pauses.length = 0
    this.envCount = 0
    this.firstSpeechTime = Number.NaN
    this.lastSpeechTime = Number.NaN
    this.speechLevelDb = DEFAULT_SPEECH_LEVEL_DB
    this.final = false
    this.histogram.fill(0)
    this.histogramTotal = 0
    this.processed = 0
    this.silenceRunStart = -1
    this.seekingMax = true
    this.curMax = -Infinity
    this.curMaxFrame = -1
    this.curMin = Infinity
    this.lastValley = -Infinity
    this.lastPeakLeftProminence = 0
    this.lastPeakDetect = 0
  }

  /** Processa os quadros novos do `store`. `final`: fim do áudio do turno (fecha picos e pausas). */
  update(final = false): boolean {
    const store = this.store
    const before = this.nuclei.length + this.pauses.length * 1000
    if (final) this.final = true
    // 1) Nível, silêncio e pausas: quadro a quadro, sem atraso.
    for (let i = this.processed; i < store.count; i++) {
      const energy = store.energyDb[i]!
      if (energy > -70) {
        const bin = Math.max(0, Math.min(100, Math.round(-energy)))
        this.histogram[bin]!++
        this.histogramTotal++
        if (this.histogramTotal >= MIN_LEVEL_FRAMES && this.histogramTotal % 16 === 0) this.updateLevel()
      }
      const silent = energy < this.silenceDb
      if (silent) {
        if (this.silenceRunStart < 0) this.silenceRunStart = i
      } else {
        if (this.silenceRunStart >= 0) this.closeSilence(i - 1)
        if (Number.isNaN(this.firstSpeechTime)) this.firstSpeechTime = store.time[i]!
        this.lastSpeechTime = store.time[i]!
      }
    }
    this.processed = store.count
    // 2) Envelope suavizado (precisa de ENV_RADIUS quadros à frente) + detector de picos.
    const limit = final ? store.count : store.count - ENV_RADIUS
    for (let i = this.envCount; i < limit; i++) {
      let acc = 0
      let accMid = 0
      let weight = 0
      for (let k = -ENV_RADIUS; k <= ENV_RADIUS; k++) {
        const j = i + k
        if (j < 0 || j >= store.count) continue
        const w = ENV_WEIGHTS[k + ENV_RADIUS]!
        acc += w * Math.pow(10, store.vowelBandDb[j]! / 10)
        accMid += w * Math.pow(10, store.midBandDb[j]! / 10)
        weight += w
      }
      const envDb = 10 * Math.log10(acc / weight + 1e-10)
      const detectDb = envDb + MID_BAND_WEIGHT * 10 * Math.log10(accMid / weight + 1e-10)
      if (this.envCount === this.env.length) {
        const grown = new Float32Array(this.env.length * 2)
        grown.set(this.env)
        this.env = grown
      }
      this.env[this.envCount++] = envDb
      this.detectPeak(i, detectDb, store.energyDb[i]! < this.silenceDb)
    }
    if (final) {
      if (this.seekingMax && this.curMaxFrame >= 0 && this.curMax - this.lastValley >= PEAK_DELTA_DB) this.confirmPeak()
      this.seekingMax = false
      if (this.silenceRunStart >= 0 && this.silenceRunStart > 0) {
        // Silêncio final não vira pausa (é o fim da fala); o alinhador usa `lastSpeechTime`.
      }
    }
    return this.nuclei.length + this.pauses.length * 1000 !== before
  }

  private updateLevel(): void {
    // Percentil 85 da energia dos quadros com som: o "nível de fala" do turno.
    let target = this.histogramTotal * 0.15
    for (let bin = 0; bin <= 100; bin++) {
      target -= this.histogram[bin]!
      if (target <= 0) {
        this.speechLevelDb = Math.max(-40, -bin)
        return
      }
    }
  }

  private closeSilence(lastSilent: number): void {
    const first = this.silenceRunStart
    this.silenceRunStart = -1
    // Silêncio antes da primeira fala é o ataque do turno, não pausa entre unidades.
    if (Number.isNaN(this.firstSpeechTime)) return
    const start = this.store.time[first]! - HOP_SECONDS / 2
    const end = this.store.time[lastSilent]! + HOP_SECONDS / 2
    if (end - start >= MIN_PAUSE_SECONDS) this.pauses.push({ start, end })
  }

  private detectPeak(frame: number, detectDb: number, silent: boolean): void {
    const value = silent ? Math.min(detectDb, (1 + MID_BAND_WEIGHT) * (this.silenceDb - 20)) : detectDb
    if (this.seekingMax) {
      if (value > this.curMax) {
        this.curMax = value
        this.curMaxFrame = frame
      } else if (value < this.curMax - PEAK_DELTA_DB) {
        this.confirmPeak()
        this.seekingMax = false
        this.curMin = value
      }
    } else if (value < this.curMin) {
      this.curMin = value
    } else if (value > this.curMin + PEAK_DELTA_DB) {
      // Vale confirmado: fecha a proeminência à direita do último núcleo.
      const last = this.nuclei[this.nuclei.length - 1]
      if (last) last.prominenceDb = Math.min(this.lastPeakLeftProminence, this.lastPeakDetect - this.curMin)
      this.lastValley = this.curMin
      this.seekingMax = true
      this.curMax = value
      this.curMaxFrame = frame
    }
  }

  private confirmPeak(): void {
    const store = this.store
    const frame = this.curMaxFrame
    const detectDb = this.curMax
    const envDb = this.env[frame]!
    this.curMaxFrame = -1
    if (frame < 0) return
    let voicing = 0
    for (let k = Math.max(0, frame - 2); k <= Math.min(store.count - 1, frame + 2); k++) voicing = Math.max(voicing, store.voicing[k]!)
    const loudEnough = envDb >= this.speechLevelDb - 26 && store.energyDb[frame]! >= this.silenceDb + 8
    if (!loudEnough || voicing < 0.4) return
    const leftProminence = Number.isFinite(this.lastValley) ? detectDb - this.lastValley : 30
    const nucleus: Nucleus = { time: store.time[frame]!, frame, envDb, prominenceDb: Math.min(leftProminence, 30), voicing }
    const last = this.nuclei[this.nuclei.length - 1]
    if (last && nucleus.time - last.time < MIN_NUCLEUS_GAP_SECONDS) {
      if (detectDb <= this.lastPeakDetect) return
      this.nuclei.pop()
    }
    this.lastPeakDetect = detectDb
    this.lastPeakLeftProminence = nucleus.prominenceDb
    this.nuclei.push(nucleus)
  }
}

export function lowerBoundBy(nuclei: readonly Nucleus[], time: number): number {
  let lo = 0
  let hi = nuclei.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (nuclei[mid]!.time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function lowerBoundPauseEnd(pauses: readonly SpeechPause[], time: number): number {
  let lo = 0
  let hi = pauses.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (pauses[mid]!.end < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

