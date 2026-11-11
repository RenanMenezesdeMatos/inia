/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { ApiError } from "@/lib/api/api-client"
import type { ConversationMessage } from "@/lib/realtime/gemini-text-client"
import type { MonitoredConversation } from "@/services/admin/assistant-conversations-service"

import { AssistantConversationsPage } from "./assistant-conversations-page"
import { ConversationThread, THREAD_POLL_INTERVAL_MS } from "./conversation-thread"

const service = vi.hoisted(() => ({ fetchMonitoredConversations: vi.fn(), fetchMonitoredMessages: vi.fn(), fetchConversationAgentRecords: vi.fn(), fetchConversationResponseTimes: vi.fn() }))
vi.mock("@/services/admin/assistant-conversations-service", async (original) => ({ ...(await original<object>()), ...service }))
const navigation = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({ usePathname: () => "/admin/conversations", useSearchParams: () => navigation.params, useRouter: () => ({ replace: navigation.replace, push: vi.fn(), refresh: vi.fn() }) }))

const OWNER = { personId: "p-larissa", name: "Larissa Monteiro", jobTitle: "Operadora", avatarUrl: null, teamName: "B2C", subteamName: "Atendimento" }
const conversation = (id: string, overrides: Partial<MonitoredConversation> = {}): MonitoredConversation => ({
  id, kind: "CONVERSATION", status: "ACTIVE", startedAt: "2026-09-29T11:00:00.000Z", lastActivityAt: new Date().toISOString(), closedAt: null, closeReason: null, messageCount: 2,
  firstUserMessage: "Como faço mudança de endereço?", lastMessage: { role: "assistant", preview: "Acesse o app e…", channel: "voice" }, owner: OWNER, ...overrides,
})
const message = (content: string, role: "user" | "assistant", cursor: string, overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({ id: `m-${cursor}`, channel: "chat", role, content, agentId: null, occurredAt: "2026-09-29T11:00:00.000Z", cursor, supportMaterials: [], ...overrides })
const PAGE = (items: MonitoredConversation[]) => ({ items, total: items.length, page: 1, pageSize: 20, filterOptions: { operators: [{ id: "p-larissa", name: "Larissa Monteiro" }], teams: [{ id: "t-b2c", name: "B2C" }], subteams: [{ id: "s-at", name: "Atendimento", teamId: "t-b2c" }] } })

beforeAll(installJsdomStubs)
const NO_REPLIES = { from: "2026-10-12", to: "2026-11-10", replies: 0, averageSeconds: null, medianSeconds: null, p90Seconds: null }
beforeEach(() => { navigation.params = new URLSearchParams(); navigation.replace.mockReset(); service.fetchConversationResponseTimes.mockResolvedValue(NO_REPLIES) })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); window.localStorage.clear() })

