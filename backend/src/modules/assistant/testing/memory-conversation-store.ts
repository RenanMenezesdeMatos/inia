import { randomUUID } from "node:crypto"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { DEFAULT_CONVERSATION_INACTIVITY_HOURS, decideConversationForWrite, encodeCursor, isInactive, previewOf, type ConversationRecord, type MessageCursor } from "../domain/assistant-conversation.js"
import { ratingView, shouldWriteRating, type AssistantRatingDetails, type AssistantRatingValue } from "../domain/assistant-interaction-rating.js"
import { SUPPORT_SIGNALS, type SupportSignal } from "../domain/reply-signals.js"
import { analyticsCardsOf, clarificationPayloadOf, clarificationScopeOf, messageOriginOf, type ConversationMessage, type ConversationScope, type ConversationStore, type ConversationSummary, type MessageInput } from "../application/assistant-conversations.js"

/**
 * Store de conversas EM MEMÓRIA — mesma decisão de domínio (`decideConversationForWrite`) da implementação Postgres,
 * para testar rotas e fluxos sem banco. Não é usado em produção.
 */
export type MemoryMessage = MessageInput & { id: string; seq: number }
/** Linha do histórico de curtir/descurtir (mesmas regras da tabela `assistant_interaction_ratings`). */
export type MemoryRating = { id: string; personId: string; conversationId: string; interactionId: string; value: AssistantRatingValue; details: AssistantRatingDetails | null; createdAt: Date; supersededAt: Date | null }

