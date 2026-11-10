/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { AvatarSpeechDriver } from "@/lib/avatar/avatar-driver"
import type { RealtimeTransportEvents } from "@/lib/realtime/gemini-realtime-transport"
import type { OperatorIndicatorsData, OperatorProfile } from "@/schemas/operator"
import { readVoiceMuted, resetVoicePreferenceForTests, setVoiceMuted } from "@/lib/avatar/voice-preference"
import { dateSeparatorLabel } from "@/lib/realtime/conversation-format"
import { OperatorIniaChat } from "./operator-inia-chat"
import { HumanSupportStateValueProvider } from "@/queries/human-support/use-human-support-state"
import type { OperatorView } from "@/schemas/human-support/state.schema"

// O chat com o transporte de voz e o avatar trocados por dublês: o que importa aqui é a fronteira
// chat ↔ avatar (driver estável, nada de fala/nível por props) e a UX de barge-in/despedida.

type FakeTransport = {
  events: RealtimeTransportEvents
  calls: string[]
  /** O que o chat pediu em cada `connect` (só a conversa a recapitular — a instrução é do backend). */
  connectRequests: unknown[]
}

const doubles = vi.hoisted(() => ({
  connectError: null as Error | null,
  transports: [] as FakeTransport[],
  avatarProps: [] as Array<Record<string, unknown>>,
  searchParams: new URLSearchParams(),
}))

// Workflow Outputs V1 — entregas da INIA (inbox de recados/conversas) e o deep link do sino.
vi.mock("@/services/inia-deliveries/inia-deliveries-service", () => ({
  fetchIniaInbox: vi.fn(async () => ({ avatarDeliveries: [], unreadConversations: [] })),
  postAvatarDeliveryEvent: vi.fn(async () => ({})),
  markWorkflowConversationSeen: vi.fn(async () => ({ seen: true })),
  fetchRecadoAudio: vi.fn(async () => { throw new Error("sem voz do Gemini neste teste") }),
}))

// Reprodução de áudio (Web Audio) trocada por um dublê observável: é por ela que a voz do Gemini chega ao avatar.
const playbackDouble = vi.hoisted(() => {
  type Listener = { onChunkScheduled?: (chunk: unknown) => void; onTurnEvent?: (event: { type: string; turnId: number }) => void }
  const state = { listeners: [] as Listener[], turn: 0, enqueued: [] as { turnId: number; samples: number }[], primeCalls: 0, interruptCalls: 0 }
  const playback = {
    context: { currentTime: 0 },
    get currentTurnId() { return state.turn },
    scheduledUntil: 0,
    prime: () => { state.primeCalls += 1 },
    beginTurn: () => ++state.turn,
    enqueueBase64Pcm16: () => null,
    enqueuePcm: (pcm: Float32Array, turnId: number) => {
      const chunk = { turnId, pcm, sampleRate: 24_000, startAt: 0, receivedAt: 0 }
      const first = !state.enqueued.some((entry) => entry.turnId === turnId)
      state.enqueued.push({ turnId, samples: pcm.length })
      for (const listener of state.listeners) listener.onChunkScheduled?.(chunk)
      if (first) for (const listener of state.listeners) listener.onTurnEvent?.({ type: "turn-started", turnId })
      return chunk
    },
    interrupt: () => { state.interruptCalls += 1; return 0 },
    isPlaying: () => false,
    heardTime: () => null,
    setAvOffsetMs: () => {},
    setMuted: () => {},
    tapOutput: () => () => {},
    subscribe: (listener: Listener) => { state.listeners.push(listener); return () => { state.listeners = state.listeners.filter((item) => item !== listener) } },
    close: async () => {},
  }
  const drain = (turnId: number) => { for (const listener of [...state.listeners]) listener.onTurnEvent?.({ type: "turn-drained", turnId }) }
  const reset = () => { state.listeners = []; state.turn = 0; state.enqueued = []; state.primeCalls = 0; state.interruptCalls = 0 }
  return { playback, state, drain, reset }
})
vi.mock("@/lib/avatar/audio/speech-playback", () => ({ createSpeechPlayback: () => playbackDouble.playback }))
vi.mock("next/navigation", () => ({ useSearchParams: () => doubles.searchParams, useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined, back: () => undefined }) }))

vi.mock("@/lib/realtime/gemini-realtime-transport", () => {
  class GeminiRealtimeTransport {
    readonly calls: string[] = []
    readonly connectRequests: unknown[] = []
    constructor(readonly events: RealtimeTransportEvents) {
      doubles.transports.push(this)
    }
    primeAudioPlayback() { this.calls.push("prime") }
    isConnected = false
    async connect(request?: unknown) {
      this.calls.push("connect")
      this.connectRequests.push(request)
      if (doubles.connectError) throw doubles.connectError
      this.isConnected = true
      this.events.onConnectionChange?.(true)
    }
    sendText(text: string) {
      this.calls.push(`sendText:${text}`)
      this.events.onStateChange?.("thinking")
    }
    async startTurn() {
      this.calls.push("startTurn")
      this.events.onStateChange?.("listening")
    }
    endTurn() {
      this.calls.push("endTurn")
      this.events.onStateChange?.("thinking")
    }
    async bargeIn() {
      this.calls.push("bargeIn")
      this.events.onTurnComplete?.()
      this.events.onStateChange?.("listening")
    }
    interruptResponse() { this.calls.push("interruptResponse") }
    readAloud(text: string) {
      this.calls.push(`readAloud:${text}`)
      this.events.onStateChange?.("thinking")
    }
    disconnect() {
      this.isConnected = false
      this.calls.push("disconnect")
      this.events.onConnectionChange?.(false)
      this.events.onStateChange?.("idle")
    }
  }
  return { GeminiRealtimeTransport, recordVoiceTurn: vi.fn(async () => null), fetchVoiceReading: vi.fn(async () => "[Leitura]\n\nResposta lida") }
})

vi.mock("@/lib/realtime/gemini-text-client", () => {
  class ConversationClosedError extends Error {
    constructor(readonly activeConversationId: string | null) {
      super("closed")
    }
  }
  class FeedbackConversationChangedError extends Error {}
  return {
    ConversationClosedError,
    FeedbackConversationChangedError,
    fetchCurrentConversation: vi.fn(async () => ({ conversation: null, inactivityHours: 24 })),
    fetchConversationMessages: vi.fn(),
    fetchOwnConversations: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    fetchTextReply: vi.fn(async () => ({ text: "", supportMaterials: [], interactionId: null, conversationId: "c", persisted: true })),
    startNewConversation: vi.fn(async () => {}),
    saveMessageRating: vi.fn(async () => ({ interactionId: "x", rating: null, ratingId: null, details: null })),
  }
})

const supportService = vi.hoisted(() => ({
  signalSupportTyping: vi.fn(async () => undefined),
  acknowledgeSupportMessages: vi.fn(async () => ({ deliveredSeq: 0, readSeq: 0 })),
  sendSupportMessage: vi.fn(async (_requestId: string, input: { clientMessageId: string; body: string }) => ({ id: "m-op", seq: 3, authorKind: "OPERATOR" as const, authorName: "Larissa", body: input.body, systemCode: null, occurredAt: new Date().toISOString() })),
  fetchSupportMessages: vi.fn(async () => ({ messages: [], hasMore: false })),
  cancelSupportRequest: vi.fn(),
  closeSupportRequestAsOperator: vi.fn(),
  previewSupportRequest: vi.fn(),
  createSupportRequest: vi.fn(),
  evaluateSupportAttendance: vi.fn(),
  fetchHumanSupportState: vi.fn(),
}))
vi.mock("@/services/human-support/human-support-service", () => supportService)

vi.mock("next/dynamic", async () => {
  const React = await import("react")
  return {
    default: () =>
      function AvatarStub(props: Record<string, unknown>) {
        doubles.avatarProps.push(props)
        return React.createElement("div", { "data-testid": "avatar-stub" })
      },
  }
})

const operator = { name: "Mariana Alves", assistantImage: "" } as unknown as OperatorProfile
const indicators = { current: [] } as unknown as OperatorIndicatorsData

type FakeUtterance = {
  text: string
  lang: string
  rate: number
  onstart: (() => void) | null
  onboundary: ((event: { name: string; charIndex: number }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

let utterances: FakeUtterance[]
let speechSynthesisMock: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }

beforeEach(() => {
  installJsdomStubs()
  resetVoicePreferenceForTests()
  doubles.connectError = null
  doubles.searchParams = new URLSearchParams()
  doubles.transports.length = 0
  doubles.avatarProps.length = 0
  utterances = []
  speechSynthesisMock = { speak: vi.fn(), cancel: vi.fn() }
  vi.stubGlobal("speechSynthesis", speechSynthesisMock)
  // O avatar 3D monta quando o navegador fica ocioso (use-browser-idle.ts); estes testes são sobre voz e driver, não sobre
  // QUANDO ele monta: ocioso na hora.
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    callback()
    return 1
  })
  vi.stubGlobal("cancelIdleCallback", () => {})
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      lang = ""
      rate = 1
      onstart: FakeUtterance["onstart"] = null
      onboundary: FakeUtterance["onboundary"] = null
      onend: FakeUtterance["onend"] = null
      onerror: FakeUtterance["onerror"] = null
      constructor(readonly text: string) {
        utterances.push(this)
      }
    },
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <OperatorIniaChat indicators={indicators} operator={operator}/>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

const lastAvatarProps = () => doubles.avatarProps[doubles.avatarProps.length - 1]
const driverOf = () => lastAvatarProps().driver as AvatarSpeechDriver
const avatarMicButton = () => screen.getAllByRole("button", { name: /Falar com a INIA|Interromper e falar|Fechar microfone e enviar/ })[0]

/** Consentimento + conexão + microfone aberto: o transporte (dublê) fica em "listening". */
async function openVoice() {
  renderChat()
  // O chat só abre a voz depois de saber qual é a conversa atual.
  await waitFor(() => expect(avatarMicButton()).toBeEnabled())
  fireEvent.click(avatarMicButton())
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Permitir microfone" }))
  })
  const transport = doubles.transports[0]
  if (!transport) throw new Error("a voz não abriu: nenhum transporte foi criado")
  return transport
}

describe("OperatorIniaChat — avatar 3D depois do idle do navegador", () => {
  it("a tela abre sem o 3D (mesmo lugar reservado) e a INIA aparece sozinha quando o navegador fica ocioso", async () => {
    let idle: (() => void) | null = null
    vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
      idle = callback
      return 1
    })
    renderChat()
    await waitFor(() => expect(avatarMicButton()).toBeEnabled())
    expect(screen.queryByTestId("avatar-stub")).not.toBeInTheDocument()
    expect(doubles.avatarProps).toHaveLength(0)
    act(() => idle!())
    expect(await screen.findByTestId("avatar-stub")).toBeInTheDocument()
  })
})

