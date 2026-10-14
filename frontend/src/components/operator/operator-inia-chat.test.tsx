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
vi.mock("next/navigation", () => ({ useSearchParams: () => doubles.searchParams }))

vi.mock("@/lib/realtime/gemini-realtime-transport", () => {
  class GeminiRealtimeTransport {
    readonly calls: string[] = []
    readonly connectRequests: unknown[] = []
    constructor(readonly events: RealtimeTransportEvents) {
      doubles.transports.push(this)
    }
    primeAudioPlayback() { this.calls.push("prime") }
    async connect(request?: unknown) {
      this.calls.push("connect")
      this.connectRequests.push(request)
      if (doubles.connectError) throw doubles.connectError
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
    disconnect() {
      this.calls.push("disconnect")
      this.events.onConnectionChange?.(false)
      this.events.onStateChange?.("idle")
    }
  }
  return { GeminiRealtimeTransport, recordVoiceTurn: vi.fn(async () => null) }
})

vi.mock("@/lib/realtime/gemini-text-client", () => {
  class ConversationClosedError extends Error {
    constructor(readonly activeConversationId: string | null) {
      super("closed")
    }
  }
  return {
    ConversationClosedError,
    fetchCurrentConversation: vi.fn(async () => ({ conversation: null, inactivityHours: 24 })),
    fetchConversationMessages: vi.fn(),
    fetchOwnConversations: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    fetchTextReply: vi.fn(async () => ({ text: "", supportMaterials: [], interactionId: null, conversationId: "c", persisted: true })),
    startNewConversation: vi.fn(async () => {}),
  }
})

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
  return doubles.transports[0]
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
    expect(lastAvatarProps()).toEqual({ modelUrl: expect.any(String), state: "listening", driver, view: "chat", facing: "forward", statusLabel: null, backdrop: "studio", showStatus: false, attributionPlacement: "top", className: "h-full rounded-xl" })
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
    expect(textClient.fetchTextReply).toHaveBeenCalledWith(expect.objectContaining({ conversationId: null, text: "oi" }), expect.any(Function), expect.any(Function))
    expect(await screen.findByText("Olá!")).toBeInTheDocument()
    fireEvent.change(composer(), { target: { value: "e agora?" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })
    expect(vi.mocked(textClient.fetchTextReply).mock.calls[1]![0]).toMatchObject({ conversationId: CONV, text: "e agora?" })
  })

  it("Nova conversa: encerra a atual, limpa a tela e fecha a sessão de voz; resposta pendente da anterior não aparece", async () => {
    vi.mocked(textClient.fetchCurrentConversation).mockResolvedValue({ conversation: summary(CONV) as never, inactivityHours: 24 })
    vi.mocked(textClient.fetchConversationMessages).mockResolvedValue({ conversation: summary(CONV) as never, messages: [message("pergunta antiga", "user", "c1")], hasMore: false })
    const pending = deferred<Awaited<ReturnType<typeof textClient.fetchTextReply>>>()
    vi.mocked(textClient.fetchTextReply).mockImplementation(() => pending.promise)
    const transport = await openVoice()
    expect(await screen.findByText("pergunta antiga")).toBeInTheDocument()
    act(() => transport.events.onStateChange?.("idle"))
    fireEvent.change(composer(), { target: { value: "vai demorar" } })
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" })) })

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Nova conversa" })) })
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

  it("voz com especialista: grava só a pergunta falada no fim do turno e adota a conversa da resposta", async () => {
    const transport = await openVoice()
    act(() => transport.events.onInputTranscript?.("qual meu TMA?"))
    act(() => transport.events.onStateChange?.("thinking"))
    act(() => transport.events.onSpecialistResult?.("TMA 320 s", [], { conversationId: CONV, created: true, closed: false, activeConversationId: null }))
    expect(screen.getByText("TMA 320 s")).toBeInTheDocument()
    expect(transport.events.getToolCallContext?.()).toMatchObject({ conversationId: CONV })
    act(() => transport.events.onOutputTranscript?.("Seu TMA é 320 segundos"))
    await act(async () => { transport.events.onTurnComplete?.() })
    expect(transportModule.recordVoiceTurn).toHaveBeenCalledWith(expect.objectContaining({ conversationId: CONV, userText: "qual meu TMA?", assistantText: undefined }))
    expect(vi.mocked(transportModule.recordVoiceTurn).mock.calls[0]![0].userSpokenAt).toEqual(expect.any(String))
    // Só um balão de resposta (o do especialista); a transcrição falada não duplica.
    expect(screen.queryByText("Seu TMA é 320 segundos")).toBeNull()
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
    expect(textClient.fetchTextReply).toHaveBeenCalledWith(expect.objectContaining({ text: "oi" }), expect.any(Function), expect.any(Function))
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
