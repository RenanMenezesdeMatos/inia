import type { WebSocketLike } from "@/lib/realtime/gemini-realtime-transport"
import type { CaptureStep } from "./capture-steps"

/**
 * "Servidor" Gemini Live falso do laboratório do avatar: implementa o `WebSocketLike` que o
 * transporte de produção usa e responde com uma captura REAL (`capture-steps.ts`), nos instantes
 * relativos em que ela chegou — o transporte, a reprodução, o lip-sync e o avatar são os de
 * produção; só a rede é substituída. Zero custo de API, zero login.
 *
 * Protocolo simulado (o subconjunto que o transporte manda):
 * - `setup` → `setupComplete`;
 * - fim do turno do usuário — `realtimeInput.activityEnd` (voz, ou texto: o `sendText` manda
 *   `activityStart` → `text` → `activityEnd`) ou `clientContent` → reproduz o próximo script
 *   (`nextScript()`, escolhido pelo laboratório);
 * - `realtimeInput.activityStart` no meio de uma resposta (barge-in) → como medido ao vivo em
 *   2026-09-24: ainda chegam 1–2 mensagens da geração ANTIGA (já estavam em voo), e ~190 ms
 *   depois vêm `interrupted` + `turnComplete`. O resto da captura é descartado;
 * - áudio do microfone (`realtimeInput.audio`) e o resto: ignorados.
 */

export type ReplayScript = {
  id: string
  /** Mensagens já com os instantes desejados (original ou "sem espera inicial"). */
  steps: readonly CaptureStep[]
}

/** Relógio injetável (os testes usam timers falsos; o navegador, `performance.now()`). */
export type ReplayClock = {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export type FixtureReplayEvent =
  | { type: "setup" }
  | { type: "replay-started"; scriptId: string; trigger: "text" | "activityEnd" }
  | { type: "replay-finished"; scriptId: string }
  | { type: "no-script"; trigger: "text" | "activityEnd" }
  | { type: "barge-in"; scriptId: string | null; inFlight: number; serverInterrupt: boolean }

export type ReplayBargeInOptions = {
  /** Mensagens da geração antiga que ainda chegam depois do `activityStart` (padrão 2). */
  inFlightMessages?: number
  /** Janela em que essas mensagens chegam (padrão 150 ms). */
  inFlightWindowMs?: number
  /** Quando chegam `interrupted` + `turnComplete` (padrão 190 ms). */
  interruptAfterMs?: number
}

export type FixtureReplaySocketOptions = {
  /** Script da resposta ao turno que acabou de terminar; `null` = responde só `turnComplete`. */
  nextScript: () => ReplayScript | null
  clock?: ReplayClock
  /** Atraso do `open` (padrão 0 ms: próximo ciclo do event loop). */
  openDelayMs?: number
  /** Atraso do `setupComplete` depois do `setup` (padrão 20 ms). */
  setupDelayMs?: number
  bargeIn?: ReplayBargeInOptions
  /** Diagnóstico do laboratório (linha do log). */
  onEvent?: (event: FixtureReplayEvent) => void
}

export const browserReplayClock: ReplayClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
}

const OPEN = 1
const CLOSED = 3

type ActiveReplay = {
  script: ReplayScript
  startedAt: number
  index: number
  timer: unknown
  turnCompleteSent: boolean
}

/** Barge-in em andamento: mensagens ainda por chegar (em voo + interrupted/turnComplete). */
type PendingBargeIn = { timers: Set<unknown>; queue: CaptureStep["message"][] }

export class FixtureReplaySocket extends EventTarget {
  readyState = 0
  readonly sent: Array<Record<string, unknown>> = []
  private readonly clock: ReplayClock
  private readonly options: FixtureReplaySocketOptions
  private active: ActiveReplay | null = null
  private pendingBargeIn: PendingBargeIn | null = null
  private readonly timers = new Set<unknown>()
  /** A atividade do usuário em aberto trouxe texto (`sendText`), não áudio. */
  private textInActivity = false

  constructor(
    readonly url: string,
    options: FixtureReplaySocketOptions,
  ) {
    super()
    this.options = options
    this.clock = options.clock ?? browserReplayClock
    this.later(options.openDelayMs ?? 0, () => {
      if (this.readyState !== 0) return
      this.readyState = OPEN
      this.dispatchEvent(new Event("open"))
    })
  }

  asWebSocket(): WebSocketLike {
    return this as unknown as WebSocketLike
  }

  /** Há resposta sendo "transmitida" agora (diagnóstico). */
  get replaying(): string | null {
    return this.active?.script.id ?? null
  }

  send(data: string): void {
    if (this.readyState !== OPEN) return
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    const input = payload.realtimeInput as Record<string, unknown> | undefined
    // O áudio do microfone (~19 chunks/s) não interessa ao diagnóstico — não acumula.
    if (!input?.audio) this.sent.push(payload)
    if (payload.setup) {
      this.later(this.options.setupDelayMs ?? 20, () => {
        this.options.onEvent?.({ type: "setup" })
        this.deliver({ setupComplete: {} })
      })
      return
    }
    if (payload.clientContent) {
      this.startReplay("text")
      return
    }
    if (input?.activityStart) {
      this.textInActivity = false
      this.bargeIn()
    } else if (typeof input?.text === "string") this.textInActivity = true
    else if (input?.activityEnd) {
      const trigger = this.textInActivity ? "text" : "activityEnd"
      this.textInActivity = false
      this.startReplay(trigger)
    }
  }

