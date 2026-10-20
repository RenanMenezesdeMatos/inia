import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { PlaybackTurnEvent, SpeechPlayback, SpeechPlaybackListener } from "@/lib/avatar/audio/types"
import type { ScheduledAudioChunk, SpeechLipsyncEngine, TranscriptFragment } from "@/lib/avatar/lipsync/types"
import { GeminiRealtimeTransport, TOOL_FAILURE_RESULT, TOOL_FAILURE_SPEECH, type RealtimeTransportEvents, type WebSocketLike } from "./gemini-realtime-transport"
import type { MicCaptureHandlers } from "./mic-capture"
import { FakeLiveSocket as FakeSocket } from "./testing/fake-live-socket"

class FakePlayback implements SpeechPlayback {
  readonly context = { currentTime: 10, state: "running" } as unknown as AudioContext
  currentTurnId = 0
  scheduledUntil = 10
  readonly enqueued: Array<{ turnId: number; data: string }> = []
  readonly calls: string[] = []
  playing = false
  private interruptedTurn = -1
  private readonly listeners = new Set<SpeechPlaybackListener>()
  prime() { this.calls.push("prime") }
  beginTurn() { this.currentTurnId += 1; return this.currentTurnId }
  enqueueBase64Pcm16(data: string, turnId: number) {
    if (turnId !== this.currentTurnId || turnId === this.interruptedTurn) return null
    this.enqueued.push({ turnId, data })
    return this.schedule(turnId)
  }
  enqueuePcm(_pcm: Float32Array, turnId: number) {
    return this.schedule(turnId)
  }
  interrupt() {
    this.calls.push("interrupt")
    this.playing = false
    this.interruptedTurn = this.currentTurnId
    return 10.06
  }
  isPlaying() { return this.playing }
  heardTime() { return 10 }
  setAvOffsetMs() {}
  setMuted() {}
  tapOutput() { return () => {} }
  subscribe(listener: SpeechPlaybackListener) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  async close() { this.calls.push("close") }
  /** O último áudio agendado do turno corrente terminou de soar. */
  drain() {
    this.playing = false
    this.emit({ type: "turn-drained", turnId: this.currentTurnId, endedAt: this.scheduledUntil })
  }
  private schedule(turnId: number): ScheduledAudioChunk {
    const chunk: ScheduledAudioChunk = { turnId, pcm: new Float32Array(960), sampleRate: 24000, startAt: this.scheduledUntil, receivedAt: 10 }
    for (const listener of this.listeners) listener.onChunkScheduled?.(chunk)
    this.scheduledUntil += 0.04
    this.playing = true
    return chunk
  }
  private emit(event: PlaybackTurnEvent) {
    for (const listener of this.listeners) listener.onTurnEvent?.(event)
  }
}

function fakeLipsync() {
  const log: string[] = []
  const transcripts: TranscriptFragment[] = []
  const engine: SpeechLipsyncEngine = {
    beginTurn: (turnId) => { log.push(`begin:${turnId}`) },
    pushAudio: (chunk) => { log.push(`audio:${chunk.turnId}`) },
    pushTranscript: (fragment) => { transcripts.push(fragment); log.push(`text:${fragment.turnId}:${fragment.text}`) },
    endOfText: (turnId) => { log.push(`end:${turnId}`) },
    interrupt: (atTime) => { log.push(`interrupt:${atTime}`) },
    reset: () => { log.push("reset") },
    sample: () => {},
    debugSnapshot: () => ({ turnId: null, phones: [], frames: [], analyzedUntil: 0, alignedUntil: 0, pendingWords: 0, minLookahead: null }),
  }
  return { engine, log, transcripts }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const audio = (data = "AAA=") => ({ serverContent: { modelTurn: { parts: [{ inlineData: { data, mimeType: "audio/pcm;rate=24000" } }] } } })
const said = (text: string) => ({ serverContent: { outputTranscription: { text } } })
const heard = (text: string) => ({ serverContent: { inputTranscription: { text } } })

let sockets: FakeSocket[]
let playback: FakePlayback
let lipsync: ReturnType<typeof fakeLipsync>
let events: Required<RealtimeTransportEvents>
let states: string[]
let captures: Array<{ handlers: MicCaptureHandlers; stop: ReturnType<typeof vi.fn> }>
let startCapture: ReturnType<typeof vi.fn>

let sessionRequests: unknown[]

function createTransport() {
  return new GeminiRealtimeTransport(events, {
    playback,
    lipsync: lipsync.engine,
    createSocket: (url) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocketLike
    },
    fetchSession: async (request) => {
      sessionRequests.push(request)
      return { wsUrl: "wss://live.test", model: "models/test", expiresAt: "" }
    },
    startCapture: startCapture as never,
  })
}

