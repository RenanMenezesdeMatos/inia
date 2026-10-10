import type { AvatarConversationState, AvatarDriver, AvatarTuning } from "@/lib/avatar/animation/types"
import { startDemoRecording, recordingFileName, uploadRecording, type DemoRecording } from "./demo-recorder"
import { labFixtureLabel, type LabFixtureId } from "./fixture-catalog"
import type { FixtureReplayEvent, ReplayClock } from "./fixture-replay-socket"
import { FixtureStore, type LabTiming } from "./fixture-store"
import { alignedPhoneAt, isMidWord } from "./speech-timeline"
import { createVoiceRig, LabDriverProxy, type LabSource, type VoiceRig } from "./voice-rig"

/**
 * Orquestra o laboratório do avatar sem React: dois motores de voz de produção ("fixture" e
 * "live"), o driver estável que o avatar lê, a fila de capturas, barge-in "no meio da palavra",
 * a sequência automática e a gravação. A tela assina um snapshot IMUTÁVEL que muda poucas vezes
 * por turno (`useSyncExternalStore`); nada aqui muda por quadro — o diagnóstico lê os motores
 * direto (`rig`) a ≤ 10 Hz.
 *
 * Métodos marcados "(clique)" precisam rodar de DENTRO do handler do clique: criam/retomam o
 * AudioContext de forma síncrona (política de autoplay) antes de qualquer `await`.
 */

export type LabLogTone = "info" | "warn" | "error"
export type LabLogEntry = { id: number; at: number; source: LabSource | "lab"; text: string; tone: LabLogTone }

export type LabRecordingState =
  | { status: "idle" }
  | { status: "recording"; label: string; mimeType: string; hasAudio: boolean }
  | { status: "processing" }
  | { status: "done"; url: string; fileName: string; bytes: number; mimeType: string; upload: string | null }
  | { status: "error"; message: string }

export type LabSnapshot = {
  source: LabSource
  /** Estado real do transporte ativo. */
  state: AvatarConversationState
  overrideState: AvatarConversationState | null
  connected: boolean
  connecting: boolean
  sequenceRunning: boolean
  /** Transcrição da resposta em andamento (fragmentos do `outputTranscription`). */
  assistantText: string
  liveError: string | null
  log: readonly LabLogEntry[]
  recording: LabRecordingState
}

/** O pedaço do `WebGLRenderer` que o diagnóstico lê (`info.render`: por quadro, `autoReset`). */
export type RendererInfoSource = {
  info: { render: { frame: number; calls: number; triangles: number }; memory: { geometries: number; textures: number } }
  /** Gravação: o Canvas é transparente (o fundo é CSS) e o WebM guardaria preto — pinta o fundo. */
  setClearColor?: (color: string | number, alpha?: number) => void
}

/** Fundo claro da interface do avatar, para a gravação não sair com fundo preto. */
const RECORDING_BACKGROUND = "#f3eff7"

export type LabControllerOptions = {
  store?: FixtureStore
  /** Testes: AudioContext falso e relógio do servidor falso (timers falsos). */
  createContext?: (sampleRate: number) => AudioContext
  replayClock?: ReplayClock
}

export type LabSequenceOptions = { interruptAtMs: number; record: boolean }

const LIVE_UNAVAILABLE =
  "Sessão real indisponível: este modo usa a sessão de voz de verdade (API do Gemini, com custo). Entre na INIA em /auth/login nesta mesma origem e tente de novo."

const MAX_LOG = 60
/** Quanto o "usuário" fala depois de interromper (nível do microfone simulado). */
const USER_UTTERANCE_MS = 700
/** Busca de um instante "no meio da palavra" antes de interromper assim mesmo. */
const MID_WORD_MAX_WAIT_MS = 700

class AbortedError extends Error {
  constructor() {
    super("cancelado")
  }
}

export class AvatarLabController {
  readonly store: FixtureStore
  readonly driver: AvatarDriver
  private readonly proxy: LabDriverProxy
  private readonly rigs: Record<LabSource, VoiceRig>
  private readonly states: Record<LabSource, AvatarConversationState> = { fixture: "idle", live: "idle" }
  private readonly connectedBy: Record<LabSource, boolean> = { fixture: false, live: false }
  private active: LabSource = "fixture"
  private snapshot: LabSnapshot
  private readonly listeners = new Set<() => void>()
  private logSeq = 0
  private selected: LabFixtureId = "frase-01-apresentacao"
  private timing: LabTiming = "original"
  private autoInterrupt: { enabled: boolean; atMs: number } = { enabled: false, atMs: 900 }
  private queued: ReturnType<FixtureStore["scriptIfLoaded"]> = null
  private flow: AbortController | null = null
  private canvas: HTMLCanvasElement | null = null
  private renderer: RendererInfoSource | null = null
  private recorder: DemoRecording | null = null
  private recordingLabel = "demo"
  private uploadTarget: URL | null = null
  private readonly rigOptions: Pick<LabControllerOptions, "createContext" | "replayClock">