  close(): void {
    if (this.readyState === CLOSED) return
    this.readyState = CLOSED
    for (const handle of this.timers) this.clock.clearTimeout(handle)
    this.timers.clear()
    this.active = null
    this.pendingBargeIn = null
    const event = typeof CloseEvent === "function" ? new CloseEvent("close", { code: 1000, reason: "lab" }) : new Event("close")
    this.dispatchEvent(event)
  }

  // ---------------------------------------------------------------------------

  private startReplay(trigger: "text" | "activityEnd"): void {
    // O servidor fecha a geração interrompida ANTES de responder ao turno novo.
    this.flushBargeIn()
    this.cancelActive()
    const script = this.options.nextScript()
    if (!script) {
      this.options.onEvent?.({ type: "no-script", trigger })
      this.later(0, () => this.deliver({ serverContent: { turnComplete: true } }))
      return
    }
    const replay: ActiveReplay = { script, startedAt: this.clock.now(), index: 0, timer: null, turnCompleteSent: false }
    this.active = replay
    this.options.onEvent?.({ type: "replay-started", scriptId: script.id, trigger })
    this.scheduleNext(replay)
  }

  private scheduleNext(replay: ActiveReplay): void {
    if (this.active !== replay) return
    const step = replay.script.steps[replay.index]
    if (!step) {
      this.active = null
      this.options.onEvent?.({ type: "replay-finished", scriptId: replay.script.id })
      return
    }
    const delay = Math.max(0, replay.startedAt + step.t - this.clock.now())
    replay.timer = this.later(delay, () => this.pump(replay))
  }

  // Um timer por vez; cada disparo entrega TUDO o que já venceu (várias mensagens coladas, como
  // a rede entrega quando o áudio vem mais rápido que o tempo real).
  private pump(replay: ActiveReplay): void {
    if (this.active !== replay) return
    const steps = replay.script.steps
    const now = this.clock.now()
    while (replay.index < steps.length && replay.startedAt + steps[replay.index]!.t <= now + 0.5) {
      const step = steps[replay.index++]!
      if (step.kind === "turnComplete") replay.turnCompleteSent = true
      this.deliver(step.message)
      if (this.active !== replay) return
    }
    this.scheduleNext(replay)
  }

  private bargeIn(): void {
    const replay = this.active
    if (!replay || replay.turnCompleteSent) {
      this.options.onEvent?.({ type: "barge-in", scriptId: null, inFlight: 0, serverInterrupt: false })
      return
    }
    this.cancelActive()
    const config = this.options.bargeIn ?? {}
    const limit = Math.max(0, config.inFlightMessages ?? 2)
    const windowMs = Math.max(0, config.inFlightWindowMs ?? 150)
    const interruptAfterMs = Math.max(windowMs, config.interruptAfterMs ?? 190)
    // Em voo = o que o servidor já tinha gerado: só conteúdo (áudio/texto) antes do fim da geração.
    const inFlight: CaptureStep[] = []
    for (let i = replay.index; i < replay.script.steps.length && inFlight.length < limit; i++) {
      const step = replay.script.steps[i]!
      if (step.kind !== "audio" && step.kind !== "transcript") break
      inFlight.push(step)
    }
    const pending: PendingBargeIn = { timers: new Set(), queue: [] }
    this.pendingBargeIn = pending
    const deliverPending = () => {
      const message = pending.queue.shift()
      if (message) this.deliver(message)
      if (pending.queue.length === 0 && this.pendingBargeIn === pending) this.pendingBargeIn = null
    }
    inFlight.forEach((step, k) => {
      pending.queue.push(step.message)
      pending.timers.add(this.later(((k + 1) * windowMs) / (inFlight.length + 1), deliverPending))
    })
    pending.queue.push({ serverContent: { interrupted: true } }, { serverContent: { turnComplete: true } })
    pending.timers.add(this.later(interruptAfterMs, () => {
      deliverPending()
      deliverPending()
    }))
    this.options.onEvent?.({ type: "barge-in", scriptId: replay.script.id, inFlight: inFlight.length, serverInterrupt: true })
  }

  private flushBargeIn(): void {
    const pending = this.pendingBargeIn
    if (!pending) return
    this.pendingBargeIn = null
    for (const handle of pending.timers) this.cancelTimer(handle)
    for (const message of pending.queue.splice(0)) this.deliver(message)
  }

  private cancelActive(): void {
    const replay = this.active
    if (!replay) return
    this.active = null
    this.cancelTimer(replay.timer)
  }

  private deliver(message: unknown): void {
    if (this.readyState !== OPEN) return
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) }))
  }

  private later(ms: number, callback: () => void): unknown {
    const handle = this.clock.setTimeout(() => {
      this.timers.delete(handle)
      callback()
    }, ms)
    this.timers.add(handle)
    return handle
  }

  private cancelTimer(handle: unknown): void {
    if (handle === null || handle === undefined) return
    this.clock.clearTimeout(handle)
    this.timers.delete(handle)
  }
}
