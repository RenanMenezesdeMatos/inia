import { formatShortDateTime } from "@/lib/format/date"

/**
 * Apresentação de CONVERSAS com a INIA — compartilhada pelo chat do colaborador e pela área "Conversas com a INIA" da
 * Administração (os dois leem a mesma troca real de mensagens; nada aqui resume ou reescreve conteúdo).
 */
export type ConversationLike = { kind: "CONVERSATION" | "LEGACY_HISTORY"; status: "ACTIVE" | "CLOSED"; startedAt: string; closeReason?: "MANUAL" | "INACTIVITY" | "LEGACY" | "COMPLETED" | "HUMAN_SUPPORT" | null; origin?: "USER" | "WORKFLOW" | "FEEDBACK"; title?: string | null; feedbackFollowUp?: boolean }

/** Identificação simples: data/hora de início — ou "Histórico anterior" para os registros sem limite de conversa conhecido.
 * Conversa criada por um Workflow usa o título do recado ("Feedback do seu fechamento de agosto de 2026"). */
export function conversationLabel(conversation: ConversationLike): string {
  if (conversation.kind === "LEGACY_HISTORY") return "Histórico anterior"
  if (conversation.origin === "WORKFLOW" && conversation.title) return conversation.title
  // Conversa de uma aplicação de feedback: o assunto do feedback.
  // Conversa complementar: o título já é "Dúvidas · <assunto>".
  if (conversation.origin === "FEEDBACK" && conversation.title) return conversation.feedbackFollowUp ? conversation.title : `Feedback · ${conversation.title}`
  return `Conversa de ${formatShortDateTime(conversation.startedAt)}`
}

export function conversationStatusLabel(conversation: ConversationLike): string {
  if (conversation.kind === "LEGACY_HISTORY") return "Histórico anterior"
  if (conversation.origin === "WORKFLOW" && conversation.status === "ACTIVE") return "Recado da INIA"
  if (conversation.origin === "FEEDBACK" && conversation.feedbackFollowUp) return "Dúvidas após a conclusão"
  if (conversation.origin === "FEEDBACK") return conversation.status === "ACTIVE" ? "Feedback em andamento" : "Feedback concluído"
  if (conversation.status === "ACTIVE") return "Em andamento"
  if (conversation.closeReason === "INACTIVITY") return "Encerrada por inatividade"
  // Encerrada pelo servidor quando terminou o atendimento do Anjo que saiu desta conversa (Apoio com Anjo).
  if (conversation.closeReason === "HUMAN_SUPPORT") return "Encerrada após o apoio do Anjo"
  return "Encerrada"
}

// Rótulos de dia e hora das conversas: moram em `lib/format/date.ts` (também os usa o painel do Apoio com Anjo, que não importa lib/realtime).
export { dateSeparatorLabel, dayKey, lastActivityLabel, messageTime } from "@/lib/format/date"

/** Identificador opaco para chaves idempotentes do cliente (fallback quando `crypto.randomUUID` não existe). */
export function newClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`
}
