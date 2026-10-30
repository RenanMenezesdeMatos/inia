import type { FeatureFrameStore } from "./audio-features"

/**
 * Prosódia do turno a partir do F0 do extrator (`FeatureFrameStore.f0Hz`), em streaming: cada quadro
 * vira semitons, a mediana da voz do turno sai de um histograma, e quadros a mais de
 * `MAX_DEVIATION_SEMITONES` dela são descartados (voz crepitante no fim de frase, erro de oitava).
 *
 * Acento de FRASE ≠ sílaba tônica: toda palavra tem tônica (≈ 2–3/s na voz do Live), mas só uma
 * parte delas carrega um acento tonal (≈ 1 por sintagma). É o acento que um falante marca com
 * aceno de cabeça/sobrancelha — acenar em toda tônica parece um "sim" contínuo (avaliação de
 * 2026-10-07: 1,5–2,8 pulsos/s). A proeminência de uma tônica é a excursão de F0 em torno dela
 * (subida OU queda — o acento nuclear do PT-BR declarativo é uma queda) contra a mediana local.
 *
 * DIREÇÃO do acento (`direction`, −1..+1): para onde o F0 vai a partir do ataque da tônica até a
 * pós-tônica, sobre a faixa percorrida. Nas capturas do Live o acento descendente (H+L*: alto no
 * ataque, cai na tônica — o nuclear declarativo e boa parte dos pré-nucleares desta voz) é o mais
 * comum; a subida (L+H* ou L*+H) aparece nas continuações ("vendas,", "Amanhã,") e na pergunta
 * sim/não ("juntos?"); o pico (sobe e desce dentro da janela, ou nível alto sem direção) fica perto
 * de 0. A cabeça/sobrancelha/piscada usam isso para não tratar todo acento igual.
 */

/** Referência dos semitons (Hz). */
const SEMITONE_REFERENCE_HZ = 50
const HISTOGRAM_BINS_PER_SEMITONE = 2
const HISTOGRAM_SEMITONES = 48
/** Antes de tantos quadros vozeados, a mediana é a priori (voz feminina do Live, ≈ 220 Hz). */
const MIN_REFERENCE_FRAMES = 30
const PRIOR_REFERENCE_SEMITONES = 12 * Math.log2(220 / SEMITONE_REFERENCE_HZ)
export const MAX_DEVIATION_SEMITONES = 10
/** Janela da excursão em torno da tônica (o pico do acento ascendente cai na pós-tônica). */
const PROMINENCE_BEFORE_SECONDS = 0.08
const PROMINENCE_AFTER_SECONDS = 0.12
/** Janela da mediana local (declinação da frase não vira proeminência). */
const BASELINE_HALF_WINDOW_SECONDS = 0.6
export const MAX_PROMINENCE_SEMITONES = 12
/** Até onde a proeminência de um fone depende de áudio à frente dele (para saber quando é definitiva). */
export const PROMINENCE_LOOKAHEAD_SECONDS = BASELINE_HALF_WINDOW_SECONDS
/**
 * Janela da direção: do pouco antes do ataque (o H de H+L* fica na pretônica) até a pós-tônica (o
 * pico de L+H* ou L*+H cai depois da vogal). Cabe no `PROMINENCE_LOOKAHEAD_SECONDS`: a direção fica
 * definitiva junto com a proeminência.
 */
const DIRECTION_BEFORE_SECONDS = 0.06
const DIRECTION_AFTER_SECONDS = 0.15
/** "Ataque" = quadros vozeados de 60 ms antes a 40 ms depois do início da tônica. */
const DIRECTION_ONSET_AFTER_SECONDS = 0.04
/** Faixa mínima no denominador (semitons): contorno quase plano não vira subida/queda cheia. */
const DIRECTION_MIN_RANGE_SEMITONES = 3
/** |direção| a partir da qual o acento é subida/queda (abaixo: pico/nível). */
export const ACCENT_DIRECTION_THRESHOLD = 0.35

export type AccentShape = "rise" | "fall" | "peak"

