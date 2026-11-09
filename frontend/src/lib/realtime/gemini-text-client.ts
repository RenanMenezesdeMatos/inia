"use client"

const API_URL = process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"
// A second, looser timeout on top of the backend's own — belt and
// suspenders against the composer getting stuck forever (empty "thinking"
// bubble, send disabled) if a request hangs instead of erroring. Confirmed
// as a real failure mode on 2026-09-09 when Gemini's servers were unstable.
// Needs to comfortably cover the backend's own worst case, so the backend's
// own error surfaces first instead of this timeout winning the race. That
// worst case got a lot bigger on 2026-09-11 once an orchestrator is
// configured: a single turn can now chain up to 3 sequential (non-streamed)
// Gemini calls — decide which specialist(s) to call, run each specialist,
// then synthesize the final reply — each with its own ~45s ceiling and a
// possible retry, verified live while chasing a spurious "não consegui
// responder" that was actually this timeout winning the race against a
// backend call still in flight.
const REQUEST_TIMEOUT_MS = 150_000

import { reportOfferSchema, type ReportOffer } from "@/schemas/reports/reports.schema"
import type { FeedbackSupportMaterial } from "@/schemas/feedbacks/support-material.schema"
import { parseLeadershipCards, type LeadershipCard } from "@/schemas/leadership/leadership.schema"
import { parseClarification, type ClarificationAnswer, type ClarificationView } from "@/schemas/knowledge-clarification/clarification.schema"

export type HistoryTurn = { role: "user" | "model"; text: string }

/** Resposta de texto completa: o texto montado dos chunks + os materiais de apoio que o
 * Orquestrador recomendou (evento SSE próprio, já resolvidos pelo backend com título real e
 * acesso do operador — a URL é montada na tela a partir do id, nunca vem do modelo). */
/** Resposta de texto completa: o texto montado dos chunks, os materiais de apoio que o Orquestrador recomendou (evento SSE
 * próprio, já resolvidos pelo backend — a URL é montada na tela a partir do id, nunca vem do modelo), a conversa em que a
 * troca ficou gravada e se a RESPOSTA foi salva (`persisted = false` = apareceu mas não entrou no histórico). */
/** `clarification` = a resposta veio do esclarecimento pelas bases (pergunta com opções, resposta com fontes ou o que falta). */
export type TextReply = { text: string; supportMaterials: FeedbackSupportMaterial[]; interactionId: string | null; conversationId: string; persisted: boolean; analytics?: LeadershipCard[]; reportOffer?: ReportOffer; navigate?: { href: string }; clarification?: ClarificationView }

/** A conversa pedida já foi encerrada (outra aba começou outra, ou ficou inativa): o chat troca para a atual. */
export class ConversationClosedError extends Error {
  constructor(readonly activeConversationId: string | null) {
    super("Esta conversa já foi encerrada.")
    this.name = "ConversationClosedError"
  }
}

export type ConversationRef = { conversationId: string; created: boolean; rotatedFrom: string | null }

/** Progresso verdadeiro da resposta (o que está rodando agora no servidor) — rótulo pronto para a tela. */
export type ReplyStatus = { stage: string; label: string }

/** A tela estava desatualizada: a conversa pedida não é mais a desta aplicação de feedback (ex.: concluída em outra aba). Nada foi
 * gravado — o chat recarrega a aplicação e devolve o texto ao campo. */
export class FeedbackConversationChangedError extends Error {
  constructor() {
    super("A conversa deste feedback mudou.")
    this.name = "FeedbackConversationChangedError"
  }
}

/**
 * Mensagem de texto para a INIA — REST/SSE, separado do GeminiRealtimeTransport de propósito (texto nunca precisa de
 * WebSocket/áudio). O cliente envia só a mensagem nova + a conversa que está exibindo (`null` = a atual/uma nova); o
 * backend resolve a conversa, grava a pergunta e monta o contexto do modelo a partir do BANCO, só com a conversa — nenhum
 * histórico sai do navegador. `clientMessageId` torna retentativas idempotentes. `onConversation` chega antes do texto.
 */
