import type { ScheduledAudioChunk } from "../lipsync/types"
import { readAvOffsetMs } from "./av-sync"
import type { PlaybackTurnEvent, SpeechPlayback, SpeechPlaybackListener, SpeechPlaybackOptions } from "./types"


/** Folga no primeiro chunk de cada rajada (s). 20 ms: imperceptível na latência da resposta. */
const BURST_START_LEAD_SECONDS = 0.02

/**
 * Reprodução da fala do Gemini Live em Web Audio — e o relógio que o lip-sync consulta.
 *
 * Cada chunk PCM16 vira um `AudioBufferSourceNode` agendado colado no anterior
 * (`startAt = max(fim do agendado, currentTime)`), então o áudio toca sem buracos mesmo chegando
 * aos pedaços, e cada chunk tem um instante EXATO no relógio do contexto. O lip-sync recebe o PCM
 * decodificado + esse `startAt` logo DEPOIS do `start()` (o Live gera mais rápido que o tempo real,
 * com folga ≥ 0,9 s — dá tempo de analisar e alinhar antes de soar). Depois, e não antes: o horário
 * do áudio nunca depende de quanto a análise demorou (JIT frio, aparelho lento).
 *
 * Turnos: cada resposta (geração) do modelo é um turno com id próprio. Chunk de turno que não é o
 * corrente é ignorado — é assim que o áudio da geração ANTIGA, que o Live ainda entrega entre o
 * `activityStart` e o `interrupted` (verificado em 2026-09-24), nunca chega ao alto-falante.
 *
 * Cada turno tem seu `GainNode` (turno → mestre → destino): a interrupção faz um fade curto só do
 * turno cortado (sem estalo) e a resposta seguinte já nasce com ganho cheio.
 *
 * "Terminou de tocar" (`turn-drained`) é o fim do ÁUDIO, não o `turnComplete` da rede — que chega
 * enquanto ainda há segundos agendados. O evento sai quando a última fonte do turno termina no grafo
 * e mais a latência de saída (o que o ouvinte escuta está atrasado em relação ao `currentTime`).
 */

const DEFAULT_SAMPLE_RATE = 24000
/** Mudo/desmudo: constante de tempo da rampa do volume geral (~0,1 s até o fim). */
const MUTE_RAMP_SECONDS = 0.03
const DEFAULT_INTERRUPT_FADE_MS = 60
/** Abaixo disso (s) o fim no grafo e o fim ouvido são o mesmo instante para quem observa o turno. */
const DRAIN_LATENCY_EPSILON = 0.015
/** Teto da espera pelo fim ouvido: uma latência reportada absurda não pode prender o estado. */
const MAX_DRAIN_DELAY = 0.5

type TurnState = {
  id: number
  /** Ganho do turno (criado no primeiro chunk). */
  gain: GainNode | null
  /** Fontes ainda não terminadas (inclusive as que estão no fade da interrupção). */
  active: number
  started: boolean
  interrupted: boolean
  /** Fim do áudio agendado do turno (s). */
  endAt: number
}

type ActiveSource = { node: AudioBufferSourceNode; turn: TurnState; endAt: number; stopping: boolean }

class WebAudioSpeechPlayback implements SpeechPlayback {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private readonly sampleRate: number
  private readonly fadeSeconds: number
  /** Ajuste fixo (laboratório, testes); `null` = o ajuste salvo DESTE aparelho (`av-sync.ts`). */
  private avOffsetOverride: number | null
  private readonly createContext: (sampleRate: number) => AudioContext
  private readonly listeners = new Set<SpeechPlaybackListener>()
  // Com a folga do Live (até ~39 s numa resposta longa) são centenas de fontes vivas de 40 ms;
  // o conjunto só é percorrido na interrupção.
  private readonly sources = new Set<ActiveSource>()
  /** Fontes vivas que NÃO estão sendo interrompidas (`isPlaying` sem percorrer o conjunto). */
  private playingCount = 0
  private turn: TurnState | null = null
  private turnSeq = 0
  /** Fim de todo o áudio agendado (qualquer turno), no relógio do contexto. */
  private cursor = 0
  private readonly drainTimers = new Set<ReturnType<typeof setTimeout>>()
  private muted = false

  constructor(options: SpeechPlaybackOptions) {
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
    this.fadeSeconds = Math.max(0, options.interruptFadeMs ?? DEFAULT_INTERRUPT_FADE_MS) / 1000
    this.avOffsetOverride = typeof options.avOffsetMs === "number" ? finiteOr(options.avOffsetMs, 0) / 1000 : null
    this.createContext = options.createContext ?? ((sampleRate) => new AudioContext({ sampleRate }))
    if (options.onChunkScheduled || options.onTurnEvent) {
      this.listeners.add({ onChunkScheduled: options.onChunkScheduled, onTurnEvent: options.onTurnEvent })
    }
  }

  get context(): AudioContext | null {
    return this.ctx
  }

  get currentTurnId(): number {
    return this.turn?.id ?? 0
  }

