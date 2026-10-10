import type { AudioFeatureFrame } from "./types"

/**
 * Extração de características do áudio da fala, em streaming, no instante em que cada chunk CHEGA
 * (bem antes de ser ouvido — o Gemini Live gera mais rápido que o tempo real).
 *
 * Quadros de 25 ms a cada 10 ms, carimbados no relógio do AudioContext (`startAt` do chunk +
 * deslocamento): é isso que deixa o alinhador trabalhar sobre o MESMO eixo em que a boca é
 * amostrada. Custo é o que manda aqui (orçamento do turno inteiro, 55 s, < ~50 ms): nada de FFT —
 * quatro biquads por amostra dão as bandas, e o vozeamento sai de autocorrelação sobre o sinal
 * decimado para ~4 kHz (F0 da voz cabe folgado abaixo de 1 kHz).
 *
 * Continuidade: o filtro, o resto do quadro e o buffer decimado atravessam fronteiras de chunk
 * (os chunks do Live têm 40 ms e o quadro, 25 ms — sem carregar a cauda metade dos quadros sairia
 * torta). Buraco entre chunks (underrun: o próximo chunk foi agendado DEPOIS do fim do anterior) é
 * silêncio de verdade no alto-falante, então é preenchido com zeros — o alinhador vê uma pausa
 * onde o ouvinte ouve uma pausa. Chunk agendado ANTES do fim do anterior (não acontece com o
 * agendamento colado do transporte) reinicia o fluxo sem nunca produzir quadro fora de ordem.
 */

/** Duração do sub-bloco (ms): quadro = 5 sub-blocos (25 ms), salto = 2 sub-blocos (10 ms). */
const SUB_BLOCK_MS = 5
const SUB_BLOCKS_PER_FRAME = 5
const SUB_BLOCKS_PER_HOP = 2
/** Taxa aproximada do sinal usado no vozeamento. */
const VOICING_RATE = 4000
/** F0 plausível (Hz): cobre voz feminina e masculina com folga. */
const F0_MIN_HZ = 75
const F0_MAX_HZ = 420
/** Vozeamento mínimo para o quadro ter F0. */
export const F0_MIN_VOICING = 0.6
/**
 * Contra erro de oitava abaixo (o pico em 2T costuma empatar com o de T): vale o MENOR lag cuja
 * correlação chega a esta fração da melhor.
 */
const F0_OCTAVE_TOLERANCE = 0.85
/** Buraco maior que isso não é preenchido amostra a amostra: vira quadros de silêncio direto. */
const MAX_ZERO_FILL_SECONDS = 0.25
/** Tolerância para considerar dois chunks colados (arredondamento de ponto flutuante do agendamento). */
const CONTIGUITY_TOLERANCE_SECONDS = 0.0015
const SILENCE_DB = -100
const ENERGY_EPSILON = 1e-10

/** Armazenamento em colunas (typed arrays que crescem): o alinhador lê milhares de quadros por turno. */
export class FeatureFrameStore {
  count = 0
  time = new Float64Array(512)
  energyDb = new Float32Array(512)
  vowelBandDb = new Float32Array(512)
  highBandRatio = new Float32Array(512)
  zeroCrossingRate = new Float32Array(512)
  voicing = new Float32Array(512)
  /**
   * Banda 1–3 kHz (região de F2), dB — interna, fora do contrato `AudioFeatureFrame`. As nasais
   * (m, n, nh) quase não baixam a banda de vogais (murmúrio nasal forte abaixo de 1 kHz), mas somem
   * nesta banda: é o que separa as sílabas de "Amanhã" e posiciona o [m] no vale certo.
   */
  midBandDb = new Float32Array(512)
  /**
   * Frequência fundamental (Hz) do quadro, 0 sem vozeamento confiável (< `F0_MIN_VOICING`) — interna,
   * fora do contrato. É o lag da mesma autocorrelação do vozeamento (refinado por parábola); a
   * prosódia (acentos de frase, entonação de pergunta) sai daqui.
   */
  f0Hz = new Float32Array(512)

  clear(): void {
    this.count = 0
  }

  push(time: number, energyDb: number, vowelBandDb: number, highBandRatio: number, zeroCrossingRate: number, voicing: number, midBandDb = vowelBandDb, f0Hz = 0): void {
    if (this.count === this.time.length) this.grow()
    const i = this.count++
    this.midBandDb[i] = midBandDb
    this.f0Hz[i] = f0Hz
    this.time[i] = time
    this.energyDb[i] = energyDb
    this.vowelBandDb[i] = vowelBandDb
    this.highBandRatio[i] = highBandRatio
    this.zeroCrossingRate[i] = zeroCrossingRate
    this.voicing[i] = voicing
  }

