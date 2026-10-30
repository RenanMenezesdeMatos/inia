/**
 * Aleatoriedade DETERMINÍSTICA da animação do avatar.
 *
 * Tudo que parece "vivo" (piscadas, olhar, micro-movimentos de cabeça, escolha de gesto) sai de um
 * gerador com semente — nunca de `Math.random()`. Assim os testes reproduzem exatamente a mesma
 * sequência, e o laboratório consegue gravar duas vezes o mesmo take.
 */

export interface Rng {
  /** Próximo número em [0, 1). */
  next(): number
}

/** mulberry32: 32 bits de estado, período 2^32, rápido e bom o bastante para animação. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

export function randRange(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng.next()
}

export function chance(rng: Rng, probability: number): boolean {
  return rng.next() < probability
}

/** -1 ou +1 com a mesma probabilidade. */
export function randSign(rng: Rng): number {
  return rng.next() < 0.5 ? -1 : 1
}

/** Índice sorteado com pesos (pesos ≤ 0 nunca saem); -1 se nenhum peso for positivo. */
export function pickWeighted(rng: Rng, weights: readonly number[]): number {
  let total = 0
  for (const weight of weights) if (weight > 0) total += weight
  if (total <= 0) return -1
  let roll = rng.next() * total
  for (let index = 0; index < weights.length; index++) {
    const weight = weights[index]!
    if (weight <= 0) continue
    roll -= weight
    if (roll < 0) return index
  }
  // Arredondamento: devolve o último com peso positivo.
  for (let index = weights.length - 1; index >= 0; index--) if (weights[index]! > 0) return index
  return -1
}

const LATTICE_SIZE = 256

/**
 * Ruído de valor 1D suave (interpolação quíntica) com várias oitavas em frequências
 * INCOMENSURÁVEIS — o movimento nunca "fecha o ciclo" visivelmente como uma soma de senos
 * harmônicos. Saída em aproximadamente [-1, 1].
 */
export class SmoothNoise {
  private readonly lattice: Float32Array
  private readonly frequencies: readonly number[]
  private readonly amplitudes: readonly number[]
  private readonly offsets: Float32Array
  private readonly norm: number

  /**
   * @param baseFrequency Hz da oitava mais lenta.
   * @param octaves quantas camadas somar (cada uma ~2,17× mais rápida e com metade da amplitude).
   */
  constructor(rng: Rng, baseFrequency: number, octaves = 2) {
    this.lattice = new Float32Array(LATTICE_SIZE)
    for (let index = 0; index < LATTICE_SIZE; index++) this.lattice[index] = rng.next() * 2 - 1
    const frequencies: number[] = []
    const amplitudes: number[] = []
    this.offsets = new Float32Array(octaves)
    let norm = 0
    for (let octave = 0; octave < octaves; octave++) {
      // 2,1737… não é racional "bonito": as oitavas não se realinham.
      frequencies.push(baseFrequency * Math.pow(2.1737, octave))
      const amplitude = Math.pow(0.5, octave)
      amplitudes.push(amplitude)
      norm += amplitude
      this.offsets[octave] = rng.next() * LATTICE_SIZE
    }
    this.frequencies = frequencies
    this.amplitudes = amplitudes
    this.norm = norm
  }

  sample(timeSeconds: number): number {
    let sum = 0
    for (let octave = 0; octave < this.frequencies.length; octave++) {
      sum += this.amplitudes[octave]! * this.valueAt(timeSeconds * this.frequencies[octave]! + this.offsets[octave]!)
    }
    return sum / this.norm
  }

  private valueAt(x: number): number {
    const floor = Math.floor(x)
    const fraction = x - floor
    const index = ((floor % LATTICE_SIZE) + LATTICE_SIZE) % LATTICE_SIZE
    const a = this.lattice[index]!
    const b = this.lattice[(index + 1) % LATTICE_SIZE]!
    const smooth = fraction * fraction * fraction * (fraction * (fraction * 6 - 15) + 10)
    return a + (b - a) * smooth
  }
}
