"use client"

import { reportOfferSchema, type ReportOffer } from "@/schemas/reports/reports.schema"
import type { FeedbackSupportMaterial } from "@/schemas/feedbacks/support-material.schema"
import { createSpeechPlayback } from "@/lib/avatar/audio/speech-playback"
import type { PlaybackTurnEvent, SpeechPlayback } from "@/lib/avatar/audio/types"
import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import { createSpeechLipsyncEngine } from "@/lib/avatar/lipsync/speech-lipsync-engine"
import type { ScheduledAudioChunk, SpeechLipsyncEngine } from "@/lib/avatar/lipsync/types"
import {
  arrayBufferToBase64,
  buildSetupMessage,
  isAudioPart,
  readSocketData,
  safeParse,
  sanitizeTranscriptFragment,
  type EphemeralSession,
  type GeminiServerMessage,
} from "./gemini-live-protocol"
import { VoiceUsageRecorder } from "@/lib/usage/voice-usage"
import { micCaptureErrorMessage, startMicCapture, type MicCapture, type StartMicCapture } from "./mic-capture"
import { parseLeadershipCards, type LeadershipCard } from "@/schemas/leadership/leadership.schema"

export type { EphemeralSession } from "./gemini-live-protocol"

const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"
// Detecção de fim de fala no cliente. O Gemini Live não aceita misturar as duas coisas: mandar um
// `activityEnd` manual com o `automaticActivityDetection` dele ligado derruba a conexão
// ("Explicit activity control is not supported when automatic activity detection is enabled" —
// verificado ao vivo em 2026-09-09). Então "encerrar no clique OU no silêncio" é UM mecanismo só:
// a detecção automática fica desligada e o silêncio é detectado aqui, pelo mesmo RMS do medidor de
// nível, passando pelo mesmo `endTurn()` do clique.
const SILENCE_RMS_THRESHOLD = 0.015
// Uma pausa no meio da frase maior que isso vira "terminei de falar": o turno fecha e o resto vira
// outro turno, desconexo. 2200 ms era fácil demais de atingir pensando em voz alta (confirmado ao
// vivo em 2026-09-09, com hesitações como "tipo"/"é"); um silêncio real de fim de turno continua
// bem mais longo que isso.
const SILENCE_DURATION_MS = 3500
/** `WebSocket.OPEN` — numérico para não depender do global (testes/Node). */
const SOCKET_OPEN = 1
const SESSION_ERROR_MESSAGE = "Não foi possível iniciar a voz em tempo real."
const CONNECT_ERROR_MESSAGE = "Falha ao conectar à voz em tempo real."
const CLOSED_BEFORE_READY_MESSAGE = "A conexão de voz foi encerrada antes de ficar pronta. Tente de novo."
const DROPPED_MESSAGE = "A conexão de voz caiu. Toque no microfone para continuar."
const ABORTED_MESSAGE = "Conexão de voz cancelada."
const SPECIALIST_UNAVAILABLE = "Não consegui consultar o especialista agora."

/** Estado da conversa visto pelo avatar e pelo chat (o mesmo tipo, sem tradução). */
export type RealtimeCallState = AvatarConversationState

export type RealtimeTransportEvents = {
  /** Sessão pronta (setupComplete) e, depois, desconexão/queda. Independente de `onStateChange` — conectado e ocioso entre turnos fica em "idle". */
  onConnectionChange?: (connected: boolean) => void
  /**
   * "listening" = microfone aberto; "thinking" = esperando a resposta (ou uma tool no meio dela);
   * "speaking" = o áudio da resposta começou a tocar; "idle" = só quando o áudio da resposta
   * TERMINOU DE SOAR e nada mais vai ser dito (`generationComplete` ou `turnComplete` já chegaram)
   * — nunca no `turnComplete` da rede em si, que costuma chegar com áudio ainda agendado.
   */
  onStateChange?: (state: RealtimeCallState) => void
  onInputTranscript?: (text: string) => void
  onOutputTranscript?: (text: string) => void
  /**
   * Uma vez por turno, quando o texto do turno está completo (`turnComplete` da rede) ou a
   * resposta foi interrompida — o único ponto seguro para consolidar a transcrição na tela, já que
   * fragmentos continuam chegando depois de o microfone fechar. Não espera o áudio terminar.
   */
  onTurnComplete?: () => void
  /**
   * A resposta foi cortada (barge-in, cancelamento, servidor ou queda) — chamado ANTES do
   * `onTurnComplete` do turno, com o trecho que de fato soou (o texto chega bem antes do áudio:
   * sem isso o histórico registraria frases que a INIA nunca disse). `null` = sem alinhamento para
   * decidir; o chamador mantém o que tem.
   */
  onResponseInterrupted?: (heardText: string | null) => void
  /** Nível do microfone (RMS, ~0–1), ~19×/s com o microfone aberto. Frequente o bastante para exigir escrita direta no DOM, nunca estado do React. */
  onAudioLevel?: (level: number) => void
  /** Resposta escrita completa de um especialista acionado na voz — a fala da INIA é só um resumo verbal disso (áudio não "fala" uma tabela markdown). `conversation` = a conversa persistida em que o backend a gravou. */
  onSpecialistResult?: (text: string, supportMaterials: FeedbackSupportMaterial[], conversation: VoiceConversationResult | null, analytics?: LeadershipCard[], extras?: { reportOffer?: ReportOffer; navigate?: { href: string } }) => void
  /** Conversa persistida e turno em curso no instante da tool-call (a sessão de voz não é a conversa: o chat decide). Com
   * `feedbackApplicationId`, a consulta é de dentro de uma sessão de feedback: o backend decide a conversa e emoldura o especialista. */
  getToolCallContext?: () => { conversationId: string | null; turnId: string; feedbackApplicationId?: string | null }
  onError?: (message: string) => void
}

