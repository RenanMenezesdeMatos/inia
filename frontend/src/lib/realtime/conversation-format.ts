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

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" })
/** Chave do dia LOCAL (separadores de data). */
export const dayKey = (iso: string) => dayKeyFormatter.format(new Date(iso))

/** Rótulo do separador de data: "Hoje", "Ontem" ou "29 de setembro de 2026". */
export function dateSeparatorLabel(iso: string, now: Date = new Date()): string {
  const key = dayKey(iso)
  if (key === dayKeyFormatter.format(now)) return "Hoje"
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dayKeyFormatter.format(yesterday)) return "Ontem"
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))
}

export const messageTime = (iso: string) => new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

/** Última atividade compacta para listas: hora (hoje), "Ontem" ou a data. */
export function lastActivityLabel(iso: string, now: Date = new Date()): string {
  const label = dateSeparatorLabel(iso, now)
  if (label === "Hoje") return messageTime(iso)
  if (label === "Ontem") return "Ontem"
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso))
}

/** Identificador opaco para chaves idempotentes do cliente (fallback quando `crypto.randomUUID` não existe). */
export function newClientKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`
}
