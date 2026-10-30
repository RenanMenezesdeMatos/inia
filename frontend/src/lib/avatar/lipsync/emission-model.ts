import type { FeatureFrameStore } from "./audio-features"
import { EMISSION_TABLE } from "./emission-table"
import type { PhoneSymbol } from "./types"

/**
 * Modelo acústico do alinhador: quanto cada QUADRO de 10 ms "parece" cada classe de fone.
 *
 * Não é um reconhecedor — o texto já diz QUAL fone vem; aqui só importa separar o suficiente para
 * o alinhador achar ONDE cada um está: silêncio × fricção × oclusão × murmúrio nasal × vogal. Seis
 * características por quadro, todas relativas ao nível de fala do turno (a voz do Gemini varia
 * ~10 dB entre frases e respostas):
 *
 * - `eRel`: energia − nível de fala;
 * - `eLoc`: energia − máximo local (±150 ms) — o "vale" de oclusivas e nasais independe do volume da frase;
 * - `mid`: banda 1–3 kHz − banda de vogais (F2): nasais e [b]/[d] afundam aqui;
 * - `low`: energia total − banda de vogais: domina em murmúrio/barra de vozeamento e em fricção;
 * - `high`: razão de energia acima de 4 kHz (fricativas);
 * - `voice`: vozeamento por autocorrelação.
 *
 * Cada classe tem média/desvio por característica (gaussiana diagonal robusta: o custo de uma
 * característica satura em `FEATURE_CAP`, então um quadro esquisito não derruba o alinhamento).
 * Algumas médias são unilaterais: vogal mais forte que o típico não é "pior vogal", silêncio mais
 * silencioso não é "pior pausa". A tabela (`emission-table.ts`) é ajustada À MÃO contra as capturas
 * reais — métricas por indícios do sinal (`scripts/dev/lipsync-metrics.ts`) e erro de início de palavra
 * contra a referência independente (Whisper, `__fixtures__/reference/whisper-words.json`). Não há
 * script de treino; a referência Whisper é o insumo natural para um, se um dia valer a pena.
 */

export const EMISSION_CLASSES = [
  "pause",
  "vowel",
  "glide",
  "nasal",
  "liquid",
  "stopVoiceless",
  "stopVoiced",
  "affricateVoiceless",
  "affricateVoiced",
  "sibilantVoiceless",
  "sibilantVoiced",
  "labiodentalVoiceless",
  "labiodentalVoiced",
  "rhotic",
] as const

export type EmissionClass = (typeof EMISSION_CLASSES)[number]
export const EMISSION_CLASS_COUNT = EMISSION_CLASSES.length
export const CLASS_INDEX: Readonly<Record<EmissionClass, number>> = Object.freeze(
  Object.fromEntries(EMISSION_CLASSES.map((name, index) => [name, index])) as Record<EmissionClass, number>,
)

const PAUSE_INDEX = CLASS_INDEX.pause

export const FEATURE_NAMES = ["eRel", "eLoc", "mid", "low", "high", "voice"] as const
export const FEATURE_COUNT = FEATURE_NAMES.length

/** Média, desvio e lado: 0 = bilateral, −1 = só penaliza abaixo da média, +1 = só acima. */
export type FeatureStat = readonly [mean: number, sd: number, side: -1 | 0 | 1]
export type ClassModel = readonly FeatureStat[]
export type EmissionTable = Readonly<Record<EmissionClass, ClassModel>>

/** Teto do custo de UMA característica num quadro (em unidades de z²/2). */
const FEATURE_CAP = 6
/** Raio (quadros) do máximo local de energia. */
const LOCAL_MAX_RADIUS = 15

const PHONE_CLASS: Readonly<Record<PhoneSymbol, EmissionClass>> = Object.freeze({
  a: "vowel", "6": "vowel", e: "vowel", E: "vowel", i: "vowel", o: "vowel", O: "vowel", u: "vowel",
  "6~": "vowel", "e~": "vowel", "i~": "vowel", "o~": "vowel", "u~": "vowel",
  j: "glide", w: "glide", "j~": "glide", "w~": "glide",
  p: "stopVoiceless", t: "stopVoiceless", k: "stopVoiceless",
  b: "stopVoiced", d: "stopVoiced", g: "stopVoiced",
  tS: "affricateVoiceless", dZ: "affricateVoiced",
  s: "sibilantVoiceless", S: "sibilantVoiceless", z: "sibilantVoiced", Z: "sibilantVoiced",
  f: "labiodentalVoiceless", v: "labiodentalVoiced",
  m: "nasal", n: "nasal", J: "nasal",
  l: "liquid", L: "liquid", r: "liquid",
  R: "rhotic",
  _: "pause",
})

export function emissionClassOf(phone: PhoneSymbol): number {
  return CLASS_INDEX[PHONE_CLASS[phone]]
}

/**
 * Características de UM quadro, relativas ao nível de fala. `localMax` é o máximo de energia na
 * vizinhança (calculado pelo chamador numa varredura só).
 */
