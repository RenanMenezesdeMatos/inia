import { ARTICULATION, MAX_JAW } from "./articulation"
import { PHONES } from "./phones"
import type { AlignedPhone, MouthChannels, PhoneSymbol } from "./types"
import { MOUTH_CHANNEL_KEYS } from "./types"

/**
 * Linha do tempo da boca: fones alinhados → pose em qualquer instante, em duas etapas.
 *
 * 1. META por fone (modelo de dominância, Cohen–Massaro): no CENTRO de cada fone, a pose é a média
 *    dos alvos dos fones vizinhos (±300 ms) ponderada pela dominância de cada um, que decai
 *    exponencialmente com a distância ao intervalo do fone. É a coarticulação: o "u" de "você"
 *    arredonda o "v" antes da hora (arredondamento antecipatório decai mais devagar), o tepe de
 *    "para" herda a mandíbula das vogais, canal com que o fone não se importa vem dos vizinhos.
 * 2. TRAJETÓRIA entre as metas: Hermite cúbica monótona (Fritsch–Butland) de meta em meta — fone
 *    longo (≥ 70 ms) segura a meta num platô do miolo, fone curto tem uma meta só no centro — com
 *    LIMITE DE VELOCIDADE por canal: duas metas vizinhas que a boca não alcançaria a tempo
 *    (|Δ| > v_máx × intervalo / 1,5) se aproximam uma da outra. É o "undershoot" da fala rápida
 *    (Lindblom): sílaba curta abre menos, sílaba longa chega ao alvo — e nada "pula".
 *    A transição entre duas metas começa 35 ms antes do fim do platô e termina 35 ms depois do começo
 *    do seguinte; quando isso não basta para percorrer a distância na velocidade máxima e os fones são
 *    longos, ela toma emprestado do platô deles (até metade de cada um) — sem isso um "a" de 140 ms
 *    seguido de um "z" de 150 ms parava a mandíbula em 0,18 (alvo 0,08) por falta de tempo, não por
 *    fala rápida (capturas Kore, 2026-10-08).
 *
 * Por que duas etapas (avaliação de 2026-10-07): com a média contínua, o pico de velocidade da
 * mandíbula dependia da diferença entre os ALVOS (k·Δ/4 na fronteira dos fones), não da diferença
 * entre o que a boca de fato alcançava — para não dar trancos, os decaimentos tinham de ser lentos,
 * e a média achatava o contraste (≈ 50% da profundidade silábica). Separadas, a nitidez é decidida
 * pela dominância e a suavidade pelo limite de velocidade.
 *
 * Restrições "duras" (dominância ≥ 0,95: lábios selados em p/b/m, lábio sob os dentes em f/v)
 * não podem ser diluídas — a pose do canal é, no mínimo, o alvo × um envelope que vale 1 no miolo
 * do fone. É a garantia de que TODO bilabial fecha a boca de verdade no centro.
 *
 * Antes do primeiro fone, depois do último e em buracos longos entre fones, a boca vai e volta do
 * repouso em `REST_LEAD_SECONDS`.
 *
 * Metas são guardadas em cache por fone (typed arrays) e invalidadas só perto do que mudou
 * (`append`/`truncate`); `sample()` não aloca.
 */

const CHANNELS = MOUTH_CHANNEL_KEYS.length
const JAW = MOUTH_CHANNEL_KEYS.indexOf("jaw")
const LIP_CLOSE = MOUTH_CHANNEL_KEYS.indexOf("lipClose")
const ROUND = MOUTH_CHANNEL_KEYS.indexOf("round")
const PUCKER = MOUTH_CHANNEL_KEYS.indexOf("pucker")
const SPREAD = MOUTH_CHANNEL_KEYS.indexOf("spread")
const UPPER_LIP_RAISE = MOUTH_CHANNEL_KEYS.indexOf("upperLipRaise")
const LOWER_LIP_DOWN = MOUTH_CHANNEL_KEYS.indexOf("lowerLipDown")
const LOWER_LIP_TUCK = MOUTH_CHANNEL_KEYS.indexOf("lowerLipTuck")
const JAW_FORWARD = MOUTH_CHANNEL_KEYS.indexOf("jawForward")
const LIP_COMPRESS = MOUTH_CHANNEL_KEYS.indexOf("lipCompress")

