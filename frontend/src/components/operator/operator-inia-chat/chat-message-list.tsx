"use client"

import Link from "next/link"
import { BarChart3, Bot, FileBarChart2, Mic, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react"
import { PersonAvatar } from "@/components/profile/person-avatar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Bubble, BubbleContent, BubbleReactions } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import { Skeleton } from "@/components/ui/skeleton"
import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import type { ConversationSummary } from "@/lib/realtime/gemini-text-client"
import { dateSeparatorLabel, dayKey } from "@/lib/realtime/conversation-format"
import { SupportMaterialsSection } from "@/components/feedbacks/support-materials-section"
import { LeadershipCards } from "@/components/leadership/leadership-cards"
import type { OperatorProfile } from "@/schemas/operator"
import { RichContent } from "@/components/rich-content/rich-content"
import type { FeedbackApplicationDetail } from "@/schemas/feedback-applications/feedback-application.schema"
import type { ChatMessage } from "./chat-message"
import type { FeedbackReturn } from "./feedback-session-model"
import { FollowUpSeparator, PresentationText, TypingBubble } from "./chat-visuals"

type ChatMessageListProps = {
  sessionApplication: FeedbackApplicationDetail | null
  messages: ChatMessage[]
  messagesContentRef: React.RefObject<HTMLDivElement | null>
  sessionOpen: boolean
  loadState: "loading" | "ready" | "error"
  readOnlyConversation: ConversationSummary | null
  openPastConversation: (summary: ConversationSummary) => Promise<void>
  loadCurrentConversation: () => Promise<void>
  olderCursor: string | null
  loadOlderMessages: () => Promise<void>
  loadingOlder: boolean
  olderError: boolean
  operator: OperatorProfile
  greeting: string
  stageHiddenIds: ReadonlySet<number>
  feedbackCompleted: boolean
  workflowConversation: { id: string; title: string } | null
  rate: (id: number, rating: "up" | "down") => void
  resumeMarkerId: number | null
  conversationState: AvatarConversationState
  liveAssistantText: string | null
  textReplyPending: boolean
  liveTextReply: string | null
  askSuggestion: (event: React.MouseEvent<HTMLButtonElement>) => void
  switchToGeneralConversation: (reason: FeedbackReturn["reason"]) => void
  /** Perguntas para começar (liderança: derivadas das prioridades do dia) — só no estado vazio da conversa geral. */
  starterSuggestions?: string[]
  /** Pergunta vinda de um cartão (ex.: "Perguntar à INIA" numa prioridade) — nada é enviado sozinho, só no clique. */
  askQuestion?: (question: string) => void
}

/** Mensagens da conversa exibida: a geral no painel; a da aplicação de feedback (e a complementar) na sessão. */
export function ChatMessageList({ sessionApplication, messages, messagesContentRef, sessionOpen, loadState, readOnlyConversation, openPastConversation, loadCurrentConversation, olderCursor, loadOlderMessages, loadingOlder, olderError, operator, greeting, stageHiddenIds, feedbackCompleted, workflowConversation, rate, resumeMarkerId, conversationState, liveAssistantText, textReplyPending, liveTextReply, askSuggestion, switchToGeneralConversation, starterSuggestions = [], askQuestion }: ChatMessageListProps) {
  const busy = textReplyPending || conversationState !== "idle"
  const suggestions = sessionApplication?.script?.suggestions ?? []
  const firstFollowUpIndex = messages.findIndex((message) => message.segment === "followup")
  return <div ref={messagesContentRef} className={sessionOpen ? "space-y-6 pt-5" : "space-y-6 px-5 py-6"} data-testid={sessionOpen ? "feedback-session-messages" : undefined}>
    {loadState === "loading" ? (
      <div className="space-y-4" aria-label="Carregando conversa"><Skeleton className="h-12 w-3/4 rounded-2xl"/><Skeleton className="ml-auto h-10 w-1/2 rounded-2xl"/><Skeleton className="h-16 w-4/5 rounded-2xl"/></div>
    ) : loadState === "error" && !sessionOpen ? (
      <div className="space-y-3 rounded-xl border border-destructive/30 p-4 text-center" role="alert">
        <p className="text-sm text-destructive">Não foi possível carregar esta conversa. Suas mensagens não foram perdidas.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void (readOnlyConversation ? openPastConversation(readOnlyConversation) : loadCurrentConversation())}>Tentar novamente</Button>
      </div>
    ) : null}
    {loadState === "ready" && olderCursor ? (
      <div className="text-center">
        <Button type="button" size="sm" variant="ghost" onClick={() => void loadOlderMessages()} disabled={loadingOlder}>{loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}</Button>
        {olderError ? <p className="mt-1 text-xs text-destructive" role="alert">Não foi possível carregar as mensagens anteriores.</p> : null}
      </div>
    ) : null}
    {loadState === "ready" && messages.length === 0 && !readOnlyConversation && !sessionOpen ? (
      <TypingBubble align="start" name="INIA" avatarSrc={operator.assistantImage} muted><RichContent text={greeting}/></TypingBubble>
    ) : null}
    {loadState === "ready" && messages.length === 0 && !readOnlyConversation && !sessionOpen && starterSuggestions.length > 0 ? (
      <div className="flex flex-wrap gap-2 pl-10" data-testid="starter-suggestions" aria-label="Perguntas sugeridas">
        {starterSuggestions.map((suggestion) => (
          <Button key={suggestion} type="button" size="xs" variant="outline" className="h-auto max-w-full rounded-full py-1 text-left whitespace-normal" disabled={busy} data-suggestion={suggestion} onClick={askSuggestion}>{suggestion}</Button>
        ))}
      </div>
    ) : null}
    {loadState === "ready" ? messages.map((message, index) => {
      // Ainda no balão do palco: aparece quando a fala pousa nela.
      if (stageHiddenIds.has(message.id)) return null
      const assistant = message.sender === "assistant"
      const fromWorkflow = assistant && message.origin === "WORKFLOW"
      const presentation = assistant && message.origin === "FEEDBACK"
      // A data só aparece quando muda (o separador "Dúvidas após a conclusão" não repete o "Hoje" do mesmo dia).
      const showSeparator = index === 0 || dayKey(messages[index - 1]!.occurredAt) !== dayKey(message.occurredAt)
      // Registro original de uma aplicação concluída: só consulta (sem avaliação de resposta).
      const closedRecord = sessionOpen && feedbackCompleted && message.segment !== "followup"
      return <div key={message.id} className="space-y-6">
      {index === firstFollowUpIndex ? <FollowUpSeparator/> : null}
      {showSeparator ? <div className="flex justify-center" role="separator" aria-label={dateSeparatorLabel(message.occurredAt)}><span className="rounded-full bg-muted px-3 py-0.5 text-[11px] font-medium text-muted-foreground">{dateSeparatorLabel(message.occurredAt)}</span></div> : null}
      {/* `data-message-id`: onde a fala da INIA pousa no palco (a mensagem inteira nasce do balão). */}
      <Message align={assistant ? "start" : "end"} data-message-id={message.id}>
        <MessageAvatar>{assistant ? <Avatar className="size-8"><AvatarImage src={operator.assistantImage} alt="INIA"/><AvatarFallback className="bg-primary text-primary-foreground"><Bot className="size-4"/></AvatarFallback></Avatar> : <PersonAvatar name={operator.displayName ?? operator.name} avatarUrl={operator.avatarUrl} className="size-8" fallbackClassName="bg-secondary"/>}</MessageAvatar>
        <MessageContent className="max-w-[88%]">
          <MessageHeader className="flex items-center gap-1.5 px-1">{assistant ? "INIA" : operator.displayName ?? operator.name}{fromWorkflow ? <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground"><Sparkles className="size-3" aria-hidden/>Recado</span> : null}{presentation ? <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground"><Sparkles className="size-3" aria-hidden/>Apresentação do feedback</span> : null}</MessageHeader>
          <Bubble variant={assistant ? "muted" : "default"} className={fromWorkflow ? "max-w-full border border-primary/40 bg-primary/10" : "max-w-full"} data-origin={fromWorkflow ? "workflow" : presentation ? "feedback-presentation" : undefined}><BubbleContent className="space-y-2 px-4 py-3">{fromWorkflow && workflowConversation ? <p className="text-sm font-semibold text-primary dark:text-chart-4">{workflowConversation.title}</p> : null}{presentation ? <PresentationText text={message.text} compact={sessionOpen}/> : assistant ? <RichContent text={message.text}/> : message.text}</BubbleContent>{message.rating ? <BubbleReactions side="bottom" align="end">{message.rating === "up" ? "👍" : "👎"}</BubbleReactions> : null}</Bubble>
          {assistant ? <SupportMaterialsSection materials={message.supportMaterials} className="mt-2" /> : null}
          {assistant ? <LeadershipCards collapsible cards={message.analytics} {...(askQuestion && !readOnlyConversation && !busy ? { onAsk: askQuestion } : {})} /> : null}
          {assistant && message.reportOffer ? <ReportOfferAction offer={message.reportOffer} /> : null}
          <MessageFooter className="gap-1 px-1"><span className="mr-1 font-normal">{message.time}{message.channel === "voice" ? <span className="ml-1 inline-flex items-center gap-0.5" aria-label="Por voz"><Mic className="size-3" aria-hidden/>voz</span> : null}{message.saveState === "failed" ? <span className="ml-1 text-destructive" role="status"> · Não salva no histórico</span> : !assistant ? " · Enviada" : ""}</span>{assistant && !message.localError && !readOnlyConversation && !closedRecord ? <><Button variant="ghost" size="icon-xs" aria-label="Resposta útil" onClick={() => rate(message.id, "up")}><ThumbsUp/></Button><Button variant="ghost" size="icon-xs" aria-label="Resposta não foi útil" onClick={() => rate(message.id, "down")}><ThumbsDown/></Button></> : null}</MessageFooter>
        </MessageContent>
      </Message>
      {message.id === resumeMarkerId ? (
        <div role="separator" aria-label="Você parou aqui" className="flex items-center gap-2 text-[11px] font-medium text-primary dark:text-chart-4" data-testid="feedback-resume-marker">
          <span className="h-px flex-1 bg-primary/30" aria-hidden/>Você parou aqui · continue por texto ou voz<span className="h-px flex-1 bg-primary/30" aria-hidden/>
        </div>
      ) : null}
      </div>
    }) : null}
    {sessionOpen && feedbackCompleted && loadState === "ready" && firstFollowUpIndex === -1 ? <FollowUpSeparator hint/> : null}
    {conversationState === "thinking" && liveAssistantText === null && !sessionOpen ? <TypingBubble align="start" name="INIA" avatarSrc={operator.assistantImage} muted><Skeleton className="h-3 w-32"/></TypingBubble> : null}
    {liveAssistantText !== null ? <TypingBubble align="start" name="INIA" avatarSrc={operator.assistantImage} muted><RichContent text={liveAssistantText}/><span aria-hidden className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-current align-middle"/></TypingBubble> : null}
    {textReplyPending && liveTextReply === null && !sessionOpen ? <TypingBubble align="start" name="INIA" avatarSrc={operator.assistantImage} muted><Skeleton className="h-3 w-32"/></TypingBubble> : null}
    {liveTextReply !== null && !sessionOpen ? <TypingBubble align="start" name="INIA" avatarSrc={operator.assistantImage} muted><RichContent text={liveTextReply}/><span aria-hidden className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-current align-middle"/></TypingBubble> : null}
    {sessionOpen && sessionApplication && loadState === "ready" ? (
      <div className="flex flex-wrap gap-2" data-testid="feedback-suggestions" aria-label="Perguntas sugeridas">
        {suggestions.map((suggestion) => (
          <Button key={suggestion} type="button" size="xs" variant="outline" className="h-auto rounded-full py-1 text-left whitespace-normal" disabled={textReplyPending || conversationState !== "idle"} data-suggestion={suggestion} onClick={askSuggestion}>{suggestion}</Button>
        ))}
        <Button type="button" size="xs" variant="ghost" className="h-auto rounded-full py-1 text-primary dark:text-chart-4" onClick={() => switchToGeneralConversation("CURRENT_RESULTS")}><BarChart3 aria-hidden/>Conversar sobre meus resultados atuais</Button>
      </div>
    ) : null}
    {loadState === "ready" && !readOnlyConversation && !sessionOpen ? <p className="pl-10 text-xs text-muted-foreground">INIA está pronta para ajudar.</p> : null}
  </div>
}

/** "Criar report desta consulta": abre a configuração preenchida com a consulta desta resposta (a recorrência só vale depois de salva). */
export function ReportOfferAction({ offer }: { offer: NonNullable<ChatMessage["reportOffer"]> }) {
  if (offer.status === "DISMISSED" || offer.status === "EXPIRED") return null
  if (offer.reportId) {
    return (
      <Link href={`/reports/${offer.reportId}`} className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
        <FileBarChart2 className="size-3.5" aria-hidden />
        Report criado a partir desta consulta
      </Link>
    )
  }
  return (
    <Link href={`/reports/novo?proposta=${offer.proposalId}`} className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/5">
      <FileBarChart2 className="size-3.5" aria-hidden />
      Criar report desta consulta
    </Link>
  )
}