  /** Remove os quadros a partir de `index` (interrupção). */
  truncate(index: number): void {
    this.count = Math.max(0, Math.min(this.count, index))
  }

  /** Primeiro índice com `time >= t` (busca binária; `count` se nenhum). */
  lowerBound(t: number): number {
    let lo = 0
    let hi = this.count
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this.time[mid] < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  frame(index: number): AudioFeatureFrame {
    return {
      time: this.time[index],
      energyDb: this.energyDb[index],
      vowelBandDb: this.vowelBandDb[index],
      highBandRatio: this.highBandRatio[index],
      zeroCrossingRate: this.zeroCrossingRate[index],
      voicing: this.voicing[index],
    }
  }

  toFrames(from = 0, to = this.count): AudioFeatureFrame[] {
    const frames: AudioFeatureFrame[] = []
    for (let i = Math.max(0, from); i < Math.min(to, this.count); i++) frames.push(this.frame(i))
    return frames
  }

  private grow(): void {
    const size = this.time.length * 2
    this.time = copyInto(new Float64Array(size), this.time)
    this.energyDb = copyInto(new Float32Array(size), this.energyDb)
    this.vowelBandDb = copyInto(new Float32Array(size), this.vowelBandDb)
    this.highBandRatio = copyInto(new Float32Array(size), this.highBandRatio)
    this.zeroCrossingRate = copyInto(new Float32Array(size), this.zeroCrossingRate)
    this.voicing = copyInto(new Float32Array(size), this.voicing)
    this.midBandDb = copyInto(new Float32Array(size), this.midBandDb)
    this.f0Hz = copyInto(new Float32Array(size), this.f0Hz)
  }
}

function copyInto<T extends Float32Array | Float64Array>(target: T, source: T): T {
  target.set(source)
  return target
}

/** Coeficientes de biquad (RBJ cookbook), normalizados por a0. */
type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number }

/** Altura do pico da parábola pelos três pontos em torno de um máximo local. */
function interpolatedPeak(before: number, peak: number, after: number): number {
  const curvature = before - 2 * peak + after
  if (curvature >= 0) return peak
  const shift = (0.5 * (before - after)) / curvature
  return peak - 0.25 * (before - after) * shift
}

function lowpass(sampleRate: number, cutoffHz: number, q = Math.SQRT1_2): Biquad {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate
  const alpha = Math.sin(w0) / (2 * q)
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  return { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 }
}

function highpass(sampleRate: number, cutoffHz: number, q = Math.SQRT1_2): Biquad {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate
  const alpha = Math.sin(w0) / (2 * q)
  const cos = Math.cos(w0)
  const a0 = 1 + alpha
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 }
}

export type AudioFeatureExtractorOptions = {
  /** Chamado a cada quadro novo (índice no `store`). */
  onFrame?: (index: number) => void
}

/**
 * Extrator incremental. Um por turno (ou `reset()` entre turnos). Suporta uma única taxa de
 * amostragem por fluxo; se ela mudar, o fluxo recomeça.
 */
export class AudioFeatureExtractor {
  readonly store = new FeatureFrameStore()

  private sampleRate = 0
  private subBlockSize = 0
  private decimation = 1
  private decimatedPerSubBlock = 0
  private minLag = 0
  private maxLag = 0
  private decimatedWindow = 0

  // Estado dos filtros (forma direta II transposta): LP 3 kHz → HP 300 Hz (banda de vogais),
  // LP 3 kHz → LP 1 kHz (antes de decimar), HP 4 kHz (fricção).
  private lp3 = lowpass(24000, 3000)
  private hp300 = highpass(24000, 300)
  private lp1k = lowpass(24000, 1000)
  private hp4k = highpass(24000, 4000)
  private hp1k = highpass(24000, 1000)
  private hp1kz1 = 0
  private hp1kz2 = 0
  private hp1kbz1 = 0
  private hp1kbz2 = 0
  private lp3z1 = 0
  private lp3z2 = 0
  private hp300z1 = 0
  private hp300z2 = 0
  private lp1kz1 = 0
  private lp1kz2 = 0
  private hp4kz1 = 0
  private hp4kz2 = 0
  private lastSign = 0