  constructor({ store = new FixtureStore(), createContext, replayClock }: LabControllerOptions = {}) {
    this.store = store
    this.rigOptions = { createContext, replayClock }
    this.rigs = {
      fixture: this.buildRig("fixture"),
      live: this.buildRig("live"),
    }
    this.proxy = new LabDriverProxy(() => this.rigs[this.active])
    this.driver = this.proxy
    this.snapshot = {
      source: "fixture",
      state: "idle",
      overrideState: null,
      connected: false,
      connecting: false,
      sequenceRunning: false,
      assistantText: "",
      liveError: null,
      log: [],
      recording: { status: "idle" },
    }
  }

  // ---------------------------------------------------------------------------
  // Leitura (tela e diagnóstico)
  // ---------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): LabSnapshot => this.snapshot

  /** Motor ativo — o diagnóstico lê reprodução/lip-sync daqui, sem passar pelo React. */
  get rig(): VoiceRig {
    return this.rigs[this.active]
  }

  get selectedFixture(): LabFixtureId {
    return this.selected
  }

  // ---------------------------------------------------------------------------
  // Configuração
  // ---------------------------------------------------------------------------

  /** Escolhe a captura da próxima resposta e já a baixa (o servidor falso não pode esperar rede). */
  selectFixture(id: LabFixtureId): void {
    this.selected = id
    this.store.load(id).catch((error: unknown) => this.log("lab", errorText(error), "error"))
  }

  setTiming(timing: LabTiming): void {
    this.timing = timing
  }

  setAutoInterrupt(enabled: boolean, atMs: number): void {
    this.autoInterrupt = { enabled, atMs: Math.max(0, atMs) }
  }

  setOverride(state: AvatarConversationState | null): void {
    this.proxy.setOverride(state)
    this.update({ overrideState: this.proxy.overrideState })
  }

  /** Vale para os dois motores (trocar de fonte não desfaz o ajuste). */
  setTuning(patch: Partial<AvatarTuning>): void {
    this.rigs.fixture.driver.setTuning(patch)
    this.rigs.live.driver.setTuning(patch)
  }

  setAvOffsetMs(ms: number): void {
    this.rigs.fixture.playback.setAvOffsetMs(ms)
    this.rigs.live.playback.setAvOffsetMs(ms)
  }

  /** `onCanvasReady` do avatar: o Canvas (gravação) e o renderer (diagnóstico: `renderer.info`). */
  setCanvas(canvas: HTMLCanvasElement | null, renderer: RendererInfoSource | null = null): void {
    this.canvas = canvas
    this.renderer = renderer
  }

  /** Renderer do Canvas atual (troca de modelo recria o Canvas e chama `setCanvas` de novo). */
  get rendererInfo(): RendererInfoSource["info"] | null {
    return this.renderer?.info ?? null
  }

  setUploadTarget(target: URL | null): void {
    this.uploadTarget = target
  }

  // ---------------------------------------------------------------------------
  // Turnos com capturas (fonte "fixture")
  // ---------------------------------------------------------------------------

  /**
   * (clique) Fala a captura escolhida. Com o microfone simulado aberto (depois de um barge-in),
   * encerra o turno do usuário (`activityEnd`) — o servidor falso responde com a captura; senão,
   * manda um turno de texto (`sendText`), o mesmo caminho de resposta da voz.
   */
  play(): void {
    this.cancelFlow()
    this.prime("fixture")
    const id = this.selected
    void this.startFixtureTurn(id)
      .then(() => {
        if (this.autoInterrupt.enabled) void this.runAutoInterrupt(this.autoInterrupt.atMs)
      })
      .catch((error: unknown) => this.log("fixture", errorText(error), "error"))
  }

  /** (clique) Barge-in no meio de uma palavra: espera o ouvido cair dentro de uma palavra e interrompe. */
  interrupt(): void {
    this.cancelFlow()
    void this.interruptMidWord().catch((error: unknown) => this.log("fixture", errorText(error), "error"))
  }

  /** Cancela a resposta em andamento (local; sem abrir o microfone). */
  cancelResponse(): void {
    this.cancelFlow()
    this.rig.transport.interruptResponse()
    this.log(this.active, "resposta cancelada localmente (interruptResponse)")
  }