async function connectedTransport() {
  const transport = createTransport()
  const connecting = transport.connect({ conversationId: "33333333-3333-4333-8333-333333333333" })
  await tick()
  sockets[0].open()
  sockets[0].receive({ setupComplete: {} })
  await connecting
  return { transport, socket: sockets[0] }
}

/** Uma resposta chegando: texto antes do áudio, como nas capturas reais. */
async function replyArrives(socket: FakeSocket, text = "Olá, tudo bem?") {
  socket.receive(said(text))
  socket.receive(audio())
  socket.receive(audio())
  await tick()
}

beforeEach(() => {
  // Os logs de diagnóstico do transporte não interessam aqui.
  for (const method of ["info", "debug", "warn"] as const) vi.spyOn(console, method).mockImplementation(() => {})
  sockets = []
  sessionRequests = []
  playback = new FakePlayback()
  lipsync = fakeLipsync()
  states = []
  events = {
    onConnectionChange: vi.fn(),
    onStateChange: vi.fn((state: string) => { states.push(state) }),
    onInputTranscript: vi.fn(),
    onOutputTranscript: vi.fn(),
    onTurnComplete: vi.fn(),
    onResponseInterrupted: vi.fn(),
    onAudioLevel: vi.fn(),
    onSpecialistResult: vi.fn(),
    getToolCallContext: vi.fn(() => ({ conversationId: "33333333-3333-4333-8333-333333333333", turnId: "voice-turn-abc" })),
    onError: vi.fn(),
  }
  captures = []
  startCapture = vi.fn(async (handlers: MicCaptureHandlers) => {
    const capture = { handlers, stop: vi.fn() }
    captures.push(capture)
    return { context: { state: "running" } as AudioContext, stop: capture.stop }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("GeminiRealtimeTransport — conexão", () => {
  it("pede a sessão com a conversa a recapitular e manda só o modelo no setup — instrução e tools ficam travadas no token", async () => {
    const { transport, socket } = await connectedTransport()
    expect(sessionRequests).toEqual([{ conversationId: "33333333-3333-4333-8333-333333333333" }])
    expect(socket.url).toBe("wss://live.test")
    expect(socket.sent[0]).toEqual({ setup: { model: "models/test" } })
    expect(transport.isConnected).toBe(true)
    expect(events.onConnectionChange).toHaveBeenCalledWith(true)
    expect(states).toEqual(["idle"])
  })

  it("não abre duas WebSockets num duplo clique", async () => {
    const transport = createTransport()
    const first = transport.connect()
    const second = transport.connect()
    expect(second).toBe(first)
    await tick()
    expect(sockets).toHaveLength(1)
    sockets[0].open()
    sockets[0].receive({ setupComplete: {} })
    await Promise.all([first, second])
    await transport.connect()
    expect(sockets).toHaveLength(1)
  })

  it("rejeita (e avisa) se a conexão fecha antes do setupComplete", async () => {
    const transport = createTransport()
    const connecting = transport.connect()
    await tick()
    sockets[0].open()
    sockets[0].close()
    await expect(connecting).rejects.toThrow(/antes de ficar pronta/)
    expect(events.onError).toHaveBeenCalledWith(expect.stringMatching(/antes de ficar pronta/))
    expect(transport.isConnected).toBe(false)
  })

  it("disconnect durante a conexão cancela sem mensagem de erro", async () => {
    const transport = createTransport()
    const connecting = transport.connect()
    await tick()
    transport.disconnect()
    await expect(connecting).rejects.toThrow()
    expect(events.onError).not.toHaveBeenCalled()
  })
})

describe("GeminiRealtimeTransport — resposta", () => {
  it("trata as mensagens na ordem de chegada mesmo com Blob no meio", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    socket.receive(said("Primeiro"), true)
    socket.receive(said(" segundo"))
    await tick()
    expect(events.onOutputTranscript).toHaveBeenNthCalledWith(1, "Primeiro")
    expect(events.onOutputTranscript).toHaveBeenNthCalledWith(2, " segundo")
  })

  it("speaking no primeiro chunk agendado; turnComplete só fecha o texto; idle quando o áudio drena", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    expect(socket.sent.at(-1)).toEqual({ realtimeInput: { activityStart: {} } })
    transport.endTurn()
    expect(socket.sent.at(-1)).toEqual({ realtimeInput: { activityEnd: {} } })
    expect(states.at(-1)).toBe("thinking")

    socket.receive(said("Olá"))
    await tick()
    expect(states.at(-1)).toBe("thinking")
    socket.receive(audio())
    await tick()
    expect(states.at(-1)).toBe("speaking")

    socket.receive({ serverContent: { generationComplete: true } })
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe("speaking")

    playback.drain()
    expect(states.at(-1)).toBe("idle")
    expect(lipsync.log).toEqual(["begin:1", "text:1:Olá", "audio:1", "end:1"])
    expect(lipsync.transcripts[0]).toMatchObject({ receivedAt: 10, audioScheduledUntil: 10 })
  })

  it("áudio drenado com a resposta aberta (tool) volta a 'thinking' e retoma 'speaking'", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket)
    playback.drain()
    expect(states.at(-1)).toBe("thinking")
    socket.receive(audio())
    await tick()
    expect(states.at(-1)).toBe("speaking")
    playback.drain()
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(states.at(-1)).toBe("idle")
  })

  it("áudio drenado depois do generationComplete vai direto a idle, antes do turnComplete (resposta longa real)", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket)
    socket.receive({ serverContent: { generationComplete: true } })
    await tick()
    playback.drain()
    expect(states.slice(-2)).toEqual(["speaking", "idle"])
    expect(events.onTurnComplete).not.toHaveBeenCalled()
    // O turnComplete atrasado só consolida o texto.
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe("idle")
  })

  it("com uma tool em andamento, o áudio drenado é 'thinking' e a resposta retoma depois do toolResponse", async () => {
    let answer: (value: unknown) => void = () => {}
    const fetchMock = vi.fn(() => new Promise((resolve) => { answer = resolve }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      const { transport, socket } = await connectedTransport()
      await transport.startTurn()
      transport.endTurn()
      await replyArrives(socket, "Vou consultar.")
      const choice = { clarificationId: "11111111-1111-4111-8111-111111111111", stepId: "step_1_aaaaaaaa", optionIds: [], freeText: "PJ x PJ", noneMatched: true, revise: false }
      vi.mocked(events.getToolCallContext!).mockReturnValueOnce({ conversationId: "33333333-3333-4333-8333-333333333333", turnId: "voice-turn-abc", utterance: "qual o TMA?", clarification: choice })
      socket.receive({ toolCall: { functionCalls: [{ id: "c1", name: "consultar", args: { query: "TMA" } }] } })
      await tick()
      playback.drain()
      expect(states.at(-1)).toBe("thinking")

      // A tool-call leva a conversa persistida e o turno (a sessão de voz não é a conversa), as palavras da PESSOA (o esclarecimento
      // parte delas, nunca da `query` do modelo) e a escolha feita no formulário neste turno.
      expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toMatchObject({ toolName: "consultar", query: "TMA", conversationId: "33333333-3333-4333-8333-333333333333", turnId: "voice-turn-abc", callId: "c1", utterance: "qual o TMA?", clarification: choice })
      answer({ ok: true, json: async () => ({ data: { text: "TMA 320 s", modelText: "TMA 320 s", conversationId: "33333333-3333-4333-8333-333333333333", created: false, closed: false, activeConversationId: null } }) })
      await tick()
      await tick()
      expect(socket.sent.at(-1)).toEqual({ toolResponse: { functionResponses: [{ id: "c1", name: "consultar", response: { result: "TMA 320 s" } }] } })
      expect(events.onSpecialistResult).toHaveBeenCalledWith("TMA 320 s", [], { conversationId: "33333333-3333-4333-8333-333333333333", created: false, closed: false, activeConversationId: null })

      socket.receive(audio())
      socket.receive({ serverContent: { generationComplete: true } })
      await tick()
      expect(states.at(-1)).toBe("speaking")
      playback.drain()
      expect(states.at(-1)).toBe("idle")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("resposta de um esclarecimento pelas bases: o estado validado vai para a tela junto do texto; o modelo recebe a instrução de fala", async () => {
    const clarification = {
      version: "KNOWLEDGE_CLARIFICATION_V1", id: "11111111-1111-4111-8111-111111111111", originalQuestion: "Pergunta de teste?", status: "OPEN",
      steps: [{ id: "step_1_aaaaaaaa", dimension: "Dimensão", question: "Qual cenário?", selectionMode: "SINGLE", options: ["A", "B"].map((label, index) => ({ id: `opt_${String(index).padStart(10, "0")}`, label, description: null, group: null, evidence: [{ documentId: "kb-1", documentTitle: "Base de teste", versionId: "kb-1-v1", heading: "1. Seção", chunkIndex: 0, available: true }] })), answer: null }],
      questionFacts: [], coverage: { consideredDocuments: 1, matchedDocuments: 1, presentedDocuments: 1, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: "2026-10-20T12:00:00.000Z", scenario: [],
    }
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { text: "Qual cenário?\n\nOpções encontradas nas bases consultadas: A · B.", modelText: "Qual cenário? [Instrução para a resposta falada: …]", clarification, conversationId: "33333333-3333-4333-8333-333333333333", created: false, closed: false, activeConversationId: null } }) }))
    vi.stubGlobal("fetch", fetchMock)
    try {
      const { transport, socket } = await connectedTransport()
      await transport.startTurn()
      transport.endTurn()
      socket.receive({ toolCall: { functionCalls: [{ id: "c1", name: "self_ask", args: { query: "Pergunta de teste?" } }] } })
      await tick()
      await tick()
      await tick()
      expect(socket.sent.at(-1)).toEqual({ toolResponse: { functionResponses: [{ id: "c1", name: "self_ask", response: { result: "Qual cenário? [Instrução para a resposta falada: …]" } }] } })
      expect(events.onSpecialistResult).toHaveBeenCalledWith("Qual cenário?\n\nOpções encontradas nas bases consultadas: A · B.", [], expect.objectContaining({ conversationId: "33333333-3333-4333-8333-333333333333" }), undefined, { clarification: expect.objectContaining({ id: clarification.id, status: "OPEN" }) })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("consulta que falha (backend fora ou erro): o modelo recebe a frase EXATA a falar — nunca uma orientação improvisada", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: "INTERNAL" } }) })
    vi.stubGlobal("fetch", fetchMock)
    try {
      const { transport, socket } = await connectedTransport()
      await transport.startTurn()
      transport.endTurn()
      socket.receive({ toolCall: { functionCalls: [{ id: "c1", name: "self_ask", args: { query: "Pergunta de teste?" } }, { id: "c2", name: "self_ask", args: { query: "Outra pergunta?" } }] } })
      await tick()
      await tick()
      await tick()
      expect(socket.sent.at(-1)).toEqual({ toolResponse: { functionResponses: [{ id: "c1", name: "self_ask", response: { result: TOOL_FAILURE_RESULT } }, { id: "c2", name: "self_ask", response: { result: TOOL_FAILURE_RESULT } }] } })
      expect(TOOL_FAILURE_RESULT).toContain(`Fale exatamente esta frase, e nada mais: "${TOOL_FAILURE_SPEECH}"`)
      expect(events.onSpecialistResult).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("turno sem resposta: turnComplete fecha direto em idle", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe("idle")
  })

  it("sendText manda um turno de texto e segue o mesmo caminho da resposta", async () => {
    const { transport, socket } = await connectedTransport()
    transport.sendText("  Como estou hoje?  ")
    expect(socket.sent.at(-1)).toEqual({ clientContent: { turns: [{ role: "user", parts: [{ text: "Como estou hoje?" }] }], turnComplete: true } })
    expect(states.at(-1)).toBe("thinking")
    await replyArrives(socket)
    expect(states.at(-1)).toBe("speaking")
  })
})