  /** Instante (relógio do contexto) da amostra 0 do fluxo contínuo atual. */
  private streamStart = 0
  /** Amostras consumidas no fluxo atual. */
  private streamSamples = 0
  /** Fim esperado do último chunk (para detectar buracos). */
  private expectedNext = -Infinity
  private lastFrameTime = -Infinity

  // Sub-bloco em andamento.
  private subPos = 0
  private accFull = 0
  private accVowel = 0
  private accHigh = 0
  private accZc = 0
  private accMid = 0

  // Anel dos últimos sub-blocos completos (somas) e contador total de sub-blocos no fluxo.
  private ringFull = new Float64Array(SUB_BLOCKS_PER_FRAME)
  private ringVowel = new Float64Array(SUB_BLOCKS_PER_FRAME)
  private ringHigh = new Float64Array(SUB_BLOCKS_PER_FRAME)
  private ringZc = new Float64Array(SUB_BLOCKS_PER_FRAME)
  private ringMid = new Float64Array(SUB_BLOCKS_PER_FRAME)
  private subBlocks = 0

  // Sinal decimado (~4 kHz) dos últimos quadros, para o vozeamento.
  private decimated = new Float32Array(0)
  private correlation = new Float64Array(0)
  private lastF0Hz = 0
  private decimatedCount = 0
  private decimationPhase = 0
  private prefix = new Float64Array(0)

  private readonly onFrame?: (index: number) => void

  constructor(options: AudioFeatureExtractorOptions = {}) {
    this.onFrame = options.onFrame
  }

  /** Fim do áudio já analisado (relógio do contexto): até onde existem quadros completos. */
  get analyzedUntil(): number {
    return this.store.count > 0 ? this.store.time[this.store.count - 1] + (SUB_BLOCK_MS / 1000) * SUB_BLOCKS_PER_HOP / 2 : this.expectedNext === -Infinity ? 0 : this.streamStart
  }

  /** Fim do áudio recebido (relógio do contexto). */
  get receivedUntil(): number {
    return this.expectedNext === -Infinity ? 0 : this.expectedNext
  }

  reset(): void {
    this.store.clear()
    this.sampleRate = 0
    this.expectedNext = -Infinity
    this.lastFrameTime = -Infinity
    this.resetStream(0)
  }

  /**
   * Analisa um chunk agendado em `startAt`. Devolve quantos quadros novos foram produzidos.
   */
  push(pcm: Float32Array, startAt: number, sampleRate: number): number {
    const before = this.store.count
    if (sampleRate !== this.sampleRate) this.configure(sampleRate, startAt)
    else if (this.expectedNext === -Infinity) this.resetStream(startAt)
    else {
      const gap = startAt - this.expectedNext
      if (gap > CONTIGUITY_TOLERANCE_SECONDS) this.fillGap(gap, startAt)
      else if (gap < -CONTIGUITY_TOLERANCE_SECONDS) this.resetStream(startAt)
    }
    this.consume(pcm, pcm.length)
    this.expectedNext = this.streamStart + this.streamSamples / this.sampleRate
    return this.store.count - before
  }

  /**
   * Fim do áudio do turno: completa os quadros que cobrem o final com zeros (o que vem depois é
   * silêncio no alto-falante), para o alinhador enxergar até a última amostra.
   */
  flush(): number {
    if (this.sampleRate === 0 || this.expectedNext === -Infinity) return 0
    const before = this.store.count
    const pad = this.subBlockSize * SUB_BLOCKS_PER_FRAME
    this.consume(null, pad)
    // O preenchimento não é áudio recebido: o próximo chunk (se vier) continua do fim real.
    this.expectedNext = this.streamStart + this.streamSamples / this.sampleRate
    return this.store.count - before
  }

