"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowDown, ArrowLeft, Bot, Lock, Mic } from "lucide-react"

import { SupportMaterialsSection } from "@/components/feedbacks/support-materials-section"
import { LeadershipCards } from "@/components/leadership/leadership-cards"
import { ClarificationAudit } from "@/components/knowledge-clarification/clarification-audit"
import { parseClarification } from "@/schemas/knowledge-clarification/clarification.schema"
import { RichContent } from "@/components/rich-content/rich-content"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/api-client"
import { formatShortDateTime } from "@/lib/format/date"
import { dateSeparatorLabel, dayKey, messageTime } from "@/lib/realtime/conversation-format"
import type { ConversationMessage } from "@/lib/realtime/gemini-text-client"
import { parseLeadershipCards } from "@/schemas/leadership/leadership.schema"
import { fetchMonitoredMessages, type MonitoredConversation } from "@/services/admin/assistant-conversations-service"

import { ConversationStatus, conversationKindOf, conversationTitleOf, messagesLabel, OwnerAvatar } from "./conversation-presentation"

const PAGE_LIMIT = 30
/** Conversa em andamento: busca mensagens NOVAS (depois da última) nesse intervalo. */
export const THREAD_POLL_INTERVAL_MS = 10_000
const NEAR_BOTTOM_PX = 80
/** Marca das mensagens que não nasceram de uma pergunta do colaborador. */
const MESSAGE_ORIGIN_LABELS: Record<string, string> = { FEEDBACK: "Apresentação do feedback", WORKFLOW: "Recado enviado por um fluxo" }

/**
 * Leitura de UMA conversa, como num aplicativo de mensagens: colaborador × INIA, nomes, horários, separadores de data e
 * ordem cronológica estável. Somente leitura. Montado com `key = conversationId` (trocar de conversa recomeça do zero).
 * Mensagens novas chegam por polling SEM deslocar quem está lendo mensagens antigas (aviso "novas mensagens").
 */