export async function fetchTextReply(
  /** `feedbackApplicationId`: a mensagem é sobre uma aplicação de feedback — o BACKEND decide a conversa (a da aplicação ou a
   * complementar, criada na primeira dúvida depois da conclusão). */
  // A persona da INIA é do servidor; daqui só sai o contexto da tela (dado, não instrução).
  // `clarification`: escolha (ou correção) de uma etapa do esclarecimento pelas bases — `text` é a forma legível dela.
  input: { conversationId: string | null; text: string; clientMessageId: string; contextHint?: string; feedbackApplicationId?: string | null; clarification?: ClarificationAnswer },
  /** `citations`: o pedaço é da resposta pelas bases, com marcadores de fonte ([1], [2]…) que a tela tira do que a pessoa lê. */
  onChunk: (text: string, meta?: { citations: true }) => void,
  onConversation?: (conversation: ConversationRef) => void,
  /** `onStatus`: o que o servidor está fazendo agora (progresso verdadeiro, nunca texto da resposta). `onRetract`: o texto mostrado
   * até aqui deixou de ser a resposta (o modelo pediu uma ferramenta depois de escrever) — a tela apaga e os próximos pedaços
   * recomeçam. `signal`: quem pediu desistiu (trocou de conversa) — o pedido é cancelado e o servidor para de gerar. */
  options: { onStatus?: (status: ReplyStatus) => void; onRetract?: () => void; signal?: AbortSignal } = {},
): Promise<TextReply> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options.signal && typeof AbortSignal.any === "function" ? AbortSignal.any([options.signal, timeout]) : timeout
  const response = await fetch(`${API_URL}/api/v1/realtime/messages`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, feedbackApplicationId: input.feedbackApplicationId ?? undefined }),
    signal,
  }).catch(() => {
    throw new Error("Não foi possível contatar a INIA. Verifique sua conexão e tente de novo.")
  })
  if (response.status === 409) {
    const payload = (await response.json().catch(() => null)) as { error?: { code?: string; details?: { activeConversationId?: string | null } } } | null
    if (payload?.error?.code === "ASSISTANT_CONVERSATION_CLOSED") throw new ConversationClosedError(payload.error.details?.activeConversationId ?? null)
    if (payload?.error?.code === "FEEDBACK_APPLICATION_CONVERSATION_MISMATCH" || payload?.error?.code === "FEEDBACK_APPLICATION_NOT_STARTED") throw new FeedbackConversationChangedError()
  }
  if (!response.ok || !response.body) throw new Error("Não foi possível obter uma resposta da INIA.")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let full = ""
  let streamError: string | null = null
  let supportMaterials: FeedbackSupportMaterial[] = []
  let analytics: LeadershipCard[] = []
  let reportOffer: ReportOffer | null = null
  let navigate: { href: string } | null = null
  let clarification: ClarificationView | null = null
  let interactionId: string | null = null
  let conversationId: string | null = null
  let persisted = false

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split("\n\n")
    buffer = events.pop() ?? ""
    for (const event of events) {
      const { name, data } = parseSseEvent(event)
      if (!data) continue
      if (name === "conversation") {
        const payload = JSON.parse(data) as ConversationRef
        conversationId = payload.conversationId
        onConversation?.(payload)
      } else if (name === "chunk") {
        const payload = JSON.parse(data) as { text: string; citations?: unknown }
        full += payload.text
        if (payload.citations === true) onChunk(payload.text, { citations: true })
        else onChunk(payload.text)
      } else if (name === "retract") {
        full = ""
        options.onRetract?.()
      } else if (name === "status") {
        const status = JSON.parse(data) as { stage?: unknown; label?: unknown }
        if (typeof status.label === "string") options.onStatus?.({ stage: typeof status.stage === "string" ? status.stage : "", label: status.label })
      } else if (name === "persisted") {
        persisted = true
        interactionId = (JSON.parse(data) as { interactionId?: string }).interactionId ?? interactionId
      } else if (name === "persist_error") {
        persisted = false
      } else if (name === "support_materials") {
        const payload = JSON.parse(data) as { interactionId?: string; supportMaterials?: FeedbackSupportMaterial[] }
        supportMaterials = Array.isArray(payload.supportMaterials) ? payload.supportMaterials : []
        interactionId = payload.interactionId ?? interactionId
      } else if (name === "analytics") {
        // Cartões de dados da liderança: números do backend (nunca do texto do modelo), exibidos junto da resposta.
        analytics = parseLeadershipCards((JSON.parse(data) as { cards?: unknown }).cards)
      } else if (name === "report_offer") {
        // Oferta "Criar report desta consulta" (proposta criada pelo backend a partir da consulta executada).
        const parsed = reportOfferSchema.safeParse(JSON.parse(data))
        if (parsed.success) reportOffer = parsed.data
      } else if (name === "navigate") {
        // "Sim" à oferta de report: o backend decide o destino (a configuração já preenchida).
        const href = (JSON.parse(data) as { href?: unknown }).href
        if (typeof href === "string" && href.startsWith("/reports/")) navigate = { href }
      } else if (name === "knowledge_clarification") {
        // Esclarecimento pelas bases: estado validado pelo backend (formulário, cenário e fontes são componentes da tela).
        const payload = JSON.parse(data) as { interactionId?: string; clarification?: unknown }
        clarification = parseClarification(payload.clarification)
        interactionId = payload.interactionId ?? interactionId
      } else if (name === "error") {
        streamError = (JSON.parse(data) as { message: string }).message
      }
    }
  }

  if (streamError) throw new Error(streamError)
  if (!full || !conversationId) throw new Error("Não foi possível obter uma resposta da INIA.")
  return { text: full, supportMaterials, interactionId, conversationId, persisted, ...(analytics.length > 0 ? { analytics } : {}), ...(reportOffer ? { reportOffer } : {}), ...(navigate ? { navigate } : {}), ...(clarification ? { clarification } : {}) }
}

