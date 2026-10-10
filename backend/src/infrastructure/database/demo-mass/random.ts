/**
 * Gerador pseudoaleatório determinístico (Mulberry32) + utilitários. Nunca `Math.random()`:
 * a massa precisa ser reproduzível byte a byte a partir de DEMO_RANDOM_SEED.
 */
export type Random = {
  next(): number
  int(min: number, max: number): number
  float(min: number, max: number): number
  /** Aproximação normal (soma de 3 uniformes) — suficiente pra dispersão plausível. */
  gaussian(mean: number, stdDev: number): number
  pick<T>(items: readonly T[]): T
  chance(probability: number): boolean
  shuffle<T>(items: readonly T[]): T[]
  /** Sub-gerador independente e reproduzível, pra isolar fluxos (ex.: um por operador). */
  fork(label: string): Random
}

export function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const random: Random = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    gaussian: (mean, stdDev) => mean + (next() + next() + next() - 1.5) * 2 * stdDev,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() em lista vazia")
      return items[Math.floor(next() * items.length)]!
    },
    chance: (probability) => next() < probability,
    shuffle: (items) => {
      const copy = [...items]
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1))
        ;[copy[index], copy[swap]] = [copy[swap]!, copy[index]!]
      }
      return copy
    },
    fork: (label) => createRandom((seed ^ hashSeed(label)) >>> 0),
  }
  return random
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
