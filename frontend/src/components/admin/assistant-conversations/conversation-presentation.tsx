"use client"

import { ClipboardCheck, History, Megaphone, MessageCircle, MessageCircleQuestion, type LucideIcon } from "lucide-react"

import { PersonAvatar } from "@/components/profile/person-avatar"
import { conversationLabel, conversationStatusLabel } from "@/lib/realtime/conversation-format"
import { cn } from "@/lib/utils"
import type { MonitoredConversation, MonitoredOwner } from "@/services/admin/assistant-conversations-service"

/**
 * Apresentação comum da lista e da leitura em "Conversas com a INIA": de que TIPO é a conversa (livre, sessão de feedback, dúvidas
 * depois de um feedback, recado de um fluxo), o ASSUNTO (título real da conversa ou a primeira pergunta do colaborador — nunca um
 * resumo) e o estado. Só formata o que veio do backend.
 */
export function conversationKindOf(conversation: MonitoredConversation): { label: string; icon: LucideIcon } {
  if (conversation.kind === "LEGACY_HISTORY") return { label: "Histórico anterior", icon: History }
  if (conversation.origin === "WORKFLOW") return { label: "Recado da INIA", icon: Megaphone }
  if (conversation.origin === "FEEDBACK") return conversation.feedbackFollowUp ? { label: "Dúvidas sobre um feedback", icon: MessageCircleQuestion } : { label: "Sessão de feedback", icon: ClipboardCheck }
  return { label: "Conversa livre", icon: MessageCircle }
}

/** Assunto para a LISTA: o título da conversa; numa conversa livre, a primeira pergunta do colaborador (entre aspas). */
export function conversationSubjectOf(conversation: MonitoredConversation): string {
  if (conversation.kind === "LEGACY_HISTORY") return conversationLabel(conversation)
  if (conversation.origin === "FEEDBACK" && conversation.title) return conversation.feedbackFollowUp ? conversation.title.replace(/^Dúvidas · /, "") : conversation.title
  if (conversation.origin === "WORKFLOW" && conversation.title) return conversation.title
  return conversation.firstUserMessage ? `“${conversation.firstUserMessage}”` : conversationLabel(conversation)
}

/** Título da LEITURA: o assunto da conversa; numa conversa livre, quando ela começou (a primeira pergunta já abre a conversa). */
export function conversationTitleOf(conversation: MonitoredConversation): string {
  if (conversation.origin === "FEEDBACK" || conversation.origin === "WORKFLOW") return conversationSubjectOf(conversation)
  return conversationLabel(conversation)
}

export function OwnerAvatar({ owner, className }: { owner: MonitoredOwner; className?: string }) {
  return <PersonAvatar name={owner.name} avatarUrl={owner.avatarUrl} className={cn("size-9", className)} fallbackClassName="bg-secondary text-xs" />
}

/** Estado com um ponto de cor (em andamento = verde, encerrada = neutro) e o rótulo escrito ao lado. */
export function ConversationStatus({ conversation, className }: { conversation: MonitoredConversation; className?: string }) {
  const active = conversation.status === "ACTIVE" && conversation.kind !== "LEGACY_HISTORY"
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", active ? "font-medium text-foreground" : "text-muted-foreground", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
      {conversationStatusLabel(conversation)}
    </span>
  )
}

export const messagesLabel = (count: number) => `${count.toLocaleString("pt-BR")} ${count === 1 ? "mensagem" : "mensagens"}`
