/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { OperatorIndicatorsData, OperatorProfile } from "@/schemas/operator"
import type { FeedbackApplication, FeedbackApplicationDetail, FeedbackInvite } from "@/schemas/feedback-applications/feedback-application.schema"
import { readVoiceMuted, resetVoicePreferenceForTests, setVoiceMuted } from "@/lib/avatar/voice-preference"
import { OperatorIniaChat } from "../operator-inia-chat"
import { FeedbackApplicationButton } from "./feedback-application-button"
import { createIniaVoiceEngine, FeedbackWorkspaceContext, type FeedbackOpenRequest, type FeedbackWorkspace } from "./feedback-workspace-context"

/**
 * APLICAÇÃO DE FEEDBACK na Área do Operador — o chat com transporte de voz e avatar trocados por dublês e os serviços simulados.
 * O que importa: uma aplicação por feedback (o backend decide; a tela segue), a SESSÃO no card central com UM avatar (o mesmo do
 * painel, movido — nunca dois), apresentação só na PRIMEIRA aplicação, retomada sem reprodução automática, concluída = registro
 * original + dúvidas na conversa complementar (o backend decide a conversa), fechar não conclui, confirmar ciência (login e senha, o
 * mesmo controle do Acompanhamento) conclui, convite sem áudio/foco.
 */
const doubles = vi.hoisted(() => ({ searchParams: new URLSearchParams() }))
const api = vi.hoisted(() => ({
  applications: [] as FeedbackApplication[],
  invite: null as FeedbackInvite | null,
  start: vi.fn(),
  confirm: vi.fn(),
  pause: vi.fn(async () => ({})),
  opened: vi.fn(async () => ({})),
  presentationEvent: vi.fn(async () => undefined),
  inviteEvent: vi.fn(async () => undefined),
  audio: vi.fn(async () => ({ pcm16: new Int16Array(2400), sampleRate: 24_000 })),
}))
vi.mock("@/services/feedback-applications/feedback-applications-service", () => ({
  fetchFeedbackApplications: vi.fn(async () => api.applications),
  fetchFeedbackInvite: vi.fn(async () => api.invite),
  postFeedbackInviteEvent: api.inviteEvent,
  startOrResumeFeedbackApplication: api.start,
  markFeedbackApplicationOpened: api.opened,
  postFeedbackPresentationEvent: api.presentationEvent,
  pauseFeedbackApplication: api.pause,
  fetchFeedbackPresentationAudio: api.audio,
}))
vi.mock("@/services/feedback-read-confirmations/feedback-read-confirmations-service", () => ({
  confirmFeedbackReading: api.confirm,
  recordReadConfirmationEvent: vi.fn(async () => undefined),
}))
const scenes = vi.hoisted(() => ({ current: null as null | { id: string; name: string; imageId: string; imageLabel: string; imageUrl: string; width: number; height: number; blur: number; dim: number; reason: "SCHEDULED" | "DEFAULT"; imageReason: "SLOT" | "PRIMARY" } }))
vi.mock("@/services/inia-scenes/inia-scene-service", () => ({
  fetchCurrentIniaScene: vi.fn(async () => ({ scene: scenes.current, now: null, nextChangeAt: null, upcoming: null })),
  sceneImageSrc: (url: string) => url,
}))
vi.mock("@/services/inia-deliveries/inia-deliveries-service", () => ({
  fetchIniaInbox: vi.fn(async () => ({ avatarDeliveries: [], unreadConversations: [] })),
  postAvatarDeliveryEvent: vi.fn(async () => ({})),
  markWorkflowConversationSeen: vi.fn(async () => ({ seen: true })),
  fetchRecadoAudio: vi.fn(async () => { throw new Error("sem voz") }),
}))
const playback = vi.hoisted(() => {
  type Listener = { onChunkScheduled?: (chunk: unknown) => void; onTurnEvent?: (event: { type: string; turnId: number }) => void }
  const state = { listeners: [] as Listener[], turn: 0, primeCalls: 0 }
  const instance = {
    context: { currentTime: 0 },
    get currentTurnId() { return state.turn },
    scheduledUntil: 0,
    prime: () => { state.primeCalls += 1 },
    beginTurn: () => ++state.turn,
    enqueueBase64Pcm16: () => null,
    enqueuePcm: (pcm: Float32Array, turnId: number) => {
      const chunk = { turnId, pcm, sampleRate: 24_000, startAt: 0, receivedAt: 0 }
      for (const listener of state.listeners) listener.onChunkScheduled?.(chunk)
      for (const listener of state.listeners) listener.onTurnEvent?.({ type: "turn-started", turnId })
      return chunk
    },
    interrupt: () => 0,
    isPlaying: () => false,
    heardTime: () => null,
    setAvOffsetMs: () => {},
    setMuted: () => {},
    tapOutput: () => () => {},
    subscribe: (listener: Listener) => { state.listeners.push(listener); return () => { state.listeners = state.listeners.filter((item) => item !== listener) } },
    close: async () => {},
  }
  const drain = () => { for (const listener of [...state.listeners]) listener.onTurnEvent?.({ type: "turn-drained", turnId: state.turn }) }
  return { instance, state, drain }
})
vi.mock("@/lib/avatar/audio/speech-playback", () => ({ createSpeechPlayback: () => playback.instance }))
vi.mock("next/navigation", () => ({ useSearchParams: () => doubles.searchParams }))
type VoiceHandlers = {
  onStateChange: (state: string) => void
  onOutputTranscript: (text: string) => void
  onTurnComplete: () => void
  onResponseInterrupted: (heard: string | null) => void
  onSpecialistResult: (text: string, supportMaterials: unknown[], conversation: unknown) => void
  getToolCallContext: () => { conversationId: string | null; turnId: string; feedbackApplicationId?: string | null }
}
const voiceDouble = vi.hoisted(() => ({
  options: null as null | { fetchSession: () => Promise<unknown> },
  handlers: null as null | VoiceHandlers,
  /** Turnos de texto mandados à sessão de voz (o sinal da apresentação ao vivo). */
  sent: [] as string[],
  connectError: null as Error | null,
  interrupts: 0,
  fetchSession: vi.fn(async () => ({})),
  recordVoiceTurn: vi.fn(async () => null),
}))
vi.mock("@/lib/realtime/gemini-realtime-transport", () => {
  class GeminiRealtimeTransport {
    constructor(handlers: VoiceHandlers, options: { fetchSession: () => Promise<unknown> }) {
      voiceDouble.options = options
      voiceDouble.handlers = handlers
    }
    primeAudioPlayback() {}
    async connect() {
      if (voiceDouble.connectError) throw voiceDouble.connectError
    }
    sendText(text: string) { voiceDouble.sent.push(text) }
    async startTurn() {}
    endTurn() {}
    async bargeIn() {}
    interruptResponse() { voiceDouble.interrupts += 1 }
    disconnect() {}
  }
  return { GeminiRealtimeTransport, recordVoiceTurn: voiceDouble.recordVoiceTurn, fetchEphemeralSession: voiceDouble.fetchSession }
})
const text = vi.hoisted(() => ({ messages: new Map<string, unknown[]>(), currentCalls: 0, reply: vi.fn() }))
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
    fetchCurrentConversation: vi.fn(async () => { text.currentCalls += 1; return { conversation: null, inactivityHours: 24 } }),
    fetchConversationMessages: vi.fn(async (id: string) => ({ conversation: { id, lastActivityAt: "2026-10-01T12:00:00.000Z" }, messages: text.messages.get(id) ?? [], hasMore: false })),
    fetchOwnConversations: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    fetchTextReply: text.reply,
    startNewConversation: vi.fn(async () => {}),
  }
})
vi.mock("next/dynamic", async () => {
  const React = await import("react")
  return { default: () => function AvatarStub(props: { facing?: string }) { return React.createElement("div", { "data-testid": "avatar-stub", "data-facing": props.facing }) } }
})

