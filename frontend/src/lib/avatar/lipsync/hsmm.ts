import type { AlignmentElement } from "./alignment-elements"
import { CLASS_INDEX, type WindowEmissions } from "./emission-model"

/**
 * Alinhamento forçado por Viterbi SEGMENTAL (semi-Markov): a sequência de elementos (fones e pausas
 * opcionais) é casada com os quadros de 10 ms de uma janela, e cada elemento ocupa um segmento
 * contíguo cuja duração tem custo explícito (log-normal em torno da priori × taxa de fala).
 *
 *   S[j][t] = melhor caminho com o elemento j terminando na fronteira t
 *           = max( S[j−1][t] − pular_j                                   (opcional)
 *                  max_d S[j−1][t−d] + duração_j(d) + Σ emissão_j(t−d..t) + presença_j )
 *
 * Por que semi-Markov e não HMM de estados: com cadeia de estados a duração vira geométrica e o
 * alinhador "gruda" fones curtos em qualquer transição. Aqui a duração pesa de verdade — é o que
 * mantém o ritmo quando a acústica é ambígua (vogal → vogal, nasal → vogal) e deixa os marcos
 * fortes (silêncio de oclusiva, fricção, pausa) puxarem as fronteiras.
 *
 * Janela aberta: o áudio continua depois da janela, então o último elemento pode estar pela metade
 * (só a duração LONGA demais custa). Se o texto acabou mas o áudio não (transcrição atrasada), um
 * "enchimento" depois do último elemento absorve o resto — é o sinal para o modo só-áudio. O enchimento
 * é um modelo de lixo (melhor classe do quadro − margem): sem ele competitivo, o melhor caminho
 * ESTICA o texto conhecido por cima da fala cujo texto ainda não chegou.
 *
 * Tudo em typed arrays reaproveitados: nada de alocação por célula.
 */

const NEG = -1e30
/** Durações de pausa acima disso (quadros) não custam mais nada (pausa longa é normal). */
const PAUSE_FLAT_FRAMES = 60
const DURATION_WEIGHT = 1
/** Marcador no `back`: começa aqui (elementos anteriores consumidos fora da janela). */
const BACK_START = -2
const BACK_SKIP = 0
const PAUSE_CLASS = CLASS_INDEX.pause

export type HsmmInput = {
  elements: readonly AlignmentElement[]
  /** Primeiro elemento da janela (índice global) e quantos entram. */
  firstElement: number
  elementCount: number
  emissions: WindowEmissions
  /** Segundos reais por segundo de priori. */
  rate: number
  /**
   * Custo de começar pulando `s` elementos (s ≥ 1): texto que foi falado enquanto o motor estava
   * em modo só-áudio. `null` = começa sempre no primeiro.
   */
  startCosts: Float64Array | null
  /** O áudio continua depois da janela (último elemento pode estar pela metade). */
  openEnd: boolean
  /**
   * > 0: o primeiro elemento já começou a ser OUVIDO (fone provisório que continua): não pode ser
   * pulado e dura pelo menos estes quadros — o que já foi desenhado dele não muda.
   */
  firstHeldFrames?: number
  /** O texto acabou (por ora) no último elemento da janela e o áudio pode seguir sem texto. */
  filler: boolean
  /**
   * Enchimento = "fala de texto que ainda não chegou": cada quadro vale a classe que MELHOR o explica
   * menos esta margem (modelo de lixo). Texto certo ganha do enchimento por quadro; texto esticado
   * por cima de fala que não é dele perde.
   */
  fillerMargin: number
  /** Custo fixo de terminar no enchimento (0 = só a margem por quadro). */
  fillerEntryCost?: number
}

/** Segmento do melhor caminho, em quadros LOCAIS da janela. */
export type HsmmSegment = {
  /** Índice global do elemento. */
  element: number
  start: number
  end: number
  skipped: boolean
  /** Último elemento de janela aberta: pode continuar depois do fim da janela. */
  partial: boolean
}

export type HsmmEnd = { score: number; element: number; kind: "complete" | "partial" | "filler"; from: number }

export class SegmentalViterbi {
  private score = new Float64Array(0)
  private back = new Int32Array(0)
  private minF = new Int32Array(0)
  private maxF = new Int32Array(0)
  private expF = new Float64Array(0)
  private bandLo = new Int32Array(0)
  private bandHi = new Int32Array(0)
  private garbage = new Float64Array(0)
  private stride = 0
  private input: HsmmInput | null = null