type SocketEventType = "open" | "message" | "error" | "close"

/** O subconjunto do WebSocket que o transporte usa (injetável em testes e no laboratório). */
export interface WebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void
  addEventListener(type: Exclude<SocketEventType, "message">, listener: (event: Event) => void): void
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void
  removeEventListener(type: Exclude<SocketEventType, "message">, listener: (event: Event) => void): void
}

export type RealtimeTransportOptions = {
  /** Reprodução da fala (padrão: Web Audio a 24 kHz). O transporte fecha o contexto no `disconnect()`. */
  playback?: SpeechPlayback
  /** Lip-sync alimentado com cada chunk agendado e cada fragmento de transcrição. */
  lipsync?: SpeechLipsyncEngine
  createSocket?: (url: string) => WebSocketLike
  /** Padrão: POST /api/v1/realtime/sessions. */
  fetchSession?: (request: VoiceSessionRequest) => Promise<EphemeralSession>
  /** Padrão: microfone real (getUserMedia + worklet). */
  startCapture?: StartMicCapture
}

/**
 * A voz nunca passa pelo nosso backend durante a conversa (vai direto pro Gemini Live) — sem
 * isso, nem a pergunta falada nem a resposta final da INIA ficavam registradas quando nenhum
 * especialista era acionado (só o resultado bruto de uma tool, via /tool-call, chegava a ser
 * persistido). Chamado uma vez por turno completo, depois que o turno já foi commitado na UI.
 */
/** Conversa em que o backend gravou um turno de voz (o chat adota o id; `closed` = a conversa foi encerrada no meio). */
export type VoiceConversationResult = { conversationId: string; created: boolean; closed: boolean; activeConversationId: string | null }

/** `feedbackApplicationId`: o turno é sobre uma aplicação de feedback — o backend decide a conversa (a da aplicação ou a complementar). */
/** `userChannel`: a pergunta foi falada (padrão) ou DIGITADA e respondida por voz — o histórico mostra a origem. */
export async function recordVoiceTurn(input: { conversationId: string | null; turnId: string; userText?: string; userChannel?: "chat" | "voice"; userSpokenAt?: string; assistantText?: string; feedbackApplicationId?: string | null }): Promise<VoiceConversationResult | null> {
  if (!input.userText && !input.assistantText) return null
  try {
    const response = await fetch(`${API_URL}/api/v1/realtime/voice-turn`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: input.conversationId, turnId: input.turnId, userText: input.userText || undefined, userChannel: input.userText ? input.userChannel : undefined, userSpokenAt: input.userSpokenAt, assistantText: input.assistantText || undefined, feedbackApplicationId: input.feedbackApplicationId ?? undefined }),
    })
    if (!response.ok) return null
    return ((await response.json()) as { data: VoiceConversationResult }).data
  } catch {
    // Falha em persistir não trava a conversa por voz (o operador já ouviu a resposta) — o chamador marca a mensagem como não salva.
    return null
  }
}

/** O que o navegador diz ao pedir uma sessão de voz: só de qual conversa ela continua (`null` = conversa nova, sem histórico). */
export type VoiceSessionRequest = { conversationId?: string | null }

/**
 * Sessão de voz. O backend monta e trava no token a instrução (persona/Orquestrador + nome de tratamento + recapitulação da
 * conversa GRAVADA `conversationId`) e as ferramentas — nada disso sai daqui. Com `feedbackApplicationId` a sessão é a de uma
 * APLICAÇÃO de feedback: a instrução vem do registro congelado do feedback.
 */
export async function fetchEphemeralSession(options: VoiceSessionRequest & { feedbackApplicationId?: string | null } = {}): Promise<EphemeralSession> {
  const response = await fetch(`${API_URL}/api/v1/realtime/sessions`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: options.conversationId ?? null, feedbackApplicationId: options.feedbackApplicationId ?? undefined }),
  })
  if (!response.ok) throw new Error(SESSION_ERROR_MESSAGE)
  const { data } = (await response.json()) as { data: EphemeralSession }
  return data
}

/** Resposta (geração) do modelo em andamento — um turno de áudio da reprodução e do lip-sync. */
type Generation = {
  turnId: number
  seq: number
  /** Texto completo (`generationComplete`/`turnComplete`): o lip-sync já recebeu `endOfText`. */
  textDone: boolean
  /** `turnComplete` da rede: não chega mais nada desta geração. */
  networkDone: boolean
  /** Tools pedidas pelo modelo e ainda sem resposta nossa: a resposta continua depois delas. */
  toolCallsInFlight: number
  audioDropWarned: boolean
  /** Transcrição de saída desta geração (para cortar no trecho ouvido numa interrupção). */
  transcript: string
}