/** Janela de influência dos vizinhos na meta de um fone (s). */
const WINDOW_SECONDS = 0.3
/** Arredondamento antecipatório: decai mais devagar para fones que ainda vão acontecer. */
const ANTICIPATORY_ROUNDING = 0.55
/**
 * Decaimento da dominância na MANDÍBULA (1/s), igual para todo fone: a meta da mandíbula é a do
 * próprio fone (todo fone se importa com ela, menos o tepe) e a coarticulação dela vem da
 * trajetória com limite de velocidade. Os lábios seguem o `decayRate` de cada fone (lento):
 * canal com que o fone não se importa continua herdando dos vizinhos.
 */
const JAW_DECAY_RATE = 120
const HARD_DOMINANCE = 0.95
/** Rampa do envelope duro fora do intervalo do fone (s). */
const HARD_RAMP_OUT = 0.02
/** Fração do fone, em cada ponta, usada para subir/descer o envelope duro. */
const HARD_RAMP_IN = 0.25
const DOMINANCE_EPSILON = 1e-4
/** Fone com pelo menos 2× isto ganha platô: a meta vale de `start + borda` até `end − borda`. */
const PLATEAU_EDGE_SECONDS = 0.035
/** Pausa: a boca fecha DENTRO dela (fala termina aberta e descansa depois), então a borda é maior. */
const PAUSE_EDGE_SECONDS = 0.08
/** Ida/volta do repouso antes da fala, depois dela e em buracos maiores que 2× isto. */
const REST_LEAD_SECONDS = 0.1
/** Vizinhos (de cada lado) que o limite de velocidade enxerga ao ajustar a meta de um fone. */
const LIMIT_RADIUS = 3
const LIMIT_PASSES = 3
/**
 * Velocidade máxima por canal (unidades do canal por segundo; ∞ = sem limite). Mandíbula: 9/s
 * fica abaixo do "tranco" visível (0,2 em 20 ms = 10/s) e perto do pico humano medido em fala
 * (≈ 100–150 mm/s nos incisivos). Lábios são mais leves e rápidos (protrusão ≈ 100–200 mm/s numa
 * faixa de 5–8 mm): 16/s ainda deixa o "u" chegar ao bico entre duas consoantes. Selar/lábio sob
 * os dentes ficam livres: fechar é rápido.
 */
const MAX_VELOCITY: Readonly<Record<string, number>> = Object.freeze({
  jaw: 9,
  jawForward: 8,
  lipClose: Number.POSITIVE_INFINITY,
  lowerLipTuck: Number.POSITIVE_INFINITY,
  lipCompress: Number.POSITIVE_INFINITY,
  round: 16,
  pucker: 16,
  spread: 16,
  upperLipRaise: 16,
  lowerLipDown: 16,
})
const VELOCITY = Float64Array.from(MOUTH_CHANNEL_KEYS, (key) => MAX_VELOCITY[key] ?? Number.POSITIVE_INFINITY)
/** Pico de velocidade de uma Hermite com tangentes nulas = 1,5 × a secante. */
const HERMITE_PEAK = 1.5

export const PHONE_SYMBOLS: readonly PhoneSymbol[] = Object.freeze(Object.keys(PHONES) as PhoneSymbol[])
const PHONE_CODE: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(PHONE_SYMBOLS.map((symbol, index) => [symbol, index])))

const FLAG_STRESSED = 1
const FLAG_NUCLEUS = 2
const FLAG_AUDIO_ONLY = 4
const FLAG_PAUSE = 8

/** Abertura da vogal pela loudness: jaw × (base + ganho × loudness); tônica abre mais. */
export const DEFAULT_LOUDNESS_BASE = 0.72
export const DEFAULT_LOUDNESS_GAIN = 0.45
export const DEFAULT_STRESS_GAIN = 1.08

export type MouthTimelineOptions = {
  /** Escala da abertura pela loudness: jaw × (base + gain × loudness). */
  loudnessBase?: number
  loudnessGain?: number
  /** Tônica abre um pouco mais. */
  stressGain?: number
}