  /** Roda o Viterbi e devolve os finais candidatos (melhor primeiro). */
  run(input: HsmmInput): HsmmEnd[] {
    this.input = input
    const W = input.emissions.count
    const K = input.elementCount
    const stride = W + 1
    this.stride = stride
    const cells = (K + 1) * stride
    if (this.score.length < cells) {
      this.score = new Float64Array(Math.max(cells, this.score.length * 2))
      this.back = new Int32Array(this.score.length)
    }
    if (this.minF.length < K) {
      const size = Math.max(K, this.minF.length * 2)
      this.minF = new Int32Array(size)
      this.maxF = new Int32Array(size)
      this.expF = new Float64Array(size)
      this.bandLo = new Int32Array(size + 1)
      this.bandHi = new Int32Array(size + 1)
    }
    const { elements, firstElement, emissions, rate } = input
    const held = input.firstHeldFrames ?? 0
    for (let j = 0; j < K; j++) {
      const element = elements[firstElement + j]!
      const scale = element.phone === "_" ? 1 : rate
      this.expF[j] = Math.max(1, (element.expectedMs * scale) / 10)
      this.minF[j] = Math.max(1, Math.round((element.minMs * Math.min(1, scale)) / 10), j === 0 ? held : 0)
      this.maxF[j] = Math.max(this.minF[j]! + 1, Math.ceil((element.maxMs * Math.max(1, scale)) / 10))
    }
    const score = this.score
    const back = this.back
    score.fill(NEG, 0, cells)
    // Linha 0 = início virtual; linha r (≥ 1) = elemento r − 1 terminado.
    score[0] = input.startCosts ? -input.startCosts[0]! : 0
    back[0] = BACK_START
    this.bandLo[0] = 0
    this.bandHi[0] = 0
    if (input.startCosts) {
      for (let r = 1; r <= K && r < input.startCosts.length; r++) {
        const cost = input.startCosts[r]!
        if (!Number.isFinite(cost)) continue
        score[r * stride] = -cost
        back[r * stride] = BACK_START
      }
    }

    for (let j = 0; j < K; j++) {
      const element = elements[firstElement + j]!
      const prevRow = j * stride
      const row = (j + 1) * stride
      const cls = element.cls
      const minF = this.minF[j]!
      const maxF = this.maxF[j]!
      const exp = this.expF[j]!
      const sigma = element.sigma
      const present = element.presentCost
      const skip = element.optional && !(j === 0 && held > 0) ? element.skipCost : Number.NaN
      const prevLo = this.bandLo[j]!
      const prevHi = this.bandHi[j]!
      const startsHere = input.startCosts !== null && score[row]! > NEG / 2
      let lo = element.optional && !(j === 0 && held > 0) ? prevLo : prevLo + minF
      if (startsHere) lo = 0
      const hi = Math.min(W, prevHi + maxF)
      this.bandLo[j + 1] = Math.min(lo, W)
      this.bandHi[j + 1] = hi
      const isPause = cls === PAUSE_CLASS && maxF > PAUSE_FLAT_FRAMES
      const flatCost = isPause ? durationCost(PAUSE_FLAT_FRAMES, exp, sigma) : 0
      // Máximo corrente de S[j][a] − C[a] para durações > PAUSE_FLAT_FRAMES (custo constante).
      let runMax = NEG
      let runArg = -1
      let runNext = prevLo
      for (let t = lo; t <= hi; t++) {
        let best = score[row + t]!
        let arg = back[row + t]!
        if (!Number.isNaN(skip)) {
          const prev = score[prevRow + t]!
          if (prev > NEG / 2 && prev - skip > best) {
            best = prev - skip
            arg = BACK_SKIP
          }
        }
        const dMax = Math.min(isPause ? PAUSE_FLAT_FRAMES : maxF, t - prevLo)
        for (let d = minF; d <= dMax; d++) {
          const prev = score[prevRow + t - d]!
          if (prev <= NEG / 2) continue
          const value = prev + present + durationCost(d, exp, sigma) + emissions.segment(cls, t - d, t)
          if (value > best) {
            best = value
            arg = d
          }
        }
        if (isPause) {
          const limit = t - PAUSE_FLAT_FRAMES - 1
          for (; runNext <= limit && runNext <= prevHi; runNext++) {
            const prev = score[prevRow + runNext]!
            if (prev <= NEG / 2) continue
            const value = prev - emissions.segment(cls, 0, runNext)
            if (value > runMax) {
              runMax = value
              runArg = runNext
            }
          }
          if (runArg >= 0 && t - runArg <= maxF) {
            const value = runMax + emissions.segment(cls, 0, t) + present + flatCost
            if (value > best) {
              best = value
              arg = t - runArg
            }
          }
        }
        score[row + t] = best
        back[row + t] = arg
      }
    }
    return this.ends()
  }