/**
 * Válvula do descarte depois de uma interrupção: o servidor fecha a geração cortada
 * (`interrupted` + `turnComplete`) antes de responder o turno novo — ~190 ms depois do
 * `activityStart` (medido em 2026-09-24). Se esse fechamento nunca vier, o descarte não pode
 * engolir a resposta nova para sempre.
 */
const DISCARD_VALVE_MS = 4000

type SetupWaiter = { session: number; resolve: () => void; fail: (message: string | null) => void }

/**
 * Transporte de voz bidirecional com o Gemini Live. Responsabilidades separadas:
 * - aqui: sessão/WebSocket, captura do microfone (push-to-talk), turnos, tools e interrupção;
 * - `SpeechPlayback`: reprodução e relógio do áudio ouvido;
 * - `SpeechLipsyncEngine`: boca — recebe cada chunk agendado e cada fragmento de transcrição.
 *
 * Um turno do usuário termina quando alguém chama `endTurn()` (clique) ou quando `checkSilence()`
 * decide que o usuário parou de falar — os dois passam pelo mesmo `endTurn()`. A detecção de
 * turno do servidor fica desligada (ver `SILENCE_RMS_THRESHOLD`; o backend a desliga no setup
 * travado no token). O backend cria uma sessão efêmera (backend/src/modules/realtime); esta classe
 * nunca vê a chave da API nem a instrução e as ferramentas da sessão.
 *
 * Ordem e sessões: as mensagens são tratadas em fila, na ordem de chegada (a leitura de um Blob é
 * assíncrona e embaralhava a ordem), e cada conexão tem um número de sessão — mensagens, tools e
 * capturas de uma sessão antiga/fechada são ignoradas, então nada volta a tocar depois do
 * `disconnect()`.
 *
 * Interrupção (barge-in): `bargeIn()` cala a INIA na hora (fade), corta o lip-sync e abre o
 * microfone. O servidor só fica sabendo pelo `activityStart`, e até mandar `interrupted` e
 * `turnComplete` (~190 ms, verificado em 2026-09-24) ainda entrega áudio/transcrição da geração
 * ANTIGA — descartados aqui até o `turnComplete`.
 */
export class GeminiRealtimeTransport {
  readonly playback: SpeechPlayback
  readonly lipsync: SpeechLipsyncEngine
  private readonly events: RealtimeTransportEvents
  private readonly createSocket: (url: string) => WebSocketLike
  private readonly fetchSession: (request: VoiceSessionRequest) => Promise<EphemeralSession>
  private readonly startCaptureImpl: StartMicCapture

  private ws: WebSocketLike | null = null
  /** Incrementada a cada connect/disconnect/queda: o que pertence a uma sessão antiga se cala. */
  private session = 0
  private connected = false
  private connecting: Promise<void> | null = null
  private setupWaiter: SetupWaiter | null = null
  private messageChain: Promise<void> = Promise.resolve()

  private capture: MicCapture | null = null
  /** Monitoria de usabilidade (só fatos técnicos da voz; sem coleta ligada, nada é enviado). */
  private readonly usage = new VoiceUsageRecorder()
  private capturing = false
  private captureStarting = false
  private hasSpokenThisTurn = false
  private silenceStartedAt: number | null = null

  private state: RealtimeCallState = "idle"
  private generation: Generation | null = null
  private generationSeq = 0
  /** Pedimos uma resposta (activityEnd/clientContent) e o servidor ainda não mandou `turnComplete`. */
  private serverTurnOpen = false
  /** `onTurnComplete` ainda deve ser disparado para o turno aberto. */
  private turnCompletePending = false
  /** Descartando a geração antiga depois de uma interrupção local, até o `turnComplete` dela. */
  private discardingOldGeneration = false
  private discardValve: ReturnType<typeof setTimeout> | null = null

  private chunksSent = 0
  private connectedAt = 0
  private readonly visibilityHandler = () => this.handleVisibilityChange()

