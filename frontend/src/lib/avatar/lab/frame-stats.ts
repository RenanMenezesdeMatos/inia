/**
 * Estatística de quadros do laboratório: intervalos entre quadros numa janela circular (sem alocar
 * por quadro) → FPS, p50 e p95 do tempo de quadro. Alimentada por `requestAnimationFrame`; lida a
 * ≤ 10 Hz pelo painel de diagnóstico.
 */

export type FrameStatsSummary = {
  /** Quadros por segundo (média da janela). */
  fps: number
  p50Ms: number
  p95Ms: number
  /** Intervalos na janela. */
  count: number
}

export class FrameStats {
  private readonly intervals: Float64Array
  private readonly sorted: Float64Array
  private next = 0
  private filled = 0
  private lastAt: number | null = null

  constructor(capacity = 240) {
    this.intervals = new Float64Array(Math.max(2, capacity))
    this.sorted = new Float64Array(this.intervals.length)
  }

  /** Chame a cada quadro com o `performance.now()` do quadro. */
  tick(nowMs: number): void {
    const last = this.lastAt
    this.lastAt = nowMs
    if (last === null) return
    const interval = nowMs - last
    // Aba em segundo plano/depurador parado: um buraco enorme não é "tempo de quadro".
    if (interval <= 0 || interval > 1000) return
    this.intervals[this.next] = interval
    this.next = (this.next + 1) % this.intervals.length
    this.filled = Math.min(this.filled + 1, this.intervals.length)
  }

  /** Esquece a janela (troca de modelo/qualidade: os números anteriores não valem mais). */
  reset(): void {
    this.next = 0
    this.filled = 0
    this.lastAt = null
  }

  summary(): FrameStatsSummary {
    const count = this.filled
    if (count === 0) return { fps: 0, p50Ms: 0, p95Ms: 0, count: 0 }
    const sorted = this.sorted.subarray(0, count)
    sorted.set(this.intervals.subarray(0, count))
    sorted.sort()
    let total = 0
    for (let i = 0; i < count; i++) total += sorted[i]
    return { fps: (1000 * count) / total, p50Ms: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), count }
  }
}

/** Percentil por "nearest rank" sobre um vetor já ordenado. */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil(Math.min(1, Math.max(0, p)) * sorted.length)
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]
}
