import type { ConversationMessage } from "@/lib/realtime/gemini-text-client"
import { messageTime, newClientKey } from "@/lib/realtime/conversation-format"
import type { FeedbackSupportMaterial } from "@/schemas/feedbacks/support-material.schema"
import { parseLeadershipCards, type LeadershipCard } from "@/schemas/leadership/leadership.schema"
import { reportOfferSchema, type ReportOffer } from "@/schemas/reports/reports.schema"
import { parseClarification, type ClarificationView } from "@/schemas/knowledge-clarification/clarification.schema"

/** `supportMaterials` = materiais de apoio recomendados pelo Orquestrador nesta resposta (chat ou
 * voz), já resolvidos pelo backend — a mesma seção do Feedback, ao lado do balão; a URL nasce do id
 * na tela (`buildKnowledgeMaterialHref`), nunca do modelo. Ausente/vazio = nenhuma seção. */
export type ChatMessage = {
  id: number
  sender: "assistant" | "user"
  text: string
  time: string
  /** Instante real (ISO) — separadores de data. Mensagens locais usam o instante de criação. */
  occurredAt: string
  channel?: "chat" | "voice"
  rating?: "up" | "down"
  supportMaterials?: FeedbackSupportMaterial[]
  /** Cartões de dados da liderança desta resposta (escopo, período, base e links) — números do backend. */
  analytics?: LeadershipCard[]
  /** "Criar report desta consulta": oferta feita nesta resposta (aceite pelo botão ou por "sim" na resposta seguinte). */
  reportOffer?: ReportOffer
  /** Esclarecimento pelas bases: pergunta com opções (formulário), resposta com o cenário e as fontes, ou o que falta. */
  clarification?: ClarificationView
  /** `failed` = exibida, mas NÃO entrou no histórico (falha ao salvar) — nunca aparenta sucesso. */
  saveState?: "failed"
  /** Resposta de erro local ("não consegui responder"): não é resposta da INIA nem vai para o contexto. */
  localError?: boolean
  /** Recado entregue por um fluxo da INIA (Workflow Output → Chat) ou a apresentação de uma aplicação de feedback: destacada. */
  origin?: "WORKFLOW" | "FEEDBACK"
  /** Mensagem da conversa COMPLEMENTAR (dúvidas depois da conclusão da aplicação) — exibida depois do separador próprio. */
  segment?: "followup"
}

export const PAGE_LIMIT = 30

export const nowTime = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })

export const newTurnId = () => `voice-${newClientKey()}`

export function toChatMessage(message: ConversationMessage): ChatMessage {
  const analytics = parseLeadershipCards(message.analytics)
  const offer = message.reportOffer ? reportOfferSchema.safeParse(message.reportOffer) : null
  const clarification = message.role === "assistant" ? parseClarification(message.clarification) : null
  return {
    id: nextMessageId(),
    sender: message.role === "assistant" ? "assistant" : "user",
    text: message.content,
    time: messageTime(message.occurredAt),
    occurredAt: message.occurredAt,
    channel: message.channel,
    ...(message.supportMaterials.length > 0 ? { supportMaterials: message.supportMaterials } : {}),
    ...(analytics.length > 0 ? { analytics } : {}),
    ...(offer?.success ? { reportOffer: offer.data } : {}),
    ...(clarification ? { clarification } : {}),
    ...(message.origin === "WORKFLOW" || message.origin === "FEEDBACK" ? { origin: message.origin } : {}),
  }
}

/** Mensagens carregadas de uma conversa complementar ficam depois do separador "Dúvidas após a conclusão". */
export const asFollowUp = (message: ChatMessage): ChatMessage => ({ ...message, segment: "followup" })

// A shared counter beats `Date.now()` for message ids: two messages created
// in the same millisecond (routine when a turn's transcript flushes) used
// to collide and produce a duplicate React key.
let messageIdSeed = Date.now()

/** A apresentação da aplicação (1ª mensagem da INIA, origem FEEDBACK) — onde a fala da apresentação pousa no palco. */
export function presentationMessageOf(messages: readonly ChatMessage[]): number | null {
  return messages.find((message) => message.sender === "assistant" && message.origin === "FEEDBACK")?.id ?? null
}

export function nextMessageId(): number {
  messageIdSeed += 1
  return messageIdSeed
}