  private configure(sampleRate: number, startAt: number): void {
    this.sampleRate = sampleRate
    this.decimation = Math.max(1, Math.round(sampleRate / VOICING_RATE))
    const decimatedRate = sampleRate / this.decimation
    this.decimatedPerSubBlock = Math.max(1, Math.round((sampleRate * SUB_BLOCK_MS) / 1000 / this.decimation))
    this.subBlockSize = this.decimatedPerSubBlock * this.decimation
    this.minLag = Math.max(2, Math.floor(decimatedRate / F0_MAX_HZ))
    this.maxLag = Math.ceil(decimatedRate / F0_MIN_HZ)
    this.decimatedWindow = this.decimatedPerSubBlock * SUB_BLOCKS_PER_FRAME
    this.decimated = new Float32Array(this.decimatedWindow * 4)
    this.prefix = new Float64Array(this.decimatedWindow + 1)
    this.correlation = new Float64Array(this.maxLag + 2)
    this.lp3 = lowpass(sampleRate, Math.min(3000, sampleRate * 0.45))
    this.hp300 = highpass(sampleRate, 300)
    this.lp1k = lowpass(sampleRate, Math.min(1000, decimatedRate * 0.3))
    this.hp4k = highpass(sampleRate, Math.min(4000, sampleRate * 0.4))
    this.hp1k = highpass(sampleRate, Math.min(1000, sampleRate * 0.2))
    this.resetStream(startAt)
  }

  private resetStream(startAt: number): void {
    this.streamStart = startAt
    this.streamSamples = 0
    this.lp3z1 = this.lp3z2 = this.hp300z1 = this.hp300z2 = 0
    this.lp1kz1 = this.lp1kz2 = this.hp4kz1 = this.hp4kz2 = 0
    this.hp1kz1 = this.hp1kz2 = this.hp1kbz1 = this.hp1kbz2 = 0
    this.lastSign = 0
    this.subPos = 0
    this.accFull = this.accVowel = this.accHigh = this.accZc = this.accMid = 0
    this.ringMid.fill(0)
    this.ringFull.fill(0)
    this.ringVowel.fill(0)
    this.ringHigh.fill(0)
    this.ringZc.fill(0)
    this.subBlocks = 0
    this.decimatedCount = 0
    this.decimationPhase = 0
  }

  /**
   * Buraco curto: zeros de verdade (mantém filtros e janela coerentes com o que se ouve).
   * Buraco longo: fecha o fluxo com zeros suficientes para os quadros em aberto, grava quadros de
   * silêncio no meio e recomeça limpo no próximo chunk.
   */
  private fillGap(gap: number, nextStart: number): void {
    if (gap <= MAX_ZERO_FILL_SECONDS) {
      this.consume(null, Math.round(gap * this.sampleRate))
      // Reancora no instante exato do chunk (o arredondamento de amostras não acumula).
      this.streamStart = nextStart - this.streamSamples / this.sampleRate
      return
    }
    this.consume(null, this.subBlockSize * SUB_BLOCKS_PER_FRAME)
    const hop = (SUB_BLOCK_MS * SUB_BLOCKS_PER_HOP) / 1000
    let t = Math.max(this.lastFrameTime + hop, this.streamStart + this.streamSamples / this.sampleRate)
    const halfWindow = (SUB_BLOCK_MS * SUB_BLOCKS_PER_FRAME) / 2000
    while (t + halfWindow <= nextStart) {
      this.emit(t, SILENCE_DB, SILENCE_DB, 0, 0, 0)
      t += hop
    }
    this.resetStream(nextStart)
  }