/** Classe do acento pela direção do F0 (para métricas e diagnóstico; o comportamento usa o valor contínuo). */
export function accentShapeOf(direction: number): AccentShape {
  if (direction >= ACCENT_DIRECTION_THRESHOLD) return "rise"
  if (direction <= -ACCENT_DIRECTION_THRESHOLD) return "fall"
  return "peak"
}

export class ProsodyTracker {
  /** Semitons por quadro (NaN = sem F0 confiável). */
  private semitones = new Float32Array(1024)
  private count = 0
  private readonly histogram = new Uint32Array(HISTOGRAM_SEMITONES * HISTOGRAM_BINS_PER_SEMITONE)
  private histogramTotal = 0
  private readonly scratch = new Float64Array(512)
  private readonly times = new Float64Array(512)
  private readonly onset = new Float64Array(16)

  constructor(private readonly store: FeatureFrameStore) {}

  reset(): void {
    this.count = 0
    this.histogram.fill(0)
    this.histogramTotal = 0
  }

  /** Processa os quadros novos do extrator. */
  update(): void {
    const store = this.store
    if (store.count < this.count) this.count = store.count
    if (this.semitones.length < store.count) {
      const grown = new Float32Array(Math.max(store.count, this.semitones.length * 2))
      grown.set(this.semitones.subarray(0, this.count))
      this.semitones = grown
    }
    for (let i = this.count; i < store.count; i++) {
      const hz = store.f0Hz[i]!
      if (hz > 0) {
        const value = 12 * Math.log2(hz / SEMITONE_REFERENCE_HZ)
        this.semitones[i] = value
        const bin = Math.floor(value * HISTOGRAM_BINS_PER_SEMITONE)
        if (bin >= 0 && bin < this.histogram.length) {
          this.histogram[bin]!++
          this.histogramTotal++
        }
      } else this.semitones[i] = Number.NaN
    }
    this.count = store.count
  }

  /** Mediana da voz no turno (semitons sobre 50 Hz). */
  get reference(): number {
    if (this.histogramTotal < MIN_REFERENCE_FRAMES) return PRIOR_REFERENCE_SEMITONES
    const half = this.histogramTotal / 2
    let acc = 0
    for (let bin = 0; bin < this.histogram.length; bin++) {
      acc += this.histogram[bin]!
      if (acc >= half) return (bin + 0.5) / HISTOGRAM_BINS_PER_SEMITONE
    }
    return PRIOR_REFERENCE_SEMITONES
  }

  /** Semitons no quadro `index` relativos à mediana da voz (NaN fora da faixa confiável). */
  relativeAt(index: number): number {
    if (index < 0 || index >= this.count) return Number.NaN
    const value = this.semitones[index]! - this.reference
    return Math.abs(value) <= MAX_DEVIATION_SEMITONES ? value : Number.NaN
  }

  /**
   * Proeminência tonal (semitons, 0..`MAX_PROMINENCE_SEMITONES`) da sílaba em [start, end]: a maior
   * entre subida do p90 e queda do p10 contra a mediana local (±0,6 s), ou 0,8 × a faixa p10–p90.
   * 0 sem F0 suficiente.
   */
  prominence(start: number, end: number): number {
    const store = this.store
    const reference = this.reference
    const scratch = this.scratch
    let n = 0
    for (let f = store.lowerBound(start - PROMINENCE_BEFORE_SECONDS); f < this.count && store.time[f]! <= end + PROMINENCE_AFTER_SECONDS && n < scratch.length; f++) {
      const value = this.semitones[f]! - reference
      if (Math.abs(value) <= MAX_DEVIATION_SEMITONES) scratch[n++] = value
    }
    if (n < 3) return 0
    const local = scratch.subarray(0, n).sort()
    const high = local[Math.min(n - 1, Math.floor(n * 0.9))]!
    const low = local[Math.floor(n * 0.1)]!
    let m = 0
    for (let f = store.lowerBound(start - BASELINE_HALF_WINDOW_SECONDS); f < this.count && store.time[f]! <= end + BASELINE_HALF_WINDOW_SECONDS && n + m < scratch.length; f++) {
      const value = this.semitones[f]! - reference
      if (Math.abs(value) <= MAX_DEVIATION_SEMITONES) scratch[n + m++] = value
    }
    if (m < 5) return 0
    const around = scratch.subarray(n, n + m).sort()
    const median = around[Math.floor(m / 2)]!
    const excursion = Math.max(high - median, median - low, 0.8 * (high - low))
    return Math.min(MAX_PROMINENCE_SEMITONES, Math.max(0, excursion))
  }