export class MouthTimeline {
  count = 0
  start: Float64Array = new Float64Array(256)
  end: Float64Array = new Float64Array(256)
  code: Uint8Array = new Uint8Array(256)
  flags: Uint8Array = new Uint8Array(256)
  wordIndex: Int32Array = new Int32Array(256)
  loudness: Float32Array = new Float32Array(256)
  decay: Float32Array = new Float32Array(256)
  hardMask: Uint8Array = new Uint8Array(256)
  target: Float32Array = new Float32Array(256 * CHANNELS)
  dominance: Float32Array = new Float32Array(256 * CHANNELS)
  /** Início do fade-out forçado (interrupção), +∞ sem fade. */
  fadeStart = Number.POSITIVE_INFINITY
  fadeDuration = 0.1

  /**
   * Instantes em que a meta de cada fone começa/deixa de valer (iguais = meta só no centro), depois do
   * empréstimo do platô às transições longas; válidos para `i < timesValid` (`ensureKeys`).
   */
  keyA: Float64Array = new Float64Array(256)
  keyB: Float64Array = new Float64Array(256)
  /** Platô nominal de cada fone (bordas fixas), antes do empréstimo. */
  private plateauA: Float64Array = new Float64Array(256)
  private plateauB: Float64Array = new Float64Array(256)
  private timesValid = 0
  /** Meta de cada fone pela dominância (antes do limite de velocidade); válida para `i < rawValid`. */
  private rawKey: Float32Array = new Float32Array(256 * CHANNELS)
  private rawValid = 0
  /** Meta final (com o limite de velocidade); válida para `i < keyValid`. */
  private key: Float32Array = new Float32Array(256 * CHANNELS)
  private keyValid = 0

  private readonly num = new Float64Array(CHANNELS)
  private readonly den = new Float64Array(CHANNELS)
  private readonly floor = new Float64Array(CHANNELS)
  private readonly pose = new Float64Array(CHANNELS)
  private readonly tangentLeft = new Float64Array(CHANNELS)
  private readonly tangentRight = new Float64Array(CHANNELS)
  private readonly window = new Float64Array((2 * LIMIT_RADIUS + 1) * CHANNELS)
  private readonly gaps = new Float64Array(2 * LIMIT_RADIUS)
  private readonly loudnessBase: number
  private readonly loudnessGain: number
  private readonly stressGain: number

  constructor(options: MouthTimelineOptions = {}) {
    this.loudnessBase = options.loudnessBase ?? DEFAULT_LOUDNESS_BASE
    this.loudnessGain = options.loudnessGain ?? DEFAULT_LOUDNESS_GAIN
    this.stressGain = options.stressGain ?? DEFAULT_STRESS_GAIN
  }

  clear(): void {
    this.count = 0
    this.rawValid = 0
    this.timesValid = 0
    this.keyValid = 0
    this.fadeStart = Number.POSITIVE_INFINITY
  }

  /** Mantém só os `count` primeiros fones. */
  truncate(count: number): void {
    const next = Math.max(0, Math.min(this.count, count))
    if (next === this.count) return
    this.count = next
    this.invalidateNear(next > 0 ? this.end[next - 1] : Number.NEGATIVE_INFINITY)
  }