describe("GeminiRealtimeTransport — interrupção", () => {
  it("barge-in descarta a geração antiga exatamente como no trace ao vivo e aceita a nova", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket, "Um bom atendimento começa quando você ouve")
    expect(states.at(-1)).toBe("speaking")

    await transport.bargeIn()
    // Local: cala (fade), corta a boca no instante do silêncio, consolida o texto e abre o microfone.
    expect(playback.calls).toContain("interrupt")
    expect(lipsync.log).toContain("interrupt:10.06")
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(socket.sent.at(-1)).toEqual({ realtimeInput: { activityStart: {} } })
    expect(states.at(-1)).toBe("listening")

    // Trace de 2026-09-24: activityStart → " e escuta" + áudio (antigos) → interrupted → turnComplete.
    socket.receive(said(" e escuta"))
    socket.receive(audio("b2xk"))
    socket.receive(heard("Espera"))
    socket.receive({ serverContent: { interrupted: true } })
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(events.onOutputTranscript).not.toHaveBeenCalledWith(" e escuta")
    expect(playback.enqueued.map((item) => item.data)).not.toContain("b2xk")
    expect(events.onInputTranscript).toHaveBeenCalledWith("Espera")
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe("listening")

    // Turno novo: tudo o que chega agora é da resposta nova.
    transport.endTurn()
    expect(states.at(-1)).toBe("thinking")
    socket.receive(said("Claro, pode falar."))
    socket.receive(audio("bm92bw=="))
    await tick()
    expect(events.onOutputTranscript).toHaveBeenLastCalledWith("Claro, pode falar.")
    expect(playback.enqueued.at(-1)).toEqual({ turnId: 2, data: "bm92bw==" })
    expect(states.at(-1)).toBe("speaking")
    expect(lipsync.log.slice(-3)).toEqual(["begin:2", "text:2:Claro, pode falar.", "audio:2"])
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    playback.drain()
    expect(events.onTurnComplete).toHaveBeenCalledTimes(2)
    expect(states.at(-1)).toBe("idle")
  })

  it("microfone fechado logo depois do barge-in: o resto da geração antiga continua descartado", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket, "Um bom atendimento começa quando você ouve")
    await transport.bargeIn()
    // Clique rápido de novo (só queria calar a INIA): fecha o microfone antes do fechamento antigo.
    transport.endTurn()
    socket.receive(said(" RESTO ANTIGO"))
    socket.receive(audio("T0xE"))
    socket.receive({ serverContent: { interrupted: true } })
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(events.onOutputTranscript).not.toHaveBeenCalledWith(" RESTO ANTIGO")
    expect(playback.enqueued.map((item) => item.data)).not.toContain("T0xE")
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe("thinking")
    // A resposta ao turno novo passa normalmente.
    socket.receive(said("Tudo bem."))
    socket.receive(audio("bm92bw=="))
    await tick()
    expect(events.onOutputTranscript).toHaveBeenLastCalledWith("Tudo bem.")
    expect(states.at(-1)).toBe("speaking")
  })

  it("barge-in: sai de 'speaking' na hora e registra só o trecho ouvido da resposta cortada", async () => {
    const heardWords = vi.fn(() => 3)
    lipsync.engine.heardWordCount = heardWords
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket, "Um bom atendimento começa quando você ouve")
    let resolveMic: () => void = () => {}
    startCapture.mockImplementationOnce((handlers: MicCaptureHandlers) => new Promise((resolve) => {
      resolveMic = () => resolve({ handlers, stop: vi.fn() })
    }))
    const pending = transport.bargeIn()
    // O navegador ainda está abrindo o microfone (ex.: prompt de permissão).
    expect(states.at(-1)).toBe("listening")
    expect(events.onResponseInterrupted).toHaveBeenCalledWith("Um bom atendimento…")
    expect(vi.mocked(events.onResponseInterrupted).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(events.onTurnComplete).mock.invocationCallOrder[0])
    resolveMic()
    await pending
  })

  it("tool da geração descartada recebe cancelamento (o servidor não fica esperando)", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket, "Vou consultar")
    await transport.bargeIn()
    socket.receive({ toolCall: { functionCalls: [{ id: "call-1", name: "especialista", args: { query: "x" } }] } })
    await tick()
    expect(socket.sent.at(-1)).toMatchObject({ toolResponse: { functionResponses: [{ id: "call-1", name: "especialista" }] } })
  })

  it("barge-in depois do turnComplete (só falta tocar) não descarta nada", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket)
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    await transport.bargeIn()
    transport.endTurn()
    socket.receive(said("Resposta nova"))
    await tick()
    expect(events.onOutputTranscript).toHaveBeenLastCalledWith("Resposta nova")
  })

  it("interruptResponse cala e volta a idle; o resto da geração antiga é descartado", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket)
    transport.interruptResponse()
    expect(states.at(-1)).toBe("idle")
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    socket.receive(said(" continuação"))
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(events.onOutputTranscript).not.toHaveBeenCalledWith(" continuação")
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe("idle")
  })

  it("interrupted do servidor (sem barge-in local) corta a resposta e consolida o texto uma vez", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    await replyArrives(socket)
    socket.receive({ serverContent: { interrupted: true } })
    socket.receive({ serverContent: { turnComplete: true } })
    await tick()
    expect(lipsync.log).toContain("interrupt:10.06")
    expect(events.onTurnComplete).toHaveBeenCalledTimes(1)
    expect(states.at(-1)).toBe("idle")
  })
})