  /** Processa `length` amostras de `pcm` (ou zeros quando `pcm` é null). */
  private consume(pcm: Float32Array | null, length: number): void {
    const lp3 = this.lp3
    const hp300 = this.hp300
    const lp1k = this.lp1k
    const hp4k = this.hp4k
    let lp3z1 = this.lp3z1
    let lp3z2 = this.lp3z2
    let hp300z1 = this.hp300z1
    let hp300z2 = this.hp300z2
    let lp1kz1 = this.lp1kz1
    let lp1kz2 = this.lp1kz2
    let hp4kz1 = this.hp4kz1
    let hp4kz2 = this.hp4kz2
    const hp1k = this.hp1k
    let hp1kz1 = this.hp1kz1
    let hp1kz2 = this.hp1kz2
    let hp1kbz1 = this.hp1kbz1
    let hp1kbz2 = this.hp1kbz2
    let accMid = this.accMid
    let lastSign = this.lastSign
    let subPos = this.subPos
    let accFull = this.accFull
    let accVowel = this.accVowel
    let accHigh = this.accHigh
    let accZc = this.accZc
    let phase = this.decimationPhase
    const subBlockSize = this.subBlockSize
    const decimation = this.decimation

    for (let n = 0; n < length; n++) {
      const x = pcm === null ? 0 : pcm[n]
      accFull += x * x
      if (x > 0) {
        if (lastSign < 0) accZc++
        lastSign = 1
      } else if (x < 0) {
        if (lastSign > 0) accZc++
        lastSign = -1
      }
      // LP 3 kHz
      const y1 = lp3.b0 * x + lp3z1
      lp3z1 = lp3.b1 * x - lp3.a1 * y1 + lp3z2
      lp3z2 = lp3.b2 * x - lp3.a2 * y1
      // HP 300 Hz sobre o LP → banda de vogais
      const vb = hp300.b0 * y1 + hp300z1
      hp300z1 = hp300.b1 * y1 - hp300.a1 * vb + hp300z2
      hp300z2 = hp300.b2 * y1 - hp300.a2 * vb
      accVowel += vb * vb
      // 2× HP 1 kHz sobre o LP 3 kHz → banda de F2 (24 dB/oitava: o murmúrio nasal não vaza).
      const m1 = hp1k.b0 * y1 + hp1kz1
      hp1kz1 = hp1k.b1 * y1 - hp1k.a1 * m1 + hp1kz2
      hp1kz2 = hp1k.b2 * y1 - hp1k.a2 * m1
      const m2 = hp1k.b0 * m1 + hp1kbz1
      hp1kbz1 = hp1k.b1 * m1 - hp1k.a1 * m2 + hp1kbz2
      hp1kbz2 = hp1k.b2 * m1 - hp1k.a2 * m2
      accMid += m2 * m2
      // HP 4 kHz → fricção
      const hb = hp4k.b0 * x + hp4kz1
      hp4kz1 = hp4k.b1 * x - hp4k.a1 * hb + hp4kz2
      hp4kz2 = hp4k.b2 * x - hp4k.a2 * hb
      accHigh += hb * hb
      // LP 1 kHz sobre o LP 3 kHz → antialiasing da decimação
      const y2 = lp1k.b0 * y1 + lp1kz1
      lp1kz1 = lp1k.b1 * y1 - lp1k.a1 * y2 + lp1kz2
      lp1kz2 = lp1k.b2 * y1 - lp1k.a2 * y2
      if (++phase === decimation) {
        phase = 0
        this.pushDecimated(y2)
      }
      if (++subPos === subBlockSize) {
        subPos = 0
        this.accFull = accFull
        this.accVowel = accVowel
        this.accHigh = accHigh
        this.accZc = accZc
        this.accMid = accMid
        this.completeSubBlock()
        accFull = accVowel = accHigh = accZc = accMid = 0
      }
    }
    this.streamSamples += length
    this.lp3z1 = lp3z1
    this.lp3z2 = lp3z2
    this.hp300z1 = hp300z1
    this.hp300z2 = hp300z2
    this.lp1kz1 = lp1kz1
    this.lp1kz2 = lp1kz2
    this.hp4kz1 = hp4kz1
    this.hp4kz2 = hp4kz2
    this.hp1kz1 = hp1kz1
    this.hp1kz2 = hp1kz2
    this.hp1kbz1 = hp1kbz1
    this.hp1kbz2 = hp1kbz2
    this.accMid = accMid
    this.lastSign = lastSign
    this.subPos = subPos
    this.accFull = accFull
    this.accVowel = accVowel
    this.accHigh = accHigh
    this.accZc = accZc
    this.decimationPhase = phase
  }

  private pushDecimated(value: number): void {
    if (this.decimatedCount === this.decimated.length) {
      // Mantém só a janela mais recente (o que um quadro futuro ainda pode precisar).
      const keep = this.decimatedWindow
      this.decimated.copyWithin(0, this.decimatedCount - keep, this.decimatedCount)
      this.decimatedCount = keep
    }
    this.decimated[this.decimatedCount++] = value
  }