const operator = { name: "Joana Ribeiro", addressName: "Jô", assistantImage: "" } as unknown as OperatorProfile
const indicators = { current: [{ id: "TMA", title: "TMA", priority: 0, recommendation: "dado de HOJE" }] } as unknown as OperatorIndicatorsData
const SOURCE = { kind: "PUBLISHED_FEEDBACK" as const, id: "11111111-1111-4111-8111-111111111111" }

function detail(overrides: Partial<FeedbackApplicationDetail> = {}): FeedbackApplicationDetail {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001", source: SOURCE, status: "IN_PROGRESS", conversationId: "conv-feedback", title: "Rechamada", periodLabel: "Agosto de 2026", publishedDay: "12/09/2026", historical: true,
    startedAt: "2026-10-01T12:00:00.000Z", lastOpenedAt: null, pausedAt: null, completedAt: null,
    presentation: { startedAt: null, completedAt: null, interruptedAt: null, playCount: 0 }, invite: { offeredAt: null, resolvedAt: null, resolution: null }, sourceVersion: 1, acknowledgedAt: null,
    script: { chatText: "Olá, Jô! Este feedback se refere aos seus resultados de agosto de 2026…", speechText: "Oi, Jô. Este feedback se refere aos seus resultados de agosto de 2026.", speechTruncated: false, suggestions: ["Pode explicar esse resultado?", "Como aplico essa orientação?"] },
    limitations: ["O registro não guarda X."], sourceCorrected: false, followUpConversationId: null,
    content: { view: null, text: "Em agosto de 2026, a Rechamada ficou em 14,6%, fora da meta de 10%.", summary: null, indicators: [{ name: "Rechamada", lines: [{ label: "Meta oficial", value: "10%" }], notes: [] }], evidence: [], guidance: ["Confirme o motivo do contato."], strengths: [], materials: [] },
    ...overrides,
  }
}
const presentationMessage = { id: "m1", channel: "chat", role: "assistant", content: "Olá, Jô! Este feedback se refere aos seus resultados de agosto de 2026…", agentId: null, occurredAt: "2026-10-01T12:00:00.000Z", cursor: "c1", supportMaterials: [], origin: "FEEDBACK" }

function workspaceDouble() {
  let handler: ((request: FeedbackOpenRequest) => void) | null = null
  let seq = 0
  const workspace: FeedbackWorkspace & { focusCalls: number; focusFeedbackTrigger: ReturnType<typeof vi.fn>; revealChat: ReturnType<typeof vi.fn> } = {
    voice: createIniaVoiceEngine(),
    layout: "desktop",
    activeSourceKey: null,
    setActiveSourceKey: vi.fn(),
    focusCalls: 0,
    openFeedback(input) {
      workspace.focusCalls += 1
      handler?.({ ...input, id: ++seq })
    },
    pendingRequest: null,
    takePendingRequest: () => null,
    registerChat: (next) => { handler = next },
    readFeedback: vi.fn(),
    readTarget: null,
    focusFeedbackTrigger: vi.fn(() => true),
    revealChat: vi.fn(),
    chatHidden: false,
  }
  return workspace
}

/** O motor de voz do espaço de trabalho do último render (para observar as dicas enviadas ao avatar). */
let createIniaVoiceEngineSpyTarget = createIniaVoiceEngine()

function renderWorkspace(workspace = workspaceDouble(), options: { hidden?: boolean } = {}) {
  createIniaVoiceEngineSpyTarget = workspace.voice
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <FeedbackWorkspaceContext.Provider value={workspace}>
          <FeedbackApplicationButton source={SOURCE} title="Rechamada" periodLabel="Agosto de 2026" />
          <OperatorIniaChat indicators={indicators} operator={operator} hidden={options.hidden} />
        </FeedbackWorkspaceContext.Provider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return workspace
}

beforeEach(() => {
  installJsdomStubs()
  resetVoicePreferenceForTests()
  vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() })
  api.applications = []
  api.invite = null
  scenes.current = null
  api.start.mockReset()
  api.confirm.mockReset()
  for (const fn of [api.pause, api.opened, api.presentationEvent, api.inviteEvent, api.audio, text.reply]) fn.mockClear()
  text.messages = new Map([["conv-feedback", [presentationMessage]]])
  text.currentCalls = 0
  voiceDouble.fetchSession.mockClear()
  voiceDouble.recordVoiceTurn.mockClear()
  voiceDouble.sent = []
  voiceDouble.connectError = null
  voiceDouble.interrupts = 0
  playback.state.listeners = []
  playback.state.primeCalls = 0
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Aplicação de feedback — ação principal no Acompanhamento", () => {
  it.each([
    [[] as FeedbackApplication[], "Ouvir com a INIA", "listen"],
    [[detail({ status: "IN_PROGRESS" })], "Continuar feedback", "continue"],
    [[detail({ status: "COMPLETED", completedAt: "2026-10-01T13:00:00.000Z" })], "Ver feedback e conversa", "view"],
  ])("rótulo pelo estado da aplicação e o pedido leva o modo certo", async (applications, label, mode) => {
    api.applications = applications
    const workspace = workspaceDouble()
    const open = vi.spyOn(workspace, "openFeedback").mockImplementation(() => {})
    renderWorkspace(workspace)
    fireEvent.click(await screen.findByRole("button", { name: label }))
    expect(open).toHaveBeenCalledWith({ source: SOURCE, mode, title: "Rechamada", periodLabel: "Agosto de 2026", origin: "feed" })
  })
})

const session = () => screen.findByTestId("feedback-session")
const voiceStatus = () => screen.getByTestId("feedback-voice-status")

