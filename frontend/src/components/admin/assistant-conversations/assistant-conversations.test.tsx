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

const service = vi.hoisted(() => ({ fetchMonitoredConversations: vi.fn(), fetchMonitoredMessages: vi.fn() }))
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
beforeEach(() => { navigation.params = new URLSearchParams(); navigation.replace.mockReset() })
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
    fireEvent.click(rows[0]!)
    expect(navigation.replace).toHaveBeenCalledWith("/admin/conversations?conversation=c1", { scroll: false })
  })

  it("filtros vão para o backend (busca por colaborador ou assunto, tipo, estado)", async () => {
    service.fetchMonitoredConversations.mockResolvedValue(PAGE([conversation("c1")]))
    renderWithQuery(<AssistantConversationsPage />)
    await screen.findAllByTestId("monitored-conversation")
    expect(service.fetchMonitoredConversations).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: 25, status: undefined, origin: undefined }))
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

  it("conversa fora do escopo (404) mostra indisponível, sem distinguir de inexistente", async () => {
    service.fetchMonitoredMessages.mockRejectedValue(new ApiError("Conversa não encontrada.", 404, "ASSISTANT_CONVERSATION_NOT_FOUND"))
    renderWithQuery(<ConversationThread conversationId="c9" />)
    expect(await screen.findByText("Conversa indisponível")).toBeInTheDocument()
    expect(screen.getByText(/fora do seu escopo/)).toBeInTheDocument()
  })
})