export function frameFeatures(store: FeatureFrameStore, f: number, levelDb: number, localMax: number, out: Float64Array): void {
  const energy = store.energyDb[f]!
  const vowel = store.vowelBandDb[f]!
  out[0] = clamp(energy - levelDb, -60, 8)
  out[1] = clamp(energy - localMax, -60, 0)
  out[2] = clamp(store.midBandDb[f]! - vowel, -40, 5)
  out[3] = clamp(energy - vowel, 0, 40)
  out[4] = store.highBandRatio[f]!
  out[5] = store.voicing[f]!
}

/** Log-verossimilhança (≤ 0, escala z²/2 saturada) de um vetor de características sob uma classe. */
export function classScore(model: ClassModel, x: Float64Array): number {
  let cost = 0
  for (let k = 0; k < FEATURE_COUNT; k++) {
    const [mean, sd, side] = model[k]!
    let z = (x[k]! - mean) / sd
    if ((side < 0 && z > 0) || (side > 0 && z < 0)) z = 0
    const c = 0.5 * z * z
    cost += c < FEATURE_CAP ? c : FEATURE_CAP
  }
  return -cost
}

/**
 * Pontua uma janela de quadros para todas as classes e grava SOMAS ACUMULADAS por classe:
 * `cumulative[c * (count + 1) + i]` = soma dos escores da classe `c` nos quadros `[first, first + i)`.
 * Assim o escore de qualquer segmento é uma subtração. Buffers do chamador (sem alocação).
 */
export class WindowEmissions {
  count = 0
  first = 0
  cumulative = new Float64Array(0)
  /** Por quadro: escore da classe de FALA (não pausa) que melhor o explica — base do enchimento. */
  bestSpeech = new Float64Array(0)
  private features = new Float64Array(FEATURE_COUNT)
  private localMax = new Float32Array(0)
  private deque = new Int32Array(0)
  private readonly models: ClassModel[]

  constructor(
    table: EmissionTable = EMISSION_TABLE,
    /** Peso das emissões frente às durações: quadros vizinhos são muito correlacionados. */
    readonly weight = 0.35,
  ) {
    this.models = EMISSION_CLASSES.map((name) => table[name])
  }

  compute(store: FeatureFrameStore, first: number, count: number, levelDb: number): void {
    this.first = first
    this.count = count
    const stride = count + 1
    if (this.cumulative.length < stride * EMISSION_CLASS_COUNT) this.cumulative = new Float64Array(Math.max(stride * EMISSION_CLASS_COUNT, this.cumulative.length * 2))
    if (this.localMax.length < count) this.localMax = new Float32Array(Math.max(count, this.localMax.length * 2))
    if (this.bestSpeech.length < count) this.bestSpeech = new Float64Array(Math.max(count, this.bestSpeech.length * 2))
    this.computeLocalMax(store, first, count)
    const cumulative = this.cumulative
    for (let c = 0; c < EMISSION_CLASS_COUNT; c++) cumulative[c * stride] = 0
    const x = this.features
    for (let i = 0; i < count; i++) {
      frameFeatures(store, first + i, levelDb, this.localMax[i]!, x)
      let bestSpeech = Number.NEGATIVE_INFINITY
      for (let c = 0; c < EMISSION_CLASS_COUNT; c++) {
        const base = c * stride
        const score = this.weight * classScore(this.models[c]!, x)
        cumulative[base + i + 1] = cumulative[base + i]! + score
        if (c !== PAUSE_INDEX && score > bestSpeech) bestSpeech = score
      }
      this.bestSpeech[i] = bestSpeech
    }
  }

  /** Soma dos escores da classe `cls` nos quadros locais `[a, b)`. */
  segment(cls: number, a: number, b: number): number {
    const base = cls * (this.count + 1)
    return this.cumulative[base + b]! - this.cumulative[base + a]!
  }

  /** Escore de um quadro local. */
  frame(cls: number, i: number): number {
    return this.segment(cls, i, i + 1)
  }

  /**
   * Máximo de energia em ±LOCAL_MAX_RADIUS quadros (olha fora da janela quando há quadros): máximo
   * deslizante com fila monotônica, O(n).
   */
  private computeLocalMax(store: FeatureFrameStore, first: number, count: number): void {
    const energy = store.energyDb
    const lo = Math.max(0, first - LOCAL_MAX_RADIUS)
    const hi = Math.min(store.count, first + count + LOCAL_MAX_RADIUS)
    if (this.deque.length < hi - lo + 1) this.deque = new Int32Array(Math.max(hi - lo + 1, this.deque.length * 2))
    const deque = this.deque
    let head = 0
    let tail = 0
    let next = lo
    for (let i = 0; i < count; i++) {
      const f = first + i
      const right = Math.min(hi - 1, f + LOCAL_MAX_RADIUS)
      for (; next <= right; next++) {
        while (tail > head && energy[deque[tail - 1]!]! <= energy[next]!) tail--
        deque[tail++] = next
      }
      while (head < tail && deque[head]! < f - LOCAL_MAX_RADIUS) head++
      this.localMax[i] = head < tail ? energy[deque[head]!]! : energy[f]!
    }
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