describe("Conversas com a INIA — lista", () => {
  it("lista agrupada por dia: operador, tipo e assunto, prévia da última mensagem, estado e contagens; selecionar abre a conversa", async () => {
    service.fetchMonitoredConversations.mockResolvedValue(PAGE([
      conversation("c1", { voiceMessageCount: 1 }),
      conversation("c2", { status: "CLOSED", closeReason: "INACTIVITY", firstUserMessage: null, lastMessage: { role: "user", preview: "obrigada", channel: "chat" } }),
      conversation("c3", { origin: "FEEDBACK", title: "Troca de titularidade", firstUserMessage: null, lastActivityAt: "2026-09-20T12:00:00.000Z" }),
    ]))
    renderWithQuery(<AssistantConversationsPage />)
    const rows = await screen.findAllByTestId("monitored-conversation")
    expect(within(rows[0]!).getByText("Larissa Monteiro")).toBeInTheDocument()
    // Conversa livre: o assunto é a primeira pergunta do colaborador; o tipo vem no ícone.
    expect(within(rows[0]!).getByText("“Como faço mudança de endereço?”")).toBeInTheDocument()
    expect(within(rows[0]!).getByLabelText("Conversa livre")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("INIA: Acesse o app e…")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("Em andamento")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("2 mensagens")).toBeInTheDocument()
    expect(within(rows[0]!).getByLabelText("1 por voz")).toBeInTheDocument()
    // Sem primeira pergunta: a data de início identifica a conversa.
    expect(within(rows[1]!).getByText(/^Conversa de /)).toBeInTheDocument()
    expect(within(rows[1]!).getByText("Encerrada por inatividade")).toBeInTheDocument()
    // Sessão de feedback: o assunto do feedback.
    expect(within(rows[2]!).getByText("Troca de titularidade")).toBeInTheDocument()
    expect(within(rows[2]!).getByLabelText("Sessão de feedback")).toBeInTheDocument()
    // Cabeçalhos de dia: hoje e a data da conversa mais antiga.
    expect(screen.getByRole("heading", { name: "Hoje" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "20 de setembro de 2026" })).toBeInTheDocument()
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {})
    fireEvent.click(rows[0]!)
    // Só a seleção muda: a URL troca sem refazer a renderização do servidor (nunca `router.replace`).
    expect(replaceState).toHaveBeenCalledWith(null, "", "/admin/conversations?conversation=c1")
    expect(navigation.replace).not.toHaveBeenCalled()
    replaceState.mockRestore()
  })

  it("filtros vão para o backend (busca por colaborador ou assunto, tipo, estado)", async () => {
    service.fetchMonitoredConversations.mockResolvedValue(PAGE([conversation("c1")]))
    renderWithQuery(<AssistantConversationsPage />)
    await screen.findAllByTestId("monitored-conversation")
    expect(service.fetchMonitoredConversations).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 20, status: undefined, origin: undefined }))
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar conversa por colaborador ou assunto" }), { target: { value: "Lari" } })
    await waitFor(() => expect(service.fetchMonitoredConversations).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Lari" })))
  })

  it("vazio, erro e acesso negado são estados diferentes", async () => {
    service.fetchMonitoredConversations.mockResolvedValueOnce(PAGE([]))
    const first = renderWithQuery(<AssistantConversationsPage />)
    expect(await screen.findByText("Nenhuma conversa no seu escopo")).toBeInTheDocument()
    first.unmount()
    service.fetchMonitoredConversations.mockRejectedValueOnce(new ApiError("Erro", 500, null))
    const second = renderWithQuery(<AssistantConversationsPage />)
    expect(await screen.findByText("Não foi possível carregar as conversas.")).toBeInTheDocument()
    second.unmount()
    service.fetchMonitoredConversations.mockRejectedValueOnce(new ApiError("Sem permissão", 403, "FORBIDDEN"))
    renderWithQuery(<AssistantConversationsPage />)
    expect(await screen.findByText("Sem acesso às conversas com a INIA")).toBeInTheDocument()
  })
})