  /**
   * Direção do F0 do acento cuja tônica ocupa [start, end]: −1 = queda … +1 = subida, ~0 = pico
   * (sobe e volta) ou nível; 0 sem F0 suficiente. = (F0 no fim da janela − F0 no ataque) ÷ faixa
   * percorrida na janela (mínimo `DIRECTION_MIN_RANGE_SEMITONES`), com o contorno suavizado por
   * mediana de 3 quadros (um quadro de oitava/crepitância não decide nada). Não aloca.
   */
  direction(start: number, end: number): number {
    const store = this.store
    const reference = this.reference
    const raw = this.scratch
    const times = this.times
    const from = start - DIRECTION_BEFORE_SECONDS
    const to = end + DIRECTION_AFTER_SECONDS
    let n = 0
    // Um quadro de folga de cada lado para a mediana das bordas.
    for (let f = Math.max(0, store.lowerBound(from) - 1); f < this.count && n < raw.length; f++) {
      const value = this.semitones[f]! - reference
      raw[n] = Math.abs(value) <= MAX_DEVIATION_SEMITONES ? value : Number.NaN
      times[n] = store.time[f]!
      n++
      if (store.time[f]! > to) break
    }
    const onset = this.onset
    let onsetCount = 0
    let points = 0
    let max = Number.NEGATIVE_INFINITY
    let min = Number.POSITIVE_INFINITY
    // Os três primeiros (ataque sem quadro vozeado: a consoante inicial) e os três últimos pontos.
    let first0 = 0
    let first1 = 0
    let first2 = 0
    let last0 = 0
    let last1 = 0
    let last2 = 0
    for (let k = 1; k < n - 1; k++) {
      const t = times[k]!
      const center = raw[k]!
      // Quadro vozeado isolado (vizinhos sem F0) não conta: costuma ser ruído na borda da consoante.
      if (t < from || t > to || Number.isNaN(center) || (Number.isNaN(raw[k - 1]) && Number.isNaN(raw[k + 1]))) continue
      const value = median3(raw[k - 1]!, center, raw[k + 1]!)
      if (value > max) max = value
      if (value < min) min = value
      if (points === 0) first0 = value
      else if (points === 1) first1 = value
      else if (points === 2) first2 = value
      last0 = last1
      last1 = last2
      last2 = value
      points++
      if (t <= start + DIRECTION_ONSET_AFTER_SECONDS && onsetCount < onset.length) onset[onsetCount++] = value
    }
    if (points < 4) return 0
    const attack = onsetCount >= 2 ? medianInPlace(onset, onsetCount) : median3(first0, first1, first2)
    const late = median3(last0, last1, last2)
    const range = Math.max(DIRECTION_MIN_RANGE_SEMITONES, max - min)
    return Math.max(-1, Math.min(1, (late - attack) / range))
  }
}

/** Mediana de 3 ignorando NaN (o do meio e ao menos um vizinho são válidos aqui). */
function median3(a: number, b: number, c: number): number {
  const aOk = !Number.isNaN(a)
  const cOk = !Number.isNaN(c)
  if (aOk && cOk) return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c))
  if (aOk) return (a + b) / 2
  if (cOk) return (b + c) / 2
  return b
}

/** Mediana dos `count` primeiros valores (ordena no lugar; `count` pequeno). */
function medianInPlace(values: Float64Array, count: number): number {
  for (let i = 1; i < count; i++) {
    const value = values[i]!
    let j = i - 1
    while (j >= 0 && values[j]! > value) {
      values[j + 1] = values[j]!
      j--
    }
    values[j + 1] = value
  }
  return values[count >> 1]!
}