describe("GeminiRealtimeTransport — ciclo de vida", () => {
  it("nada da sessão fechada volta a tocar depois do disconnect", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    transport.endTurn()
    socket.receive(audio("YW50ZXM="), true)
    transport.disconnect()
    socket.receive(audio("ZGVwb2lz"))
    await tick()
    expect(playback.enqueued).toHaveLength(0)
    expect(playback.calls).toContain("close")
    expect(lipsync.log).toContain("reset")
    expect(captures[0].stop).toHaveBeenCalled()
    expect(events.onConnectionChange).toHaveBeenLastCalledWith(false)
    expect(states.at(-1)).toBe("idle")
    expect(transport.isConnected).toBe(false)
  })

  it("queda inesperada com o microfone aberto fecha a captura e avisa", async () => {
    const { transport, socket } = await connectedTransport()
    await transport.startTurn()
    socket.close()
    expect(captures[0].stop).toHaveBeenCalled()
    expect(events.onConnectionChange).toHaveBeenLastCalledWith(false)
    expect(events.onError).toHaveBeenCalledWith(expect.stringMatching(/caiu/))
    expect(states.at(-1)).toBe("idle")
    // O próximo turno não fica preso: sem conexão, startTurn não faz nada (o chat reconecta).
    await transport.startTurn()
    expect(startCapture).toHaveBeenCalledTimes(1)
  })

  it("falha ao abrir o microfone avisa e deixa tentar de novo", async () => {
    const { transport, socket } = await connectedTransport()
    startCapture.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }))
    await transport.startTurn()
    expect(events.onError).toHaveBeenCalledWith(expect.stringMatching(/Permissão do microfone negada/))
    expect(socket.sent.some((message) => "realtimeInput" in message)).toBe(false)
    expect(states.at(-1)).toBe("idle")
    await transport.startTurn()
    expect(states.at(-1)).toBe("listening")
  })

  it("microfone aberto depois de um disconnect é fechado na hora", async () => {
    const { transport } = await connectedTransport()
    let release: () => void = () => {}
    startCapture.mockImplementationOnce(async (handlers: MicCaptureHandlers) => {
      await new Promise<void>((resolve) => { release = resolve })
      const capture = { handlers, stop: vi.fn() }
      captures.push(capture)
      return { context: { state: "running" } as AudioContext, stop: capture.stop }
    })
    const starting = transport.startTurn()
    transport.disconnect()
    release()
    await starting
    expect(captures[0].stop).toHaveBeenCalled()
    expect(states.at(-1)).toBe("idle")
  })

  it("nível do microfone vai para onAudioLevel e o silêncio longo encerra o turno", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      const { transport, socket } = await connectedTransport()
      await transport.startTurn()
      const { handlers } = captures[0]
      handlers.onLevel(0.2)
      expect(events.onAudioLevel).toHaveBeenCalledWith(0.2)
      handlers.onLevel(0)
      vi.setSystemTime(Date.now() + 3600)
      handlers.onLevel(0)
      expect(socket.sent.at(-1)).toEqual({ realtimeInput: { activityEnd: {} } })
      expect(states.at(-1)).toBe("thinking")
    } finally {
      vi.useRealTimers()
    }
  })
})