  // ---------------------------------------------------------------------------
  // Sessão real (fonte "live")
  // ---------------------------------------------------------------------------

  /** (clique) Turno de texto na sessão REAL do Gemini Live (precisa de login; custo de API). */
  speakLive(text: string): void {
    const clean = text.trim()
    if (!clean) return
    this.cancelFlow()
    this.prime("live")
    this.update({ liveError: null })
    const rig = this.rigs.live
    void this.ensureConnected(rig).then(
      () => {
        this.update({ assistantText: "" })
        rig.transport.sendText(clean)
        this.log("live", `texto enviado à sessão real (${clean.length} caracteres)`)
      },
      () => {
        this.update({ liveError: LIVE_UNAVAILABLE })
        this.log("live", LIVE_UNAVAILABLE, "warn")
      },
    )
  }

  /** Encerra a sessão real (para de contar tempo de sessão na API). */
  disconnectLive(): void {
    this.rigs.live.transport.disconnect()
    if (this.active === "live") this.activate("fixture")
  }

  // ---------------------------------------------------------------------------
  // Sequência automática: frase → barge-in no meio da palavra → próxima frase
  // ---------------------------------------------------------------------------

  /** (clique) Roda a sequência; `record` grava do começo ao fim (com 500 ms de sobra). */
  runSequence(first: LabFixtureId, second: LabFixtureId, { interruptAtMs, record }: LabSequenceOptions): void {
    this.cancelFlow()
    this.prime("fixture")
    const flow = new AbortController()
    this.flow = flow
    this.update({ sequenceRunning: true })
    if (record) this.startRecording(`sequencia ${first} ${second}`)
    this.log("lab", `sequência: ${labFixtureLabel(first)} → interrompe em ${interruptAtMs} ms → ${labFixtureLabel(second)}`)
    const rig = this.rigs.fixture
    void (async () => {
      try {
        await this.store.load(second)
        await this.startFixtureTurn(first)
        await this.waitForState((state) => state === "speaking", 30_000, flow.signal)
        await sleep(interruptAtMs, flow.signal)
        await this.interruptMidWord(flow.signal)
        // O "usuário" fala um pouco (nível no microfone simulado) e termina o turno.
        await sleep(USER_UTTERANCE_MS + 250, flow.signal)
        this.queued = await this.store.script(second, this.timing)
        this.update({ assistantText: "" })
        rig.transport.endTurn()
        await this.waitForState((state) => state === "speaking", 30_000, flow.signal)
        await this.waitForState((state) => state === "idle", 180_000, flow.signal)
        await sleep(500, flow.signal)
        this.log("lab", "sequência concluída")
      } catch (error) {
        if (!(error instanceof AbortedError)) this.log("lab", `sequência falhou: ${errorText(error)}`, "error")
      } finally {
        if (this.flow === flow) this.flow = null
        this.update({ sequenceRunning: false })
        if (record && this.recorder) await this.stopRecording()
      }
    })()
  }

  stopSequence(): void {
    this.cancelFlow()
  }

  // ---------------------------------------------------------------------------
  // Gravação de demonstração
  // ---------------------------------------------------------------------------

  /** (clique) Grava o Canvas + o áudio que sai do alto-falante do motor ativo. */
  startRecording(label = labFixtureLabel(this.selected)): void {
    if (this.recorder) return
    if (!this.canvas) {
      this.update({ recording: { status: "error", message: "O Canvas do avatar ainda não está pronto." } })
      return
    }
    // O áudio precisa do contexto de reprodução (criado aqui, no clique, se ainda não existe).
    this.rig.transport.primeAudioPlayback()
    this.releaseRecordingUrl()
    try {
      this.renderer?.setClearColor?.(RECORDING_BACKGROUND, 1)
      this.recorder = startDemoRecording({ canvas: this.canvas, playback: this.rig.playback })
    } catch (error) {
      this.renderer?.setClearColor?.(0x000000, 0)
      this.update({ recording: { status: "error", message: errorText(error) } })
      return
    }
    this.recordingLabel = label
    this.update({ recording: { status: "recording", label, mimeType: this.recorder.mimeType, hasAudio: this.recorder.hasAudio } })
    this.log("lab", `gravando (${this.recorder.mimeType}${this.recorder.hasAudio ? "" : ", sem áudio"})`)
  }