export type ConversationSummary = {
  id: string
  kind: "CONVERSATION" | "LEGACY_HISTORY"
  status: "ACTIVE" | "CLOSED"
  startedAt: string
  lastActivityAt: string
  closedAt: string | null
  closeReason: "MANUAL" | "INACTIVITY" | "LEGACY" | "COMPLETED" | null
  /** Workflow Outputs V1 — conversa criada por um Workflow (primeira mensagem da INIA); "nova" até a primeira abertura. FEEDBACK =
   * conversa de uma aplicação de feedback (somente consulta depois de concluída). */
  origin?: "USER" | "WORKFLOW" | "FEEDBACK"
  title?: string | null
  unread?: boolean
  /** Conversa complementar de uma aplicação concluída (dúvidas depois da conclusão). */
  feedbackFollowUp?: boolean
  messageCount: number
  firstUserMessage: string | null
  lastMessage: { role: "user" | "assistant"; preview: string; channel: "chat" | "voice" } | null
}

export type ConversationMessage = {
  id: string
  channel: "chat" | "voice"
  role: "user" | "assistant"
  content: string
  agentId: string | null
  occurredAt: string
  cursor: string
  supportMaterials: FeedbackSupportMaterial[]
  /** Cartões de dados gravados com a resposta (revalidados pelo backend contra o escopo atual). */
  analytics?: unknown[]
  /** Oferta de report recorrente feita nesta resposta (só para o dono). */
  reportOffer?: unknown
  /** Estado do esclarecimento pelas bases desta resposta (fontes já revalidadas para quem lê). */
  clarification?: unknown
  /** `PRODUCT_APPLICABILITY_V1` (monitoramento): o esclarecimento foi uma confirmação feita NA CONVERSA sobre um feedback — não é
   * observação da gravação. */
  clarificationProvenance?: "CHAT_CONFIRMATION"
  /** Conferência da resposta (PEN-017), só no monitoramento: o que foi barrado ou detectado nesta mensagem, com o texto original. */
  responseCheck?: { outcome: string; control: string; action: string; rules: { kind: string; name: string }[]; reason: string | null; flaggedContent: string | null }
  /** "WORKFLOW" = recado entregue por um fluxo da INIA (mensagem destacada); "FEEDBACK" = apresentação de uma aplicação de
   * feedback; null nas demais. */
  origin?: "WORKFLOW" | "FEEDBACK" | null
  /** Curtir/descurtir vigente da dona nesta resposta da INIA (null = sem marcação); ausente nas mensagens da pessoa. */
  rating?: "up" | "down" | null
}