describe("OperatorIniaChat — voz e avatar", () => {
  it("o avatar recebe sempre o MESMO driver, com as novas props, e o estado vai para o driver", async () => {
    const transport = await openVoice()
    expect(transport.calls).toEqual(["prime", "prime", "connect", "startTurn"])
    const driver = driverOf()
    // No painel: busto ("chat"), de frente, ocupando o lugar do avatar; sem selo de preparação (isso é só da sessão de feedback).
    expect(lastAvatarProps()).toEqual({ modelUrl: expect.any(String), state: "listening", driver, view: "chat", facing: "forward", statusLabel: null, backdrop: "studio", showStatus: false, attributionPlacement: "bottom", className: "h-full rounded-xl" })
    expect(driver.state).toBe("listening")

    act(() => transport.events.onStateChange?.("thinking"))
    act(() => transport.events.onStateChange?.("speaking"))
    expect(doubles.avatarProps.every((props) => props.driver === driver)).toBe(true)
    expect(lastAvatarProps().state).toBe("speaking")
    expect(driver.state).toBe("speaking")
    expect(driver.drainCues()).toContainEqual({ type: "turn-started" })
  })

  it("nível do microfone e texto da resposta viram dicas no driver sem re-renderizar o avatar", async () => {
    const transport = await openVoice()
    const renders = doubles.avatarProps.length
    const driver = driverOf()
    driver.drainCues()
    act(() => {
      for (let i = 0; i < 20; i++) transport.events.onAudioLevel?.(0.05)
    })
    expect(doubles.avatarProps.length).toBe(renders)
    expect(driver.drainCues()).toEqual([{ type: "user-level", level: expect.closeTo(0.45, 5) }])

    act(() => transport.events.onOutputTranscript?.("Parabéns"))
    expect(driver.drainCues()).toEqual([{ type: "assistant-text", text: "Parabéns" }])
  })

  it("falando: o microfone vira 'Interromper e falar' (barge-in); pensando: fica desabilitado", async () => {
    const transport = await openVoice()
    act(() => transport.events.onStateChange?.("thinking"))
    expect(screen.getAllByRole("button", { name: "Falar com a INIA" })[0]).toBeDisabled()

    act(() => transport.events.onStateChange?.("speaking"))
    const interrupt = screen.getAllByRole("button", { name: "Interromper e falar" })
    expect(interrupt).toHaveLength(2)
    expect(interrupt[0]).toBeEnabled()
    await act(async () => {
      fireEvent.click(interrupt[0])
    })
    expect(transport.calls.at(-1)).toBe("bargeIn")
    expect(screen.getAllByRole("button", { name: "Fechar microfone e enviar" })[0]).toBeEnabled()
  })

  it("encerrar: corta a resposta, desconecta e a despedida anima a boca pelo driver", async () => {
    const transport = await openVoice()
    act(() => transport.events.onStateChange?.("speaking"))
    const driver = driverOf()
    const farewell = { boundary: vi.fn(), end: vi.fn(), cancel: vi.fn() }
    const startFarewell = vi.spyOn(driver, "startFarewell").mockReturnValue(farewell)

    fireEvent.click(screen.getByRole("button", { name: "Encerrar avatar" }))
    expect(transport.calls.slice(-2)).toEqual(["interruptResponse", "disconnect"])
    expect(speechSynthesisMock.speak).toHaveBeenCalledTimes(1)
    const utterance = utterances[0]
    act(() => utterance.onstart?.())
    expect(startFarewell).toHaveBeenCalledWith(utterance.text)
    expect(driver.state).toBe("speaking")
    // Durante a despedida a sessão já acabou: nada de barge-in.
    expect(screen.getAllByRole("button", { name: "Falar com a INIA" })[0]).toBeDisabled()

    act(() => utterance.onboundary?.({ name: "word", charIndex: 5 }))
    expect(farewell.boundary).toHaveBeenCalledWith(5)
    act(() => utterance.onend?.())
    expect(farewell.end).toHaveBeenCalledTimes(1)
    expect(driver.state).toBe("idle")
    // Chamada encerrada: a foto dela e o convite para chamar de novo (como numa chamada de vídeo).
    expect(screen.getByText("Chamada com a INIA encerrada")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Chamar a INIA" }))
    expect(screen.getByRole("button", { name: "Encerrar avatar" })).toBeInTheDocument()
  })

  it("tile de chamada no painel: nome e estado no canto, contorno quando ela fala, silenciar a INIA na barra da chamada", async () => {
    const transport = await openVoice()
    const tile = screen.getByTestId("inia-call-tile")
    expect(screen.getByTestId("inia-call-status")).toHaveTextContent("INIA· Ouvindo você")
    act(() => transport.events.onStateChange?.("speaking"))
    expect(screen.getByTestId("inia-call-status")).toHaveTextContent("Falando")
    expect(tile).toHaveAttribute("data-speaking")
    const controls = screen.getByRole("group", { name: "Controles da chamada com a INIA" })
    // Silenciar pela barra: ela continua respondendo, em texto (sem contorno de fala, alto-falante cortado).
    fireEvent.click(within(controls).getByRole("button", { name: "Silenciar a INIA" }))
    expect(within(controls).getByRole("button", { name: "Ativar a voz da INIA" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByTestId("inia-call-status")).toHaveTextContent("Respondendo em texto")
    expect(tile).not.toHaveAttribute("data-speaking")
    // Fora da sessão de feedback o silenciar fica só na barra da chamada (não duplica no campo de mensagem).
    expect(screen.getAllByRole("button", { name: "Ativar a voz da INIA" })).toHaveLength(1)
  })

  it("o avatar começa compacto e só amplia a pedido: o mesmo avatar, com os mesmos controles e a voz intactos", async () => {
    const transport = await openVoice()
    const size = () => screen.getByTestId("inia-call-tile").parentElement!.parentElement!
    expect(size()).toHaveAttribute("data-avatar-size", "compact")
    const avatar = screen.getByTestId("avatar-stub")
    const expand = screen.getByRole("button", { name: "Ampliar a INIA" })
    expect(expand).toHaveAttribute("aria-expanded", "false")
    act(() => transport.events.onStateChange?.("speaking"))
    expect(size()).toHaveAttribute("data-avatar-size", "compact")

    fireEvent.click(expand)
    expect(size()).toHaveAttribute("data-avatar-size", "expanded")
    expect(screen.getByRole("button", { name: "Compactar a INIA" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByTestId("avatar-stub")).toBe(avatar)
    expect(screen.getByRole("group", { name: "Controles da chamada com a INIA" })).toBeInTheDocument()
    expect(screen.getByTestId("inia-call-status")).toHaveTextContent("Falando")
    expect(transport.calls).not.toContain("close")

    fireEvent.click(screen.getByRole("button", { name: "Compactar a INIA" }))
    expect(size()).toHaveAttribute("data-avatar-size", "compact")
    expect(screen.getByTestId("avatar-stub")).toBe(avatar)
  })

  it("desmontar no meio da despedida cala a fala do navegador e solta os handlers", async () => {
    const transport = await openVoice()
    fireEvent.click(screen.getByRole("button", { name: "Encerrar avatar" }))
    const utterance = utterances[0]
    act(() => utterance.onstart?.())
    expect(transport.calls).toContain("disconnect")
    speechSynthesisMock.cancel.mockClear()
    cleanup()
    expect(speechSynthesisMock.cancel).toHaveBeenCalledTimes(1)
    expect(utterance.onend).toBeNull()
    expect(utterance.onboundary).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Conversas persistidas
// ---------------------------------------------------------------------------------------------

const textClient = await import("@/lib/realtime/gemini-text-client")
const transportModule = await import("@/lib/realtime/gemini-realtime-transport")
const CONV = "33333333-3333-4333-8333-333333333333"
const summary = (id: string, overrides: Record<string, unknown> = {}) => ({ id, kind: "CONVERSATION", status: "ACTIVE", startedAt: "2026-09-29T11:00:00.000Z", lastActivityAt: new Date().toISOString(), closedAt: null, closeReason: null, messageCount: 2, firstUserMessage: "oi", lastMessage: null, ...overrides })
const message = (content: string, role: "user" | "assistant", cursor: string, channel: "chat" | "voice" = "chat") => ({ id: `m-${cursor}`, channel, role, content, agentId: null, occurredAt: new Date().toISOString(), cursor, supportMaterials: [] })
const composer = () => screen.getByPlaceholderText(/Pergunte algo para a INIA|Conversa encerrada/)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe("OperatorIniaChat — conversas", () => {
  beforeEach(() => {
    vi.mocked(textClient.fetchCurrentConversation).mockReset().mockResolvedValue({ conversation: null, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockReset()
    vi.mocked(textClient.fetchTextReply).mockReset()
    vi.mocked(textClient.startNewConversation).mockReset().mockResolvedValue()
    vi.mocked(transportModule.recordVoiceTurn).mockReset().mockResolvedValue(null)
    // Estes testes são do caminho ESCRITO: a INIA no mudo (o padrão — ela falar — tem testes próprios abaixo).
    setVoiceMuted(true)
  })

  it("ao recarregar recupera a conversa ativa (sem a saudação de conversa nova)", async () => {
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [message("Qual meu TMA?", "user", "c1"), message("Seu TMA está em 320 s.", "assistant", "c2", "voice")], hasMore: false })
    renderChat()
    expect(await screen.findByText("Seu TMA está em 320 s.")).toBeInTheDocument()
    expect(screen.getByText("Qual meu TMA?")).toBeInTheDocument()
    expect(screen.queryByText(/Vi seus feedbacks de hoje/)).toBeNull()
    expect(screen.getByLabelText("Por voz")).toBeInTheDocument()
    expect(textClient.fetchConversationMessages).toHaveBeenCalledWith(CONV, { limit: 30 })
  })

  it("falha ao carregar mostra erro com nova tentativa — nunca uma conversa vazia", async () => {
    vi.mocked(textClient.fetchCurrentConversation).mockRejectedValueOnce(new Error("offline"))
    renderChat()
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar esta conversa")
    expect(screen.queryByText(/Vi seus feedbacks de hoje/)).toBeNull()
    expect(composer()).toBeDisabled()
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" })) })
    expect(await screen.findByText(/Vi seus feedbacks de hoje/)).toBeInTheDocument()
  })

  it("mensagem de texto: envia só a mensagem + conversa exibida e adota a conversa criada", async () => {
    vi.mocked(textClient.fetchTextReply).mockImplementation(async (_input, onChunk, onConversation) => {
      onConversation?.({ conversationId: CONV, created: true, rotatedFrom: null })
      onChunk("Olá!")
      return { text: "Olá!", supportMaterials: [], interactionId: "i1", conversationId: CONV, persisted: true }
    })
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    fireEvent.change(composer(), { target: { value: "oi" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(textClient.fetchTextReply).toHaveBeenCalledWith(expect.objectContaining({ conversationId: null, text: "oi" }), expect.any(Function), expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(await screen.findByText("Olá!")).toBeInTheDocument()
    fireEvent.change(composer(), { target: { value: "e agora?" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(vi.mocked(textClient.fetchTextReply).mock.calls[1]![0]).toMatchObject({ conversationId: CONV, text: "e agora?" })
  })

  it("Nova conversa: encerra a atual, limpa a tela e fecha a sessão de voz; resposta pendente da anterior não aparece", async () => {
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [message("pergunta antiga", "user", "c1")], hasMore: false })
    const pending = deferred<Awaited<ReturnType<typeof textClient.fetchTextReply>>>()
    let signal: AbortSignal | undefined
    vi.mocked(textClient.fetchTextReply).mockImplementation((_input, _onChunk, _onConversation, options) => {
      signal = options?.signal
      return pending.promise
    })
    const transport = await openVoice()
    expect(await screen.findByText("pergunta antiga")).toBeInTheDocument()
    act(() => transport.events.onStateChange?.("idle"))
    fireEvent.change(composer(), { target: { value: "vai demorar" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })

    expect(signal?.aborted).toBe(false)
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Nova conversa" })) })
    // O pedido da resposta pendente é cancelado: o servidor para de gerar algo que ninguém vai ver.
    expect(signal?.aborted).toBe(true)
    expect(textClient.startNewConversation).toHaveBeenCalledTimes(1)
    expect(transport.calls).toContain("disconnect")
    expect(screen.queryByText("pergunta antiga")).toBeNull()
    expect(screen.getByText(/Vi seus feedbacks de hoje/)).toBeInTheDocument()

    await act(async () => { pending.resolve({ text: "resposta atrasada", supportMaterials: [], interactionId: "i", conversationId: CONV, persisted: true }) })
    expect(screen.queryByText("resposta atrasada")).toBeNull()
  })

  it("conversa encerrada em outra janela: avisa, abre a atual e devolve o texto ao campo", async () => {
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValueOnce({ conversation: summary(CONV) as never, inactivityHours: 24 }).mockResolvedValue({ conversation: null, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [], hasMore: false })
    vi.mocked(textClient.fetchTextReply).mockRejectedValue(new textClient.ConversationClosedError(null))
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    fireEvent.change(composer(), { target: { value: "minha dúvida" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(await screen.findByText(/encerrada em outra janela/)).toBeInTheDocument()
    await waitFor(() => expect(composer()).toHaveValue("minha dúvida"))
  })

  it("voz, conferência depois de falado (PEN-017): a violação tira o texto da tela e avisa a pessoa; permitido, nada muda", async () => {
    const notice = "Parte do que falei antes não deveria ter sido dita."
    vi.mocked(transportModule.recordVoiceTurn).mockResolvedValueOnce({ conversationId: CONV, created: false, closed: false, activeConversationId: null, assistantInteractionId: "i1", responseCheck: { outcome: "VIOLATION", notice } })
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("em quem votar?"))
    act(() => transport.events.onOutputTranscript?.("Vote no candidato X"))
    await act(async () => { transport.events.onTurnComplete?.() })
    await waitFor(() => expect(screen.getByText(notice)).toBeInTheDocument())
    expect(screen.queryByText("Vote no candidato X")).toBeNull()
  })

  it("voz com especialista: a conferência do que foi falado também avisa, em um balão à parte da resposta dele", async () => {
    const notice = "Parte do que falei antes não deveria ter sido dita."
    vi.mocked(transportModule.recordVoiceTurn).mockResolvedValueOnce({ conversationId: CONV, created: false, closed: false, activeConversationId: null, assistantInteractionId: null, responseCheck: { outcome: "VIOLATION", notice } })
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("qual meu TMA?"))
    act(() => transport.events.onSpecialistResult?.("TMA 320 s", [], { conversationId: CONV, created: true, closed: false, activeConversationId: null }))
    act(() => transport.events.onOutputTranscript?.("Vote no candidato X"))
    await act(async () => { transport.events.onTurnComplete?.() })
    await waitFor(() => expect(screen.getByText(notice)).toBeInTheDocument())
    expect(screen.getByText("TMA 320 s")).toBeInTheDocument()
    expect(screen.queryByText("Vote no candidato X")).toBeNull()
  })

  it("voz com especialista: grava só a pergunta falada no fim do turno e adota a conversa da resposta", async () => {
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("qual meu TMA?"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => transport.events.onSpecialistResult?.("TMA 320 s", [], { conversationId: CONV, created: true, closed: false, activeConversationId: null }))
    expect(screen.getByText("TMA 320 s")).toBeInTheDocument()
    // A consulta da voz leva as palavras da pessoa (a transcrição ainda não fechada em balão também conta).
    expect(transport.events.getToolCallContext?.()).toMatchObject({ conversationId: CONV, utterance: "qual meu TMA?" })
    act(() => transport.events.onOutputTranscript?.("Seu TMA é 320 segundos"))
    await act(async () => { transport.events.onTurnComplete?.() })
    // A resposta gravada é a do especialista, mas o que foi falado também vai, só para a conferência (PEN-017).
    expect(transportModule.recordVoiceTurn).toHaveBeenCalledWith(expect.objectContaining({ conversationId: CONV, userText: "qual meu TMA?", assistantText: undefined, spokenText: "Seu TMA é 320 segundos" }))
    expect(vi.mocked(transportModule.recordVoiceTurn).mock.calls[0]![0].userSpokenAt).toEqual(expect.any(String))
    // Só um balão de resposta (o do especialista); a transcrição falada não duplica.
    expect(screen.queryByText("Seu TMA é 320 segundos")).toBeNull()
  })

  it("voz com esclarecimento pelas bases: o formulário aparece na resposta falada e a escolha clicada segue pela VOZ (a INIA continua falando), estruturada", async () => {
    const source = { documentId: "kb-a", documentTitle: "Base A (fictícia)", versionId: "kb-a-v1", heading: "2. Documentos", chunkIndex: 1, available: true }
    const asked = {
      version: "KNOWLEDGE_CLARIFICATION_V1", id: "11111111-1111-4111-8111-111111111111", originalQuestion: "Quais documentos para a troca?", status: "OPEN" as const,
      steps: [{ id: "step_1_aaaaaaaa", dimension: "Tipo de cliente", question: "Para qual tipo de cliente é a troca?", selectionMode: "SINGLE" as const, options: [{ id: "opt_000000000a", label: "Empresa", description: null, group: null, evidence: [source] }, { id: "opt_000000000b", label: "Residencial", description: null, group: null, evidence: [source] }], answer: null }],
      questionFacts: [], coverage: { consideredDocuments: 2, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: new Date().toISOString(), scenario: [],
    }
    vi.mocked(textClient.fetchTextReply).mockImplementationOnce(async (_input, onChunk) => {
      onChunk("Contrato social [1].")
      return { text: "Contrato social [1].", supportMaterials: [], interactionId: "i2", conversationId: CONV, persisted: true }
    })
    // A INIA com a voz LIGADA (este bloco começa no mudo).
    setVoiceMuted(false)
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("quais documentos para a troca?"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => transport.events.onSpecialistResult?.("Para qual tipo de cliente é a troca?\n\nOpções encontradas nas bases consultadas: Empresa · Residencial.", [], { conversationId: CONV, created: true, closed: false, activeConversationId: null }, undefined, { clarification: asked }))
    // O balão mostra a pergunta; as opções são o formulário (o mesmo do chat de texto).
    expect(screen.getAllByText("Para qual tipo de cliente é a troca?").length).toBeGreaterThan(0)
    expect(screen.queryByText(/Opções encontradas nas bases consultadas/)).toBeNull()
    const form = await screen.findByTestId("clarification-form")
    fireEvent.click(within(form).getByRole("radio", { name: /Empresa/ }))
    // Enquanto a INIA PENSA, o formulário espera; enquanto ela FALA, escolher interrompe a fala (como falar por cima) e a escolha vira a
    // resposta da pessoa na sessão de voz.
    expect(within(form).getByRole("button", { name: "Continuar" })).toBeDisabled()
    act(() => transport.events.onStateChange?.("speaking"))
    fireEvent.click(within(screen.getByTestId("clarification-form")).getByRole("radio", { name: /Empresa/ }))
    const textCalls = vi.mocked(textClient.fetchTextReply).mock.calls.length
    await act(async () => { fireEvent.click(within(screen.getByTestId("clarification-form")).getByRole("button", { name: "Continuar" })) })
    expect(transport.calls).toContain("interruptResponse")
    await waitFor(() => expect(transport.calls).toContain("sendText:Empresa"))
    expect(vi.mocked(textClient.fetchTextReply).mock.calls.length).toBe(textCalls)
    // A escolha ESTRUTURADA vai junto da consulta que a voz faz em seguida (uma vez só), com as palavras da pessoa — o backend a aplica
    // exatamente, nunca pela reescrita do modelo de voz.
    expect(transport.events.getToolCallContext?.()).toMatchObject({ utterance: "Empresa", clarification: { clarificationId: asked.id, stepId: "step_1_aaaaaaaa", optionIds: ["opt_000000000a"], noneMatched: false, revise: false } })
    expect(transport.events.getToolCallContext?.()).not.toHaveProperty("clarification")
    // Com a INIA no mudo, a mesma escolha vai pelo caminho de texto, estruturada.
    act(() => transport.events.onStateChange?.("idle"))
    await act(async () => { transport.events.onTurnComplete?.() })
    // A consulta da voz levou a escolha: o fim do turno não a manda de novo pelo texto.
    expect(vi.mocked(textClient.fetchTextReply).mock.calls.length).toBe(textCalls)
    act(() => transport.events.onSpecialistResult?.("Para qual tipo de cliente é a troca?", [], { conversationId: CONV, created: false, closed: false, activeConversationId: null }, undefined, { clarification: asked }))
    act(() => setVoiceMuted(true))
    const forms = await screen.findAllByTestId("clarification-form")
    const latest = forms.at(-1)!
    fireEvent.click(within(latest).getByRole("radio", { name: /Empresa/ }))
    await act(async () => { fireEvent.click(within(latest).getByRole("button", { name: "Continuar" })) })
    expect(vi.mocked(textClient.fetchTextReply).mock.calls.at(-1)![0]).toMatchObject({ conversationId: CONV, text: "Empresa", clarification: { clarificationId: asked.id, stepId: "step_1_aaaaaaaa", optionIds: ["opt_000000000a"] } })
  })

  it("voz: a correção pelo \"Alterar\" também segue pela VOZ (a INIA fala a nova resposta), com a escolha estruturada de correção", async () => {
    const source = { documentId: "kb-a", documentTitle: "Base A (fictícia)", versionId: "kb-a-v1", heading: "2. Documentos", chunkIndex: 1, available: true }
    const answered = {
      version: "KNOWLEDGE_CLARIFICATION_V1", id: "33333333-3333-4333-8333-333333333333", originalQuestion: "Quais documentos para a troca?", status: "ANSWERED" as const,
      steps: [{ id: "step_1_cccccccc", dimension: "Tipo de cliente", question: "Para qual tipo de cliente é a troca?", selectionMode: "SINGLE" as const, options: [{ id: "opt_000000000e", label: "Empresa", description: null, group: null, evidence: [source] }, { id: "opt_000000000f", label: "Residencial", description: null, group: null, evidence: [source] }], answer: { optionIds: ["opt_000000000e"], freeText: null, noneMatched: false, via: "FORM" as const, answeredAt: new Date().toISOString() } }],
      questionFacts: [], coverage: { consideredDocuments: 2, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true }, sources: [source], conflicts: [], notice: null, updatedAt: new Date().toISOString(),
      scenario: [{ dimension: "Tipo de cliente", value: "Empresa", origin: "SELECTION" as const, stepId: "step_1_cccccccc" }],
    }
    setVoiceMuted(false)
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("quais documentos para a troca?"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => transport.events.onSpecialistResult?.("Contrato social [1].", [], { conversationId: CONV, created: true, closed: false, activeConversationId: null }, undefined, { clarification: answered }))
    await act(async () => { transport.events.onTurnComplete?.() })
    act(() => transport.events.onStateChange?.("idle"))
    const textCalls = vi.mocked(textClient.fetchTextReply).mock.calls.length
    const scenario = await screen.findByTestId("clarification-scenario")
    fireEvent.click(within(scenario).getByRole("button", { name: "Tipo de cliente: Empresa (você escolheu)" }))
    fireEvent.click(screen.getByRole("button", { name: "Alterar Tipo de cliente" }))
    fireEvent.click(screen.getByRole("radio", { name: /Residencial/ }))
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refazer a partir daqui" })) })
    await waitFor(() => expect(transport.calls).toContain("sendText:Residencial"))
    expect(vi.mocked(textClient.fetchTextReply).mock.calls.length).toBe(textCalls)
    expect(transport.events.getToolCallContext?.()).toMatchObject({ utterance: "Residencial", clarification: { clarificationId: answered.id, stepId: "step_1_cccccccc", optionIds: ["opt_000000000f"], noneMatched: false, revise: true } })
  })

  it("voz: escolha clicada que nenhuma consulta da voz levou (o modelo não acionou a ferramenta) segue pelo TEXTO no fim do turno, estruturada e gravada uma vez", async () => {
    const source = { documentId: "kb-a", documentTitle: "Base A (fictícia)", versionId: "kb-a-v1", heading: "2. Documentos", chunkIndex: 1, available: true }
    const asked = {
      version: "KNOWLEDGE_CLARIFICATION_V1", id: "22222222-2222-4222-8222-222222222222", originalQuestion: "Quais documentos para a troca?", status: "OPEN" as const,
      steps: [{ id: "step_1_bbbbbbbb", dimension: "Tipo de cliente", question: "Para qual tipo de cliente é a troca?", selectionMode: "SINGLE" as const, options: [{ id: "opt_000000000c", label: "Empresa", description: null, group: null, evidence: [source] }, { id: "opt_000000000d", label: "Residencial", description: null, group: null, evidence: [source] }], answer: null }],
      questionFacts: [], coverage: { consideredDocuments: 2, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: new Date().toISOString(), scenario: [],
    }
    vi.mocked(textClient.fetchTextReply).mockImplementationOnce(async (_input, onChunk) => {
      onChunk("Qual é a situação da troca entre empresas?")
      return { text: "Qual é a situação da troca entre empresas?", supportMaterials: [], interactionId: "i3", conversationId: CONV, persisted: true }
    })
    setVoiceMuted(false)
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("quais documentos para a troca?"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => transport.events.onSpecialistResult?.("Para qual tipo de cliente é a troca?", [], { conversationId: CONV, created: true, closed: false, activeConversationId: null }, undefined, { clarification: asked }))
    await act(async () => { transport.events.onTurnComplete?.() })
    act(() => transport.events.onStateChange?.("listening"))
    vi.mocked(transportModule.recordVoiceTurn).mockClear()
    const textCalls = vi.mocked(textClient.fetchTextReply).mock.calls.length
    const form = await screen.findByTestId("clarification-form")
    fireEvent.click(within(form).getByRole("radio", { name: /Empresa/ }))
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Continuar" })) })
    await waitFor(() => expect(transport.calls).toContain("sendText:Empresa"))
    expect(vi.mocked(textClient.fetchTextReply).mock.calls.length).toBe(textCalls)
    // O modelo de voz só falou (nenhuma consulta) e o turno terminou: a escolha segue pelo texto, exatamente como foi clicada.
    act(() => transport.events.onOutputTranscript?.("Certo, empresa."))
    await act(async () => { transport.events.onTurnComplete?.() })
    await waitFor(() => expect(vi.mocked(textClient.fetchTextReply).mock.calls.length).toBe(textCalls + 1))
    expect(vi.mocked(textClient.fetchTextReply).mock.calls.at(-1)![0]).toMatchObject({ conversationId: CONV, text: "Empresa", clarification: { clarificationId: asked.id, stepId: "step_1_bbbbbbbb", optionIds: ["opt_000000000c"], noneMatched: false, revise: false } })
    // A mensagem da pessoa é gravada pelo caminho de texto (com a escolha); a voz grava só o que a INIA falou.
    expect(transportModule.recordVoiceTurn).toHaveBeenCalledWith(expect.objectContaining({ userText: undefined, assistantText: "Certo, empresa." }))
    expect(await screen.findByText("Qual é a situação da troca entre empresas?")).toBeInTheDocument()
    // Com a voz ligada ela FALA toda resposta: a resposta que veio pelo texto é LIDA em voz alta pela sessão de voz (o backend monta o
    // texto da leitura com a instrução de fala) — sem gravar nada de novo e sem legenda paralela.
    await waitFor(() => expect(transportModule.fetchVoiceReading).toHaveBeenCalledWith({ conversationId: CONV, interactionId: "i3", feedbackApplicationId: null }))
    await waitFor(() => expect(transport.calls).toContain("readAloud:[Leitura]\n\nResposta lida"))
    vi.mocked(transportModule.recordVoiceTurn).mockClear()
    act(() => transport.events.onOutputTranscript?.("Qual é a situação da troca entre empresas?"))
    await act(async () => { transport.events.onTurnComplete?.() })
    // Nada novo fica na conversa; o que foi lido em voz alta só vai para a conferência (PEN-017).
    expect(vi.mocked(transportModule.recordVoiceTurn).mock.calls).toHaveLength(1)
    expect(vi.mocked(transportModule.recordVoiceTurn).mock.calls[0]![0]).toMatchObject({ userText: undefined, assistantText: undefined, spokenText: "Qual é a situação da troca entre empresas?" })
    expect(screen.getAllByText("Qual é a situação da troca entre empresas?")).toHaveLength(1)
  })

  it("voz: a leitura em voz alta da escolha que seguiu pelo texto não acontece se a INIA foi para o mudo enquanto a resposta chegava", async () => {
    const source = { documentId: "kb-a", documentTitle: "Base A (fictícia)", versionId: "kb-a-v1", heading: "2. Documentos", chunkIndex: 1, available: true }
    const asked = {
      version: "KNOWLEDGE_CLARIFICATION_V1", id: "44444444-4444-4444-8444-444444444444", originalQuestion: "Quais documentos para a troca?", status: "OPEN" as const,
      steps: [{ id: "step_1_dddddddd", dimension: "Tipo de cliente", question: "Para qual tipo de cliente é a troca?", selectionMode: "SINGLE" as const, options: [{ id: "opt_00000000aa", label: "Empresa", description: null, group: null, evidence: [source] }, { id: "opt_00000000ab", label: "Residencial", description: null, group: null, evidence: [source] }], answer: null }],
      questionFacts: [], coverage: { consideredDocuments: 2, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true }, sources: [], conflicts: [], notice: null, updatedAt: new Date().toISOString(), scenario: [],
    }
    let answer: (value: Awaited<ReturnType<typeof textClient.fetchTextReply>>) => void = () => {}
    vi.mocked(textClient.fetchTextReply).mockImplementationOnce(() => new Promise((resolve) => { answer = resolve }))
    setVoiceMuted(false)
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("quais documentos para a troca?"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => transport.events.onSpecialistResult?.("Para qual tipo de cliente é a troca?", [], { conversationId: CONV, created: true, closed: false, activeConversationId: null }, undefined, { clarification: asked }))
    await act(async () => { transport.events.onTurnComplete?.() })
    act(() => transport.events.onStateChange?.("idle"))
    const form = await screen.findByTestId("clarification-form")
    fireEvent.click(within(form).getByRole("radio", { name: /Empresa/ }))
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Continuar" })) })
    await waitFor(() => expect(transport.calls).toContain("sendText:Empresa"))
    await act(async () => { transport.events.onTurnComplete?.() })
    await waitFor(() => expect(vi.mocked(textClient.fetchTextReply).mock.calls.at(-1)?.[0]).toMatchObject({ text: "Empresa", clarification: { clarificationId: asked.id } }))
    vi.mocked(transportModule.fetchVoiceReading).mockClear()
    act(() => setVoiceMuted(true))
    await act(async () => { answer({ text: "Contrato social.", supportMaterials: [], interactionId: "i4", conversationId: CONV, persisted: true }) })
    expect(await screen.findByText("Contrato social.")).toBeInTheDocument()
    expect(transportModule.fetchVoiceReading).not.toHaveBeenCalled()
    expect(transport.calls.some((call) => call.startsWith("readAloud"))).toBe(false)
  })

  it("voz: a sessão continua a conversa ATUAL — só o id dela vai ao backend, que recapitula o que está gravado e monta a instrução", async () => {
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [message("Qual meu TMA?", "user", "c1")], hasMore: false })
    const transport = await openVoice()
    expect(screen.getByText("Qual meu TMA?")).toBeInTheDocument()
    expect(transport.connectRequests).toEqual([{ conversationId: CONV }])
  })

  it("voz numa conversa parada além da janela de inatividade: a sessão nasce sem conversa (sem histórico antigo)", async () => {
    const stale = summary(CONV, { lastActivityAt: new Date(Date.now() - 25 * 3_600_000).toISOString() })
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValue({ conversation: stale as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: stale as never, messages: [message("pergunta de ontem", "user", "c1")], hasMore: false })
    const transport = await openVoice()
    expect(transport.connectRequests).toEqual([{ conversationId: null }])
    // A tela também recomeça: o que era da conversa parada não fica à vista da sessão nova.
    expect(screen.queryByText("pergunta de ontem")).toBeNull()
  })

  it("mensagens anteriores entram acima, sem trocar a conversa", async () => {
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages)
      .mockResolvedValueOnce({ conversation: summary(CONV) as never, messages: [message("recente", "user", "c3")], hasMore: true })
      .mockResolvedValueOnce({ conversation: summary(CONV) as never, messages: [message("antiga", "user", "c1")], hasMore: false })
    renderChat()
    await screen.findByText("recente")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Carregar mensagens anteriores" })) })
    expect(textClient.fetchConversationMessages).toHaveBeenLastCalledWith(CONV, { before: "c3", limit: 30 })
    const texts = screen.getAllByText(/^(antiga|recente)$/).map((node) => node.textContent)
    expect(texts).toEqual(["antiga", "recente"])
    expect(screen.queryByRole("button", { name: "Carregar mensagens anteriores" })).toBeNull()
  })

  it("falha ao salvar a pergunta falada marca as mensagens do turno como não salvas", async () => {
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("oi INIA"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => transport.events.onOutputTranscript?.("Oi! Como posso ajudar?"))
    await act(async () => { transport.events.onTurnComplete?.() })
    await waitFor(() => expect(screen.getAllByText(/Não salva no histórico/)).toHaveLength(2))
  })

  it("esclarecimento pelas bases: formulário na resposta, escolha enviada pelo texto com o payload estruturado e resposta com fontes", async () => {
    // Estados fictícios (bases de teste): pergunta com duas opções → resposta com o cenário e a fonte.
    const source = { documentId: "kb-a", documentTitle: "Base A (fictícia)", versionId: "kb-a-v1", heading: "2. Documentos", chunkIndex: 1, available: true }
    const openStep = { id: "step_1_aaaaaaaa", dimension: "Tipo de cliente", question: "Para qual tipo de cliente é a troca?", selectionMode: "SINGLE" as const, options: [{ id: "opt_000000000a", label: "Empresa", description: null, group: null, evidence: [source] }, { id: "opt_000000000b", label: "Residencial", description: null, group: null, evidence: [{ ...source, documentId: "kb-b", documentTitle: "Base B (fictícia)" }] }], answer: null }
    const base = { version: "KNOWLEDGE_CLARIFICATION_V1", id: "11111111-1111-4111-8111-111111111111", originalQuestion: "Quais documentos para a troca?", questionFacts: [], coverage: { consideredDocuments: 3, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true }, conflicts: [], notice: null, updatedAt: new Date().toISOString() }
    const asked = { ...base, status: "OPEN" as const, steps: [openStep], sources: [], scenario: [] }
    const answered = { ...base, status: "ANSWERED" as const, steps: [{ ...openStep, answer: { optionIds: ["opt_000000000a"], freeText: null, noneMatched: false, via: "FORM" as const, answeredAt: new Date().toISOString() } }], sources: [source], scenario: [{ dimension: "Tipo de cliente", value: "Empresa", origin: "SELECTION" as const, stepId: "step_1_aaaaaaaa" }] }
    vi.mocked(textClient.fetchTextReply)
      .mockImplementationOnce(async (_input, onChunk, onConversation) => {
        onConversation?.({ conversationId: CONV, created: true, rotatedFrom: null })
        onChunk("Para qual tipo de cliente é a troca?\n\nOpções encontradas nas bases consultadas: Empresa · Residencial.")
        return { text: "Para qual tipo de cliente é a troca?\n\nOpções encontradas nas bases consultadas: Empresa · Residencial.", supportMaterials: [], interactionId: "i1", conversationId: CONV, persisted: true, clarification: asked }
      })
      .mockImplementationOnce(async (_input, onChunk) => {
        onChunk("Contrato social das duas empresas [1].")
        return { text: "Contrato social das duas empresas [1].", supportMaterials: [], interactionId: "i2", conversationId: CONV, persisted: true, clarification: answered }
      })
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    fireEvent.change(composer(), { target: { value: "Quais documentos para a troca?" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    // O balão mostra a pergunta; as opções são o formulário da aplicação (não o texto do modelo).
    const form = await screen.findByTestId("clarification-form")
    expect(screen.getByText("Encontrei estes cenários nas bases consultadas.")).toBeInTheDocument()
    fireEvent.click(within(form).getByRole("radio", { name: /Empresa/ }))
    await act(async () => { fireEvent.click(within(form).getByRole("button", { name: "Continuar" })) })
    expect(vi.mocked(textClient.fetchTextReply).mock.calls[1]![0]).toMatchObject({ conversationId: CONV, text: "Empresa", clarification: { clarificationId: asked.id, stepId: "step_1_aaaaaaaa", optionIds: ["opt_000000000a"], noneMatched: false, revise: false } })
    // A resposta traz o cenário (com "Alterar") e as fontes; o formulário antigo vira registro.
    // Conversa natural: o balão sem os marcadores; as fontes recolhidas em "Fontes consultadas".
    expect(await screen.findByText("Contrato social das duas empresas.")).toBeInTheDocument()
    const sources = await screen.findByTestId("knowledge-sources")
    expect(within(sources).queryByTestId("knowledge-sources-list")).toBeNull()
    fireEvent.click(within(sources).getByRole("button", { name: /Fontes consultadas \(1\)/ }))
    expect(within(sources).getByTestId("knowledge-sources-list")).toHaveTextContent("Base A (fictícia)2. Documentos")
    expect(within(screen.getByTestId("clarification-scenario")).getByRole("button", { name: "Tipo de cliente: Empresa (você escolheu)" })).toHaveTextContent("Empresa")
    expect(screen.queryByTestId("clarification-form")).toBeNull()
    expect(screen.getByText("Opções apresentadas: Empresa · Residencial")).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
// Workflow Outputs V1 — recado de voz (Avatar) e conversa criada por Workflow (Chat)
// ---------------------------------------------------------------------------------------------

const deliveries = await import("@/services/inia-deliveries/inia-deliveries-service")
const RECADO = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Feedback do seu fechamento de agosto de 2026",
  speechText: "Oi, Mariana. Tenho um retorno sobre o seu fechamento de agosto de 2026. O foco principal é informar o prazo da análise. Se quiser, posso te explicar os detalhes aqui no chat.",
  displayText: "Olá, Mariana!\n\nNo fechamento de agosto de 2026, o foco principal é informar o prazo da análise.",
  status: "PENDING" as const,
  createdAt: "2026-09-29T12:00:00.000Z",
  offeredAt: null, acceptedAt: null, playingAt: null, deliveredAt: null, snoozedAt: null, failedAt: null, failureReason: null, attemptCount: 0,
}
const eventsPosted = () => vi.mocked(deliveries.postAvatarDeliveryEvent).mock.calls.map((call) => call[1])

describe("OperatorIniaChat — ela fala por padrão; mudo = só texto", () => {
  beforeEach(() => {
    vi.mocked(textClient.fetchCurrentConversation).mockReset().mockResolvedValue({ conversation: null, inactivityHours: 24 })
    vi.mocked(textClient.fetchTextReply).mockReset()
    vi.mocked(transportModule.recordVoiceTurn).mockReset().mockResolvedValue({ conversationId: CONV, created: true, closed: false, activeConversationId: null })
  })

  it("pergunta DIGITADA: vai para a sessão de voz e ela responde falando; o turno é gravado com a pergunta como digitada", async () => {
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    fireEvent.change(composer(), { target: { value: "qual meu TMA?" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    const transport = doubles.transports[0]!
    // O áudio é liberado no próprio clique; nada vai pelo caminho escrito.
    expect(transport.calls).toEqual(expect.arrayContaining(["prime", "connect", "sendText:qual meu TMA?"]))
    expect(transport.calls.indexOf("prime")).toBeLessThan(transport.calls.indexOf("sendText:qual meu TMA?"))
    expect(textClient.fetchTextReply).not.toHaveBeenCalled()
    expect(screen.getByText("qual meu TMA?")).toBeInTheDocument()
    expect(composer()).toHaveValue("")
    // Enquanto ela pensa, não dá para mandar outra por cima.
    fireEvent.change(composer(), { target: { value: "e a meta?" } })
    expect(screen.getByRole("button", { name: "Enviar mensagem" })).toBeDisabled()
    act(() => {
      transport.events.onOutputTranscript?.("Seu TMA está em 320 segundos.")
      transport.events.onStateChange?.("speaking")
    })
    await act(async () => { transport.events.onTurnComplete?.() })
    expect(transportModule.recordVoiceTurn).toHaveBeenCalledWith(expect.objectContaining({ userText: "qual meu TMA?", userChannel: "chat", assistantText: "Seu TMA está em 320 segundos." }))
    expect(screen.getByText("Seu TMA está em 320 segundos.")).toBeInTheDocument()
  })

  it("voz indisponível: a MESMA pergunta segue por escrito (uma bolha só, nada se perde)", async () => {
    doubles.connectError = new Error("sem sessão")
    vi.mocked(textClient.fetchTextReply).mockImplementation(async (_input, onChunk) => {
      onChunk("Por escrito.")
      return { text: "Por escrito.", supportMaterials: [], interactionId: "i1", conversationId: CONV, persisted: true }
    })
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    fireEvent.change(composer(), { target: { value: "oi" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(await screen.findByText("Por escrito.")).toBeInTheDocument()
    expect(textClient.fetchTextReply).toHaveBeenCalledWith(expect.objectContaining({ text: "oi" }), expect.any(Function), expect.any(Function), expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.getAllByText("oi")).toHaveLength(1)
  })

  it("mudo: ela responde só por escrito, sem voz; a preferência fica e silencia/libera a voz na hora", async () => {
    vi.mocked(textClient.fetchTextReply).mockImplementation(async (_input, onChunk) => {
      onChunk("Por escrito.")
      return { text: "Por escrito.", supportMaterials: [], interactionId: "i1", conversationId: CONV, persisted: true }
    })
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    const mute = screen.getByRole("button", { name: "Silenciar a INIA" })
    expect(mute).toHaveAttribute("aria-pressed", "false")
    fireEvent.click(mute)
    expect(screen.getByRole("button", { name: "Ativar a voz da INIA" })).toHaveAttribute("aria-pressed", "true")
    // Muda, a boca não mexe (o driver não "fala").
    driverOf().setState("speaking")
    expect(driverOf().state).toBe("idle")
    fireEvent.change(composer(), { target: { value: "oi" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(await screen.findByText("Por escrito.")).toBeInTheDocument()
    expect(doubles.transports.flatMap((transport) => transport.calls).some((call) => call.startsWith("sendText"))).toBe(false)
    // Desmuta: volta a falar.
    fireEvent.click(screen.getByRole("button", { name: "Ativar a voz da INIA" }))
    expect(driverOf().state).toBe("speaking")
  })
})

describe("OperatorIniaChat — recado de voz do Workflow (Avatar)", () => {
  const GEMINI_AUDIO = { pcm16: new Int16Array(24_000).fill(800), sampleRate: 24_000 }
  beforeEach(() => {
    playbackDouble.reset()
    vi.mocked(textClient.fetchCurrentConversation).mockReset().mockResolvedValue({ conversation: null, inactivityHours: 24 })
    vi.mocked(deliveries.postAvatarDeliveryEvent).mockReset().mockResolvedValue({} as never)
    vi.mocked(deliveries.fetchIniaInbox).mockReset().mockResolvedValue({ avatarDeliveries: [RECADO], unreadConversations: [] })
    vi.mocked(deliveries.fetchRecadoAudio).mockReset().mockResolvedValue(GEMINI_AUDIO)
  })

  it("starts avatar speech immediately after the user accepts the workflow delivery", async () => {
    renderChat()
    expect(await screen.findByText("Tenho um recado para você")).toBeInTheDocument()
    // Antes do aceite: a voz do Gemini é PREPARADA (uma vez), mas nada soa.
    await waitFor(() => expect(deliveries.fetchRecadoAudio).toHaveBeenCalledWith(RECADO.id))
    await waitFor(() => expect(eventsPosted()).toEqual(["OFFER"]))
    expect(playbackDouble.state.enqueued).toEqual([])
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled()

    // O clique JÁ é o play: libera o áudio e agenda a fala do Gemini dentro do próprio clique, sem esperar a rede.
    const driver = driverOf()
    fireEvent.click(screen.getByRole("button", { name: "Ouvir agora" }))
    expect(playbackDouble.state.primeCalls).toBe(1)
    expect(playbackDouble.state.enqueued.reduce((total, entry) => total + entry.samples, 0)).toBe(24_000)
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled()
    expect(driver.state).toBe("speaking")
    expect(screen.getByText("A INIA está falando o recado.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^(Play|Reproduzir|Tocar)/ })).toBeNull()
    await waitFor(() => expect(eventsPosted()).toEqual(["OFFER", "ACCEPT", "PLAYBACK_STARTED"]))

    // Só o áudio tocado até o fim entrega.
    act(() => playbackDouble.drain(playbackDouble.state.turn))
    await waitFor(() => expect(eventsPosted()).toEqual(["OFFER", "ACCEPT", "PLAYBACK_STARTED", "PLAYBACK_COMPLETED"]))
    expect(driver.state).toBe("idle")
    expect(screen.getByText("Recado entregue")).toBeInTheDocument()
  })

  it("voz do Gemini indisponível: a voz do sistema assume — o avatar fala mesmo assim", async () => {
    vi.mocked(deliveries.fetchRecadoAudio).mockReset().mockRejectedValue(new Error("503"))
    renderChat()
    const accept = await screen.findByRole("button", { name: "Ouvir agora" })
    await act(async () => { fireEvent.click(accept) })
    await waitFor(() => expect(speechSynthesisMock.speak).toHaveBeenCalled())
    expect(utterances.map((utterance) => utterance.text).join(" ")).toBe(RECADO.speechText)
    act(() => utterances[0]!.onstart?.())
    await waitFor(() => expect(eventsPosted()).toEqual(["OFFER", "ACCEPT", "PLAYBACK_STARTED"]))
  })

  it("'Depois': nenhum áudio, o recado fica guardado (nunca entregue)", async () => {
    renderChat()
    fireEvent.click(await screen.findByRole("button", { name: "Depois" }))
    await waitFor(() => expect(eventsPosted()).toContain("SNOOZE"))
    expect(playbackDouble.state.enqueued).toEqual([])
    expect(speechSynthesisMock.speak).not.toHaveBeenCalled()
    expect(eventsPosted()).not.toContain("PLAYBACK_COMPLETED")
  })

  it("falha de áudio (voz do sistema): vira FAILED (com nova tentativa), nunca entregue", async () => {
    vi.mocked(deliveries.fetchRecadoAudio).mockReset().mockRejectedValue(new Error("503"))
    renderChat()
    const accept = await screen.findByRole("button", { name: "Ouvir agora" })
    await act(async () => { fireEvent.click(accept) })
    await waitFor(() => expect(utterances.length).toBeGreaterThan(0))
    act(() => utterances[0]!.onstart?.())
    act(() => utterances[0]!.onerror?.())
    await waitFor(() => expect(eventsPosted()).toEqual(["OFFER", "ACCEPT", "PLAYBACK_STARTED", "PLAYBACK_FAILED"]))
    expect(vi.mocked(deliveries.postAvatarDeliveryEvent).mock.calls.at(-1)).toEqual([RECADO.id, "PLAYBACK_FAILED", "SPEECH_ERROR"])
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument()
    expect(driverOf().state).toBe("idle")
  })

  it("mudo ligado + 'Ouvir agora': o recado toca COM voz e o mudo sai (a troca fica salva e aparece no botão)", async () => {
    setVoiceMuted(true)
    renderChat()
    await waitFor(() => expect(deliveries.fetchRecadoAudio).toHaveBeenCalled())
    expect(screen.getByRole("button", { name: "Ativar a voz da INIA" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir agora" }))
    expect(readVoiceMuted()).toBe(false)
    expect(playbackDouble.state.enqueued.reduce((total, entry) => total + entry.samples, 0)).toBe(24_000)
    expect(driverOf().state).toBe("speaking")
    expect(screen.getByRole("button", { name: "Silenciar a INIA" })).toHaveAttribute("aria-pressed", "false")
  })

  it("parar no meio: interrupção registrada (não conta como ouvido) e dá para ouvir de novo", async () => {
    renderChat()
    await waitFor(() => expect(deliveries.fetchRecadoAudio).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir agora" }))
    fireEvent.click(screen.getByRole("button", { name: "Parar" }))
    await waitFor(() => expect(eventsPosted()).toEqual(["OFFER", "ACCEPT", "PLAYBACK_STARTED", "PLAYBACK_INTERRUPTED"]))
    expect(playbackDouble.state.interruptCalls).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: "Ouvir de novo" })).toBeInTheDocument()
  })
})

describe("OperatorIniaChat — conversa criada por Workflow (Chat)", () => {
  const WORKFLOW_CONV = "55555555-5555-4555-8555-555555555555"
  beforeEach(() => {
    vi.mocked(textClient.fetchCurrentConversation).mockReset().mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockReset().mockImplementation(async (id: string) =>
      id === WORKFLOW_CONV
        ? { conversation: summary(WORKFLOW_CONV, { origin: "WORKFLOW", title: "Retorno da monitoria · Contestação de conta", unread: true, messageCount: 1 }) as never, messages: [{ ...message("Tenho um retorno novo para você sobre o seu atendimento.", "assistant", "w1"), origin: "WORKFLOW" }], hasMore: false }
        : { conversation: summary(CONV) as never, messages: [message("Como faço troca de titularidade?", "user", "c1")], hasMore: false },
    )
    vi.mocked(deliveries.fetchIniaInbox).mockReset().mockResolvedValue({ avatarDeliveries: [], unreadConversations: [{ id: WORKFLOW_CONV, title: "Retorno da monitoria · Contestação de conta", startedAt: "2026-09-29T12:00:00.000Z" }] })
    vi.mocked(deliveries.markWorkflowConversationSeen).mockReset().mockResolvedValue({ seen: true })
  })

  it("aparece como 'Nova conversa da INIA' sem invadir a conversa atual; abrir mostra a mensagem destacada e marca como lida", async () => {
    renderChat()
    expect(await screen.findByText("Como faço troca de titularidade?")).toBeInTheDocument()
    expect(await screen.findByText(/Nova conversa da INIA:/)).toBeInTheDocument()
    // A conversa atual continua na tela, intacta.
    expect(screen.queryByText("Tenho um retorno novo para você sobre o seu atendimento.")).toBeNull()

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Abrir" })) })
    const bubble = (await screen.findByText("Tenho um retorno novo para você sobre o seu atendimento.")).closest("[data-origin]")
    expect(bubble).toHaveAttribute("data-origin", "workflow")
    expect(screen.getByText("Recado")).toBeInTheDocument()
    expect(screen.getAllByText("Retorno da monitoria · Contestação de conta").length).toBeGreaterThan(0)
    expect(deliveries.markWorkflowConversationSeen).toHaveBeenCalledWith(WORKFLOW_CONV)
    // Respondível (não é somente leitura) e dá para voltar à conversa atual.
    expect(composer()).toBeEnabled()
    expect(screen.getByRole("button", { name: "Voltar à conversa atual" })).toBeInTheDocument()
  })

  it("deep link do sino abre direto a conversa do Workflow (sem carregar antes a conversa atual)", async () => {
    doubles.searchParams = new URLSearchParams(`tab=followup&iniaConversation=${WORKFLOW_CONV}`)
    renderChat()
    expect(await screen.findByText("Tenho um retorno novo para você sobre o seu atendimento.")).toBeInTheDocument()
    expect(textClient.fetchCurrentConversation).not.toHaveBeenCalled()
    expect(textClient.fetchConversationMessages).toHaveBeenCalledWith(WORKFLOW_CONV, { limit: 30 })
  })
})

// ---------------------------------------------------------------------------------------------
// Caracterização (gravada antes da divisão do componente em partes): o que ainda não tinha teste
// e mora em código que muda de arquivo — ordem do turno de voz, barge-in com o trecho ouvido,
// conversa encerrada aberta pelo histórico, nível do microfone pintado direto no DOM, separadores
// de data e o recado já entregue.
// ---------------------------------------------------------------------------------------------

describe("OperatorIniaChat — caracterização do comportamento", () => {
  const CLOSED = "66666666-6666-4666-8666-666666666666"
  const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
  const messageTexts = () => Array.from(document.querySelectorAll("[data-message-id]")).map((node) => node.textContent ?? "")

  beforeEach(() => {
    playbackDouble.reset()
    vi.mocked(textClient.fetchCurrentConversation).mockReset().mockResolvedValue({ conversation: null, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockReset()
    vi.mocked(textClient.fetchOwnConversations).mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    vi.mocked(transportModule.recordVoiceTurn).mockReset().mockResolvedValue({ conversationId: CONV, created: true, closed: false, activeConversationId: null })
    vi.mocked(deliveries.fetchIniaInbox).mockReset().mockResolvedValue({ avatarDeliveries: [], unreadConversations: [] })
    vi.mocked(deliveries.postAvatarDeliveryEvent).mockReset().mockResolvedValue({} as never)
    vi.mocked(deliveries.fetchRecadoAudio).mockReset().mockRejectedValue(new Error("sem voz do Gemini neste teste"))
  })

  it("ordem do turno de voz: a pergunta falada entra antes da resposta mesmo com o turno terminando antes do debounce, e uma vez só", async () => {
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("qual é a minha meta?"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => {
      transport.events.onOutputTranscript?.("A sua meta é de dez por cento.")
      transport.events.onStateChange?.("speaking")
    })
    // Legenda ao vivo enquanto ela fala (antes de a resposta virar mensagem).
    expect(screen.getByText("A sua meta é de dez por cento.")).toBeInTheDocument()
    expect(messageTexts()).toEqual([])
    await act(async () => { transport.events.onTurnComplete?.() })
    expect(messageTexts()).toEqual([expect.stringContaining("qual é a minha meta?"), expect.stringContaining("A sua meta é de dez por cento.")])
    expect(transportModule.recordVoiceTurn).toHaveBeenCalledTimes(1)
    expect(transportModule.recordVoiceTurn).toHaveBeenCalledWith(expect.objectContaining({ conversationId: null, userText: "qual é a minha meta?", userChannel: "voice", assistantText: "A sua meta é de dez por cento.", feedbackApplicationId: null }))
    // O debounce de 400 ms da pergunta não gera uma segunda bolha depois.
    await act(async () => { await pause(450) })
    expect(messageTexts()).toHaveLength(2)
    // A conversa criada pelo turno é adotada: o próximo tool-call já leva o id dela.
    expect(transport.events.getToolCallContext?.()).toMatchObject({ conversationId: CONV })
  })

  it("barge-in: a resposta cortada fica só com o que soou — na legenda, na mensagem e no turno gravado", async () => {
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("me explica o TMA"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => {
      transport.events.onOutputTranscript?.("O TMA é o tempo médio de atendimento, e o seu está")
      transport.events.onStateChange?.("speaking")
    })
    act(() => transport.events.onResponseInterrupted?.("O TMA é o tempo médio"))
    expect(screen.getByText("O TMA é o tempo médio")).toBeInTheDocument()
    expect(screen.queryByText(/e o seu está/)).toBeNull()
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Interromper e falar" })[0]!) })
    expect(transport.calls.at(-1)).toBe("bargeIn")
    expect(messageTexts()).toEqual([expect.stringContaining("me explica o TMA"), expect.stringContaining("O TMA é o tempo médio")])
    expect(transportModule.recordVoiceTurn).toHaveBeenCalledWith(expect.objectContaining({ userText: "me explica o TMA", assistantText: "O TMA é o tempo médio" }))
    expect(screen.getAllByRole("button", { name: "Fechar microfone e enviar" })[0]).toBeEnabled()
  })

  it("conversa encerrada aberta pelo histórico: fecha a sessão de voz, fica somente leitura e 'Voltar à conversa atual' recarrega a atual", async () => {
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockImplementation(async (id: string) =>
      id === CLOSED
        ? { conversation: summary(CLOSED, { status: "CLOSED", closedAt: "2026-09-28T12:00:00.000Z", closeReason: "MANUAL" }) as never, messages: [message("pergunta de setembro", "user", "x1"), message("resposta de setembro", "assistant", "x2")], hasMore: false }
        : { conversation: summary(CONV) as never, messages: [message("pergunta de hoje", "user", "c1")], hasMore: false },
    )
    vi.mocked(textClient.fetchOwnConversations).mockResolvedValue({ items: [summary(CLOSED, { status: "CLOSED", closedAt: "2026-09-28T12:00:00.000Z", closeReason: "MANUAL", startedAt: "2026-09-28T11:00:00.000Z" }) as never], total: 1, page: 1, pageSize: 20 })
    const transport = await openVoice()
    expect(await screen.findByText("pergunta de hoje")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Conversas anteriores" }))
    const list = await screen.findByRole("list", { name: "Conversas anteriores" })
    await act(async () => { fireEvent.click(within(list).getAllByRole("button")[0]!) })

    expect(await screen.findByText("resposta de setembro")).toBeInTheDocument()
    expect(screen.queryByText("pergunta de hoje")).toBeNull()
    expect(transport.calls).toContain("disconnect")
    expect(screen.getByText(/encerrada, somente leitura/)).toBeInTheDocument()
    expect(composer()).toBeDisabled()
    expect(composer()).toHaveAttribute("placeholder", "Conversa encerrada — volte à atual ou inicie uma nova")
    expect(screen.getAllByRole("button", { name: "Falar com a INIA" }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    // Somente leitura: sem avaliação de resposta.
    expect(screen.queryByRole("button", { name: "Resposta útil" })).toBeNull()

    const currentLoads = vi.mocked(textClient.fetchCurrentConversation).mock.calls.length
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Voltar à conversa atual" })) })
    expect(await screen.findByText("pergunta de hoje")).toBeInTheDocument()
    expect(vi.mocked(textClient.fetchCurrentConversation).mock.calls.length).toBe(currentLoads + 1)
    expect(screen.queryByText(/somente leitura/)).toBeNull()
    expect(composer()).toBeEnabled()
  })

  it("nível do microfone: barras, pulso e brilho pintados direto no DOM (sem re-render) e de volta ao repouso", async () => {
    const transport = await openVoice()
    const bars = () => Array.from(document.querySelectorAll<HTMLElement>('span[class*="transition-[height]"]'))
    const pulses = () => Array.from(document.querySelectorAll<HTMLElement>('span[class*="-z-10"]'))
    expect(bars()).toHaveLength(28)
    expect(pulses()).toHaveLength(2)
    expect(pulses().map((pulse) => pulse.style.transform)).toEqual(["scale(1.2)", "scale(1.2)"])
    const composerBox = bars()[0]!.parentElement!.parentElement!
    const renders = doubles.avatarProps.length
    // Nível bruto × 9, limitado a 1 (as mesmas contas do componente, com o mesmo arredondamento de ponto flutuante).
    const level = Math.min(1, 0.05 * 9)
    act(() => transport.events.onAudioLevel?.(0.05))
    expect(doubles.avatarProps.length).toBe(renders)
    expect(bars().map((bar) => bar.style.height)).toEqual([...Array<string>(27).fill("4px"), `${4 + level * 26}px`])
    expect(pulses().map((pulse) => pulse.style.transform)).toEqual(Array(2).fill(`scale(${1.2 + level * 1.3})`))
    expect(pulses().map((pulse) => pulse.style.opacity)).toEqual(Array(2).fill(String(0.25 + level * 0.55)))
    expect(composerBox.style.boxShadow).toBe(`0 0 0 ${3 + level * 10}px rgba(102,0,153,${0.1 + level * 0.35})`)
    act(() => transport.events.onAudioLevel?.(0.02))
    expect(bars().slice(-2).map((bar) => bar.style.height)).toEqual([`${4 + level * 26}px`, `${4 + Math.min(1, 0.02 * 9) * 26}px`])
    // Microfone fechado: sem barras nem pulso; ociosa, o nível volta a zero.
    act(() => transport.events.onStateChange?.("idle"))
    expect(bars()).toHaveLength(0)
    expect(pulses()).toHaveLength(0)
    expect(screen.getAllByRole("button", { name: "Falar com a INIA" })[0]).toBeEnabled()
  })

  it("separadores de data: um por dia, na ordem das mensagens (o mesmo dia não repete)", async () => {
    const earlier = "2026-09-20T15:00:00.000Z"
    const now = new Date().toISOString()
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({
      conversation: summary(CONV) as never,
      messages: [
        { ...message("primeira", "user", "c1"), occurredAt: earlier },
        { ...message("segunda", "assistant", "c2"), occurredAt: earlier },
        { ...message("terceira", "user", "c3"), occurredAt: now },
        { ...message("quarta", "assistant", "c4"), occurredAt: now },
      ],
      hasMore: false,
    })
    renderChat()
    await screen.findByText("quarta")
    const separators = screen.getAllByRole("separator").map((node) => node.getAttribute("aria-label"))
    expect(separators).toEqual([dateSeparatorLabel(earlier), "Hoje"])
    expect(messageTexts().map((text) => text.match(/primeira|segunda|terceira|quarta/)?.[0])).toEqual(["primeira", "segunda", "terceira", "quarta"])
  })

  it("recado já entregue: 'Ouvir de novo' toca só na tela (nenhum evento novo) e 'Fechar recado' some com ele", async () => {
    const GEMINI_AUDIO = { pcm16: new Int16Array(24_000).fill(800), sampleRate: 24_000 }
    vi.mocked(deliveries.fetchIniaInbox).mockResolvedValue({ avatarDeliveries: [RECADO], unreadConversations: [] })
    vi.mocked(deliveries.fetchRecadoAudio).mockReset().mockResolvedValue(GEMINI_AUDIO)
    renderChat()
    await waitFor(() => expect(deliveries.fetchRecadoAudio).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir agora" }))
    act(() => playbackDouble.drain(playbackDouble.state.turn))
    await waitFor(() => expect(eventsPosted()).toEqual(["OFFER", "ACCEPT", "PLAYBACK_STARTED", "PLAYBACK_COMPLETED"]))
    expect(screen.getByText("Recado entregue")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Ouvir de novo" }))
    expect(playbackDouble.state.enqueued.reduce((total, entry) => total + entry.samples, 0)).toBe(48_000)
    expect(driverOf().state).toBe("speaking")
    act(() => playbackDouble.drain(playbackDouble.state.turn))
    expect(driverOf().state).toBe("idle")
    expect(screen.getByText("Recado entregue")).toBeInTheDocument()
    await act(async () => { await pause(20) })
    expect(eventsPosted()).toEqual(["OFFER", "ACCEPT", "PLAYBACK_STARTED", "PLAYBACK_COMPLETED"])

    fireEvent.click(screen.getByRole("button", { name: "Fechar recado" }))
    expect(screen.queryByTestId("inia-recado")).toBeNull()
  })
})

describe("OperatorIniaChat — resposta por escrito em fluxo", () => {
  it("antes do primeiro texto mostra o progresso verdadeiro do servidor; o texto retirado some; trocar de conversa cancela o pedido", async () => {
    let finish: () => void = () => {}
    let signal: AbortSignal | undefined
    vi.mocked(textClient.fetchTextReply).mockImplementation(async (_input, onChunk, _onConversation, options) => {
      signal = options?.signal
      options?.onStatus?.({ stage: "TOOLS", label: "Consultando as bases de conhecimento…" })
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      onChunk("Rascunho")
      options?.onRetract?.()
      onChunk("Resposta final.")
      return { text: "Resposta final.", supportMaterials: [], interactionId: "i1", conversationId: CONV, persisted: true }
    })
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Silenciar a INIA" }))
    fireEvent.change(composer(), { target: { value: "como contesto?" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(await screen.findByTestId("text-reply-status")).toHaveTextContent("Consultando as bases de conhecimento…")
    await act(async () => { finish() })
    expect(await screen.findByText("Resposta final.")).toBeInTheDocument()
    expect(screen.queryByText("Rascunho")).not.toBeInTheDocument()
    expect(screen.queryByTestId("text-reply-status")).not.toBeInTheDocument()
    expect(signal?.aborted).toBe(false)
  })

  it("resposta pelas bases em fluxo: o balão ao vivo já sai sem os marcadores de fonte; retirada, a próxima resposta volta a mostrar colchetes", async () => {
    let next: () => void = () => {}
    const step = () => new Promise<void>((resolve) => {
      next = resolve
    })
    vi.mocked(textClient.fetchTextReply).mockImplementation(async (_input, onChunk, _onConversation, options) => {
      onChunk("Abra o protocolo [1] e confira", { citations: true })
      await step()
      options?.onRetract?.()
      onChunk("Veja o item [2] do manual")
      await step()
      return { text: "Veja o item [2] do manual", supportMaterials: [], interactionId: "i1", conversationId: CONV, persisted: true }
    })
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Silenciar a INIA" }))
    fireEvent.change(composer(), { target: { value: "como contesto?" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(await screen.findByText("Abra o protocolo e confira")).toBeInTheDocument()
    expect(screen.queryByText(/\[1\]/)).not.toBeInTheDocument()
    await act(async () => { next() })
    expect(await screen.findByText("Veja o item [2] do manual")).toBeInTheDocument()
    await act(async () => { next() })
  })
})

describe("OperatorIniaChat — curtir/descurtir gravado (migration 158), a tela igual", () => {
  beforeEach(() => {
    vi.mocked(textClient.fetchCurrentConversation).mockReset().mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockReset().mockResolvedValue({ conversation: summary(CONV) as never, messages: [message("Qual o prazo?", "user", "c1"), message("Até 5 dias úteis.", "assistant", "c2")], hasMore: false })
    vi.mocked(textClient.fetchTextReply).mockReset()
    vi.mocked(textClient.saveMessageRating).mockReset().mockResolvedValue({ interactionId: "m-c2", rating: null, ratingId: null, details: null })
    setVoiceMuted(true)
  })

  it("resposta do histórico: cada clique em \"útil\" grava na resposta do servidor (clicar de novo retira); o polegar para baixo só abre o formulário", async () => {
    renderChat()
    expect(await screen.findByText("Até 5 dias úteis.")).toBeInTheDocument()
    const up = screen.getByRole("button", { name: "Resposta útil" })
    fireEvent.click(up)
    fireEvent.click(up)
    fireEvent.click(screen.getByRole("button", { name: "Resposta não foi útil" }))
    expect(await screen.findByRole("dialog", { name: "Por que esta resposta não foi útil?" })).toBeInTheDocument()
    expect(vi.mocked(textClient.saveMessageRating).mock.calls).toEqual([[CONV, "m-c2", "up"], [CONV, "m-c2", undefined]])
    // Só a resposta da INIA tem os botões (a pergunta da pessoa não).
    expect(screen.getAllByRole("button", { name: "Resposta útil" })).toHaveLength(1)
  })

  it("a avaliação gravada volta ao reabrir: clicar no mesmo botão retira", async () => {
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [message("Qual o prazo?", "user", "c1"), { ...message("Até 5 dias úteis.", "assistant", "c2"), rating: "up" }], hasMore: false })
    renderChat()
    expect(await screen.findByText("Até 5 dias úteis.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Resposta útil" }))
    expect(textClient.saveMessageRating).toHaveBeenCalledWith(CONV, "m-c2", undefined)
  })

  it("resposta escrita gravada usa o id devolvido; a que não entrou no histórico fica só na tela; falha ao gravar não muda nada", async () => {
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [], hasMore: false })
    vi.mocked(textClient.fetchTextReply)
      .mockImplementationOnce(async (_input, onChunk) => {
        onChunk("Gravada.")
        return { text: "Gravada.", supportMaterials: [], interactionId: "int-saved", conversationId: CONV, persisted: true }
      })
      .mockImplementationOnce(async (_input, onChunk) => {
        onChunk("Não gravada.")
        return { text: "Não gravada.", supportMaterials: [], interactionId: null, conversationId: CONV, persisted: false }
      })
    vi.mocked(textClient.saveMessageRating).mockRejectedValue(new Error("offline"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    for (const text of ["primeira", "segunda"]) {
      fireEvent.change(composer(), { target: { value: text } })
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    }
    expect(await screen.findByText("Não gravada.")).toBeInTheDocument()
    const [saved, unsaved] = screen.getAllByRole("button", { name: "Resposta útil" })
    await act(async () => { fireEvent.click(saved!) })
    await act(async () => { fireEvent.click(unsaved!) })
    expect(vi.mocked(textClient.saveMessageRating).mock.calls).toEqual([[CONV, "int-saved", "up"]])
    expect(warn).toHaveBeenCalledWith("[INIA] avaliação da resposta não gravada", expect.any(Error))
    expect(screen.getByText("Gravada.")).toBeInTheDocument()
    warn.mockRestore()
  })

  it("voz: a resposta do especialista e a resposta falada gravadas recebem o id do servidor", async () => {
    vi.mocked(transportModule.recordVoiceTurn).mockReset().mockResolvedValue({ conversationId: CONV, created: false, closed: false, activeConversationId: null, assistantInteractionId: "int-spoken" })
    setVoiceMuted(false)
    const transport = await openVoice()
    act(() => transport.events.onSpecialistResult?.("TMA 320 s", [], { conversationId: CONV, created: false, closed: false, activeConversationId: null }, undefined, { interactionId: "int-specialist" }))
    act(() => transport.events.onTurnComplete?.())
    act(() => transport.events.onOutputTranscript?.("Bom dia, Larissa."))
    await act(async () => { transport.events.onTurnComplete?.() })
    await waitFor(() => expect(transportModule.recordVoiceTurn).toHaveBeenCalled())
    for (const button of screen.getAllByRole("button", { name: "Resposta útil" })) await act(async () => { fireEvent.click(button) })
    expect(vi.mocked(textClient.saveMessageRating).mock.calls.map((call) => call[1])).toEqual(expect.arrayContaining(["int-specialist", "int-spoken"]))
  })
})

describe("OperatorIniaChat — descurtida com motivo no chat livre (Apoio com Anjo, Parte A)", () => {
  const down = { interactionId: "m-c2", rating: "down" as const, ratingId: "rating-2", details: { reason: "NOT_FOUND" as const, comment: null, stillNeedsHelp: false } }
  beforeEach(() => {
    vi.mocked(textClient.fetchCurrentConversation).mockReset().mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockReset().mockResolvedValue({ conversation: summary(CONV) as never, messages: [message("Qual o prazo?", "user", "c1"), message("Até 5 dias úteis.", "assistant", "c2")], hasMore: false })
    vi.mocked(textClient.fetchTextReply).mockReset()
    vi.mocked(textClient.saveMessageRating).mockReset().mockResolvedValue(down)
    setVoiceMuted(true)
  })
  const openForm = async () => {
    expect(await screen.findByText("Até 5 dias úteis.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Resposta não foi útil" }))
    return screen.findByRole("dialog", { name: "Por que esta resposta não foi útil?" })
  }

  it("exige o motivo e a resposta de ajuda; envia tudo numa chamada, espera a confirmação e só então marca a resposta", async () => {
    renderChat()
    const dialog = await openForm()
    const send = within(dialog).getByRole("button", { name: "Enviar" })
    expect(send).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Não encontrou a informação" }))
    expect(send).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Não" }))
    expect(send).toBeEnabled()
    await act(async () => { fireEvent.click(send) })
    expect(textClient.saveMessageRating).toHaveBeenCalledWith(CONV, "m-c2", "down", { reason: "NOT_FOUND", comment: "", stillNeedsHelp: false })
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("button", { name: "Resposta não foi útil" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("👎")).toBeInTheDocument()
  })

  it("\"Outro\" exige comentário; fechar sem enviar não grava nada", async () => {
    renderChat()
    const dialog = await openForm()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Outro" }))
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sim" }))
    expect(within(dialog).getByRole("button", { name: "Enviar" })).toBeDisabled()
    expect(within(dialog).getByText("Obrigatório quando o motivo é “Outro”.")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Conte o que aconteceu"), { target: { value: "ok" } })
    expect(within(dialog).getByText("Escreva pelo menos 3 caracteres.")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Conte o que aconteceu"), { target: { value: "O prazo mudou." } })
    expect(within(dialog).getByRole("button", { name: "Enviar" })).toBeEnabled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(textClient.saveMessageRating).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Resposta não foi útil" })).toHaveAttribute("aria-pressed", "false")
  })

  it("falha ao gravar aparece no formulário, com as respostas mantidas; nada é marcado", async () => {
    vi.mocked(textClient.saveMessageRating).mockRejectedValue(new Error("Não foi possível registrar agora."))
    renderChat()
    const dialog = await openForm()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Resposta incompleta" }))
    fireEvent.click(within(dialog).getByRole("radio", { name: "Não" }))
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Enviar" })) })
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Não foi possível registrar agora.")
    expect(within(dialog).getByRole("radio", { name: "Resposta incompleta" })).toBeChecked()
    expect(screen.queryByText("👎")).not.toBeInTheDocument()
  })

  it("com \"Sim\": sem o apoio ligado, avisa que ainda não está disponível para a equipe", async () => {
    vi.mocked(textClient.saveMessageRating).mockResolvedValue({ ...down, details: { reason: "NOT_FOUND", comment: null, stillNeedsHelp: true } })
    renderChat()
    const dialog = await openForm()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Não encontrou a informação" }))
    fireEvent.click(within(dialog).getByRole("radio", { name: "Sim" }))
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Enviar" })) })
    expect(await within(dialog).findByText("O apoio com Anjo ainda não está disponível para sua equipe.")).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "Falar com um Anjo" })).not.toBeInTheDocument()
  })

  it("descurtida gravada volta ao reabrir: o formulário abre preenchido e \"Retirar avaliação\" grava a retirada", async () => {
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [message("Qual o prazo?", "user", "c1"), { ...message("Até 5 dias úteis.", "assistant", "c2"), rating: "down", ratingId: "rating-2", ratingDetails: { reason: "DID_NOT_ANSWER", comment: "Perguntei outra coisa.", stillNeedsHelp: false } }], hasMore: false })
    vi.mocked(textClient.saveMessageRating).mockResolvedValue({ interactionId: "m-c2", rating: null, ratingId: null, details: null })
    renderChat()
    const dialog = await openForm()
    expect(within(dialog).getByRole("radio", { name: "Não respondeu o que perguntei" })).toBeChecked()
    expect(within(dialog).getByLabelText("Comentário (opcional)")).toHaveValue("Perguntei outra coisa.")
    expect(within(dialog).getByRole("radio", { name: "Não" })).toBeChecked()
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Retirar avaliação" })) })
    expect(textClient.saveMessageRating).toHaveBeenCalledWith(CONV, "m-c2", undefined, undefined)
    await waitFor(() => expect(screen.queryByText("👎")).not.toBeInTheDocument())
  })

  it("recado de Workflow mantém o polegar de sempre (sem formulário)", async () => {
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [{ ...message("Recado do fechamento.", "assistant", "w1"), origin: "WORKFLOW" }], hasMore: false })
    renderChat()
    expect(await screen.findByText("Recado do fechamento.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Resposta não foi útil" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(textClient.saveMessageRating).toHaveBeenCalledWith(CONV, "m-w1", "down")
  })

  it("pergunta gravada que ficou sem resposta: o balão de erro guarda o sinal NO_REPLY; sinais da resposta gravada também ficam na mensagem", async () => {
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [], hasMore: false })
    vi.mocked(textClient.fetchTextReply)
      .mockImplementationOnce(async (_input, _onChunk, onConversation) => {
        onConversation?.({ conversationId: CONV, created: false, rotatedFrom: null, userMessageId: "q-1" })
        throw new Error("Não foi possível obter uma resposta da INIA.")
      })
      .mockImplementationOnce(async (_input, onChunk, onConversation) => {
        onConversation?.({ conversationId: CONV, created: false, rotatedFrom: null, userMessageId: "q-2" })
        onChunk("Não encontrei isso nas bases.")
        return { text: "Não encontrei isso nas bases.", supportMaterials: [], interactionId: "a-2", conversationId: CONV, persisted: true, signals: ["KNOWLEDGE_NOT_FOUND"] }
      })
    const { container } = renderChat()
    await waitFor(() => expect(composer()).toBeEnabled())
    for (const text of ["como porto a linha?", "e a multa?"]) {
      fireEvent.change(composer(), { target: { value: text } })
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    }
    expect(await screen.findByText("Não encontrei isso nas bases.")).toBeInTheDocument()
    expect([...container.querySelectorAll("[data-support-signals]")].map((element) => element.getAttribute("data-support-signals"))).toEqual(["NO_REPLY", "KNOWLEDGE_NOT_FOUND"])
  })
})

describe("OperatorIniaChat — Apoio com Anjo (sala separada da INIA)", () => {
  const openRequest = {
    id: "req-1", protocol: "AP-7K2QX9", status: "IN_PROGRESS" as const, endCause: null, origin: "BUTTON" as const, createdAt: new Date().toISOString(), queuedAt: new Date().toISOString(), queueExpiresAt: null,
    sharedContext: { question: null, answer: null, dislike: null, note: "Fatura de outubro" }, anjo: { name: "Ana", avatarUrl: null, awaitingFirstResponse: false },
    messages: [{ id: "m1", seq: 1, authorKind: "SYSTEM" as const, authorName: null, body: "Ana (Anjo) recebeu seu pedido. Aguardando a primeira resposta.", systemCode: "ANJO_ASSIGNED", occurredAt: new Date().toISOString() }, { id: "m2", seq: 2, authorKind: "ANJO" as const, authorName: "Ana", body: "Oi! Como posso ajudar?", systemCode: null, occurredAt: new Date().toISOString() }],
    hasOlder: false, canCancel: false, canClose: true, peerReceipts: { deliveredSeq: 0, readSeq: 0 }, peerTypingMs: null,
  }
  const supportState: OperatorView = { enabled: true, availability: null, openRequest, pendingEvaluations: [] }
  function renderWithSupport(operatorView: OperatorView | null) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <HumanSupportStateValueProvider value={{ operator: operatorView }}>
            <OperatorIniaChat indicators={indicators} operator={operator}/>
          </HumanSupportStateValueProvider>
        </TooltipProvider>
      </QueryClientProvider>,
    )
  }
  beforeEach(() => {
    vi.mocked(textClient.fetchCurrentConversation).mockReset().mockResolvedValue({ conversation: null, inactivityHours: 24 })
    vi.mocked(textClient.fetchTextReply).mockReset()
    supportService.sendSupportMessage.mockClear()
    setVoiceMuted(false)
  })

  it("sem apoio ligado: nem botão nem selo", async () => {
    renderWithSupport({ enabled: false, availability: null, openRequest: null, pendingEvaluations: [] })
    await waitFor(() => expect(avatarMicButton()).toBeEnabled())
    expect(screen.queryByRole("button", { name: /Falar com um Anjo/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId("support-status-pill")).not.toBeInTheDocument()
  })

  it("apoio ligado: nenhum botão fixo; \"Falar com um Anjo\" só aparece abaixo da resposta em que a INIA não encontrou", async () => {
    setVoiceMuted(true)
    renderWithSupport({ enabled: true, availability: null, openRequest: null, pendingEvaluations: [] })
    await waitFor(() => expect(composer()).toBeEnabled())
    // Decisão de 10/11/2026: o apoio só é oferecido depois de a pessoa tentar com a INIA (resposta com sinal ou descurtida com "Sim").
    expect(screen.queryByRole("button", { name: /Falar com um Anjo/ })).not.toBeInTheDocument()
    vi.mocked(textClient.fetchTextReply).mockImplementationOnce(async (_input, onChunk, onConversation) => {
      onConversation?.({ conversationId: CONV, created: true, rotatedFrom: null, userMessageId: "q-1" })
      onChunk("Não encontrei isso nas bases.")
      return { text: "Não encontrei isso nas bases.", supportMaterials: [], interactionId: "a-1", conversationId: CONV, persisted: true, signals: ["KNOWLEDGE_NOT_FOUND"] }
    })
    fireEvent.change(composer(), { target: { value: "como porto a linha?" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(await screen.findByText("Não encontrei isso nas bases.")).toBeInTheDocument()
    const suggestion = screen.getByTestId("support-suggestion")
    expect(within(suggestion).getByRole("button", { name: "Falar com um Anjo" })).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /Falar com um Anjo/ })).toHaveLength(1)
  })

  it("fim de um atendimento em andamento: a vista volta à conversa atual (o servidor encerrou a de origem); pedido que sai da fila não recarrega", async () => {
    setVoiceMuted(true)
    const tree = (operatorView: OperatorView) => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <HumanSupportStateValueProvider value={{ operator: operatorView }}>
            <OperatorIniaChat indicators={indicators} operator={operator}/>
          </HumanSupportStateValueProvider>
        </TooltipProvider>
      </QueryClientProvider>
    )
    const view = render(tree(supportState))
    await waitFor(() => expect(textClient.fetchCurrentConversation).toHaveBeenCalledTimes(1))
    view.rerender(tree({ ...supportState, openRequest: null }))
    await waitFor(() => expect(textClient.fetchCurrentConversation).toHaveBeenCalledTimes(2))

    const waiting = { ...openRequest, id: "req-2", status: "WAITING" as const, anjo: null, canCancel: true, canClose: false }
    view.rerender(tree({ ...supportState, openRequest: waiting }))
    view.rerender(tree({ ...supportState, openRequest: null }))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
    expect(textClient.fetchCurrentConversation).toHaveBeenCalledTimes(2)
  })

  it("abrir a sala ENCERRA a sessão de voz; a mensagem para o Anjo vai pela sala, nunca pelo envio da INIA nem pela voz", async () => {
    renderWithSupport(supportState)
    await waitFor(() => expect(avatarMicButton()).toBeEnabled())
    fireEvent.click(avatarMicButton())
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Permitir microfone" }))
    })
    const transport = doubles.transports.at(-1)!
    expect(screen.getByTestId("support-status-pill")).toHaveTextContent("Apoio · com Ana")
    expect(screen.getByTestId("inia-avatar-stage")).not.toHaveClass("hidden")
    fireEvent.click(screen.getByTestId("support-status-pill"))
    expect(transport.calls).toContain("disconnect")
    // Com a sala aberta, o avatar sai de cena só por CSS (continua montado) e volta ao sair da sala.
    expect(screen.getByTestId("inia-avatar-stage")).toHaveClass("hidden")
    const room = screen.getByTestId("support-room")
    expect(within(room).getByText("Oi! Como posso ajudar?")).toBeInTheDocument()
    expect(within(room).getByText(/A INIA não lê esta conversa/)).toBeInTheDocument()
    const field = within(room).getByRole("textbox", { name: "Mensagem para o Anjo" })
    fireEvent.change(field, { target: { value: "Preciso contestar a fatura." } })
    await act(async () => {
      fireEvent.click(within(room).getByRole("button", { name: "Enviar mensagem para o Anjo" }))
    })
    expect(supportService.sendSupportMessage).toHaveBeenCalledWith("req-1", { clientMessageId: expect.stringMatching(/^[0-9a-f-]{36}$/), body: "Preciso contestar a fatura." })
    expect(textClient.fetchTextReply).not.toHaveBeenCalled()
    expect(transport.calls.some((call) => call.startsWith("sendText"))).toBe(false)
    expect(await within(room).findByText("Preciso contestar a fatura.")).toBeInTheDocument()
    fireEvent.click(within(room).getByRole("button", { name: "Voltar para a INIA" }))
    expect(screen.queryByTestId("support-room")).not.toBeInTheDocument()
    expect(screen.getByTestId("inia-avatar-stage")).not.toHaveClass("hidden")
  })
})