  get scheduledUntil(): number {
    return this.cursor
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    const ctx = this.ctx
    if (ctx && this.master && ctx.state !== "closed") this.master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, MUTE_RAMP_SECONDS)
  }

  prime(): void {
    let ctx = this.ctx
    if (!ctx || ctx.state === "closed") {
      ctx = this.createContext(this.sampleRate)
      const master = ctx.createGain()
      master.gain.value = this.muted ? 0 : 1
      master.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      this.cursor = ctx.currentTime
    }
    // "suspended" (autoplay/aba em segundo plano) ou "interrupted" (Safari/iOS).
    if (ctx.state !== "running") void ctx.resume().catch(() => {})
  }

  beginTurn(): number {
    const previous = this.turn
    if (previous && previous.active === 0) disconnectQuietly(previous.gain)
    this.turnSeq += 1
    this.turn = { id: this.turnSeq, gain: null, active: 0, started: false, interrupted: false, endAt: 0 }
    return this.turnSeq
  }

  enqueueBase64Pcm16(base64: string, turnId: number): ScheduledAudioChunk | null {
    // Não decodifica o que vai ser descartado (áudio da geração antiga chega em rajadas).
    if (!this.acceptsTurn(turnId)) return null
    return this.enqueuePcm(decodePcm16Base64(base64), turnId)
  }

  enqueuePcm(pcm: Float32Array, turnId: number): ScheduledAudioChunk | null {
    const ctx = this.ctx
    const master = this.master
    const turn = this.turn
    if (!ctx || !master || !turn || !this.acceptsTurn(turnId) || pcm.length === 0) return null
    if (!turn.gain) {
      turn.gain = ctx.createGain()
      turn.gain.connect(master)
    }
    const buffer = ctx.createBuffer(1, pcm.length, this.sampleRate)
    buffer.getChannelData(0).set(pcm)
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.connect(turn.gain)

    const now = ctx.currentTime
    // Começo de rajada (nada agendado à frente): uma folga pequena para o `start()` nunca cair no
    // passado (o chunk tocaria atrasado e encavalaria no seguinte).
    const startAt = this.cursor > now ? this.cursor : now + BURST_START_LEAD_SECONDS
    const chunk: ScheduledAudioChunk = { turnId, pcm, sampleRate: this.sampleRate, startAt, receivedAt: now }

    // O áudio primeiro: agendado antes da análise do lip-sync (síncrona, no observador), o horário dele
    // não depende de quanto ela demora.
    const source: ActiveSource = { node, turn, endAt: startAt + pcm.length / this.sampleRate, stopping: false }
    node.onended = () => this.handleEnded(source)
    node.start(startAt)
    this.sources.add(source)
    this.playingCount += 1
    this.cursor = source.endAt
    turn.active += 1
    turn.endAt = source.endAt

    // Quem escuta (lip-sync) conhece o áudio antes de ele soar: `startAt` está no futuro.
    this.emitChunk(chunk)
    // Um observador pode ter interrompido/fechado no meio do caminho (a fonte já foi parada junto).
    if (this.ctx !== ctx || this.turn !== turn || turn.interrupted) return null
    if (!turn.started) {
      turn.started = true
      this.emitTurn({ type: "turn-started", turnId, startAt })
    }
    return chunk
  }

  interrupt(): number | null {
    const ctx = this.ctx
    if (!ctx) return null
    const now = ctx.currentTime
    const stoppedAt = Math.min(now + this.fadeSeconds, Math.max(now, this.cursor))
    const touched = new Set<TurnState>()
    for (const source of this.sources) {
      if (source.stopping) continue
      source.stopping = true
      if (!touched.has(source.turn)) {
        touched.add(source.turn)
        fadeOut(source.turn.gain, now, stoppedAt)
      }
      try {
        source.node.stop(stoppedAt)
      } catch {
        // já parada
      }
    }
    this.playingCount = 0
    this.clearDrainTimers()
    if (this.turn) this.turn.interrupted = true
    this.cursor = stoppedAt
    for (const turn of touched) {
      turn.interrupted = true
      this.emitTurn({ type: "turn-interrupted", turnId: turn.id, stoppedAt })
    }
    return stoppedAt
  }

  // Inclui o fim do turno ainda "no cano" (fonte terminou no grafo, mas a latência de saída ainda
  // não deixou o ouvinte escutar): quem espera o `turn-drained` não pode concluir antes dele.
  isPlaying(): boolean {
    return this.playingCount > 0 || this.drainTimers.size > 0
  }

  heardTime(nowPerformanceMs?: number): number | null {
    const raw = this.rawHeardTime(nowPerformanceMs ?? performance.now())
    return raw === null ? null : raw + (this.avOffsetOverride ?? readAvOffsetMs() / 1000)
  }

  setAvOffsetMs(ms: number): void {
    this.avOffsetOverride = finiteOr(ms, 0) / 1000
  }

  tapOutput(node: AudioNode): () => void {
    const master = this.master
    if (!master) return () => {}
    master.connect(node)
    return () => disconnectQuietly(master, node)
  }

  subscribe(listener: SpeechPlaybackListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async close(): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const touched = new Set<TurnState>()
    for (const source of this.sources) if (!source.stopping) touched.add(source.turn)
    this.sources.clear()
    this.playingCount = 0
    this.clearDrainTimers()
    // Referências soltas ANTES do await: nada agenda num contexto fechando, e só um novo prime()
    // (dentro de um clique) cria outro.
    this.ctx = null
    this.master = null
    this.turn = null
    this.cursor = 0
    for (const turn of touched) {
      turn.interrupted = true
      this.emitTurn({ type: "turn-interrupted", turnId: turn.id, stoppedAt: now })
    }
    if (ctx.state !== "closed") {
      try {
        await ctx.close()
      } catch {
        // contexto já fechado pelo navegador
      }
    }
  }

  // ---------------------------------------------------------------------------

  private acceptsTurn(turnId: number): boolean {
    const ctx = this.ctx
    const turn = this.turn
    return ctx !== null && ctx.state !== "closed" && turn !== null && turn.id === turnId && !turn.interrupted
  }

  private rawHeardTime(nowMs: number): number | null {
    const ctx = this.ctx
    if (!ctx) return null
    const current = ctx.currentTime
    // getOutputTimestamp: instante que está saindo do dispositivo agora (Chrome/Firefox); só vale
    // depois que o contexto rodou de fato (performanceTime > 0). Nunca à frente do grafo.
    if (typeof ctx.getOutputTimestamp === "function") {
      const stamp = ctx.getOutputTimestamp()
      if (stamp.performanceTime !== undefined && stamp.performanceTime > 0 && stamp.contextTime !== undefined) {
        const extrapolated = stamp.contextTime + (nowMs - stamp.performanceTime) / 1000
        return Math.max(0, Math.min(extrapolated, current))
      }
    }
    const latency = ctx.outputLatency ?? ctx.baseLatency ?? 0
    return Math.max(0, current - finiteOr(latency, 0))
  }

  private handleEnded(source: ActiveSource): void {
    if (!this.sources.delete(source)) return
    disconnectQuietly(source.node)
    const turn = source.turn
    if (!source.stopping) this.playingCount = Math.max(0, this.playingCount - 1)
    turn.active -= 1
    if (turn.active > 0) return
    if (turn.interrupted) {
      disconnectQuietly(turn.gain)
      return
    }
    this.scheduleDrained(turn)
  }

  private scheduleDrained(turn: TurnState): void {
    const heard = this.rawHeardTime(performance.now())
    const delay = heard === null ? 0 : Math.min(MAX_DRAIN_DELAY, turn.endAt - heard)
    const fire = () => {
      // O áudio pode ter voltado (buraco de rede/tool) ou o turno pode ter sido cortado na espera.
      if (turn.active > 0 || turn.interrupted) return
      if (this.turn !== turn) disconnectQuietly(turn.gain)
      this.emitTurn({ type: "turn-drained", turnId: turn.id, endedAt: turn.endAt })
    }
    if (delay <= DRAIN_LATENCY_EPSILON) {
      fire()
      return
    }
    const timer = setTimeout(() => {
      this.drainTimers.delete(timer)
      fire()
    }, delay * 1000)
    this.drainTimers.add(timer)
  }

  private clearDrainTimers(): void {
    for (const timer of this.drainTimers) clearTimeout(timer)
    this.drainTimers.clear()
  }

  private emitChunk(chunk: ScheduledAudioChunk): void {
    for (const listener of this.listeners) {
      try {
        listener.onChunkScheduled?.(chunk)
      } catch (error) {
        console.error("[speech-playback] onChunkScheduled falhou", error)
      }
    }
  }

  private emitTurn(event: PlaybackTurnEvent): void {
    for (const listener of this.listeners) {
      try {
        listener.onTurnEvent?.(event)
      } catch (error) {
        console.error("[speech-playback] onTurnEvent falhou", error)
      }
    }
  }
}

export function createSpeechPlayback(options: SpeechPlaybackOptions = {}): SpeechPlayback {
  return new WebAudioSpeechPlayback(options)
}

/** PCM16 little-endian em base64 (formato do Gemini Live) → Float32 mono (−1..1). */
export function decodePcm16Base64(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64)
  const count = binary.length >> 1
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    let value = binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8)
    if (value >= 0x8000) value -= 0x10000
    out[i] = value / 0x8000
  }
  return out
}

function fadeOut(gain: GainNode | null, from: number, to: number): void {
  if (!gain) return
  const param = gain.gain
  param.cancelScheduledValues(from)
  param.setValueAtTime(param.value, from)
  if (to > from) param.linearRampToValueAtTime(0, to)
  else param.setValueAtTime(0, from)
}

function disconnectQuietly(node: AudioNode | null, destination?: AudioNode): void {
  if (!node) return
  try {
    if (destination) node.disconnect(destination)
    else node.disconnect()
  } catch {
    // já desconectado
  }
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}