  /** Finais candidatos: elemento completo na última fronteira, pela metade (janela aberta) ou enchimento. */
  private ends(): HsmmEnd[] {
    const input = this.input!
    const W = input.emissions.count
    const K = input.elementCount
    const stride = this.stride
    const score = this.score
    const ends: HsmmEnd[] = []
    for (let j = 0; j < K; j++) {
      const complete = score[(j + 1) * stride + W]!
      if (complete > NEG / 2) ends.push({ score: complete, element: j, kind: "complete", from: W })
      if (!input.openEnd) continue
      const partial = this.bestPartial(j)
      if (partial.score > NEG / 2) ends.push({ score: partial.score, element: j, kind: "partial", from: partial.from })
    }
    if (input.filler && K > 0) {
      const g = this.fillerCumulative()
      const row = K * stride
      let best = NEG
      let from = -1
      for (let t = this.bandLo[K]!; t < W; t++) {
        const prev = score[row + t]!
        if (prev <= NEG / 2) continue
        const value = prev + g[W]! - g[t]!
        if (value > best) {
          best = value
          from = t
        }
      }
      if (from >= 0) ends.push({ score: best - (input.fillerEntryCost ?? 0), element: K - 1, kind: "filler", from })
    }
    ends.sort((a, b) => b.score - a.score)
    return ends
  }

  private bestPartial(j: number): { score: number; from: number } {
    const input = this.input!
    const element = input.elements[input.firstElement + j]!
    const W = input.emissions.count
    const prevRow = j * this.stride
    const exp = this.expF[j]!
    let best = NEG
    let from = -1
    const dMax = Math.min(W - this.bandLo[j]!, this.maxF[j]!)
    for (let d = 1; d <= dMax; d++) {
      const prev = this.score[prevRow + W - d]!
      if (prev <= NEG / 2) continue
      // Pela metade: só a duração longa demais custa.
      const duration = d <= exp ? 0 : durationCost(d, exp, element.sigma)
      const value = prev + element.presentCost + duration + input.emissions.segment(element.cls, W - d, W)
      if (value > best) {
        best = value
        from = W - d
      }
    }
    return { score: best, from }
  }

  /** Enchimento: silêncio vale como pausa, fala vale a melhor classe − `fillerMargin` (somas acumuladas). */
  private fillerCumulative(): Float64Array {
    const input = this.input!
    const W = input.emissions.count
    if (this.garbage.length < W + 1) this.garbage = new Float64Array(Math.max(W + 1, this.garbage.length * 2))
    const g = this.garbage
    g[0] = 0
    const margin = input.fillerMargin
    const bestSpeech = input.emissions.bestSpeech
    for (let i = 0; i < W; i++) g[i + 1] = g[i]! + Math.max(input.emissions.frame(PAUSE_CLASS, i), bestSpeech[i]! - margin)
    return g
  }

  /** Caminho até um final, em ordem, incluindo elementos pulados. */
  backtrack(end: HsmmEnd): HsmmSegment[] {
    const input = this.input!
    const stride = this.stride
    const out: HsmmSegment[] = []
    let j: number
    let t: number
    if (end.kind === "complete") {
      j = end.element
      t = end.from
    } else if (end.kind === "partial") {
      out.push({ element: input.firstElement + end.element, start: end.from, end: input.emissions.count, skipped: false, partial: true })
      j = end.element - 1
      t = end.from
    } else {
      j = input.elementCount - 1
      t = end.from
    }
    while (j >= 0) {
      const arg = this.back[(j + 1) * stride + t]!
      if (arg === BACK_START) break
      if (arg === BACK_SKIP) out.push({ element: input.firstElement + j, start: t, end: t, skipped: true, partial: false })
      else {
        out.push({ element: input.firstElement + j, start: t - arg, end: t, skipped: false, partial: false })
        t -= arg
      }
      j--
    }
    out.reverse()
    return out
  }
}

/** Custo log-normal robusto da duração: quadrático até 2,5σ, linear depois. */
export function durationCost(d: number, expected: number, sigma: number): number {
  const z = Math.abs(Math.log(d / expected)) / sigma
  const c = z <= 2.5 ? 0.5 * z * z : 3.125 + 2.5 * (z - 2.5)
  return -DURATION_WEIGHT * c
}