describe("Aplicação de feedback — sessão no card central", () => {
  it("primeira aplicação: libera o áudio no clique, abre o card com o feedback e o avatar (um só) e apresenta sem segundo clique", async () => {
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    const primesBefore = playback.state.primeCalls
    const cues = vi.spyOn(createIniaVoiceEngineSpyTarget.driver, "pushCue")
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    expect(playback.state.primeCalls).toBeGreaterThan(primesBefore)
    const dialog = await session()
    // A INIA chega chamando a atenção para o feedback que ela apresenta (frase fixa + gesto apontando para ele).
    expect(within(dialog).getByRole("heading", { name: "INIA Aplicação de feedback" })).toBeInTheDocument()
    expect(within(dialog).getByTestId("feedback-session-speech")).toHaveTextContent("Agora vamos falar sobre isso.")
    await waitFor(() => expect(cues).toHaveBeenCalledWith({ type: "gesture", id: "explainLeft" }), { timeout: 2000 })
    expect(within(dialog).getByRole("heading", { name: "Rechamada" })).toBeInTheDocument()
    expect(within(dialog).getByTestId("feedback-session-conversation")).toBeInTheDocument()
    expect(within(dialog).getByText("Agosto de 2026 · publicado em 12/09/2026")).toBeInTheDocument()
    expect(within(dialog).getByTestId("feedback-session-status")).toHaveTextContent("Em andamento")
    // Conteúdo REAL do feedback (o registro aplicado) ao lado do avatar, não só metadados.
    expect(await within(dialog).findByText(/a Rechamada ficou em 14,6%, fora da meta de 10%/)).toBeInTheDocument()
    // UM avatar: o mesmo nó, movido do painel para o card (nunca um segundo).
    expect(screen.getAllByTestId("avatar-stub")).toHaveLength(1)
    expect(within(dialog).getByTestId("avatar-stub")).toBeInTheDocument()
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(api.start).toHaveBeenCalledWith(SOURCE)
    // AO VIVO: a sessão de voz da aplicação recebe o sinal da tela e a INIA começa a falar — sem esperar a voz preparada.
    await waitFor(() => expect(voiceDouble.sent).toEqual(["[INICIAR_APRESENTACAO]"]))
    expect(voiceStatus()).toHaveTextContent("Já vou te apresentar o feedback de agosto de 2026. Ele está aqui ao lado.")
    expect(api.audio).not.toHaveBeenCalled()
    // A sessão é a da APLICAÇÃO (o backend monta a instrução com o registro e o texto aprovado da apresentação).
    await voiceDouble.options!.fetchSession()
    expect(voiceDouble.fetchSession).toHaveBeenCalledWith({ feedbackApplicationId: "aaaaaaaa-0000-4000-8000-000000000001" })
    const live = voiceDouble.handlers!
    // Enquanto ela se prepara, o balão traz a chegada; a apresentação escrita ainda não está na conversa (ela "sai" do balão).
    expect(within(dialog).getByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "say")
    expect(within(dialog).queryByText(/Este feedback se refere aos seus resultados de agosto/)).not.toBeInTheDocument()
    // Enquanto MOSTRA o feedback (a chegada, o gesto), ela fica virada para ele.
    expect(within(dialog).getByTestId("avatar-stub")).toHaveAttribute("data-facing", "forward")
    act(() => {
      live.onStateChange("thinking")
      live.onOutputTranscript("Oi, Jô. Este feedback se refere a agosto.")
      live.onStateChange("speaking")
    })
    await waitFor(() => expect(voiceStatus()).toHaveTextContent("Estou apresentando o feedback de agosto de 2026. Acompanhe ao lado."))
    expect(api.presentationEvent).toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000001", "STARTED")
    // A fala vai para o BALÃO sobre a cabeça dela (no ritmo da voz), nunca para uma legenda na conversa.
    expect(within(dialog).getByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "stream")
    expect(within(dialog).getByTestId("feedback-session-stream")).toBeInTheDocument()
    // Quando FALA com a pessoa, ela se vira de frente para ela.
    expect(within(dialog).getByTestId("avatar-stub")).toHaveAttribute("data-facing", "viewer")
    act(() => {
      live.onTurnComplete()
      live.onStateChange("idle")
    })
    await waitFor(() => expect(api.presentationEvent).toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000001", "COMPLETED"))
    // Terminou de falar: a fala POUSA na conversa (vira a apresentação escrita) e o balão some.
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).not.toBeInTheDocument())
    expect(within(dialog).getByText(/Este feedback se refere aos seus resultados de agosto/)).toBeInTheDocument()
    // Depois de falar, continua de frente, esperando a pergunta.
    expect(within(dialog).getByTestId("avatar-stub")).toHaveAttribute("data-facing", "viewer")
    // A fala é a apresentação já escrita na conversa: nada de legenda, segunda mensagem ou turno gravado.
    expect(voiceDouble.recordVoiceTurn).not.toHaveBeenCalled()
    expect(within(dialog).queryByText("Oi, Jô. Este feedback se refere a agosto.")).not.toBeInTheDocument()
    // Áudio concluído ≠ aplicação concluída: nenhuma conclusão, a conversa continua aberta para perguntas.
    expect(api.confirm).not.toHaveBeenCalled()
    expect(within(dialog).getByPlaceholderText("Converse com a INIA sobre este feedback…")).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: "Repetir apresentação" })).toBeInTheDocument()
    // Nenhuma ação genérica do chat dentro da sessão.
    expect(within(dialog).queryByRole("button", { name: /Nova conversa/ })).not.toBeInTheDocument()
  })

  it("resposta por voz no palco: pensando (balão de pensamento) → fala no balão → pousa como mensagem da conversa", async () => {
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    await waitFor(() => expect(voiceDouble.sent).toHaveLength(1))
    const live = voiceDouble.handlers!
    // A apresentação termina e pousa; o balão some.
    act(() => {
      live.onOutputTranscript("Oi, Jô.")
      live.onStateChange("speaking")
      live.onTurnComplete()
      live.onStateChange("idle")
    })
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).not.toBeInTheDocument())
    // A pessoa perguntou por voz (microfone fechado): ela pensa — balão de pensamento sobre a cabeça, nada na conversa.
    act(() => live.onStateChange("thinking"))
    expect(within(dialog).getByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "thinking")
    expect(within(dialog).getByTestId("feedback-session-thinking")).toBeInTheDocument()
    act(() => {
      live.onOutputTranscript("A meta era de dez por cento.")
      live.onStateChange("speaking")
    })
    expect(within(dialog).getByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "stream")
    // Fim do turno na rede: a resposta é gravada, mas só entra na conversa quando a fala termina de soar.
    act(() => live.onTurnComplete())
    await waitFor(() => expect(voiceDouble.recordVoiceTurn).toHaveBeenCalledWith(expect.objectContaining({ assistantText: "A meta era de dez por cento." })))
    expect(within(dialog).queryByText("A meta era de dez por cento.")).not.toBeInTheDocument()
    act(() => live.onStateChange("idle"))
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).not.toBeInTheDocument())
    expect(within(dialog).getByText("A meta era de dez por cento.")).toBeInTheDocument()
  })

  it("consulta a um especialista pela voz no palco: a tool-call leva a aplicação e a resposta só entra na conversa quando a fala dela pousa", async () => {
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    await waitFor(() => expect(voiceDouble.sent).toHaveLength(1))
    const live = voiceDouble.handlers!
    act(() => {
      live.onOutputTranscript("Oi, Jô.")
      live.onStateChange("speaking")
      live.onTurnComplete()
      live.onStateChange("idle")
    })
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).not.toBeInTheDocument())
    // A consulta de dentro da sessão diz de qual aplicação veio (o backend decide a conversa e emoldura o especialista).
    expect(live.getToolCallContext()).toMatchObject({ feedbackApplicationId: "aaaaaaaa-0000-4000-8000-000000000001" })
    act(() => {
      live.onStateChange("thinking")
      live.onSpecialistResult("Pelo procedimento atual, o prazo é de 5 dias úteis.", [], null)
    })
    // Ainda não falou: a resposta escrita espera a fala.
    expect(within(dialog).queryByText("Pelo procedimento atual, o prazo é de 5 dias úteis.")).not.toBeInTheDocument()
    act(() => {
      live.onOutputTranscript("Pelo procedimento atual, o prazo é de cinco dias úteis — o mesmo documento do seu feedback.")
      live.onStateChange("speaking")
      live.onTurnComplete()
    })
    expect(within(dialog).queryByText("Pelo procedimento atual, o prazo é de 5 dias úteis.")).not.toBeInTheDocument()
    // Com especialista no turno, só a pergunta vai para o registro (a resposta já foi gravada na consulta).
    await waitFor(() => expect(voiceDouble.recordVoiceTurn).not.toHaveBeenCalledWith(expect.objectContaining({ assistantText: expect.anything() })))
    act(() => live.onStateChange("idle"))
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).not.toBeInTheDocument())
    expect(within(dialog).getByText("Pelo procedimento atual, o prazo é de 5 dias úteis.")).toBeInTheDocument()
  })

  it("caracterização — resposta cortada no palco (barge-in): pousa só com o que soou, e o turno grava só esse trecho", async () => {
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    await waitFor(() => expect(voiceDouble.sent).toHaveLength(1))
    const live = voiceDouble.handlers!
    act(() => {
      live.onOutputTranscript("Oi, Jô.")
      live.onStateChange("speaking")
      live.onTurnComplete()
      live.onStateChange("idle")
    })
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).not.toBeInTheDocument())
    act(() => live.onStateChange("thinking"))
    act(() => {
      live.onOutputTranscript("A meta era de dez por cento, e o seu resultado ficou acima.")
      live.onStateChange("speaking")
    })
    expect(within(dialog).getByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "stream")
    // Nada da fala vira mensagem enquanto ela fala.
    const conversation = within(dialog).getByTestId("feedback-session-messages")
    expect(within(conversation).queryByText(/A meta era de dez/)).not.toBeInTheDocument()
    act(() => live.onResponseInterrupted("A meta era de dez"))
    act(() => {
      live.onTurnComplete()
      live.onStateChange("listening")
    })
    await waitFor(() => expect(voiceDouble.recordVoiceTurn).toHaveBeenCalledWith(expect.objectContaining({ assistantText: "A meta era de dez", feedbackApplicationId: "aaaaaaaa-0000-4000-8000-000000000001" })))
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "listening"))
    const landed = Array.from(conversation.querySelectorAll("[data-message-id]")).map((node) => node.textContent ?? "")
    expect(landed.at(-1)).toContain("A meta era de dez")
    expect(within(dialog).queryByText(/o seu resultado ficou acima/)).not.toBeInTheDocument()
  })

  it("voz ao vivo: a transcrição com Markdown no meio do parágrafo (negrito, itálico, link) aparece no balão em texto corrido", async () => {
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    await waitFor(() => expect(voiceDouble.sent).toHaveLength(1))
    const live = voiceDouble.handlers!
    // Fragmentos como os do Gemini Live: a marcação chega cortada entre eles.
    act(() => {
      live.onStateChange("thinking")
      live.onOutputTranscript("Seu TMA foi de **10")
      live.onStateChange("speaking")
    })
    expect(within(dialog).getByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "stream")
    act(() => {
      live.onOutputTranscript("min20s**, meta")
      live.onOutputTranscript(" *8min30s*, veja [o guia](/materiais/1d000000-0000-4000-8000-000000000001).")
    })
    const stream = within(dialog).getByTestId("feedback-session-stream")
    await waitFor(() => expect(stream).toHaveTextContent("guia."), { timeout: 6000 })
    expect(stream).toHaveTextContent(/^Seu TMA foi de 10min20s, meta 8min30s, veja o guia\.$/)
    expect(stream.textContent).not.toMatch(/[*[\]]|materiais/)
  }, 15_000)

  it("mudo ligado + 'Ouvir com a INIA': o clique tira o mudo (fica salvo) e ela apresenta COM voz; 'Ouvir apresentação' também", async () => {
    setVoiceMuted(true)
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    // "Ouvir" é um pedido explícito de voz: vale mais que a preferência antiga — e a troca fica salva.
    expect(readVoiceMuted()).toBe(false)
    const dialog = await session()
    await waitFor(() => expect(voiceDouble.sent).toEqual(["[INICIAR_APRESENTACAO]"]))
    // O botão de mudo mostra o novo estado: um toque silencia de novo.
    const mute = within(dialog).getByTestId("inia-voice-mute")
    expect(mute).toHaveAttribute("aria-pressed", "false")
    act(() => voiceDouble.handlers!.onStateChange("speaking"))
    fireEvent.click(await within(dialog).findByRole("button", { name: "Parar" }))
    fireEvent.click(mute)
    expect(readVoiceMuted()).toBe(true)
    // Silenciou de novo e pediu para OUVIR a apresentação: o pedido de agora vence outra vez.
    fireEvent.click(within(dialog).getByRole("button", { name: "Ouvir apresentação" }))
    expect(readVoiceMuted()).toBe(false)
    await waitFor(() => expect(voiceDouble.sent).toEqual(["[INICIAR_APRESENTACAO]", "[INICIAR_APRESENTACAO]"]))
  })

  it("silenciou DEPOIS de pedir para ouvir (antes de a apresentação começar): vale a escolha mais recente — só texto no balão, sem voz nem reprodução registrada", async () => {
    let resolveStart: (value: { application: FeedbackApplicationDetail; created: boolean }) => void = () => {}
    api.start.mockImplementation(() => new Promise((resolve) => { resolveStart = resolve }))
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    fireEvent.click(await within(dialog).findByTestId("inia-voice-mute"))
    expect(readVoiceMuted()).toBe(true)
    await act(async () => resolveStart({ application: detail(), created: true }))
    await waitFor(() => expect(within(dialog).getByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "stream"))
    await waitFor(() => expect(within(dialog).getByTestId("feedback-session-stream")).toHaveTextContent("Oi, Jô."), { timeout: 3000 })
    expect(voiceDouble.sent).toEqual([])
    expect(api.audio).not.toHaveBeenCalled()
    expect(api.presentationEvent).not.toHaveBeenCalled()
    // A apresentação escrita só entra na conversa quando o balão pousa.
    expect(within(dialog).queryByText(/Olá, Jô!/)).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Parar" }))
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).not.toBeInTheDocument())
    expect(within(dialog).getByText(/Olá, Jô!/)).toBeInTheDocument()
  })

  it("mudo: a resposta ESCRITA a uma pergunta digitada passa pelo balão (sem voz) e depois pousa na conversa", async () => {
    setVoiceMuted(true)
    api.start.mockResolvedValue({ application: detail(), created: false })
    text.reply.mockImplementation(async (input: { conversationId: string }, onChunk: (chunk: string) => void) => {
      onChunk("A meta era de **dez** por cento.")
      return { text: "A meta era de **dez** por cento.", supportMaterials: [], interactionId: "i", conversationId: input.conversationId, persisted: true }
    })
    // Retomar (não "Ouvir"): o mudo continua valendo.
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    const dialog = await session()
    expect(readVoiceMuted()).toBe(true)
    const box = await within(dialog).findByPlaceholderText("Converse com a INIA sobre este feedback…")
    fireEvent.change(box, { target: { value: "Qual era a meta?" } })
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Enviar mensagem" })) })
    expect(text.reply).toHaveBeenCalledTimes(1)
    expect(voiceDouble.sent).toEqual([])
    // No balão, em texto corrido (a marcação fica só na conversa).
    await waitFor(() => expect(within(dialog).getByTestId("feedback-session-speech")).toHaveAttribute("data-speech", "stream"))
    await waitFor(() => expect(within(dialog).getByTestId("feedback-session-stream")).toHaveTextContent("A meta era de dez"), { timeout: 3000 })
    expect(within(dialog).getByTestId("feedback-session-stream")).not.toHaveTextContent("**")
    await waitFor(() => expect(within(dialog).queryByTestId("feedback-session-speech")).not.toBeInTheDocument(), { timeout: 6000 })
    expect(within(dialog).getByText("dez")).toBeInTheDocument()
  })

  it("padrão: pergunta DIGITADA no palco vai para a voz da aplicação (ela responde falando), não para o caminho escrito", async () => {
    api.start.mockResolvedValue({ application: detail(), created: false })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    const box = await within(dialog).findByPlaceholderText("Converse com a INIA sobre este feedback…")
    fireEvent.change(box, { target: { value: "Qual era a meta?" } })
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Enviar mensagem" })) })
    await waitFor(() => expect(voiceDouble.sent).toEqual(["Qual era a meta?"]))
    expect(text.reply).not.toHaveBeenCalled()
    expect(within(dialog).getByText("Qual era a meta?")).toBeInTheDocument()
    await voiceDouble.options!.fetchSession()
    expect(voiceDouble.fetchSession).toHaveBeenCalledWith({ feedbackApplicationId: "aaaaaaaa-0000-4000-8000-000000000001" })
  })

  it("sem a voz ao vivo (sessão indisponível), a apresentação segue sozinha pela voz preparada", async () => {
    voiceDouble.connectError = new Error("sessão indisponível")
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    await session()
    await waitFor(() => expect(api.audio).toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000001"))
    await waitFor(() => expect(voiceStatus()).toHaveTextContent("Estou apresentando o feedback de agosto de 2026. Acompanhe ao lado."))
    expect(voiceDouble.sent).toEqual([])
    act(() => playback.drain())
    await waitFor(() => expect(api.presentationEvent).toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000001", "COMPLETED"))
    expect(api.presentationEvent).not.toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000001", "FAILED")
  })

  it("apresentação ao vivo: 'Parar' corta a fala e registra a interrupção; a pessoa pode ouvir de novo", async () => {
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    await waitFor(() => expect(voiceDouble.sent).toHaveLength(1))
    act(() => voiceDouble.handlers!.onStateChange("speaking"))
    const interruptsBefore = voiceDouble.interrupts
    fireEvent.click(await within(dialog).findByRole("button", { name: "Parar" }))
    expect(voiceDouble.interrupts).toBeGreaterThan(interruptsBefore)
    await waitFor(() => expect(api.presentationEvent).toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000001", "INTERRUPTED"))
    // O "idle" que a sessão manda depois do corte não vira "concluída".
    act(() => voiceDouble.handlers!.onStateChange("idle"))
    expect(api.presentationEvent).not.toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000001", "COMPLETED")
    fireEvent.click(within(dialog).getByRole("button", { name: "Ouvir apresentação" }))
    await waitFor(() => expect(voiceDouble.sent).toEqual(["[INICIAR_APRESENTACAO]", "[INICIAR_APRESENTACAO]"]))
  })

  it("cenário do dia atrás dela (painel e palco); a conversa e o campo de mensagem formam um card só", async () => {
    scenes.current = { id: "scene-1", name: "Outubro Rosa", imageId: "img-noite", imageLabel: "Noite", imageUrl: "/api/v1/inia-scenes/images/img-noite?v=abc", width: 1920, height: 1080, blur: 1.2, dim: 40, reason: "SCHEDULED", imageReason: "SLOT" }
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    // O desfoque configurado vale em px nas duas telas (antes o painel, mais estreito, ficava com um terço do valor).
    const blurOf = (variant: string) => (document.querySelector(`[data-inia-scene="${variant}"] [data-blur]`) as HTMLElement | null)?.style.filter
    // Painel: o cenário substitui o fundo de estúdio, atrás do avatar.
    await waitFor(() => expect(document.querySelector('[data-inia-scene="panel"]')).not.toBeNull())
    expect(blurOf("panel")).toBe("blur(1.2px)")
    expect((document.querySelector('[data-inia-scene="panel"] [data-testid="inia-scene-dim"]') as HTMLElement | null)?.style.opacity).toBe("0.4")
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    const stage = dialog.querySelector('[data-inia-scene="stage"]')
    expect(stage).not.toBeNull()
    expect(stage!.getAttribute("aria-hidden")).toBe("true")
    expect(stage!.innerHTML).toContain("/api/v1/inia-scenes/images/img-noite?v=abc")
    expect(blurOf("stage")).toBe("blur(1.2px)")
    // O escurecimento do cenário vale igual no palco e no painel: uma máscara preta só sobre a imagem, abaixo do resto.
    expect((stage!.querySelector('[data-testid="inia-scene-dim"]') as HTMLElement | null)?.style.opacity).toBe("0.4")
    // Um card só: a conversa sem arredondar embaixo e o campo sem arredondar em cima, colados.
    expect(within(dialog).getByTestId("feedback-session-conversation-card").className).toContain("rounded-b-none")
    expect(within(dialog).getByTestId("feedback-session-composer-card").className).toContain("rounded-t-none")
    // Vidro: os cards deixam o cenário aparecer de leve (fundo translúcido e desfoque do que está atrás).
    for (const card of ["feedback-session-heading", "feedback-session-body", "feedback-session-conversation-card", "feedback-session-composer-card"]) {
      expect(within(dialog).getByTestId(card).className).toMatch(/bg-white\/72.*backdrop-blur-2xl/)
    }
  })

  it("o feedback recolhe ao rolar a conversa (sobra só o cabeçalho, fixo) e o botão o abre de novo no tamanho normal", async () => {
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    const dialog = await session()
    const heading = within(dialog).getByTestId("feedback-session-heading")
    const body = within(dialog).getByTestId("feedback-session-body")
    const scroller = dialog.querySelector<HTMLElement>("[data-chat-scroll]")!
    // Layout de mentira: cabeçalho de 90 px preso no topo, corpo terminando em 600 px do conteúdo; conversa longa (há como recolher).
    let scrollTop = 0
    const rect = (bottom: number, height: number) => ({ top: bottom - height, bottom, height, left: 0, right: 600, width: 600, x: 0, y: bottom - height, toJSON() {} }) as DOMRect
    vi.spyOn(body, "getBoundingClientRect").mockImplementation(() => rect(600 - scrollTop, 480))
    Object.defineProperty(heading, "offsetHeight", { configurable: true, value: 90 })
    Object.defineProperty(scroller, "scrollTop", { configurable: true, get: () => scrollTop })
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 })
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 800 })
    const scrollTo = vi.fn()
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo
    // A medição roda no quadro seguinte à rolagem.
    const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    fireEvent.scroll(scroller)
    await nextFrame()
    // Aberto: dá para recolher (a conversa ocupa o lugar).
    const collapse = await within(dialog).findByRole("button", { name: "Recolher o feedback" })
    expect(collapse).toHaveAttribute("aria-expanded", "true")
    expect(collapse.className).not.toContain("invisible")
    expect(heading).not.toHaveAttribute("data-collapsed")
    // "Recolher" rola até onde o corpo some por baixo do cabeçalho.
    fireEvent.click(collapse)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 510, behavior: "smooth" })
    // Rolou a conversa: o corpo passou inteiro por baixo do cabeçalho — sobra só o cabeçalho (status, data e título).
    scrollTop = 520
    fireEvent.scroll(scroller)
    await nextFrame()
    const reopen = await within(dialog).findByRole("button", { name: "Ver o feedback completo: Rechamada" })
    expect(reopen).toHaveAttribute("aria-expanded", "false")
    expect(heading).toHaveAttribute("data-collapsed")
    expect(within(heading).getByTestId("feedback-session-status")).toHaveTextContent("Em andamento")
    expect(within(heading).getByRole("heading", { name: "Rechamada" })).toBeInTheDocument()
    // Abrir de novo volta ao topo: o feedback no tamanho normal.
    fireEvent.click(reopen)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" })
  })

  it("sem cenário configurado: palco e painel como sempre (nenhuma imagem)", async () => {
    api.start.mockResolvedValue({ application: detail(), created: true })
    renderWorkspace()
    fireEvent.click(await screen.findByRole("button", { name: "Ouvir com a INIA" }))
    await session()
    expect(document.querySelector("[data-inia-scene]")).toBeNull()
  })

  it("materiais do feedback numa faixa própria, acima do campo (link em nova aba; sem acesso = sem link)", async () => {
    const base = detail()
    api.start.mockResolvedValue({ application: detail({ content: { ...base.content!, materials: [
      { documentId: "doc-1", title: "Argumentário Sugerido", sections: ["Reparo fixa"], reason: null, href: "/materiais/doc-1" },
      { documentId: "doc-2", title: "Procedimento restrito", sections: [], reason: null, href: null },
    ] } }), created: false })
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    const strip = await within(await session()).findByTestId("feedback-session-materials")
    const link = within(strip).getByRole("link", { name: /Argumentário Sugerido/ })
    expect(link).toHaveAttribute("href", "/materiais/doc-1")
    expect(link).toHaveAttribute("target", "_blank")
    expect(within(strip).getByText(/indisponível para este perfil/)).toBeInTheDocument()
    // Os materiais ficam só na faixa (não repetidos no corpo do feedback).
    expect(within(screen.getByTestId("feedback-session-content")).queryByText("Argumentário Sugerido")).not.toBeInTheDocument()
  })

  it("clique repetido durante a abertura não pede outra aplicação", async () => {
    let resolve: (value: unknown) => void = () => {}
    api.start.mockReturnValue(new Promise((done) => { resolve = done }))
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "listen", title: "Rechamada", periodLabel: null, origin: "feed" }))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "listen", title: "Rechamada", periodLabel: null, origin: "feed" }))
    expect(api.start).toHaveBeenCalledTimes(1)
    expect(within(await session()).getByTestId("feedback-session-status")).toHaveTextContent("Abrindo…")
    await act(async () => resolve({ application: detail(), created: true }))
    await waitFor(() => expect(within(screen.getByTestId("feedback-session")).getByTestId("feedback-session-status")).toHaveTextContent("Em andamento"))
  })

  it("retomada: mostra onde parou e NÃO reproduz a apresentação sozinha; várias perguntas na mesma conversa, sem o indicador atual", async () => {
    setVoiceMuted(true) // caminho escrito (a resposta falada ao que é digitado tem teste próprio)
    api.start.mockResolvedValue({ application: detail(), created: false })
    text.reply.mockImplementation(async (input: { conversationId: string }) => ({ text: "Resposta.", supportMaterials: [], interactionId: "i", conversationId: input.conversationId, persisted: true }))
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    expect(await screen.findByTestId("feedback-resume-marker")).toBeInTheDocument()
    expect(screen.getByTestId("feedback-session-speech")).toHaveTextContent("Vamos continuar de onde paramos.")
    expect(api.audio).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Ouvir apresentação" })).toBeInTheDocument()
    for (const question of ["Pode explicar esse resultado?", "Como aplico essa orientação?"]) {
      await act(async () => fireEvent.click(screen.getByRole("button", { name: question })))
    }
    expect(text.reply).toHaveBeenCalledTimes(2)
    for (const [input] of text.reply.mock.calls) {
      expect(input).toMatchObject({ conversationId: "conv-feedback", feedbackApplicationId: "aaaaaaaa-0000-4000-8000-000000000001" })
      // A persona é do servidor: o navegador não manda instrução de sistema; dentro do feedback nem o contexto da tela vai.
      expect(input).not.toHaveProperty("systemInstruction")
      expect(input.contextHint ?? "").not.toContain("dado de HOJE")
    }
  })

  it("retomada com conversa: abre na ÚLTIMA troca (a última pergunta no topo da rolagem), não no começo do feedback", async () => {
    api.start.mockResolvedValue({ application: detail(), created: false })
    const exchange = (id: string, role: "user" | "assistant", content: string, cursor: string) => ({ ...presentationMessage, id, role, content, cursor, origin: null })
    text.messages.set("conv-feedback", [
      presentationMessage,
      exchange("m2", "user", "Pode explicar esse resultado?", "c2"),
      exchange("m3", "assistant", "No registro, a Rechamada ficou em 14,6%.", "c3"),
      exchange("m4", "user", "E como aplico a orientação?", "c4"),
      exchange("m5", "assistant", "Confirme o motivo do contato antes de transferir.", "c5"),
    ])
    const into = vi.spyOn(Element.prototype, "scrollIntoView")
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    into.mockClear()
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    expect(await screen.findByTestId("feedback-resume-marker")).toBeInTheDocument()
    await waitFor(() => expect(into).toHaveBeenCalledWith({ block: "start" }))
    const scrolledTo = into.mock.contexts.at(-1) as HTMLElement
    expect(scrolledTo).toHaveAttribute("data-message-id")
    expect(scrolledTo).toHaveTextContent("E como aplico a orientação?")
  })

  it("retomada SEM conversa (só a apresentação): abre no topo, com o feedback inteiro", async () => {
    api.start.mockResolvedValue({ application: detail(), created: false })
    const into = vi.spyOn(Element.prototype, "scrollIntoView")
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    into.mockClear()
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    expect(await screen.findByTestId("feedback-resume-marker")).toBeInTheDocument()
    expect(into.mock.contexts.some((element) => (element as HTMLElement).hasAttribute?.("data-message-id"))).toBe(false)
  })

  it("concluída: registro original para consulta + dúvidas na conversa complementar (criada na primeira dúvida pelo backend), sem apresentação", async () => {
    setVoiceMuted(true) // caminho escrito (a resposta falada ao que é digitado tem teste próprio)
    api.start.mockResolvedValue({ application: detail({ status: "COMPLETED", completedAt: "2026-10-01T13:00:00.000Z" }), created: false })
    text.reply.mockImplementation(async (input: { conversationId: string | null }, _chunk: unknown, onConversation?: (ref: { conversationId: string; created: boolean; rotatedFrom: null }) => void) => {
      onConversation?.({ conversationId: "conv-followup", created: input.conversationId === null, rotatedFrom: null })
      return { text: "Era a meta de agosto: 10%.", supportMaterials: [], interactionId: "i", conversationId: "conv-followup", persisted: true }
    })
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "view", title: "Rechamada", periodLabel: null, origin: "feed" }))
    const dialog = await session()
    await waitFor(() => expect(within(dialog).getByTestId("feedback-session-status")).toHaveTextContent(/Aplicação concluída/))
    expect(within(dialog).getByTestId("feedback-session-speech")).toHaveTextContent("Vamos rever este feedback.")
    // Abrir a concluída não cria nada nem reproduz; o campo deixa claro o escopo e o efeito.
    expect(api.audio).not.toHaveBeenCalled()
    expect(api.opened).not.toHaveBeenCalled()
    expect(within(dialog).queryByRole("button", { name: /Confirmar ciência/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: /apresentação$/ })).not.toBeInTheDocument()
    expect(within(dialog).getByTestId("feedback-followup-separator")).toBeInTheDocument()
    expect(within(dialog).getByTestId("feedback-followup-hint")).toHaveTextContent("não reabrem a aplicação nem contam como ciência")
    const box = within(dialog).getByPlaceholderText("Tire uma dúvida sobre este feedback…")
    expect(box).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: "Falar com a INIA" })).toBeEnabled()
    for (const question of ["Qual era a meta?", "E o que eu faço?"]) {
      fireEvent.change(box, { target: { value: question } })
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Enviar mensagem" })))
    }
    // Primeira dúvida: sem conversa (o backend cria a complementar); a segunda já vai para ela. Nunca a conversa original.
    expect(text.reply.mock.calls.map(([input]) => input.conversationId)).toEqual([null, "conv-followup"])
    for (const [input] of text.reply.mock.calls) expect(input.feedbackApplicationId).toBe("aaaaaaaa-0000-4000-8000-000000000001")
    expect(api.confirm).not.toHaveBeenCalled()
    // A voz das dúvidas usa a sessão da MESMA aplicação (registro histórico), nunca a conversa geral.
    fireEvent.click(within(dialog).getByRole("button", { name: "Falar com a INIA" }))
    fireEvent.click(await screen.findByRole("button", { name: "Permitir microfone" }))
    await act(async () => { await voiceDouble.options?.fetchSession() })
    expect(voiceDouble.fetchSession).toHaveBeenCalledWith({ feedbackApplicationId: "aaaaaaaa-0000-4000-8000-000000000001" })
  })

  it("reabrir uma concluída com dúvidas: o original e, depois do separador, a conversa complementar", async () => {
    setVoiceMuted(true) // caminho escrito (a resposta falada ao que é digitado tem teste próprio)
    api.start.mockResolvedValue({ application: detail({ status: "COMPLETED", completedAt: "2026-10-01T13:00:00.000Z", followUpConversationId: "conv-followup" }), created: false })
    text.messages.set("conv-followup", [{ id: "f1", channel: "chat", role: "user", content: "Qual era a meta?", agentId: null, occurredAt: "2026-10-01T14:00:00.000Z", cursor: "f1", supportMaterials: [], origin: null }])
    text.reply.mockResolvedValue({ text: "Resposta.", supportMaterials: [], interactionId: "i", conversationId: "conv-followup", persisted: true })
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "view", title: "Rechamada", periodLabel: null, origin: "feed" }))
    const dialog = await session()
    const separator = await within(dialog).findByTestId("feedback-followup-separator")
    const question = within(dialog).getByText("Qual era a meta?")
    expect(separator.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(within(dialog).getByPlaceholderText("Tire uma dúvida sobre este feedback…"), { target: { value: "Mais uma" } })
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Enviar mensagem" })))
    expect(text.reply.mock.calls[0]![0].conversationId).toBe("conv-followup")
  })

  it("fechar (X/Esc/Sair por agora) não conclui: pausa e devolve o foco ao botão; confirmar ciência com login e senha conclui", async () => {
    setVoiceMuted(true) // caminho escrito (a resposta falada ao que é digitado tem teste próprio)
    api.start.mockResolvedValue({ application: detail(), created: false })
    const { script: _script, limitations: _limitations, sourceCorrected: _corrected, content: _content, ...view } = detail()
    void [_script, _limitations, _corrected, _content]
    api.confirm.mockResolvedValue({ source: SOURCE, acknowledgedAt: "2026-10-01T13:00:00.000Z", alreadyConfirmed: false, application: { ...view, status: "COMPLETED", completedAt: "2026-10-01T13:00:00.000Z", acknowledgedAt: "2026-10-01T13:00:00.000Z" } })
    text.reply.mockResolvedValue({ text: "Resposta.", supportMaterials: [], interactionId: "i", conversationId: "conv-followup", persisted: true })
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    await session()
    await screen.findByTestId("feedback-resume-marker")
    fireEvent.keyDown(screen.getByTestId("feedback-session"), { key: "Escape" })
    await waitFor(() => expect(api.pause).toHaveBeenCalledWith("aaaaaaaa-0000-4000-8000-000000000001"))
    expect(api.confirm).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId("feedback-session")).not.toBeInTheDocument())
    expect(workspace.focusFeedbackTrigger).toHaveBeenCalledWith(`PUBLISHED_FEEDBACK:${SOURCE.id}`)

    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    const dialog = await session()
    await screen.findByTestId("feedback-resume-marker")
    // O MESMO controle do Acompanhamento: diálogo central (nunca painel lateral) com login e senha.
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirmar ciência/ }))
    const confirm = await screen.findByRole("dialog", { name: "Confirmar ciência" })
    expect(within(confirm).getByText(/A conversa com a INIA sobre este feedback será concluída/)).toBeInTheDocument()
    fireEvent.change(within(confirm).getByLabelText("Login"), { target: { value: "joana@empresa.com" } })
    fireEvent.change(within(confirm).getByLabelText("Senha"), { target: { value: "segredo" } })
    await act(async () => fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar ciência" })))
    expect(api.confirm).toHaveBeenCalledTimes(1)
    expect(api.confirm.mock.calls[0]![0]).toMatchObject({ source: SOURCE, entryPoint: "FEEDBACK_SESSION", login: "joana@empresa.com", password: "segredo" })
    await waitFor(() => expect(within(screen.getByTestId("feedback-session")).getByTestId("feedback-session-status")).toHaveTextContent(/Ciência confirmada em/))
    // Depois de concluir, a próxima dúvida nasce na conversa complementar — nunca na conversa encerrada da aplicação.
    const box = within(screen.getByTestId("feedback-session")).getByPlaceholderText("Tire uma dúvida sobre este feedback…")
    fireEvent.change(box, { target: { value: "Ficou uma dúvida" } })
    await act(async () => fireEvent.click(within(screen.getByTestId("feedback-session")).getByRole("button", { name: "Enviar mensagem" })))
    expect(text.reply.mock.calls.at(-1)![0]).toMatchObject({ conversationId: null, feedbackApplicationId: "aaaaaaaa-0000-4000-8000-000000000001" })
  })

  it("concluída em outra aba enquanto conversava: nada é gravado; a sessão recarrega concluída e o texto volta ao campo", async () => {
    setVoiceMuted(true) // caminho escrito (a resposta falada ao que é digitado tem teste próprio)
    const { ConversationClosedError } = await import("@/lib/realtime/gemini-text-client")
    api.start.mockResolvedValueOnce({ application: detail(), created: false }).mockResolvedValueOnce({ application: detail({ status: "COMPLETED", completedAt: "2026-10-01T13:00:00.000Z" }), created: false })
    text.reply.mockRejectedValue(new ConversationClosedError(null))
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    const dialog = await session()
    const box = await within(dialog).findByPlaceholderText("Converse com a INIA sobre este feedback…")
    fireEvent.change(box, { target: { value: "Minha pergunta" } })
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Enviar mensagem" })))
    await waitFor(() => expect(within(screen.getByTestId("feedback-session")).getByTestId("feedback-session-status")).toHaveTextContent(/Aplicação concluída/))
    expect(within(screen.getByTestId("feedback-session")).getByPlaceholderText("Tire uma dúvida sobre este feedback…")).toHaveValue("Minha pergunta")
    expect(screen.getByText(/foi concluída em outra janela/)).toBeInTheDocument()
  })

  it("resultados atuais vão para a conversa geral (painel), identificada; o feedback continua retomável", async () => {
    api.start.mockResolvedValue({ application: detail(), created: false })
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    const dialog = await session()
    await screen.findByTestId("feedback-resume-marker")
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: /Conversar sobre meus resultados atuais/ })))
    expect(await screen.findByText("Conversa geral · resultados atuais")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId("feedback-session")).not.toBeInTheDocument())
    expect(workspace.revealChat).toHaveBeenCalled()
    expect(api.confirm).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText("Pergunte algo para a INIA...")).toHaveValue("Como estão meus resultados atuais?")
    expect(screen.getByRole("button", { name: "Voltar ao feedback" })).toBeInTheDocument()
  })

  it("com o painel recolhido (chat oculto), a sessão abre do mesmo jeito", async () => {
    api.start.mockResolvedValue({ application: detail(), created: false })
    const workspace = renderWorkspace(workspaceDouble(), { hidden: true })
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "continue", title: "Rechamada", periodLabel: null, origin: "feed" }))
    expect(await within(await session()).findByText(/a Rechamada ficou em 14,6%/)).toBeInTheDocument()
  })

  it("sem o contexto do feedback, informa o problema em vez de abrir uma conversa genérica", async () => {
    api.start.mockRejectedValue(new Error("boom"))
    const workspace = renderWorkspace()
    await waitFor(() => expect(text.currentCalls).toBe(1))
    act(() => workspace.openFeedback({ source: SOURCE, mode: "listen", title: "Rechamada", periodLabel: null, origin: "feed" }))
    const dialog = await session()
    // O balão dela diz o que houve (visível) e a região de status leva o mesmo aviso ao leitor de tela.
    await waitFor(() => expect(within(dialog).getByTestId("feedback-session-speech")).toHaveTextContent(/Não foi possível abrir este feedback agora/))
    expect(voiceStatus()).toHaveTextContent(/Não foi possível abrir este feedback agora/)
    expect(within(dialog).getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText("Converse com a INIA sobre este feedback…")).toBeDisabled()
    expect(api.audio).not.toHaveBeenCalled()
  })
})

