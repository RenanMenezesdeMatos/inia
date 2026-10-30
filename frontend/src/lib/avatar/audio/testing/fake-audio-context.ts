import { vi } from "vitest"

// Web Audio falso (apoio de TESTE): só o que a reprodução usa, com relógio controlado pelo teste.
export class FakeParam {
  value = 1
  calls: Array<[string, number, number]> = []
  cancelScheduledValues(time: number) { this.calls.push(["cancel", 0, time]) }
  setValueAtTime(value: number, time: number) { this.calls.push(["set", value, time]) }
  linearRampToValueAtTime(value: number, time: number) { this.calls.push(["ramp", value, time]) }
}

export class FakeNode {
  outputs = new Set<FakeNode>()
  connect(node: FakeNode) { this.outputs.add(node); return node }
  disconnect(node?: FakeNode) { if (node) this.outputs.delete(node); else this.outputs.clear() }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam()
}

export class FakeBuffer {
  private readonly data: Float32Array
  constructor(length: number, readonly sampleRate: number) { this.data = new Float32Array(length) }
  getChannelData() { return this.data }
}

export class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null
  onended: (() => void) | null = null
  startedAt: number | null = null
  stoppedAt: number | null = null
  ended = false
  start(time: number) { this.startedAt = time }
  stop(time: number) { this.stoppedAt = time }
  /** Dispara o `onended` (uma vez só, como o navegador). */
  finish() {
    if (this.ended) return
    this.ended = true
    this.onended?.()
  }
  /** Fim real no grafo: o natural do buffer ou o `stop()`, o que vier antes. */
  get endAt(): number {
    if (this.startedAt === null) return Number.POSITIVE_INFINITY
    const natural = this.startedAt + (this.buffer ? this.buffer.getChannelData().length / this.buffer.sampleRate : 0)
    return this.stoppedAt === null ? natural : Math.min(natural, this.stoppedAt)
  }
}

export class FakeContext {
  currentTime = 0
  state: "suspended" | "running" | "closed" = "suspended"
  outputLatency: number | undefined = undefined
  baseLatency: number | undefined = undefined
  outputStamp: { contextTime?: number; performanceTime?: number } | null = null
  readonly destination = new FakeNode()
  readonly gains: FakeGain[] = []
  readonly sources: FakeSource[] = []
  resume = vi.fn(async () => { this.state = "running" })
  close = vi.fn(async () => { this.state = "closed" })
  createGain() { const gain = new FakeGain(); this.gains.push(gain); return gain }
  createBuffer(_channels: number, length: number, sampleRate: number) { return new FakeBuffer(length, sampleRate) }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source }
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number }
}

/** Fábrica para `createSpeechPlayback({ createContext })` que guarda os contextos criados. */
export function fakeContextFactory() {
  const contexts: FakeContext[] = []
  const createContext = vi.fn(() => {
    const context = new FakeContext()
    contexts.push(context)
    return context as unknown as AudioContext
  })
  return { contexts, createContext, current: () => contexts[contexts.length - 1]! }
}

/** Avança o relógio e termina (onended) toda fonte cujo fim já passou — o que o navegador faria. */
export function advanceContext(context: FakeContext, time: number): void {
  context.currentTime = time
  for (const source of context.sources) if (source.endAt <= time + 1e-9) source.finish()
}