describe("Conversas com a INIA — leitura da conversa", () => {
  it("balões distintos colaborador × INIA, nomes, horários, separador de data, voz e materiais; somente leitura", async () => {
    service.fetchMonitoredMessages.mockResolvedValue({
      conversation: conversation("c1"),
      messages: [
        message("Como faço mudança de endereço?", "user", "1", { occurredAt: "2026-09-28T14:00:00.000Z" }),
        message("**Mudança de endereço**: acesse o app.", "assistant", "2", { occurredAt: "2026-09-29T11:00:00.000Z", channel: "voice", supportMaterials: [{ materialId: "11111111-1111-4111-8111-111111111111", available: true, title: "Checklist de endereço", reason: "Passo a passo." }] }),
      ],
      hasMore: false,
    })
    renderWithQuery(<ConversationThread conversationId="c1" />)
    const bubbles = await screen.findAllByTestId("monitored-message")
    expect(bubbles.map((bubble) => bubble.getAttribute("data-role"))).toEqual(["user", "assistant"])
    expect(within(bubbles[0]!).getByText("Larissa Monteiro")).toBeInTheDocument()
    expect(within(bubbles[1]!).getByText("INIA")).toBeInTheDocument()
    expect(within(bubbles[1]!).getByLabelText("Enviada por voz")).toBeInTheDocument()
    expect(within(bubbles[1]!).getByText("Checklist de endereço")).toBeInTheDocument()
    expect(screen.getAllByRole("separator")).toHaveLength(2)
    expect(screen.queryByRole("textbox")).toBeNull()
    expect(screen.getByText(/Somente leitura/)).toBeInTheDocument()
  })

  it("curtir/descurtir de quem perguntou aparece na resposta da INIA, só para leitura (sem botões)", async () => {
    service.fetchMonitoredMessages.mockResolvedValue({
      conversation: conversation("c1"),
      messages: [
        message("Qual o prazo?", "user", "1"),
        message("Até 5 dias úteis.", "assistant", "2", { rating: "up" }),
        message("Não sei informar.", "assistant", "3", { rating: "down" }),
        message("Sem avaliação.", "assistant", "4", { rating: null }),
      ],
      hasMore: false,
    })
    renderWithQuery(<ConversationThread conversationId="c1" />)
    const bubbles = await screen.findAllByTestId("monitored-message")
    expect(bubbles.map((bubble) => within(bubble).queryByTestId("message-rating")?.textContent ?? null)).toEqual([null, "marcada como útil", "marcada como não útil", null])
    expect(within(bubbles[1]!).getByLabelText("Quem perguntou marcou esta resposta como útil")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Resposta útil|não foi útil/ })).toBeNull()
  })

  it("conferência da resposta: quem audita vê o que aconteceu, a regra e o texto original, dizendo se foi antes ou depois da entrega", async () => {
    service.fetchMonitoredMessages.mockResolvedValue({
      conversation: conversation("c1"),
      messages: [
        message("Não posso tratar disso por aqui.", "assistant", "1", { responseCheck: { outcome: "VIOLATION", control: "PREVENTIVE", action: "BLOCKED", rules: [{ kind: "PROHIBITED_TOPIC", name: "Política" }], reason: "Opinou sobre política.", flaggedContent: "Vote no candidato X." } }),
        message("Desconsidere essa resposta.", "assistant", "2", { channel: "voice", responseCheck: { outcome: "VIOLATION", control: "DETECTIVE", action: "RECORDED", rules: [{ kind: "PROHIBITED_TOPIC", name: "Política" }], reason: null, flaggedContent: "Falei demais." } }),
        message("Tente de novo.", "assistant", "3", { responseCheck: { outcome: "CHECK_FAILED", control: "PREVENTIVE", action: "BLOCKED", rules: [], reason: "O provedor não concluiu.", flaggedContent: "Texto não conferido." } }),
        message("Tudo certo.", "assistant", "4"),
      ],
      hasMore: false,
    })
    renderWithQuery(<ConversationThread conversationId="c1" />)
    const bubbles = await screen.findAllByTestId("monitored-message")
    expect(within(bubbles[0]!).getByTestId("response-check-audit")).toHaveTextContent("Bloqueada antes da entrega")
    expect(within(bubbles[0]!).getByTestId("response-check-audit")).toHaveTextContent("Regra: Política")
    expect(within(bubbles[0]!).getByText("Vote no candidato X.")).toBeInTheDocument()
    expect(within(bubbles[1]!).getByTestId("response-check-audit")).toHaveTextContent("Detectada depois da entrega")
    expect(within(bubbles[2]!).getByTestId("response-check-audit")).toHaveTextContent("A conferência falhou: a resposta não foi entregue")
    expect(within(bubbles[3]!).queryByTestId("response-check-audit")).toBeNull()
  })

  it("cabeçalho diz o tipo, o assunto, quem conversou e quantas mensagens; a apresentação do feedback vem marcada", async () => {
    service.fetchMonitoredMessages.mockResolvedValue({
      conversation: conversation("c1", { origin: "FEEDBACK", title: "Troca de titularidade", messageCount: 3, voiceMessageCount: 1 }),
      messages: [message("Olá, Larissa! Este feedback…", "assistant", "1", { origin: "FEEDBACK" })],
      hasMore: false,
    })
    renderWithQuery(<ConversationThread conversationId="c1" />)
    expect(await screen.findByRole("heading", { name: "Troca de titularidade" })).toBeInTheDocument()
    expect(screen.getByText("Sessão de feedback")).toBeInTheDocument()
    expect(screen.getByText("Feedback em andamento")).toBeInTheDocument()
    expect(screen.getByText("3 mensagens · 1 por voz")).toBeInTheDocument()
    expect(within(screen.getByTestId("monitored-message")).getByText(/Apresentação do feedback/)).toBeInTheDocument()
  })

  it("carrega mensagens anteriores acima", async () => {
    service.fetchMonitoredMessages
      .mockResolvedValueOnce({ conversation: conversation("c1", { status: "CLOSED", closeReason: "MANUAL" }), messages: [message("recente", "user", "5")], hasMore: true })
      .mockResolvedValueOnce({ conversation: conversation("c1", { status: "CLOSED", closeReason: "MANUAL" }), messages: [message("antiga", "user", "1")], hasMore: false })
    renderWithQuery(<ConversationThread conversationId="c1" />)
    await screen.findByText("recente")
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Carregar mensagens anteriores" })) })
    expect(service.fetchMonitoredMessages).toHaveBeenLastCalledWith("c1", { before: "5", limit: 30 })
    expect(screen.getAllByTestId("monitored-message").map((node) => node.textContent)).toEqual([expect.stringContaining("antiga"), expect.stringContaining("recente")])
  })

  it("conversa em andamento: mensagens novas chegam sem deslocar quem lê as antigas (aviso de novas mensagens)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    service.fetchMonitoredMessages
      .mockResolvedValueOnce({ conversation: conversation("c1"), messages: [message("primeira", "user", "1")], hasMore: false })
      .mockResolvedValue({ conversation: conversation("c1"), messages: [message("nova resposta", "assistant", "2")], hasMore: false })
    renderWithQuery(<ConversationThread conversationId="c1" />)
    await screen.findByText("primeira")
    // Leitor rolado para cima: longe do fim.
    const scroller = screen.getByLabelText("Mensagens da conversa")
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 2000 })
    Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 400 })
    scroller.scrollTop = 100
    await act(async () => { await vi.advanceTimersByTimeAsync(THREAD_POLL_INTERVAL_MS + 10) })
    expect(service.fetchMonitoredMessages).toHaveBeenLastCalledWith("c1", { after: "1", limit: 100 })
    expect(await screen.findByText("nova resposta")).toBeInTheDocument()
    expect(scroller.scrollTop).toBe(100)
    expect(screen.getByRole("button", { name: "1 nova mensagem" })).toBeInTheDocument()
  })

  it("Ver histórico desta conversa: agentes com versão, chamada impedida com a orientação e nenhum link para o cadastro", async () => {
    service.fetchMonitoredMessages.mockResolvedValue({ conversation: conversation("c1"), messages: [message("Qual o prazo?", "user", "1")], hasMore: false })
    service.fetchConversationAgentRecords.mockResolvedValue([
      { interactionId: "i1", occurredAt: "2026-11-03T13:00:00.000Z", role: "SPECIALIST", outcome: "BLOCKED_INACTIVE", agentId: "a-fat", agentName: "Especialista de Faturamento", agentActive: false, agentVersionNumber: 2, orchestratorName: "INIA — Contas", orchestratorVersionNumber: 4, guidance: "Agente inativo: a parte da resposta que dependia dele ficou indisponível. Reative ou substitua o agente no orquestrador." },
      { interactionId: "i1", occurredAt: "2026-11-03T13:00:00.000Z", role: "ORCHESTRATOR_AGENT", outcome: "EXECUTED", agentId: "a-orq", agentName: "Coordenação · Contas", agentActive: true, agentVersionNumber: 3, orchestratorName: "INIA — Contas", orchestratorVersionNumber: 4, guidance: null },
      // Revisão de 03/11/2026: a versão vigente não cobre o alcance do orquestrador — a chamada é impedida com a orientação do backend.
      { interactionId: "i2", occurredAt: "2026-11-03T13:05:00.000Z", role: "SPECIALIST", outcome: "BLOCKED_UNAUTHORIZED", agentId: "a-ret", agentName: "Especialista de Retenção", agentActive: true, agentVersionNumber: 5, orchestratorName: "INIA — Contas", orchestratorVersionNumber: 4, guidance: "Acesso não autorizado neste contexto: a versão vigente do agente não está autorizada para o alcance deste orquestrador." },
    ])
    renderWithQuery(<ConversationThread conversationId="c1" />)
    await screen.findByText("Qual o prazo?")
    // Só busca ao abrir.
    expect(service.fetchConversationAgentRecords).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Ver histórico desta conversa" }))
    const records = await screen.findAllByTestId("conversation-agent-record")
    expect(service.fetchConversationAgentRecords).toHaveBeenCalledWith("c1")
    // Orquestrador antes dos especialistas na mesma resposta.
    expect(records.map((record) => record.getAttribute("data-outcome"))).toEqual(["EXECUTED", "BLOCKED_INACTIVE", "BLOCKED_UNAUTHORIZED"])
    expect(within(records[0]!).getByText(/Agente orquestrador · Versão 3/)).toBeInTheDocument()
    const blocked = records[1]!
    expect(within(blocked).getByText("Especialista de Faturamento")).toBeInTheDocument()
    expect(within(blocked).getByText(/Especialista · Versão 2/)).toBeInTheDocument()
    expect(within(blocked).getByText("Chamada impedida — agente inativo")).toBeInTheDocument()
    expect(within(blocked).getByText("Agente inativo")).toBeInTheDocument()
    expect(within(blocked).getByText(/Reative ou substitua o agente no orquestrador\./)).toBeInTheDocument()
    const unauthorized = records[2]!
    expect(within(unauthorized).getByText("Chamada impedida — acesso não autorizado")).toBeInTheDocument()
    expect(within(unauthorized).getByText(/Especialista · Versão 5/)).toBeInTheDocument()
    expect(within(unauthorized).getByText(/a versão vigente do agente não está autorizada para o alcance deste orquestrador/)).toBeInTheDocument()
    expect(within(unauthorized).queryByText("Agente inativo")).toBeNull()
    expect(screen.getAllByText(/INIA — Contas \(Versão 4\)/)).toHaveLength(2)
    expect(within(blocked.closest("[data-slot=popover-content]") as HTMLElement).queryByRole("link")).toBeNull()
  })

  it("conversa fora do escopo (404) mostra indisponível, sem distinguir de inexistente", async () => {
    service.fetchMonitoredMessages.mockRejectedValue(new ApiError("Conversa não encontrada.", 404, "ASSISTANT_CONVERSATION_NOT_FOUND"))
    renderWithQuery(<ConversationThread conversationId="c9" />)
    expect(await screen.findByText("Conversa indisponível")).toBeInTheDocument()
    expect(screen.getByText(/fora do seu escopo/)).toBeInTheDocument()
  })
})