  append(phone: AlignedPhone): void {
    if (this.count === this.start.length) this.grow()
    const i = this.count++
    const articulation = ARTICULATION[phone.phone]
    this.start[i] = phone.start
    this.end[i] = Math.max(phone.start, phone.end)
    this.code[i] = PHONE_CODE[phone.phone]
    let flags = 0
    if (phone.stressed) flags |= FLAG_STRESSED
    if (phone.nucleus) flags |= FLAG_NUCLEUS
    if (phone.source === "audio-only") flags |= FLAG_AUDIO_ONLY
    if (phone.phone === "_") flags |= FLAG_PAUSE
    this.flags[i] = flags
    this.wordIndex[i] = phone.wordIndex
    this.loudness[i] = phone.loudness
    this.decay[i] = articulation.decayRate
    let hard = 0
    const isVowel = PHONES[phone.phone].class === "vowel" || PHONES[phone.phone].class === "glide"
    for (let c = 0; c < CHANNELS; c++) {
      const key = MOUTH_CHANNEL_KEYS[c]
      let target = c === JAW && phone.jawTarget !== undefined ? phone.jawTarget : articulation.target[key] ?? 0
      const dominance = articulation.dominance[key] ?? articulation.defaultDominance
      if (c === JAW && isVowel) {
        // Loudness escala a abertura dentro de limites; tônica um pouco maior.
        const loud = Math.max(0, Math.min(1, phone.loudness))
        target *= this.loudnessBase + this.loudnessGain * loud
        if (phone.stressed && phone.nucleus) target *= this.stressGain
        target = Math.min(MAX_JAW, target)
      }
      this.target[i * CHANNELS + c] = target
      this.dominance[i * CHANNELS + c] = dominance
      if (dominance >= HARD_DOMINANCE && target > 0) hard |= 1 << c
    }
    this.hardMask[i] = hard
    // Fone longo segura a meta num platô do miolo; curto tem a meta só no centro. Pausa: a boca
    // fecha DENTRO dela (a fala termina aberta e descansa depois), então a borda é maior.
    const edge = phone.phone === "_" ? PAUSE_EDGE_SECONDS : PLATEAU_EDGE_SECONDS
    const s = this.start[i]
    const e = this.end[i]
    this.plateauA[i] = e - s >= 2 * edge ? s + edge : (s + e) / 2
    this.plateauB[i] = e - s >= 2 * edge ? e - edge : (s + e) / 2
    this.invalidateNear(i > 0 ? Math.min(this.end[i - 1], this.start[i]) : Number.NEGATIVE_INFINITY)
  }

  appendAll(phones: readonly AlignedPhone[]): void {
    for (const phone of phones) this.append(phone)
  }

  /** Fim do último fone que não é pausa (−∞ sem fones). */
  get speechEnd(): number {
    for (let i = this.count - 1; i >= 0; i--) if (!(this.flags[i] & FLAG_PAUSE)) return this.end[i]
    return Number.NEGATIVE_INFINITY
  }

  get speechStart(): number {
    for (let i = 0; i < this.count; i++) if (!(this.flags[i] & FLAG_PAUSE)) return this.start[i]
    return Number.POSITIVE_INFINITY
  }