  constructor(events: RealtimeTransportEvents = {}, options: RealtimeTransportOptions = {}) {
    this.events = events
    this.playback = options.playback ?? createSpeechPlayback()
    this.lipsync = options.lipsync ?? createSpeechLipsyncEngine()
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url))
    this.fetchSession = options.fetchSession ?? fetchEphemeralSession
    this.startCaptureImpl = options.startCapture ?? startMicCapture
    this.playback.subscribe({
      onChunkScheduled: (chunk) => this.handleChunkScheduled(chunk),
      onTurnEvent: (event) => this.handlePlaybackEvent(event),
    })
  }

  get isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === SOCKET_OPEN
  }

  /** Estado atual (o mesmo último valor de `onStateChange`). */
  get callState(): RealtimeCallState {
    return this.state
  }

  /**
   * Cria (ou retoma) o AudioContext de reprodução de forma SÍNCRONA — chame direto do handler do
   * clique. Criado depois, dentro do callback assíncrono da WebSocket, a política de autoplay
   * deixava o contexto "suspended": o áudio era agendado sem erro e nunca soava, enquanto a
   * transcrição funcionava (confirmado como a causa de "resposta vem em texto mas nunca em áudio"
   * em 2026-09-09). A reprodução nunca cria contexto sozinha.
   */
  primeAudioPlayback(): void {
    this.playback.prime()
  }

  /**
   * `request.conversationId` = a conversa que a sessão continua: o backend recapitula o que está GRAVADO nela na instrução da
   * sessão (a memória do Live só cobre a própria conexão). A instrução e as ferramentas são do backend, travadas no token.
   *
   * Chamadas repetidas enquanto conecta devolvem a MESMA tentativa (duplo clique não abre duas
   * WebSockets); a promessa rejeita se a conexão fecha antes do `setupComplete`.
   */
  connect(request: VoiceSessionRequest = {}): Promise<void> {
    if (this.connected) return Promise.resolve()
    if (this.connecting) return this.connecting
    this.session += 1
    this.usage.connectRequested()
    const attempt = this.openSession(this.session, request)
    this.connecting = attempt
    const clear = () => {
      if (this.connecting === attempt) this.connecting = null
    }
    attempt.then(clear, clear)
    attempt.then(
      () => this.usage.connected(),
      (error: unknown) => (error instanceof Error && error.message === ABORTED_MESSAGE ? this.usage.closed("USER") : this.usage.failed()),
    )
    return attempt
  }

  disconnect(): void {
    this.session += 1
    const waiter = this.setupWaiter
    this.setupWaiter = null
    waiter?.fail(null)
    this.teardown()
    const ws = this.ws
    this.ws = null
    closeQuietly(ws)
    if (this.connected) this.usage.closed("USER")
    this.connected = false
    this.connecting = null
    this.lipsync.reset()
    void this.playback.close()
    console.info("[realtime] disconnected", { chunksSent: this.chunksSent, sessionMs: this.connectedAt ? Date.now() - this.connectedAt : 0 })
    this.connectedAt = 0
    this.events.onConnectionChange?.(false)
    this.setState("idle", true)
  }

  private async openSession(session: number, request: VoiceSessionRequest): Promise<void> {
    let ephemeral: EphemeralSession
    try {
      ephemeral = await this.fetchSession(request)
    } catch (error) {
      if (session === this.session) this.events.onError?.(SESSION_ERROR_MESSAGE)
      throw error instanceof Error ? error : new Error(SESSION_ERROR_MESSAGE)
    }
    if (session !== this.session) throw new Error(ABORTED_MESSAGE)
    await this.openSocket(session, ephemeral)
    if (session !== this.session) throw new Error(ABORTED_MESSAGE)
    this.connected = true
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.visibilityHandler)
    this.connectedAt = Date.now()
    console.info("[realtime] connected", { model: ephemeral.model })
    this.events.onConnectionChange?.(true)
    this.setState("idle", true)
  }

  private openSocket(session: number, ephemeral: EphemeralSession): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let ws: WebSocketLike
      try {
        ws = this.createSocket(ephemeral.wsUrl)
      } catch (error) {
        if (session === this.session) this.events.onError?.(CONNECT_ERROR_MESSAGE)
        reject(error instanceof Error ? error : new Error(CONNECT_ERROR_MESSAGE))
        return
      }
      this.ws = ws
      let settled = false
      // `message` null = cancelado por nós (disconnect): rejeita sem mensagem de erro na tela.
      const fail = (message: string | null) => {
        if (settled) return
        settled = true
        if (this.setupWaiter?.session === session) this.setupWaiter = null
        if (message !== null && session === this.session) {
          if (this.ws === ws) this.ws = null
          this.events.onError?.(message)
        }
        closeQuietly(ws)
        reject(new Error(message ?? ABORTED_MESSAGE))
      }
      this.setupWaiter = {
        session,
        resolve: () => {
          if (settled) return
          settled = true
          this.setupWaiter = null
          resolve()
        },
        fail,
      }
      ws.addEventListener("open", () => {
        if (session === this.session && !settled) ws.send(JSON.stringify(buildSetupMessage(ephemeral)))
      })
      ws.addEventListener("message", (event) => this.enqueueMessage(event.data, session))
      // Depois do setup, `error` sempre vem seguido de `close` — tratado lá.
      ws.addEventListener("error", () => fail(CONNECT_ERROR_MESSAGE))
      ws.addEventListener("close", (event) => {
        const close = event as CloseEvent
        if (!settled) {
          console.warn("[realtime] socket closed before setupComplete", { code: close.code, reason: close.reason })
          fail(CLOSED_BEFORE_READY_MESSAGE)
          return
        }
        this.handleSocketClosed(session, ws, close)
      })
    })
  }

  // Fila única: cada mensagem só é tratada depois da anterior (Blob.text() é assíncrono e deixava
  // um chunk de áudio "passar na frente" de outro). O número da sessão é conferido antes e depois
  // da leitura — mensagem de uma conexão já fechada nunca agenda áudio.
  private enqueueMessage(data: unknown, session: number): void {
    this.messageChain = this.messageChain
      .then(async () => {
        if (session !== this.session) return
        const text = await readSocketData(data)
        if (session !== this.session) return
        const message = safeParse(text)
        if (!message) return
        if (message.setupComplete !== undefined) {
          if (this.setupWaiter?.session === session) this.setupWaiter.resolve()
          return
        }
        this.handleServerMessage(message, session)
      })
      .catch((error: unknown) => {
        console.error("[realtime] falha ao tratar mensagem do servidor", error)
      })
  }

  private handleSocketClosed(session: number, ws: WebSocketLike, event: CloseEvent): void {
    if (session !== this.session || this.ws !== ws) return
    console.warn("[realtime] socket closed unexpectedly", { code: event.code, reason: event.reason })
    const wasBusy = this.state !== "idle" || this.capturing
    // O que já chegou da resposta vai para o histórico; o resto nunca vai chegar.
    this.notifyTurnComplete()
    this.session += 1
    this.ws = null
    this.connected = false
    this.teardown()
    this.usage.closed(event.code === 1000 ? "SERVER" : "NETWORK")
    this.lipsync.reset()
    this.events.onConnectionChange?.(false)
    this.setState("idle", true)
    if (wasBusy) this.events.onError?.(DROPPED_MESSAGE)
  }

  /** Para captura, áudio e geração da sessão atual (sem mexer na WebSocket). */
  private teardown(): void {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.visibilityHandler)
    this.capturing = false
    this.stopCapture()
    const generation = this.generation
    const stoppedAt = this.playback.interrupt()
    if (generation) this.lipsync.interrupt(stoppedAt ?? 0)
    this.usage.playbackEnded("INTERRUPTED")
    this.generation = null
    this.generationSeq += 1
    this.serverTurnOpen = false
    this.turnCompletePending = false
    this.discardingOldGeneration = false
    this.clearDiscardValve()
    this.hasSpokenThisTurn = false
    this.silenceStartedAt = null
  }

  // ---------------------------------------------------------------------------
  // Turnos do usuário
  // ---------------------------------------------------------------------------

  /**
   * Abre o microfone e começa a mandar o áudio do turno. Se a INIA ainda está respondendo, a
   * resposta é interrompida antes (ver `bargeIn`). Falha ao abrir o microfone limpa o que abriu e
   * avisa por `onError`.
   */
  async startTurn(): Promise<void> {
    if (!this.isConnected || this.capturing || this.captureStarting) return
    // Depois de um `bargeIn()` a geração antiga já foi cortada e está sendo descartada.
    if (this.generation || (this.serverTurnOpen && !this.discardingOldGeneration)) this.interruptLocally()
    const session = this.session
    this.captureStarting = true
    let capture: MicCapture
    try {
      capture = await this.startCaptureImpl({
        onChunk: (buffer) => this.sendAudioChunk(buffer),
        onLevel: (level) => this.handleMicLevel(level),
      })
    } catch (error) {
      this.captureStarting = false
      this.usage.micPermission(error)
      if (session === this.session) {
        console.warn("[realtime] microphone capture failed", error)
        this.events.onError?.(micCaptureErrorMessage(error))
        if (!this.generation) this.setState("idle")
      }
      return
    }
    this.captureStarting = false
    // Desconectou (ou caiu) enquanto o navegador abria o microfone: fecha na hora.
    if (session !== this.session || !this.isConnected) {
      capture.stop()
      return
    }
    this.capture = capture
    this.capturing = true
    this.usage.micPermission(null)
    this.usage.micOpened()
    this.hasSpokenThisTurn = false
    this.silenceStartedAt = null
    this.send({ realtimeInput: { activityStart: {} } })
    console.info("[realtime] turn started (mic open)")
    this.setState("listening")
  }

  /** Fecha o microfone e avisa o modelo que o usuário terminou — por clique ou por `checkSilence`. */
  endTurn(): void {
    if (!this.capturing) return
    this.capturing = false
    this.stopCapture()
    // O descarte da geração cortada continua até o `turnComplete` DELA (o servidor o manda antes de
    // responder este turno). Fechar o microfone logo depois do barge-in não pode deixar o resto
    // da resposta antiga passar como resposta nova — só a válvula de tempo libera.
    this.armDiscardValve()
    this.send({ realtimeInput: { activityEnd: {} } })
    this.usage.turnSent()
    this.serverTurnOpen = true
    this.turnCompletePending = true
    console.info("[realtime] turn ended (mic closed)", { chunksSent: this.chunksSent })
    this.setState("thinking")
  }

  /**
   * "Interromper e falar": cala a INIA com fade, corta o lip-sync no instante em que o áudio se
   * cala, descarta o que ainda chegar da geração antiga e abre o microfone (activityStart).
   */
  async bargeIn(): Promise<void> {
    if (!this.isConnected) return
    this.interruptLocally()
    // O áudio já se calou: o avatar e os botões saem de "falando" agora, não quando o navegador
    // terminar de abrir o microfone (com prompt de permissão isso leva segundos).
    this.setState("listening")
    await this.startTurn()
  }

  /** Cancela localmente a resposta em andamento (fim de chamada, laboratório), sem abrir o microfone. */
  interruptResponse(): void {
    this.interruptLocally()
    if (!this.capturing) this.setState("idle")
  }

  /** Turno de texto (laboratório/testes): mesma resposta falada que um turno de voz. */
  sendText(text: string): void {
    const clean = text.trim()
    if (!clean) return
    if (!this.isConnected) {
      this.events.onError?.("A voz em tempo real não está conectada.")
      return
    }
    if (this.capturing) {
      console.warn("[realtime] sendText ignored while the microphone is open")
      return
    }
    if (this.generation || this.serverTurnOpen) this.interruptLocally()
    // Mesmo contrato do endTurn: descarta a geração cortada até o fechamento dela (com válvula).
    this.armDiscardValve()
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text: clean }] }], turnComplete: true } })
    this.usage.turnSent()
    this.serverTurnOpen = true
    this.turnCompletePending = true
    this.setState("thinking")
  }

  private interruptLocally(): void {
    const generation = this.generation
    const stoppedAt = this.playback.interrupt()
    if (generation) this.usage.playbackEnded("INTERRUPTED")
    if (generation) {
      const cutAt = stoppedAt ?? this.playback.heardTime() ?? 0
      this.lipsync.interrupt(cutAt)
      this.reportInterrupted(generation, cutAt)
    }
    // Só há o que descartar se o servidor ainda está no meio do turno dele.
    if (this.serverTurnOpen) this.discardingOldGeneration = true
    this.generation = null
    this.generationSeq += 1
    // A resposta cortada vai para o histórico como está — antes da fala nova do usuário.
    this.notifyTurnComplete()
  }

  private handleMicLevel(level: number): void {
    this.events.onAudioLevel?.(level)
    this.checkSilence(level)
  }

  // O que o VAD do servidor faria, inteiramente no cliente (ver o comentário do módulo). Só
  // começa a contar silêncio depois que o usuário de fato falou neste turno — abrir o microfone e
  // demorar para começar nunca o fecha sozinho.
  private checkSilence(level: number): void {
    if (!this.capturing) return
    if (level >= SILENCE_RMS_THRESHOLD) {
      this.hasSpokenThisTurn = true
      this.silenceStartedAt = null
      return
    }
    if (!this.hasSpokenThisTurn) return
    const now = Date.now()
    if (this.silenceStartedAt === null) {
      this.silenceStartedAt = now
      return
    }
    if (now - this.silenceStartedAt >= SILENCE_DURATION_MS) {
      this.silenceStartedAt = null
      console.info("[realtime] client-side end-of-speech detected, ending turn")
      this.endTurn()
    }
  }

  private stopCapture(): void {
    const capture = this.capture
    this.capture = null
    if (!capture) return
    this.usage.micClosed()
    capture.stop()
    this.events.onAudioLevel?.(0)
  }

  private sendAudioChunk(buffer: ArrayBuffer): void {
    if (!this.capturing) return
    if (!this.send({ realtimeInput: { audio: { data: arrayBufferToBase64(buffer), mimeType: "audio/pcm;rate=16000" } } })) return
    this.chunksSent += 1
    // ~100 ms por chunk: loga a cada ~2 s de fala contínua — um buraco nessas linhas no console é
    // a assinatura de captura travada (ex.: AudioContext suspenso).
    if (this.chunksSent % 20 === 0) {
      console.debug("[realtime] mic streaming", { chunksSent: this.chunksSent, captureState: this.capture?.context.state })
    }
  }

  private send(payload: unknown): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== SOCKET_OPEN) return false
    ws.send(JSON.stringify(payload))
    return true
  }

  // Safari (e o Chrome, sob pressão de memória/bateria) pode suspender um AudioContext com a aba em
  // segundo plano, parando a captura em silêncio. Retomar ao voltar é barato e seguro.
  private handleVisibilityChange(): void {
    if (document.visibilityState !== "visible") return
    const captureContext = this.capture?.context
    if (captureContext && captureContext.state !== "running" && captureContext.state !== "closed") {
      console.warn("[realtime] capture AudioContext was suspended, resuming")
      void captureContext.resume().catch(() => {})
    }
    const playbackContext = this.playback.context
    if (playbackContext && playbackContext.state !== "running" && playbackContext.state !== "closed") {
      console.warn("[realtime] playback AudioContext was suspended, resuming")
      void playbackContext.resume().catch(() => {})
    }
  }

  // ---------------------------------------------------------------------------
  // Mensagens do servidor e ciclo de vida da resposta
  // ---------------------------------------------------------------------------

  private handleServerMessage(message: GeminiServerMessage, session: number): void {
    if (message.goAway) console.warn("[realtime] server goAway", message.goAway)

    if (message.toolCall) {
      if (this.discardingOldGeneration) {
        // Tool da geração cortada: responde "cancelado" — sem resposta o servidor esperaria para
        // sempre e o `turnComplete` que fecha o descarte nunca viria.
        const functionResponses = (message.toolCall.functionCalls ?? []).map((call) => ({ id: call.id, name: call.name, response: { result: "Cancelado: o usuário interrompeu a resposta." } }))
        if (functionResponses.length > 0) this.send({ toolResponse: { functionResponses } })
        return
      }
      const generation = this.ensureGeneration()
      this.runToolCalls(message.toolCall, session, generation)
      return
    }

    const content = message.serverContent
    if (!content) return

    // A transcrição da fala do USUÁRIO nunca é descartada: durante um barge-in ela já é do turno novo.
    const inputText = content.inputTranscription?.text
    if (inputText) {
      const clean = sanitizeTranscriptFragment(inputText)
      if (clean) this.events.onInputTranscript?.(clean)
    }

    if (this.discardingOldGeneration) {
      // Áudio, transcrição e `interrupted` da geração cancelada: fora. O `turnComplete` dela fecha o descarte.
      if (content.turnComplete) {
        console.info("[realtime] interrupted generation closed by the server")
        this.discardingOldGeneration = false
        this.clearDiscardValve()
        this.serverTurnOpen = false
      }
      return
    }

    if (content.interrupted) {
      this.handleServerInterrupted()
    } else {
      for (const part of content.modelTurn?.parts ?? []) {
        if (!isAudioPart(part)) continue
        const generation = this.ensureGeneration()
        const scheduled = this.playback.enqueueBase64Pcm16(part.inlineData.data, generation.turnId)
        if (!scheduled && !this.playback.context && !generation.audioDropWarned) {
          // Sem `primeAudioPlayback()` num clique não há contexto — e a reprodução nunca cria um sozinha.
          generation.audioDropWarned = true
          console.warn("[realtime] reply audio dropped: playback was never primed inside a user gesture")
        }
      }
      const outputText = content.outputTranscription?.text
      if (outputText) {
        const clean = sanitizeTranscriptFragment(outputText)
        if (clean) {
          const generation = this.ensureGeneration()
          generation.transcript += clean
          this.lipsync.pushTranscript({
            turnId: generation.turnId,
            text: clean,
            receivedAt: this.playback.context?.currentTime ?? 0,
            audioScheduledUntil: this.playback.scheduledUntil,
          })
          this.events.onOutputTranscript?.(clean)
        }
      }
      // "A última transcrição do turno vem antes do generationComplete" (documentação do Live).
      if (content.generationComplete) this.completeText()
    }

    if (content.turnComplete) this.handleServerTurnComplete()
  }

  /** Primeira coisa (áudio, texto ou tool) de uma resposta nova: abre o turno de áudio e do lip-sync. */
  private ensureGeneration(): Generation {
    if (this.generation) return this.generation
    const turnId = this.playback.beginTurn()
    this.lipsync.beginTurn(turnId)
    this.generationSeq += 1
    this.generation = { turnId, seq: this.generationSeq, textDone: false, networkDone: false, toolCallsInFlight: 0, audioDropWarned: false, transcript: "" }
    this.serverTurnOpen = true
    this.turnCompletePending = true
    return this.generation
  }

  private completeText(): void {
    const generation = this.generation
    if (!generation || generation.textDone) return
    generation.textDone = true
    this.lipsync.endOfText(generation.turnId)
  }

  // O servidor cancelou a resposta sem que tivéssemos interrompido localmente (ex.: `startTurn`
  // sem barge-in, ou outro motivo do lado dele).
  private handleServerInterrupted(): void {
    const generation = this.generation
    if (generation) {
      this.usage.playbackEnded("INTERRUPTED")
      const stoppedAt = this.playback.interrupt()
      const cutAt = stoppedAt ?? this.playback.heardTime() ?? 0
      this.lipsync.interrupt(cutAt)
      this.reportInterrupted(generation, cutAt)
    }
    this.generation = null
    this.generationSeq += 1
    this.notifyTurnComplete()
    if (!this.capturing) this.setState("idle")
  }

  private handleServerTurnComplete(): void {
    this.serverTurnOpen = false
    const generation = this.generation
    if (generation) {
      this.completeText()
      generation.networkDone = true
    }
    this.notifyTurnComplete()
    if (!generation) {
      if (!this.capturing) this.setState("idle")
      return
    }
    // O turnComplete chega com áudio ainda agendado (o Live gera mais rápido que o tempo real):
    // "idle" só quando a reprodução drenar.
    if (!this.playback.isPlaying()) this.finishGeneration()
  }

  // Fim da resposta para o avatar e para os botões: o áudio drenou e nada mais vai ser dito. O
  // `turnComplete` pode ainda não ter chegado (ver `handlePlaybackEvent`) — se o operador abrir o
  // microfone nesse meio-tempo, `startTurn` descarta o resto da geração até ele.
  private finishGeneration(): void {
    this.usage.playbackEnded("COMPLETED")
    this.generation = null
    if (!this.capturing) this.setState("idle")
  }

  /** Corta a transcrição da geração no número de palavras que o alinhamento diz ter soado. */
  private reportInterrupted(generation: Generation, cutAt: number): void {
    if (!this.events.onResponseInterrupted) return
    const words = this.lipsync.heardWordCount?.(cutAt)
    if (words === undefined) {
      this.events.onResponseInterrupted(null)
      return
    }
    this.events.onResponseInterrupted(cutTranscript(generation.transcript, words))
  }

  private armDiscardValve(): void {
    if (!this.discardingOldGeneration) return
    this.clearDiscardValve()
    const session = this.session
    this.discardValve = setTimeout(() => {
      this.discardValve = null
      if (session !== this.session || !this.discardingOldGeneration) return
      console.warn("[realtime] interrupted generation never closed; accepting new content")
      this.discardingOldGeneration = false
    }, DISCARD_VALVE_MS)
  }

  private clearDiscardValve(): void {
    if (this.discardValve === null) return
    clearTimeout(this.discardValve)
    this.discardValve = null
  }

  private notifyTurnComplete(): void {
    if (!this.turnCompletePending) return
    this.turnCompletePending = false
    this.events.onTurnComplete?.()
  }

  private handleChunkScheduled(chunk: ScheduledAudioChunk): void {
    const generation = this.generation
    if (!generation || chunk.turnId !== generation.turnId) return
    this.usage.audioScheduled(generation.turnId)
    this.lipsync.pushAudio(chunk)
    // "speaking" nasce com o primeiro chunk agendado — e volta depois de um buraco (tool no meio).
    if (!this.capturing) this.setState("speaking")
  }

  private handlePlaybackEvent(event: PlaybackTurnEvent): void {
    if (event.type !== "turn-drained") return
    const generation = this.generation
    if (!generation || event.turnId !== generation.turnId) return
    // O servidor manda o `turnComplete` no ritmo do tempo real (≈ quando o áudio acabaria de soar
    // do lado dele — resposta longa capturada em 2026-09-24: `generationComplete` em 22,7 s,
    // `turnComplete` em 60,6 s), então com jitter o áudio pode drenar antes dele. Depois do
    // `generationComplete` não vem mais fala: drenou = acabou, sem passar por "pensando".
    if (generation.networkDone || (generation.textDone && generation.toolCallsInFlight === 0)) this.finishGeneration()
    // Áudio acabou mas a resposta não: o modelo está esperando uma tool (ou a rede atrasou).
    else if (!this.capturing) this.setState("thinking")
  }

  private setState(next: RealtimeCallState, force = false): void {
    if (!force && next === this.state) return
    this.state = next
    this.events.onStateChange?.(next)
  }

  // O Gemini Live decidiu acionar 1+ especialistas — só ele tem a conexão, então é o cliente (não
  // o backend) quem busca cada resultado via REST e devolve pela mesma WebSocket antes que o modelo
  // continue o turno. Roda fora da fila de mensagens (senão um `interrupted` esperaria a tool).
  // Resultado de uma geração interrompida ou de uma sessão fechada é descartado: o servidor já
  // cancelou a chamada e o operador não pediu mais aquilo.
  private runToolCalls(toolCall: NonNullable<GeminiServerMessage["toolCall"]>, session: number, generation: Generation): void {
    const calls = toolCall.functionCalls ?? []
    if (calls.length === 0) return
    const generationSeq = generation.seq
    const stillCurrent = () => session === this.session && generationSeq === this.generationSeq
    generation.toolCallsInFlight += 1
    void Promise.all(
      calls.map(async (call) => {
        const query = typeof call.args?.query === "string" ? call.args.query : JSON.stringify(call.args ?? {})
        const periodDays = typeof call.args?.periodDays === "number" ? call.args.periodDays : undefined
        try {
          const response = await fetch(`${API_URL}/api/v1/realtime/tool-call`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ toolName: call.name, query, periodDays, ...(this.events.getToolCallContext?.() ?? { conversationId: null, turnId: `voice-${session}-${generationSeq}` }), callId: String(call.id ?? call.name).replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 120) }),
          })
          const payload = (await response.json()) as { data?: { text?: string; modelText?: string; supportMaterials?: FeedbackSupportMaterial[]; analytics?: unknown; reportOffer?: unknown; navigate?: { href?: unknown } | null } & Partial<VoiceConversationResult> }
          if (response.ok && payload.data?.text) {
            // O card de material vai pra tela (mesma semântica do chat); o modelo recebe
            // `modelText` — o texto + a instrução determinística de mencionar que há apoio na
            // tela, nunca uma URL (a voz não conhece rota nenhuma).
            const conversation = payload.data.conversationId ? { conversationId: payload.data.conversationId, created: payload.data.created ?? false, closed: payload.data.closed ?? false, activeConversationId: payload.data.activeConversationId ?? null } : null
            // Ferramenta da liderança: o cartão de dados (números do backend) vai para a tela junto do resumo.
            const analytics = parseLeadershipCards(payload.data.analytics)
            // Report recorrente: a oferta (botão) ou a navegação para a configuração quando o "sim" veio pela voz.
            const offer = reportOfferSchema.safeParse(payload.data.reportOffer)
            const href = payload.data.navigate?.href
            const extras = { ...(offer.success ? { reportOffer: offer.data } : {}), ...(typeof href === "string" && href.startsWith("/reports/") ? { navigate: { href } } : {}) }
            const hasExtras = Object.keys(extras).length > 0
            if (stillCurrent()) this.events.onSpecialistResult?.(payload.data.text, payload.data.supportMaterials ?? [], conversation, ...(analytics.length > 0 || hasExtras ? [analytics.length > 0 ? analytics : undefined] : []), ...(hasExtras ? [extras] : []))
            return { id: call.id, name: call.name, response: { result: payload.data.modelText ?? payload.data.text } }
          }
          return { id: call.id, name: call.name, response: { result: SPECIALIST_UNAVAILABLE } }
        } catch {
          return { id: call.id, name: call.name, response: { result: SPECIALIST_UNAVAILABLE } }
        }
      }),
    ).then((functionResponses) => {
      generation.toolCallsInFlight -= 1
      if (stillCurrent()) this.send({ toolResponse: { functionResponses } })
    })
  }
}

function closeQuietly(ws: WebSocketLike | null): void {
  if (!ws) return
  try {
    ws.close()
  } catch {
    // já fechada
  }
}

/**
 * As primeiras `words` palavras da transcrição (separadas por espaço, como o G2P as conta), com
 * reticências quando algo foi cortado. Zero palavras = nada foi dito.
 */
export function cutTranscript(transcript: string, words: number): string {
  const tokens = transcript.trim().split(/\s+/).filter(Boolean)
  if (words <= 0 || tokens.length === 0) return ""
  if (words >= tokens.length) return transcript.trim()
  return `${tokens.slice(0, words).join(" ").replace(/[\s,;:—-]+$/u, "")}…`
}