  private completeSubBlock(): void {
    const slot = this.subBlocks % SUB_BLOCKS_PER_FRAME
    this.ringFull[slot] = this.accFull
    this.ringVowel[slot] = this.accVowel
    this.ringHigh[slot] = this.accHigh
    this.ringZc[slot] = this.accZc
    this.ringMid[slot] = this.accMid
    this.subBlocks++
    const firstSub = this.subBlocks - SUB_BLOCKS_PER_FRAME
    if (firstSub < 0 || firstSub % SUB_BLOCKS_PER_HOP !== 0) return
    let full = 0
    let vowel = 0
    let high = 0
    let zc = 0
    let mid = 0
    for (let k = 0; k < SUB_BLOCKS_PER_FRAME; k++) {
      mid += this.ringMid[k]
      full += this.ringFull[k]
      vowel += this.ringVowel[k]
      high += this.ringHigh[k]
      zc += this.ringZc[k]
    }
    const n = this.subBlockSize * SUB_BLOCKS_PER_FRAME
    const centerSample = firstSub * this.subBlockSize + n / 2
    const time = this.streamStart + centerSample / this.sampleRate
    if (time <= this.lastFrameTime) return
    const energyDb = 10 * Math.log10(full / n + ENERGY_EPSILON)
    const vowelBandDb = 10 * Math.log10(vowel / n + ENERGY_EPSILON)
    const highBandRatio = full > ENERGY_EPSILON * n ? Math.min(1, high / full) : 0
    const zeroCrossingRate = zc / (n - 1)
    const voicing = energyDb > -60 ? this.voicingOfLastWindow() : 0
    const f0Hz = voicing >= F0_MIN_VOICING ? this.lastF0Hz : 0
    const midBandDb = 10 * Math.log10(mid / n + ENERGY_EPSILON)
    this.emit(time, energyDb, vowelBandDb, highBandRatio, zeroCrossingRate, voicing, midBandDb, f0Hz)
  }

  private emit(time: number, energyDb: number, vowelBandDb: number, highBandRatio: number, zeroCrossingRate: number, voicing: number, midBandDb = vowelBandDb, f0Hz = 0): void {
    this.lastFrameTime = time
    this.store.push(time, energyDb, vowelBandDb, highBandRatio, zeroCrossingRate, voicing, midBandDb, f0Hz)
    this.onFrame?.(this.store.count - 1)
  }

  /**
   * Autocorrelação normalizada máxima (0..1) na janela decimada mais recente, dentro da faixa de
   * F0. A janela do quadro termina exatamente onde o sub-bloco atual terminou. Deixa em
   * `lastF0Hz` a frequência do período escolhido (menor lag perto do máximo, refinado por parábola).
   */
  private voicingOfLastWindow(): number {
    const size = this.decimatedWindow
    if (this.decimatedCount < size) return 0
    const x = this.decimated
    const offset = this.decimatedCount - size
    const prefix = this.prefix
    prefix[0] = 0
    for (let n = 0; n < size; n++) {
      const v = x[offset + n]
      prefix[n + 1] = prefix[n] + v * v
    }
    const total = prefix[size]
    if (total <= ENERGY_EPSILON) return 0
    let best = 0
    const maxLag = Math.min(this.maxLag, size - 8)
    const correlation = this.correlation
    for (let lag = this.minLag; lag <= maxLag; lag++) {
      let acc = 0
      const end = offset + size - lag
      for (let n = offset; n < end; n++) acc += x[n] * x[n + lag]
      let r = 0
      if (acc > 0) {
        const e1 = prefix[size - lag]
        const e2 = total - prefix[lag]
        r = acc / Math.sqrt(e1 * e2 + ENERGY_EPSILON)
      }
      correlation[lag] = r
      if (r > best) best = r
    }
    // Período: o primeiro máximo local que chega perto do melhor (evita a oitava abaixo). Picos
    // comparados já interpolados por parábola: a 4 kHz, uma voz de 320 Hz tem período de 12,5
    // amostras e os lags inteiros vizinhos subestimam a correlação do período verdadeiro.
    // Na borda da faixa (lag mínimo) o vizinho de fora não existe: conta como igual ao pico.
    this.lastF0Hz = 0
    const minLag = this.minLag
    let bestPeak = 0
    for (let lag = minLag; lag < maxLag; lag++) {
      const r = correlation[lag]
      const before = lag > minLag ? correlation[lag - 1] : r
      if (r < before || r < correlation[lag + 1]) continue
      bestPeak = Math.max(bestPeak, interpolatedPeak(before, r, correlation[lag + 1]))
    }
    for (let lag = minLag; lag < maxLag; lag++) {
      const r = correlation[lag]
      const before = lag > minLag ? correlation[lag - 1] : r
      const after = correlation[lag + 1]
      if (r < before || r < after) continue
      if (interpolatedPeak(before, r, after) < F0_OCTAVE_TOLERANCE * bestPeak) continue
      const curvature = before - 2 * r + after
      const shift = curvature < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / curvature)) : 0
      this.lastF0Hz = this.sampleRate / this.decimation / (lag + shift)
      break
    }
    return best > 1 ? 1 : best
  }
}