export function ConversationThread({ conversationId, onBack }: { conversationId: string; onBack?: () => void }) {
  const [conversation, setConversation] = useState<MonitoredConversation | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState<unknown>(null)
  const [olderCursor, setOlderCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState(false)
  const [unseen, setUnseen] = useState(0)
  const [reload, setReload] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Ajuste de rolagem pendente depois do próximo render: ir ao fim, ou manter a posição ao inserir mensagens acima.
  const pendingScrollRef = useRef<{ kind: "bottom" } | { kind: "anchor"; height: number; top: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMonitoredMessages(conversationId, { limit: PAGE_LIMIT })
      .then((page) => {
        if (cancelled) return
        pendingScrollRef.current = { kind: "bottom" }
        setConversation(page.conversation)
        setMessages(page.messages)
        setOlderCursor(page.hasMore ? (page.messages[0]?.cursor ?? null) : null)
        setStatus("ready")
      })
      .catch((caught: unknown) => {
        if (cancelled) return
        setError(caught)
        setStatus("error")
      })
    return () => { cancelled = true }
  }, [conversationId, reload])

  // Conversa em andamento: mensagens novas por polling (só depois da última já exibida).
  const lastCursor = messages.at(-1)?.cursor ?? null
  const polling = status === "ready" && conversation?.status === "ACTIVE" && lastCursor !== null
  useEffect(() => {
    if (!polling || !lastCursor) return
    const timer = setInterval(() => {
      fetchMonitoredMessages(conversationId, { after: lastCursor, limit: 100 })
        .then((page) => {
          setConversation(page.conversation)
          if (page.messages.length === 0) return
          const element = scrollRef.current
          const nearBottom = !element || element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX
          if (nearBottom) pendingScrollRef.current = { kind: "bottom" }
          else setUnseen((count) => count + page.messages.length)
          setMessages((current) => [...current, ...page.messages.filter((message) => !current.some((existing) => existing.id === message.id))])
        })
        .catch(() => {
          // Falha pontual de atualização: a conversa já exibida continua válida; tenta de novo no próximo ciclo.
        })
    }, THREAD_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [polling, lastCursor, conversationId])

  useLayoutEffect(() => {
    const pending = pendingScrollRef.current
    const element = scrollRef.current
    if (!pending || !element) return
    pendingScrollRef.current = null
    element.scrollTop = pending.kind === "bottom" ? element.scrollHeight : element.scrollHeight - pending.height + pending.top
  }, [messages])

  async function loadOlder() {
    if (!olderCursor) return
    setLoadingOlder(true)
    setOlderError(false)
    try {
      const page = await fetchMonitoredMessages(conversationId, { before: olderCursor, limit: PAGE_LIMIT })
      const element = scrollRef.current
      if (element) pendingScrollRef.current = { kind: "anchor", height: element.scrollHeight, top: element.scrollTop }
      setMessages((current) => [...page.messages, ...current])
      setOlderCursor(page.hasMore ? (page.messages[0]?.cursor ?? null) : null)
    } catch {
      setOlderError(true)
    } finally {
      setLoadingOlder(false)
    }
  }

  function jumpToLatest() {
    setUnseen(0)
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }

  if (status === "loading") {
    return (
      <div className="space-y-4 p-4" aria-label="Carregando conversa">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-14 w-3/4 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-2/3 rounded-2xl" />
      </div>
    )
  }
  if (status === "error") {
    const denied = error instanceof ApiError && (error.status === 403 || error.status === 404)
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center" role="alert">
        {denied ? <Lock className="size-8 text-muted-foreground/60" aria-hidden /> : null}
        <p className={denied ? "font-medium" : "text-sm text-destructive"}>{denied ? "Conversa indisponível" : "Não foi possível carregar esta conversa."}</p>
        {denied ? <p className="max-w-sm text-sm text-muted-foreground">Ela não existe ou está fora do seu escopo de acesso.</p> : <Button variant="outline" size="sm" onClick={() => { setStatus("loading"); setReload((value) => value + 1) }}>Tentar novamente</Button>}
        {onBack ? <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft />Voltar à lista</Button> : null}
      </div>
    )
  }

  const current = conversation!
  const owner = current.owner
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ThreadHeader conversation={current} onBack={onBack} />
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto bg-muted/20 px-4 py-5"
          aria-label="Mensagens da conversa"
          onScroll={(event) => {
            const element = event.currentTarget
            if (unseen > 0 && element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX) setUnseen(0)
          }}
        >
          <div className="mx-auto max-w-3xl space-y-5">
            {olderCursor ? (
              <div className="text-center">
                <Button variant="ghost" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>{loadingOlder ? "Carregando…" : "Carregar mensagens anteriores"}</Button>
                {olderError ? <p className="mt-1 text-xs text-destructive" role="alert">Não foi possível carregar as mensagens anteriores.</p> : null}
              </div>
            ) : null}
            {messages.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Esta conversa não tem mensagens.</p> : null}
            {messages.map((message, index) => {
              const assistant = message.role === "assistant"
              const separator = index === 0 || dayKey(messages[index - 1]!.occurredAt) !== dayKey(message.occurredAt)
              const originLabel = message.origin ? MESSAGE_ORIGIN_LABELS[message.origin] : undefined
              const clarification = assistant ? parseClarification(message.clarification) : null
              return (
                <div key={message.id} className="space-y-5">
                  {separator ? <div className="flex justify-center" role="separator" aria-label={dateSeparatorLabel(message.occurredAt)}><span className="rounded-full bg-background px-3 py-0.5 text-[11px] font-medium text-muted-foreground shadow-xs">{dateSeparatorLabel(message.occurredAt)}</span></div> : null}
                  <Message align={assistant ? "start" : "end"} data-testid="monitored-message" data-role={message.role}>
                    <MessageAvatar>{assistant ? <Avatar className="size-8"><AvatarFallback className="bg-primary text-primary-foreground"><Bot className="size-4" /></AvatarFallback></Avatar> : <OwnerAvatar owner={owner} className="size-8" />}</MessageAvatar>
                    <MessageContent className="max-w-[85%]">
                      <MessageHeader className="px-1">{assistant ? "INIA" : owner.name}{originLabel ? <span className="ml-1.5 font-normal text-muted-foreground">· {originLabel}</span> : null}</MessageHeader>
                      <Bubble variant={assistant ? "muted" : "default"} className="max-w-full"><BubbleContent className="space-y-2 px-4 py-3">{assistant ? <RichContent text={message.content} /> : <span className="whitespace-pre-wrap">{message.content}</span>}</BubbleContent></Bubble>
                      {assistant ? <SupportMaterialsSection materials={message.supportMaterials} className="mt-2" /> : null}
                      {/* Cartões de dados que a pessoa viu (liderança): recolhidos e só de leitura — auditoria do que a resposta afirmou. */}
                      {assistant ? <LeadershipCards collapsible readOnly cards={parseLeadershipCards(message.analytics)} /> : null}
                      {/* Esclarecimento pelas bases: trilha completa (opções com a fonte de cada uma, fontes numeradas como no texto). */}
                      {clarification ? <ClarificationAudit view={clarification} /> : null}
                      <MessageFooter className="gap-1 px-1">
                        <time dateTime={message.occurredAt}>{messageTime(message.occurredAt)}</time>
                        {message.channel === "voice" ? <span className="inline-flex items-center gap-0.5" aria-label="Enviada por voz"><Mic className="size-3" aria-hidden />voz</span> : null}
                      </MessageFooter>
                    </MessageContent>
                  </Message>
                </div>
              )
            })}
          </div>
        </div>
        {unseen > 0 ? (
          <Button size="sm" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-md" onClick={jumpToLatest}>
            <ArrowDown />{unseen === 1 ? "1 nova mensagem" : `${unseen} novas mensagens`}
          </Button>
        ) : null}
      </div>
      <p className="flex items-center justify-center gap-1.5 border-t px-4 py-2 text-center text-[11px] text-muted-foreground"><Lock className="size-3" aria-hidden />Somente leitura — a gestão não envia mensagens nem edita o histórico.</p>
    </div>
  )
}