  async stopRecording(): Promise<void> {
    const recorder = this.recorder
    if (!recorder) return
    this.recorder = null
    this.renderer?.setClearColor?.(0x000000, 0)
    this.update({ recording: { status: "processing" } })
    try {
      const blob = await recorder.stop()
      const fileName = recordingFileName(this.recordingLabel, new Date())
      const url = URL.createObjectURL(blob)
      const done = { status: "done" as const, url, fileName, bytes: blob.size, mimeType: recorder.mimeType, upload: null as string | null }
      this.update({ recording: done })
      this.log("lab", `gravação pronta: ${fileName} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`)
      const target = this.uploadTarget
      if (!target) return
      this.update({ recording: { ...done, upload: `enviando para ${target.origin}…` } })
      const result = await uploadRecording(target, blob, fileName).catch((error: unknown) => ({ ok: false, status: 0, body: errorText(error), opaque: false }))
      const message = result.opaque
        ? `enviado para ${target.href} (sem CORS: resposta opaca)`
        : `${result.ok ? "enviado" : "falhou"} — HTTP ${result.status}${result.body ? `: ${result.body}` : ""}`
      if (this.snapshot.recording.status === "done" && this.snapshot.recording.url === url) this.update({ recording: { ...done, upload: message } })
      this.log("lab", `upload: ${message}`, result.ok ? "info" : "error")
    } catch (error) {
      this.update({ recording: { status: "error", message: errorText(error) } })
    }
  }

  /**
   * Desmontagem (e o ciclo extra do StrictMode): cala e desconecta tudo. A instância continua
   * utilizável — o próximo clique reconecta.
   */
  dispose(): void {
    this.cancelFlow()
    this.recorder?.cancel()
    this.recorder = null
    this.releaseRecordingUrl()
    this.queued = null
    for (const rig of Object.values(this.rigs)) {
      rig.transport.disconnect()
      rig.driver.dispose()
    }
    this.update({ recording: { status: "idle" }, sequenceRunning: false, connecting: false })
  }

  // ---------------------------------------------------------------------------
  // Internos
  // ---------------------------------------------------------------------------

  private buildRig(source: LabSource): VoiceRig {
    return createVoiceRig(source, {
      ...this.rigOptions,
      nextScript: source === "fixture" ? () => this.takeNextScript() : undefined,
      events: {
        onState: (state, previous) => {
          this.states[source] = state
          if (state !== previous) this.log(source, `estado: ${previous} → ${state}`)
          if (source === this.active) this.update({ state })
        },
        onConnection: (connected) => {
          this.connectedBy[source] = connected
          this.log(source, connected ? "conectado (setupComplete)" : "desconectado")
          if (source === this.active) this.update({ connected })
        },
        onOutputText: (text) => {
          if (source === this.active) this.update({ assistantText: this.snapshot.assistantText + text })
        },
        onTurnComplete: () => this.log(source, "turno da INIA consolidado (turnComplete/interrupção)"),
        onError: (message) => this.log(source, message, "error"),
        onReplayEvent: (event) => this.logReplay(event),
      },
    })
  }

  /** Resposta ao turno que acabou de terminar: a captura enfileirada, senão a escolhida (se já baixada). */
  private takeNextScript() {
    const queued = this.queued
    this.queued = null
    return queued ?? this.store.scriptIfLoaded(this.selected, this.timing)
  }

  /** Síncrono, no clique: ativa o motor e cria/retoma o AudioContext dele. */
  private prime(source: LabSource): void {
    this.activate(source)
    this.rigs[source].transport.primeAudioPlayback()
    this.proxy.setOverride(null)
    this.update({ overrideState: null })
  }

  private activate(source: LabSource): void {
    if (this.active === source) return
    // O motor que sai não pode continuar falando com o avatar lendo o outro.
    const previous = this.rigs[this.active]
    if (previous.transport.callState !== "idle") previous.transport.interruptResponse()
    this.active = source
    this.update({ source, state: this.states[source], connected: this.connectedBy[source], assistantText: "" })
  }

  private async ensureConnected(rig: VoiceRig): Promise<void> {
    if (rig.transport.isConnected) return
    this.update({ connecting: true })
    try {
      // Sessão nova, sem conversa a recapitular: a instrução é a do backend (travada no token), como no chat.
      await rig.transport.connect()
    } finally {
      this.update({ connecting: false })
    }
  }

  private async startFixtureTurn(id: LabFixtureId): Promise<void> {
    const rig = this.rigs.fixture
    const [script] = await Promise.all([this.store.script(id, this.timing), this.ensureConnected(rig)])
    this.queued = script
    this.update({ assistantText: "" })
    const seconds = this.store.audioSeconds(id)
    const timing = this.timing === "fast" ? "sem espera inicial" : "latência original"
    if (rig.transport.callState === "listening") {
      rig.transport.endTurn()
      this.log("fixture", `fim da fala simulada (activityEnd) → ${labFixtureLabel(id)}`)
    } else {
      rig.transport.sendText(this.store.prompt(id) ?? labFixtureLabel(id))
      this.log("fixture", `turno de texto → ${labFixtureLabel(id)} (${seconds?.toFixed(1) ?? "?"} s de áudio, ${timing})`)
    }
  }