  /** Índice do último fone com `start <= t` (−1 se nenhum). */
  lastStartingBefore(t: number): number {
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.start[mid] <= t) lo = mid + 1
      else hi = mid
    }
    return lo - 1
  }

  /** Índice do fone que contém `t` (−1 se nenhum). */
  indexAt(t: number): number {
    const i = this.lastStartingBefore(t)
    return i >= 0 && t < this.end[i] ? i : -1
  }

  isPause(i: number): boolean {
    return (this.flags[i] & FLAG_PAUSE) !== 0
  }

  isStressedNucleus(i: number): boolean {
    return (this.flags[i] & (FLAG_STRESSED | FLAG_NUCLEUS)) === (FLAG_STRESSED | FLAG_NUCLEUS)
  }

  isNucleus(i: number): boolean {
    return (this.flags[i] & FLAG_NUCLEUS) !== 0
  }

  isAudioOnly(i: number): boolean {
    return (this.flags[i] & FLAG_AUDIO_ONLY) !== 0
  }

  phoneAt(i: number): PhoneSymbol {
    return PHONE_SYMBOLS[this.code[i]]
  }

  /** Instante em que a meta do fone `i` começa a valer (início do platô, ou o centro). */
  keyStart(i: number): number {
    this.ensureKeys(i)
    return this.keyA[i]
  }

  /** Instante em que a meta do fone `i` deixa de valer (fim do platô, ou o centro). */
  keyEnd(i: number): number {
    this.ensureKeys(i)
    return this.keyB[i]
  }

  /** Meta final (com limite de velocidade) do fone `i` no canal `channel` — diagnóstico/testes. */
  keyOf(i: number, channel: number): number {
    this.ensureKeys(i)
    return this.key[i * CHANNELS + channel]
  }

  /** Pose da boca no instante `t`. Não aloca. */
  sample(t: number, out: MouthChannels): void {
    const count = this.count
    if (count === 0 || t >= this.fadeStart + this.fadeDuration) {
      writeRest(out)
      return
    }
    const pose = this.pose
    const k = this.lastStartingBefore(t)
    // Instantes das metas em volta de `t` (o segmento é escolhido por eles).
    this.ensureKeys(Math.min(count - 1, Math.max(0, k) + 1))
    // Segmento da trajetória que contém `t`: da meta de `left` à de `right` (−1 = repouso), de t0 a t1.
    let left = -1
    let right = -1
    let t0 = 0
    let t1 = 0
    if (k < 0 || (k === 0 && t < this.keyA[0])) {
      // Antes da meta do primeiro fone: sai do repouso.
      right = 0
      t1 = this.keyA[0]
      t0 = t1 - REST_LEAD_SECONDS
    } else if (t >= this.keyA[k] && t <= this.keyB[k]) {
      left = k
      right = k
    } else {
      const previous = t < this.keyA[k] ? k - 1 : k
      t0 = this.keyB[previous]
      if (previous === count - 1) {
        // Depois da meta do último fone: volta ao repouso.
        left = previous
        t1 = t0 + REST_LEAD_SECONDS
      } else {
        t1 = this.keyA[previous + 1]
        if (t1 - t0 <= 2 * REST_LEAD_SECONDS) {
          left = previous
          right = previous + 1
        } else if (t <= t0 + REST_LEAD_SECONDS) {
          // Buraco longo sem fone (re-ancoragem, áudio descartado): passa pelo repouso.
          left = previous
          t1 = t0 + REST_LEAD_SECONDS
        } else if (t >= t1 - REST_LEAD_SECONDS) {
          right = previous + 1
          t0 = t1 - REST_LEAD_SECONDS
        }
      }
    }
    this.ensureKeys(Math.min(count - 1, Math.max(left, right) + 1))
    if (left >= 0 && left === right) {
      const offset = left * CHANNELS
      for (let c = 0; c < CHANNELS; c++) pose[c] = this.key[offset + c]
    } else if (left < 0 && right < 0) {
      pose.fill(0)
    } else {
      // Hermite cúbica entre as duas metas (repouso = valor e tangente 0).
      const m0 = this.tangentLeft
      const m1 = this.tangentRight
      if (left >= 0) this.tangents(left, m0)
      else m0.fill(0)
      if (right >= 0) this.tangents(right, m1)
      else m1.fill(0)
      const h = t1 - t0
      const x = h <= 1e-6 ? 1 : Math.min(1, Math.max(0, (t - t0) / h))
      const x2 = x * x
      const x3 = x2 * x
      const h00 = 2 * x3 - 3 * x2 + 1
      const h10 = (x3 - 2 * x2 + x) * h
      const h01 = -2 * x3 + 3 * x2
      const h11 = (x3 - x2) * h
      const a = left * CHANNELS
      const b = right * CHANNELS
      for (let c = 0; c < CHANNELS; c++) {
        const p0 = left >= 0 ? this.key[a + c] : 0
        const p1 = right >= 0 ? this.key[b + c] : 0
        pose[c] = h00 * p0 + h10 * m0[c] + h01 * p1 + h11 * m1[c]
      }
    }

    // Restrições duras (selo dos lábios, lábio sob os dentes) e o que o selo suprime.
    const floor = this.floor
    floor.fill(0)
    let closure = 0
    for (let i = Math.max(0, k - 1); i <= k + 1 && i < count; i++) {
      const hard = this.hardMask[i]
      if (hard === 0) continue
      const bump = hardEnvelope(t, this.start[i], this.end[i])
      if (bump <= 0) continue
      const offset = i * CHANNELS
      for (let c = 0; c < CHANNELS; c++) {
        if (hard & (1 << c)) {
          const value = this.target[offset + c] * bump
          if (value > floor[c]) floor[c] = value
        }
      }
      if (hard & (1 << LIP_CLOSE) && bump > closure) closure = bump
    }
    for (let c = 0; c < CHANNELS; c++) if (floor[c] > pose[c]) pose[c] = floor[c]
    if (closure > 0) {
      // Lábios selados: nada de dentes à mostra nem lábios estirados/abertos brigando com o selo.
      pose[UPPER_LIP_RAISE] *= 1 - closure
      pose[LOWER_LIP_DOWN] *= 1 - closure
      pose[SPREAD] *= 1 - 0.5 * closure
    }

    let fade = 1
    if (t > this.fadeStart) {
      const x = Math.min(1, (t - this.fadeStart) / this.fadeDuration)
      fade = 1 - x * x * (3 - 2 * x)
    }
    out.jaw = Math.min(MAX_JAW, Math.max(0, pose[JAW])) * fade
    out.lipClose = clamp01(pose[LIP_CLOSE]) * fade
    out.round = clamp01(pose[ROUND]) * fade
    out.pucker = clamp01(pose[PUCKER]) * fade
    out.spread = clamp01(pose[SPREAD]) * fade
    out.lowerLipTuck = clamp01(pose[LOWER_LIP_TUCK]) * fade
    out.upperLipRaise = clamp01(pose[UPPER_LIP_RAISE]) * fade
    out.lowerLipDown = clamp01(pose[LOWER_LIP_DOWN]) * fade
    out.jawForward = clamp01(pose[JAW_FORWARD]) * fade
    out.lipCompress = clamp01(pose[LIP_COMPRESS]) * fade
  }

  /**
   * Tangentes na meta do fone `i`, por canal, em `out` (Fritsch–Butland): nulas em platô e em
   * extremo local (a trajetória nunca ultrapassa a meta), média harmônica das secantes vizinhas
   * quando ela é monótona. Escreve num array em vez de devolver número: não aloca.
   */
  private tangents(i: number, out: Float64Array): void {
    if (this.keyB[i] > this.keyA[i]) {
      out.fill(0)
      return
    }
    const center = this.keyA[i]
    const hasLeft = i > 0 && center - this.keyB[i - 1] <= 2 * REST_LEAD_SECONDS
    const hasRight = i + 1 < this.count && this.keyA[i + 1] - center <= 2 * REST_LEAD_SECONDS
    const leftSpan = hasLeft ? center - this.keyB[i - 1] : REST_LEAD_SECONDS
    const rightSpan = hasRight ? this.keyA[i + 1] - center : REST_LEAD_SECONDS
    const offset = i * CHANNELS
    for (let c = 0; c < CHANNELS; c++) {
      const value = this.key[offset + c]
      const leftValue = hasLeft ? this.key[offset - CHANNELS + c] : 0
      const rightValue = hasRight ? this.key[offset + CHANNELS + c] : 0
      const sl = leftSpan > 1e-6 ? (value - leftValue) / leftSpan : 0
      const sr = rightSpan > 1e-6 ? (rightValue - value) / rightSpan : 0
      out[c] = sl * sr > 0 ? (2 * sl * sr) / (sl + sr) : 0
    }
  }

  /** Invalida metas que dependem de fones a partir do instante `t` (algo mudou ali). */
  private invalidateNear(t: number): void {
    const first = Number.isFinite(t) ? Math.max(0, this.lastStartingBefore(t - WINDOW_SECONDS)) : 0
    if (first < this.rawValid) this.rawValid = first
    // Os instantes de um fone dependem das metas dos dois vizinhos; a meta final, dos instantes em ±LIMIT_RADIUS.
    const timesFirst = Math.max(0, first - 1)
    if (timesFirst < this.timesValid) this.timesValid = timesFirst
    const keyFirst = Math.max(0, timesFirst - LIMIT_RADIUS)
    if (keyFirst < this.keyValid) this.keyValid = keyFirst
    if (this.rawValid > this.count) this.rawValid = this.count
    if (this.timesValid > this.count) this.timesValid = this.count
    if (this.keyValid > this.count) this.keyValid = this.count
  }

  /** Garante as metas finais (e os instantes delas) até o fone `index` (inclusive). */
  private ensureKeys(index: number): void {
    const last = Math.min(index, this.count - 1)
    if (last < this.keyValid) return
    const timesLast = Math.min(this.count - 1, last + LIMIT_RADIUS)
    this.ensureRaw(Math.min(this.count - 1, timesLast + 1))
    this.ensureTimes(timesLast)
    for (let i = this.keyValid; i <= last; i++) this.limitKey(i)
    this.keyValid = last + 1
  }

  /**
   * Instantes efetivos das metas até o fone `index`: o platô nominal, menos o que as transições
   * vizinhas tomam emprestado (`transitionLoan`).
   */
  private ensureTimes(index: number): void {
    for (let i = this.timesValid; i <= index; i++) {
      this.keyA[i] = this.plateauA[i] + (i > 0 ? this.transitionLoan(i - 1, false) : 0)
      this.keyB[i] = this.plateauB[i] - (i + 1 < this.count ? this.transitionLoan(i, true) : 0)
    }
    if (index + 1 > this.timesValid) this.timesValid = index + 1
  }

  /**
   * Quanto a transição entre os fones `j` e `j + 1` toma do platô de `j` (`fromLeft`) ou de `j + 1`:
   * o que falta para percorrer a maior distância entre as metas (pela dominância, antes do limite)
   * na velocidade máxima de cada canal, dividido na proporção do que cada um pode ceder (metade do
   * platô). Buraco longo (transição pelo repouso) não empresta.
   */
  private transitionLoan(j: number, fromLeft: boolean): number {
    const gap = this.plateauA[j + 1] - this.plateauB[j]
    if (gap > 2 * REST_LEAD_SECONDS) return 0
    const availableLeft = (this.plateauB[j] - this.plateauA[j]) / 2
    const availableRight = (this.plateauB[j + 1] - this.plateauA[j + 1]) / 2
    const available = availableLeft + availableRight
    if (available <= 0) return 0
    let need = 0
    const a = j * CHANNELS
    const b = a + CHANNELS
    for (let c = 0; c < CHANNELS; c++) {
      const velocity = VELOCITY[c]
      if (!Number.isFinite(velocity)) continue
      const time = (HERMITE_PEAK * Math.abs(this.rawKey[b + c] - this.rawKey[a + c])) / velocity
      if (time > need) need = time
    }
    const deficit = Math.min(need - gap, available)
    if (deficit <= 0) return 0
    return (deficit * (fromLeft ? availableLeft : availableRight)) / available
  }

  private ensureRaw(index: number): void {
    for (let i = this.rawValid; i <= index; i++) this.computeRawKey(i)
    if (index + 1 > this.rawValid) this.rawValid = index + 1
  }

  /** Meta do fone `i`: dominância dos vizinhos avaliada no centro dele. */
  private computeRawKey(i: number): void {
    const num = this.num
    const den = this.den
    num.fill(0)
    den.fill(DOMINANCE_EPSILON)
    const t = (this.start[i] + this.end[i]) / 2
    let lo = i
    while (lo > 0 && this.end[lo - 1] >= t - WINDOW_SECONDS) lo--
    let hi = i + 1
    while (hi < this.count && this.start[hi] <= t + WINDOW_SECONDS) hi++
    for (let j = lo; j < hi; j++) {
      const s = this.start[j]
      const e = this.end[j]
      const distance = t < s ? s - t : t > e ? t - e : 0
      if (distance > WINDOW_SECONDS) continue
      const decay = this.decay[j]
      const base = Math.exp(-decay * distance)
      const anticipatory = t < s ? Math.exp(-decay * ANTICIPATORY_ROUNDING * distance) : base
      const jaw = Math.exp(-JAW_DECAY_RATE * distance)
      const offset = j * CHANNELS
      for (let c = 0; c < CHANNELS; c++) {
        const weight = this.dominance[offset + c] * (c === JAW ? jaw : c === ROUND || c === PUCKER ? anticipatory : base)
        num[c] += weight * this.target[offset + c]
        den[c] += weight
      }
    }
    const offset = i * CHANNELS
    for (let c = 0; c < CHANNELS; c++) this.rawKey[offset + c] = num[c] / den[c]
  }

  /**
   * Limite de velocidade local: metas vizinhas que exigiriam |Δ| > v_máx × intervalo / 1,5 se
   * aproximam (cada uma cede metade do excesso; a pausa não cede), em algumas passadas sobre
   * ±`LIMIT_RADIUS` fones.
   * Determinístico por fone (só depende da vizinhança), então a meta não muda com o ponto de vista.
   */
  private limitKey(i: number): void {
    const from = Math.max(0, i - LIMIT_RADIUS)
    const to = Math.min(this.count - 1, i + LIMIT_RADIUS)
    const n = to - from + 1
    const window = this.window
    const gaps = this.gaps
    for (let j = 0; j < n; j++) {
      const source = (from + j) * CHANNELS
      for (let c = 0; c < CHANNELS; c++) window[j * CHANNELS + c] = this.rawKey[source + c]
      if (j < n - 1) gaps[j] = Math.max(0, this.keyA[from + j + 1] - this.keyB[from + j])
    }
    for (let c = 0; c < CHANNELS; c++) {
      const velocity = VELOCITY[c]
      if (!Number.isFinite(velocity)) continue
      for (let pass = 0; pass < LIMIT_PASSES; pass++) {
        const forward = pass % 2 === 0
        for (let step = 0; step < n - 1; step++) {
          const j = forward ? step : n - 2 - step
          if (gaps[j] > 2 * REST_LEAD_SECONDS) continue
          const allowed = (velocity * gaps[j]) / HERMITE_PEAK
          const p = j * CHANNELS + c
          const q = p + CHANNELS
          const delta = window[q] - window[p]
          const excess = Math.abs(delta) - allowed
          if (excess <= 0) continue
          // Pausa é repouso: não cede (quem chega atrasado é a fala); entre dois fones, cada um cede metade.
          const pinnedP = this.isPause(from + j)
          const pinnedQ = this.isPause(from + j + 1)
          if (pinnedP && pinnedQ) continue
          const share = pinnedP || pinnedQ ? 1 : 0.5
          const move = Math.sign(delta) * excess * share
          if (!pinnedP) window[p] += move
          if (!pinnedQ) window[q] -= move
        }
      }
    }
    const offset = i * CHANNELS
    const local = (i - from) * CHANNELS
    for (let c = 0; c < CHANNELS; c++) this.key[offset + c] = window[local + c]
  }

  private grow(): void {
    const size = this.start.length * 2
    this.start = growF64(this.start, size)
    this.end = growF64(this.end, size)
    this.code = growU8(this.code, size)
    this.flags = growU8(this.flags, size)
    this.wordIndex = growI32(this.wordIndex, size)
    this.loudness = growF32(this.loudness, size)
    this.decay = growF32(this.decay, size)
    this.hardMask = growU8(this.hardMask, size)
    this.target = growF32(this.target, size * CHANNELS)
    this.dominance = growF32(this.dominance, size * CHANNELS)
    this.keyA = growF64(this.keyA, size)
    this.keyB = growF64(this.keyB, size)
    this.plateauA = growF64(this.plateauA, size)
    this.plateauB = growF64(this.plateauB, size)
    this.rawKey = growF32(this.rawKey, size * CHANNELS)
    this.key = growF32(this.key, size * CHANNELS)
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Envelope da restrição dura: 1 no miolo do fone, cosseno até 0 a `HARD_RAMP_OUT` fora das bordas. */
function hardEnvelope(t: number, s: number, e: number): number {
  const d = e - s
  const innerStart = s + HARD_RAMP_IN * d
  const innerEnd = e - HARD_RAMP_IN * d
  if (t >= innerStart && t <= innerEnd) return 1
  if (t < innerStart) {
    const from = s - HARD_RAMP_OUT
    if (t <= from) return 0
    return 0.5 - 0.5 * Math.cos((Math.PI * (t - from)) / (innerStart - from))
  }
  const to = e + HARD_RAMP_OUT
  if (t >= to) return 0
  return 0.5 + 0.5 * Math.cos((Math.PI * (t - innerEnd)) / (to - innerEnd))
}

function writeRest(out: MouthChannels): void {
  out.jaw = 0
  out.lipClose = 0
  out.round = 0
  out.pucker = 0
  out.spread = 0
  out.lowerLipTuck = 0
  out.upperLipRaise = 0
  out.lowerLipDown = 0
  out.jawForward = 0
  out.lipCompress = 0
}

function growF64(source: Float64Array, size: number): Float64Array {
  const out = new Float64Array(size)
  out.set(source)
  return out
}

function growF32(source: Float32Array, size: number): Float32Array {
  const out = new Float32Array(size)
  out.set(source)
  return out
}

function growU8(source: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  out.set(source)
  return out
}

function growI32(source: Int32Array, size: number): Int32Array {
  const out = new Int32Array(size)
  out.set(source)
  return out
}

/** Linha do tempo pronta a partir de fones alinhados. */
export function createMouthTimeline(phones: readonly AlignedPhone[] = [], options: MouthTimelineOptions = {}): MouthTimeline {
  const timeline = new MouthTimeline(options)
  timeline.appendAll(phones)
  return timeline
}