export function createMemoryConversationStore(options: { inactivityHours?: number } = {}) {
  const inactivityMs = (options.inactivityHours ?? DEFAULT_CONVERSATION_INACTIVITY_HOURS) * 3_600_000
  const conversations: ConversationRecord[] = []
  const messages: MemoryMessage[] = []
  const ratings: MemoryRating[] = []
  /** Sinais gravados por mensagem (mesmas regras de `assistant_reply_signals`: só no chat livre). */
  const signals = new Map<string, SupportSignal[]>()
  let seq = 0
  const owned = (scope: ConversationScope, id: string) => conversations.find((c) => c.id === id && c.organizationId === scope.organizationId && c.ownerPersonId === scope.ownerPersonId) ?? null
  const active = (scope: ConversationScope) => conversations.find((c) => c.status === "ACTIVE" && (c.origin ?? "USER") === "USER" && c.organizationId === scope.organizationId && c.ownerPersonId === scope.ownerPersonId) ?? null
  const close = (conversation: ConversationRecord, reason: "MANUAL" | "INACTIVITY", at: Date) => Object.assign(conversation, { status: "CLOSED", closedAt: at, closeReason: reason })
  const ordered = (conversationId: string) => messages.filter((m) => m.conversationId === conversationId).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.seq - b.seq)
  const toMessage = (m: MemoryMessage): ConversationMessage => {
    const occurredAt = m.occurredAt.toISOString()
    return { id: m.id, channel: m.channel, role: m.role, content: m.content, agentId: m.agentId ?? null, occurredAt, cursor: encodeCursor({ occurredAt, seq: String(m.seq) }), origin: messageOriginOf(m.role, m.clientMessageId), analytics: m.role === "assistant" ? analyticsCardsOf(m.toolCalls) : [], clarification: m.role === "assistant" ? clarificationPayloadOf(m.toolCalls) : null, clarificationScope: m.role === "assistant" ? clarificationScopeOf(m.toolCalls) : null, signals: signals.get(m.id) ?? null }
  }
  const compare = (m: MemoryMessage, cursor: MessageCursor) => m.occurredAt.getTime() - new Date(cursor.occurredAt).getTime() || m.seq - Number(cursor.seq)
  const summary = (c: ConversationRecord): ConversationSummary => {
    const list = ordered(c.id)
    const last = list.at(-1)
    const firstUser = list.find((m) => m.role === "user")
    return {
      id: c.id, kind: c.kind, status: c.status, startedAt: c.startedAt.toISOString(), lastActivityAt: c.lastActivityAt.toISOString(), closedAt: c.closedAt?.toISOString() ?? null, closeReason: c.closeReason,
      origin: c.origin ?? "USER", title: (c as ConversationRecord & { title?: string | null }).title ?? null, unread: c.origin === "WORKFLOW" && !(c as ConversationRecord & { ownerSeenAt?: Date | null }).ownerSeenAt, feedbackFollowUp: false,
      messageCount: list.length, firstUserMessage: firstUser ? previewOf(firstUser.content, 80) : null,
      lastMessage: last ? { role: last.role, preview: previewOf(last.content), channel: last.channel } : null,
    }
  }

  /** Só para testes: uma conversa criada por um Workflow (origin WORKFLOW) com a primeira mensagem da INIA. */
  const seedWorkflowConversation = (scope: ConversationScope, input: { title: string; text: string; at: Date }) => {
    const conversation = { id: randomUUID(), organizationId: scope.organizationId, ownerPersonId: scope.ownerPersonId, kind: "CONVERSATION" as const, status: "ACTIVE" as const, startedAt: input.at, lastActivityAt: input.at, closedAt: null, closeReason: null, origin: "WORKFLOW" as const, title: input.title, ownerSeenAt: null }
    conversations.push(conversation)
    seq += 1
    messages.push({ id: randomUUID(), seq, conversationId: conversation.id, organizationId: scope.organizationId, ownerPersonId: scope.ownerPersonId, channel: "chat", role: "assistant", content: input.text, occurredAt: input.at, clientMessageId: `workflow-output:${conversation.id}` })
    return conversation.id
  }

  /** Só para testes: a conversa de uma aplicação de feedback (origin FEEDBACK) com a apresentação da INIA. */
  const seedFeedbackConversation = (scope: ConversationScope, input: { title: string; text: string; at: Date }) => {
    const conversation = { id: randomUUID(), organizationId: scope.organizationId, ownerPersonId: scope.ownerPersonId, kind: "CONVERSATION" as const, status: "ACTIVE" as const, startedAt: input.at, lastActivityAt: input.at, closedAt: null, closeReason: null, origin: "FEEDBACK" as const, title: input.title }
    conversations.push(conversation)
    seq += 1
    messages.push({ id: randomUUID(), seq, conversationId: conversation.id, organizationId: scope.organizationId, ownerPersonId: scope.ownerPersonId, channel: "chat", role: "assistant", content: input.text, occurredAt: input.at, clientMessageId: "feedback-application:presentation" })
    return conversation.id
  }
  /** Só para testes: conclusão da aplicação (a conversa fecha com COMPLETED). */
  const completeConversation = (id: string, at: Date) => Object.assign(conversations.find((c) => c.id === id)!, { status: "CLOSED", closedAt: at, closeReason: "COMPLETED" })

  const store: ConversationStore = {
    async resolveForWrite(scope, requestedId, now, opts) {
      const requested = requestedId ? owned(scope, requestedId) : null
      const decision = decideConversationForWrite({ requested, requestedId, active: active(scope), now, inactivityMs, allowClosed: opts?.allowClosed ?? false })
      if (decision.action === "REJECT_NOT_FOUND") throw new DomainError("Conversa não encontrada.", "ASSISTANT_CONVERSATION_NOT_FOUND", 404)
      if (decision.action === "REJECT_CLOSED") throw new DomainError("Esta conversa já foi encerrada.", "ASSISTANT_CONVERSATION_CLOSED", 409, { activeConversationId: decision.activeConversationId })
      if (decision.action === "USE") return { conversationId: decision.conversationId, created: false, rotatedFrom: null, closed: decision.closed ?? false }
      if (decision.closeFirst) close(owned(scope, decision.closeFirst.conversationId)!, "INACTIVITY", now)
      const conversation: ConversationRecord = { id: randomUUID(), organizationId: scope.organizationId, ownerPersonId: scope.ownerPersonId, kind: "CONVERSATION", status: "ACTIVE", startedAt: now, lastActivityAt: now, closedAt: null, closeReason: null }
      conversations.push(conversation)
      return { conversationId: conversation.id, created: true, rotatedFrom: decision.closeFirst?.conversationId ?? null, closed: false }
    },
    async requireOwned(scope, id) {
      const conversation = owned(scope, id)
      if (!conversation) throw new DomainError("Conversa não encontrada.", "ASSISTANT_CONVERSATION_NOT_FOUND", 404)
      return conversation
    },
    async startNew(scope, now) {
      const current = active(scope)
      if (!current) return { closedConversationId: null }
      close(current, "MANUAL", now)
      return { closedConversationId: current.id }
    },
    async loadCurrent(scope, now) {
      const current = active(scope)
      if (!current) return null
      if (!isInactive(current, now, inactivityMs)) return current
      close(current, "INACTIVITY", now)
      return null
    },
    async append(input) {
      if (input.clientMessageId) {
        const existing = messages.find((m) => m.conversationId === input.conversationId && m.clientMessageId === input.clientMessageId)
        if (existing) return { id: existing.id, duplicate: true }
      }
      seq += 1
      const message: MemoryMessage = { ...input, id: randomUUID(), seq }
      messages.push(message)
      const target = conversations.find((c) => c.id === input.conversationId)
      if (input.role === "assistant" && (target?.origin ?? "USER") === "USER") signals.set(message.id, SUPPORT_SIGNALS.filter((signal) => (input.signals ?? []).includes(signal)))
      const conversation = conversations.find((c) => c.id === input.conversationId)!
      if (input.occurredAt > conversation.lastActivityAt) conversation.lastActivityAt = input.occurredAt
      return { id: message.id, duplicate: false }
    },
    async findByClientMessageId(conversationId, clientMessageId) {
      const found = messages.find((m) => m.conversationId === conversationId && m.clientMessageId === clientMessageId)
      return found ? { id: found.id, content: found.content } : null
    },
    async loadMessages({ organizationId, conversationId, limit, before, after, ownerPersonId }) {
      if (ownerPersonId && !owned({ organizationId, ownerPersonId }, conversationId)) return { messages: [], hasMore: false }
      let list = ordered(conversationId)
      if (after) list = list.filter((m) => compare(m, after) > 0).slice(0, limit + 1)
      else {
        if (before) list = list.filter((m) => compare(m, before) < 0)
        list = list.slice(-(limit + 1))
      }
      const hasMore = list.length > limit
      const page = after ? list.slice(0, limit) : list.slice(hasMore ? 1 : 0)
      return { messages: page.map(toMessage), hasMore }
    },
    async contextTurns({ conversationId }) {
      return ordered(conversationId).slice(-24).map((m) => ({ role: m.role === "assistant" ? ("model" as const) : ("user" as const), text: m.content }))
    },
    async listOwn(scope, page, pageSize) {
      const list = conversations.filter((c) => c.organizationId === scope.organizationId && c.ownerPersonId === scope.ownerPersonId).sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
      return { items: list.slice((page - 1) * pageSize, page * pageSize).map(summary), total: list.length }
    },
    async ownSummary(scope, id) {
      const conversation = owned(scope, id)
      return conversation ? summary(conversation) : null
    },
    async rate(scope, input, now) {
      const message = messages.find((m) => m.id === input.interactionId && m.conversationId === input.conversationId && m.role === "assistant")
      const conversation = owned(scope, input.conversationId)
      if (!message || !conversation) throw new DomainError("Resposta não encontrada.", "ASSISTANT_MESSAGE_NOT_FOUND", 404)
      const origin = conversation.origin ?? "USER"
      const details = input.value === "DOWN" ? (input.details ?? null) : null
      if (details && origin !== "USER") throw new DomainError("O motivo da descurtida só vale nas conversas abertas por você com a INIA.", "RATING_DETAILS_NOT_ALLOWED", 422)
      const current = ratings.find((r) => r.personId === scope.ownerPersonId && r.interactionId === input.interactionId && !r.supersededAt) ?? null
      if (!shouldWriteRating(current, { value: input.value, details })) {
        const vigente = current && current.value !== "NONE" ? current : null
        return { rating: ratingView(vigente?.value), ratingId: vigente?.id ?? null, details: vigente?.details ?? null, conversationOrigin: origin, written: false }
      }
      if (current) current.supersededAt = now
      const id = randomUUID()
      ratings.push({ id, personId: scope.ownerPersonId, conversationId: input.conversationId, interactionId: input.interactionId, value: input.value, details, createdAt: now, supersededAt: null })
      return { rating: ratingView(input.value), ratingId: input.value === "NONE" ? null : id, details, conversationOrigin: origin, written: true }
    },
    async ratingsOf(scope, interactionIds) {
      const current = ratings.filter((r) => r.personId === scope.ownerPersonId && interactionIds.includes(r.interactionId) && !r.supersededAt && r.value !== "NONE")
      return new Map(current.map((r) => [r.interactionId, { rating: ratingView(r.value)!, ratingId: r.id, details: r.details }] as const))
    },
    async markNoReply(scope, questionId) {
      const question = messages.find((m) => m.id === questionId && m.role === "user")
      const conversation = question ? owned(scope, question.conversationId) : null
      if (!question || !conversation || (conversation.origin ?? "USER") !== "USER" || signals.has(questionId)) return false
      signals.set(questionId, ["NO_REPLY"])
      return true
    },
  }
  return { store, conversations, messages, ratings, signals, seedWorkflowConversation, seedFeedbackConversation, completeConversation }
}