  private async runAutoInterrupt(atMs: number): Promise<void> {
    const flow = new AbortController()
    this.flow = flow
    try {
      await this.waitForState((state) => state === "speaking", 30_000, flow.signal)
      await sleep(atMs, flow.signal)
      await this.interruptMidWord(flow.signal)
    } catch (error) {
      if (!(error instanceof AbortedError)) this.log("fixture", `auto-interrupção falhou: ${errorText(error)}`, "error")
    } finally {
      if (this.flow === flow) this.flow = null
    }
  }

  /**
   * Espera o instante OUVIDO cair no meio de uma palavra (até ~700 ms) e faz o barge-in do
   * transporte de produção: fade, corte do lip-sync e `activityStart` — o servidor falso ainda manda
   * 1–2 mensagens da geração antiga e depois `interrupted` + `turnComplete`.
   */
  private async interruptMidWord(signal?: AbortSignal): Promise<void> {
    const rig = this.rigs.fixture
    if (this.active !== "fixture" || rig.transport.callState !== "speaking") {
      this.log("fixture", "nada para interromper (a INIA não está falando)", "warn")
      return
    }
    const deadline = Date.now() + MID_WORD_MAX_WAIT_MS
    let heard = rig.playback.heardTime()
    let phones = rig.lipsync.debugSnapshot({ frames: false }).phones
    while (Date.now() < deadline && !(heard !== null && isMidWord(phones, heard))) {
      await sleep(12, signal)
      heard = rig.playback.heardTime()
      phones = rig.lipsync.debugSnapshot({ frames: false }).phones
    }
    const phone = heard === null ? null : alignedPhoneAt(phones, heard)
    const where = phone ? `fone "${phone.phone}" da palavra #${phone.wordIndex + 1}${isMidWord(phones, heard ?? 0) ? " (meio da palavra)" : ""}` : "fora de palavra"
    this.log("fixture", `barge-in em ${heard?.toFixed(3) ?? "?"} s — ${where}`)
    await rig.transport.bargeIn()
    rig.mic.speak(USER_UTTERANCE_MS)
  }

  private waitForState(predicate: (state: AvatarConversationState) => boolean, timeoutMs: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const check = () => {
        if (!predicate(this.snapshot.state)) return
        cleanup()
        resolve()
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`tempo esgotado esperando o estado (${timeoutMs} ms)`))
      }, timeoutMs)
      const onAbort = () => {
        cleanup()
        reject(new AbortedError())
      }
      const unsubscribe = this.subscribe(check)
      const cleanup = () => {
        clearTimeout(timer)
        unsubscribe()
        signal.removeEventListener("abort", onAbort)
      }
      if (signal.aborted) return onAbort()
      signal.addEventListener("abort", onAbort)
      check()
    })
  }

  private cancelFlow(): void {
    const flow = this.flow
    this.flow = null
    flow?.abort()
  }

  private releaseRecordingUrl(): void {
    const recording = this.snapshot.recording
    if (recording.status === "done") URL.revokeObjectURL(recording.url)
  }

  private logReplay(event: FixtureReplayEvent): void {
    if (event.type === "replay-started") this.log("fixture", `servidor falso: reproduzindo ${event.scriptId} (${event.trigger === "text" ? "clientContent" : "activityEnd"})`)
    else if (event.type === "replay-finished") this.log("fixture", `servidor falso: ${event.scriptId} entregue por inteiro`)
    else if (event.type === "no-script") this.log("fixture", "servidor falso: nenhuma captura carregada — só turnComplete", "warn")
    else if (event.type === "barge-in" && event.serverInterrupt)
      this.log("fixture", `servidor falso: activityStart → ${event.inFlight} mensagem(ns) da geração antiga em voo, depois interrupted + turnComplete`)
  }

  private log(source: LabLogEntry["source"], text: string, tone: LabLogTone = "info"): void {
    const entry: LabLogEntry = { id: ++this.logSeq, at: Date.now(), source, text, tone }
    this.update({ log: [...this.snapshot.log.slice(-(MAX_LOG - 1)), entry] })
  }

  private update(patch: Partial<LabSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.listeners]) listener()
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError())
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AbortedError())
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