describe("Conversas com a INIA — tempo de resposta", () => {
  it("média, mediana e 90% do chat de texto, com os filtros da lista e o período do último mês", async () => {
    service.fetchMonitoredConversations.mockResolvedValue(PAGE([conversation("c1")]))
    service.fetchConversationResponseTimes.mockResolvedValue({ ...NO_REPLIES, replies: 123, averageSeconds: 20.54, medianSeconds: 17.816, p90Seconds: 34.9 })
    renderWithQuery(<AssistantConversationsPage />)
    const card = await screen.findByTestId("response-time-card")
    expect(await within(card).findByTestId("response-time-average")).toHaveTextContent("20,5 s")
    expect(card).toHaveTextContent("Mediana17,8 s")
    expect(card).toHaveTextContent("90% em até34,9 s")
    expect(card).toHaveTextContent("Respostas123")
    expect(card).toHaveTextContent("A voz fica de fora")
    const params = service.fetchConversationResponseTimes.mock.calls[0]![0] as { from: string; to: string; origin?: string }
    expect((Date.parse(params.to) - Date.parse(params.from)) / 86_400_000).toBe(29)
    expect(params).not.toHaveProperty("page")
    // Mudar o tipo na lista muda o cálculo.
    fireEvent.click(screen.getByRole("combobox", { name: "Filtrar por tipo de conversa" }))
    fireEvent.click(await screen.findByRole("option", { name: "Conversas livres" }))
    await waitFor(() => expect(service.fetchConversationResponseTimes).toHaveBeenLastCalledWith(expect.objectContaining({ origin: "USER" })))
  })

  it("sem respostas no período: diz isso (nunca 0 s); poucas respostas: avisa", async () => {
    service.fetchMonitoredConversations.mockResolvedValue(PAGE([conversation("c1")]))
    renderWithQuery(<AssistantConversationsPage />)
    const card = await screen.findByTestId("response-time-card")
    expect(await within(card).findByText("Nenhuma resposta da INIA no chat de texto no período.")).toBeInTheDocument()
    cleanup()
    service.fetchConversationResponseTimes.mockResolvedValue({ ...NO_REPLIES, replies: 2, averageSeconds: 0.4, medianSeconds: 0.3, p90Seconds: 0.5 })
    renderWithQuery(<AssistantConversationsPage />)
    const few = await screen.findByTestId("response-time-card")
    expect(await within(few).findByTestId("response-time-average")).toHaveTextContent("menos de 1 s")
    expect(few).toHaveTextContent("Poucos dados")
  })
})

