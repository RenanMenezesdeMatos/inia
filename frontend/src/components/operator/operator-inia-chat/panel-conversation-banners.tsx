"use client"

import { BarChart3, MessageCircle, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ConversationSummary } from "@/lib/realtime/gemini-text-client"
import { conversationLabel } from "@/lib/realtime/conversation-format"
import type { IniaInbox } from "@/schemas/inia-deliveries/inia-deliveries.schema"
import type { FeedbackOpenRequest } from "../feedback-application/feedback-workspace-context"
import { feedbackLabel, type FeedbackReturn } from "./feedback-session-model"

type PanelConversationBannersProps = {
  feedbackReturn: FeedbackReturn | null
  reopenFeedback: (input: Omit<FeedbackOpenRequest, "id">) => void
  unreadWorkflowConversations: IniaInbox["unreadConversations"]
  openWorkflowConversation: (id: string) => Promise<void>
  workflowConversation: { id: string; title: string } | null
  setConversationNotice: React.Dispatch<React.SetStateAction<string>>
  loadCurrentConversation: () => Promise<void>
  readOnlyConversation: ConversationSummary | null
  conversationNotice: string
}

/** Avisos do painel acima da conversa: volta ao feedback, conversas de Workflow, conversa encerrada e o aviso da vez. */
export function PanelConversationBanners({ feedbackReturn, reopenFeedback, unreadWorkflowConversations, openWorkflowConversation, workflowConversation, setConversationNotice, loadCurrentConversation, readOnlyConversation, conversationNotice }: PanelConversationBannersProps) {
  return (
    <>
      {feedbackReturn ? (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs" role="status">
          <BarChart3 className="size-4 shrink-0 text-primary" aria-hidden/>
          <span className="min-w-0 flex-1"><span className="font-medium">Conversa geral · resultados atuais</span> (hoje, {new Date().toLocaleDateString("pt-BR")}). O feedback “{feedbackLabel(feedbackReturn.title, feedbackReturn.periodLabel)}” continua como estava.</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => reopenFeedback({ source: feedbackReturn.source, mode: "continue", title: feedbackReturn.title, periodLabel: feedbackReturn.periodLabel, origin: "history" })}>Voltar ao feedback</Button>
        </div>
      ) : null}
      {unreadWorkflowConversations.length > 0 ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs" role="status">
          <MessageCircle className="size-4 shrink-0 text-primary" aria-hidden/>
          <span className="min-w-0 flex-1 truncate"><span className="font-medium">Nova conversa da INIA:</span> {unreadWorkflowConversations[0]!.title}{unreadWorkflowConversations.length > 1 ? ` (+${unreadWorkflowConversations.length - 1})` : ""}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => void openWorkflowConversation(unreadWorkflowConversations[0]!.id)}>Abrir</Button>
        </div>
      ) : null}
      {workflowConversation ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs" role="status">
          <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden/>
          <span className="min-w-0 flex-1 truncate"><span className="font-medium">{workflowConversation.title}</span> · você pode responder por aqui</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setConversationNotice(""); void loadCurrentConversation() }}>Voltar à conversa atual</Button>
        </div>
      ) : null}
      {readOnlyConversation ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-xs" role="status">
          <span className="min-w-0 flex-1 truncate"><span className="font-medium">{conversationLabel(readOnlyConversation)}</span> · encerrada, somente leitura</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setConversationNotice(""); void loadCurrentConversation() }}>Voltar à conversa atual</Button>
        </div>
      ) : null}
      {conversationNotice ? <p className="mx-4 mt-3 rounded-xl bg-primary/5 px-3 py-2 text-xs text-foreground" role="status">{conversationNotice}</p> : null}
    </>
  )
}