/** Cabeçalho da conversa: o tipo e o assunto, quem conversou (cargo e equipe), quando começou e quantas mensagens houve. */
function ThreadHeader({ conversation, onBack }: { conversation: MonitoredConversation; onBack: (() => void) | undefined }) {
  const { owner } = conversation
  const kind = conversationKindOf(conversation)
  const voice = conversation.voiceMessageCount ?? 0
  const where = [owner.jobTitle, [owner.teamName, owner.subteamName].filter(Boolean).join(" › ")].filter(Boolean).join(" · ")
  return (
    <header className="space-y-3 border-b px-5 py-4">
      <div className="flex items-start gap-3">
        {onBack ? <Button variant="ghost" size="icon" className="-ml-2 lg:hidden" onClick={onBack} aria-label="Voltar à lista"><ArrowLeft /></Button> : null}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-primary"><kind.icon className="size-3.5" aria-hidden />{kind.label}</p>
            <ConversationStatus conversation={conversation} />
          </div>
          <h2 className="line-clamp-2 text-lg leading-snug font-semibold">{conversationTitleOf(conversation)}</h2>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-2">
          <OwnerAvatar owner={owner} className="size-6 text-[10px]" />
          <span className="min-w-0 truncate"><span className="font-medium text-foreground">{owner.name}</span>{where ? ` · ${where}` : ""}</span>
        </span>
        {conversation.kind !== "LEGACY_HISTORY" ? <span>Iniciada em {formatShortDateTime(conversation.startedAt)}</span> : null}
        <span className="tabular-nums">{messagesLabel(conversation.messageCount)}{voice > 0 ? ` · ${voice} por voz` : ""}</span>
      </div>
    </header>
  )
}