async function getJson<T>(path: string, errorMessage: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store" }).catch(() => {
    throw new Error(errorMessage)
  })
  if (!response.ok) throw new Error(errorMessage)
  return ((await response.json()) as { data: T }).data
}

/** Conversa ativa ao abrir o chat (null = começa limpo) + a janela de inatividade configurada no backend. */
export function fetchCurrentConversation() {
  return getJson<{ conversation: ConversationSummary | null; inactivityHours: number }>("/api/v1/realtime/conversations/current", "Não foi possível carregar a conversa atual.")
}

/** Conversas do próprio usuário, da mais recente para a mais antiga. */
export function fetchOwnConversations(page = 1, pageSize = 20) {
  return getJson<{ items: ConversationSummary[]; total: number; page: number; pageSize: number }>(`/api/v1/realtime/conversations?page=${page}&pageSize=${pageSize}`, "Não foi possível carregar as conversas anteriores.")
}

/** Página de mensagens de uma conversa do próprio usuário: as mais recentes, as anteriores (`before`) ou as novas (`after`). */
export function fetchConversationMessages(conversationId: string, options: { before?: string; after?: string; limit?: number } = {}) {
  const params = new URLSearchParams({ limit: String(options.limit ?? 30) })
  if (options.before) params.set("before", options.before)
  if (options.after) params.set("after", options.after)
  return getJson<{ conversation: ConversationSummary; messages: ConversationMessage[]; hasMore: boolean }>(`/api/v1/realtime/conversations/${conversationId}/messages?${params}`, "Não foi possível carregar as mensagens da conversa.")
}

/** Grava o curtir/descurtir de uma resposta da INIA (`undefined` = retirou). Só a dona da conversa; o histórico fica no banco. */
export async function saveMessageRating(conversationId: string, interactionId: string, rating: "up" | "down" | undefined): Promise<void> {
  const value = rating === "up" ? "UP" : rating === "down" ? "DOWN" : "NONE"
  const response = await fetch(`${API_URL}/api/v1/realtime/conversations/${conversationId}/messages/${interactionId}/rating`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  })
  if (!response.ok) throw new Error(`Avaliação não gravada (${response.status}).`)
}

/** "Nova conversa": encerra a atual no backend (nada é criado até a próxima mensagem). */
export async function startNewConversation(): Promise<void> {
  const response = await fetch(`${API_URL}/api/v1/realtime/conversations/new`, { method: "POST", credentials: "include" }).catch(() => {
    throw new Error("Não foi possível iniciar uma nova conversa.")
  })
  if (!response.ok) throw new Error("Não foi possível iniciar uma nova conversa.")
}

function parseSseEvent(block: string): { name: string | null; data: string | null } {
  let name: string | null = null
  let data: string | null = null
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice("event:".length).trim()
    else if (line.startsWith("data:")) data = line.slice("data:".length).trim()
  }
  return { name, data }
}