describe("Convite proativo", () => {
  const INVITE: FeedbackInvite = { source: SOURCE, subject: "Rechamada", periodLabel: "Agosto de 2026", publishedAt: "2026-09-30T12:00:00.000Z", offeredAt: null }

  it("aparece com dados reais, registra a oferta, não toca nem rouba o foco; 'Depois' persiste e não encadeia outro convite", async () => {
    api.invite = INVITE
    renderWorkspace()
    const card = await screen.findByTestId("feedback-invite")
    expect(within(card).getByText("Tenho um feedback sobre Rechamada.")).toBeInTheDocument()
    expect(within(card).getByText(/Quando puder, posso conversar com você sobre ele\. · Agosto de 2026/)).toBeInTheDocument()
    await waitFor(() => expect(api.inviteEvent).toHaveBeenCalledWith(SOURCE, "OFFER"))
    expect(api.audio).not.toHaveBeenCalled()
    expect(card.contains(document.activeElement)).toBe(false)
    // O backend já teria o próximo convite: a tela não encadeia outro nesta sessão.
    api.invite = { ...INVITE, source: { kind: "PUBLISHED_FEEDBACK", id: "22222222-2222-4222-8222-222222222222" }, subject: "TMA" }
    await act(async () => fireEvent.click(within(card).getByRole("button", { name: "Depois" })))
    expect(api.inviteEvent).toHaveBeenCalledWith(SOURCE, "SNOOZE")
    await waitFor(() => expect(screen.queryByTestId("feedback-invite")).not.toBeInTheDocument())
  })

  it("'Ouvir agora' usa o MESMO fluxo do botão do feed; 'Ler feedback' abre o item sem áudio", async () => {
    api.invite = INVITE
    api.start.mockResolvedValue({ application: detail(), created: true })
    const workspace = renderWorkspace()
    const open = vi.spyOn(workspace, "openFeedback")
    fireEvent.click(within(await screen.findByTestId("feedback-invite")).getByRole("button", { name: "Ouvir agora" }))
    expect(open).toHaveBeenCalledWith({ source: SOURCE, mode: "listen", title: "Rechamada", periodLabel: "Agosto de 2026", origin: "invite" })
    expect(api.inviteEvent).toHaveBeenCalledWith(SOURCE, "ACCEPT")
    await waitFor(() => expect(voiceDouble.sent).toEqual(["[INICIAR_APRESENTACAO]"]))
    cleanup()

    api.inviteEvent.mockClear()
    const reader = renderWorkspace()
    fireEvent.click(within(await screen.findByTestId("feedback-invite")).getByRole("button", { name: "Ler feedback" }))
    expect(reader.readFeedback).toHaveBeenCalledWith(SOURCE)
    expect(api.inviteEvent).toHaveBeenCalledWith(SOURCE, "READ")
    // Só o "Ouvir agora" apresentou (ao vivo); ler nunca fala.
    expect(voiceDouble.sent).toEqual(["[INICIAR_APRESENTACAO]"])
    expect(api.audio).not.toHaveBeenCalled()
  })

  it("não interrompe uma conversa em andamento", async () => {
    api.invite = INVITE
    renderWorkspace()
    await screen.findByTestId("feedback-invite")
    fireEvent.change(screen.getByPlaceholderText("Pergunte algo para a INIA..."), { target: { value: "Estou digitando" } })
    expect(screen.queryByTestId("feedback-invite")).not.toBeInTheDocument()
  })
})
