"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, CheckCircle2, Clock, MessagesSquare, ShieldCheck, type LucideIcon } from "lucide-react"
import { PersonAvatar } from "@/components/profile/person-avatar"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatClockTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useReadAcknowledgement } from "@/queries/human-support/receipt-acks"
import { useHumanSupportState } from "@/queries/human-support/use-human-support-state"
import { useTypingSignal } from "@/queries/human-support/use-typing-signal"
import { SUPPORT_ROOM_NOTICE } from "@/schemas/human-support/catalogs.schema"
import { AVAILABILITY_TEXT, waitEstimateText, type MessageView, type OperatorRequestView, type Receipts } from "@/schemas/human-support/state.schema"
import { cancelSupportRequest, closeSupportRequestAsOperator, fetchSupportMessages, sendSupportMessage } from "@/services/human-support/human-support-service"
import { toneSurface, type Tone } from "@/components/ui/surface"
import { MessageReceipt } from "../conversation/message-receipt"
import { PeerTyping } from "../conversation/peer-typing"
import { lastSeqOf, receiptStatus } from "../conversation/receipts"
import { SharedContextCard } from "./shared-context-card"
import { awaitingEvaluation } from "./support-entry"
import { SupportComposer } from "./support-composer"
import { SupportEvaluation } from "./support-evaluation"

/**
 * SALA DE APOIO do operador (design_draft.md seções 10 e 14): a conversa com o Anjo, num campo próprio, sem microfone — nunca
 * passa pelo envio do chat da INIA, pela voz ou por qualquer caminho de modelo. Lê o pedido do estado do apoio (um provedor no
 * shell); quando o pedido termina, mostra o fim da conversa e a avaliação (enquanto a janela de 24 h estiver aberta).
 * Como num aplicativo de mensagens (migration 184): "Fulano está digitando…" quando o Anjo escreve, tiques de entregue e lido nas
 * mensagens do operador, e as mensagens do Anjo confirmadas como lidas enquanto a sala está na tela com a janela em foco (o
 * entregue sai do provedor do estado, ao receber).
 */
const mergeMessages = (current: MessageView[], incoming: MessageView[]) => {
  const bySeq = new Map(current.map((message) => [message.seq, message]))
  for (const message of incoming) bySeq.set(message.seq, message)
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}

export function statusLine(request: OperatorRequestView, ended: boolean): string {
  if (ended || (request.status !== "WAITING" && request.status !== "IN_PROGRESS")) return "Atendimento encerrado"
  if (request.status === "WAITING") return "Procurando um Anjo…"
  if (request.anjo?.awaitingFirstResponse) return `${request.anjo.name} (Anjo) recebeu seu pedido. Aguardando a primeira resposta.`
  return `Em atendimento com ${request.anjo?.name ?? "o Anjo"}`
}

export function SupportRoom({ onBack }: { onBack: () => void }) {
  const { operator, reconnecting, refresh, applyOperator } = useHumanSupportState()
  const open = operator?.openRequest ?? null
  // O pedido aberto do estado é a fonte. Quando ele some (terminou), a sala fica no último pedido mostrado e busca o fim da conversa.
  const [previousOpen, setPreviousOpen] = useState(open)
  const [endedRequest, setEndedRequest] = useState<OperatorRequestView | null>(null)
  if (open !== previousOpen) {
    setPreviousOpen(open)
    setEndedRequest(open ? null : (previousOpen ?? endedRequest))
  }
  const [updated, setUpdated] = useState<OperatorRequestView | null>(null)
  const base = open ?? endedRequest
  const shown = updated && base && updated.id === base.id && !open ? updated : base
  const ended = !open && shown !== null
  const [extra, setExtra] = useState<{ requestId: string; messages: MessageView[]; olderDone: boolean } | null>(null)
  const extraFor = shown && extra?.requestId === shown.id ? extra : null
  const messages = useMemo(() => mergeMessages(extraFor?.messages ?? [], shown?.messages ?? []), [extraFor, shown])
  const hasOlder = Boolean(shown?.hasOlder) && !extraFor?.olderDone
  const [actionError, setActionError] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const liveId = shown && !ended && (shown.status === "WAITING" || shown.status === "IN_PROGRESS") ? shown.id : null
  const typing = useTypingSignal(liveId && shown?.status === "IN_PROGRESS" ? liveId : null)
  useReadAcknowledgement(liveId, lastSeqOf(messages), liveId !== null)
  const typingKey = liveId && shown?.peerTypingMs != null ? shown : null
  const addMessages = (requestId: string, incoming: MessageView[], olderDone?: boolean) =>
    setExtra((current) => {
      const same = current?.requestId === requestId ? current : { requestId, messages: [], olderDone: false }
      return { requestId, messages: mergeMessages(same.messages, incoming), olderDone: olderDone ?? same.olderDone }
    })

  const endedId = ended ? shown.id : null
  useEffect(() => {
    if (!endedId) return
    void fetchSupportMessages(endedId)
      .then((page) => addMessages(endedId, page.messages))
      .catch(() => undefined)
  }, [endedId])

  useEffect(() => {
    // Só a área das mensagens rola: `scrollIntoView` também rolaria a página e tiraria o campo de texto da tela.
    const viewport = bottomRef.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (viewport) viewport.scrollTop = viewport.scrollHeight
  }, [messages.length, typingKey])

  const pending = useMemo(() => (shown ? (operator?.pendingEvaluations.find((evaluation) => evaluation.requestId === shown.id) ?? null) : null), [operator, shown])

  if (!shown) {
    // Aberta pelo selo "avalie" depois de recarregar a página: a sala não tem o pedido em memória, mas as avaliações sem resposta
    // vêm no estado do apoio — mostra cada uma (alterável até o fim da janela de 24 h).
    const awaiting = operator?.pendingEvaluations.filter(awaitingEvaluation) ?? []
    if (awaiting.length > 0) {
      return (
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Avaliar o atendimento" data-testid="support-room">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Button type="button" variant="ghost" size="sm" className="-ml-2 h-8 shrink-0 rounded-full px-2.5" aria-label="Voltar para a INIA" onClick={onBack}>
              <ArrowLeft />
              <span className="hidden sm:inline">Voltar</span>
            </Button>
            <h3 className="truncate text-sm font-semibold">Avaliar o atendimento</h3>
          </div>
          <ScrollArea className="min-h-0 flex-1 bg-muted/30">
            <div className="space-y-4 px-4 py-3">
              {awaiting.map((evaluation) => (
                <div key={evaluation.attendanceId} className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Atendimento <span className="font-mono">{evaluation.protocol}</span> com {evaluation.anjoName}
                  </p>
                  <SupportEvaluation pending={evaluation} onSaved={() => refresh()} />
                </div>
              ))}
            </div>
          </ScrollArea>
        </section>
      )
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <p className="text-muted-foreground">Você não tem um pedido de apoio aberto.</p>
        <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onBack}><ArrowLeft />Voltar para a INIA</Button>
      </div>
    )
  }

  const live = !ended && (shown.status === "WAITING" || shown.status === "IN_PROGRESS")
  const queued = live && shown.status === "WAITING"
  const availability = queued ? (operator?.availability ?? null) : null
  const estimate = availability && availability.status !== "AVAILABLE_NOW" ? waitEstimateText(availability.estimate) : null

  const act = async (kind: "cancel" | "close") => {
    setActing(true)
    setActionError(null)
    try {
      const result = kind === "cancel" ? await cancelSupportRequest(shown.id) : await closeSupportRequestAsOperator(shown.id)
      setUpdated(result)
      addMessages(result.id, result.messages)
      if (operator) applyOperator({ ...operator, openRequest: result.status === "WAITING" || result.status === "IN_PROGRESS" ? result : null })
      refresh()
    } catch (failure) {
      setActionError(failure instanceof Error && failure.message ? failure.message : "Não foi possível concluir. Tente de novo.")
      refresh()
    } finally {
      setActing(false)
    }
  }

  const loadOlder = async () => {
    const first = messages[0]?.seq
    if (!first) return
    const page = await fetchSupportMessages(shown.id, { before: first }).catch(() => null)
    if (page) addMessages(shown.id, page.messages, !page.hasMore)
  }

  const look = roomLook(shown, ended)
  const StatusIcon = look.icon
  const action = live ? (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 rounded-full px-3 text-xs" disabled={acting}>{shown.canCancel ? "Cancelar pedido" : "Encerrar atendimento"}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown.canCancel ? "Cancelar o pedido de apoio?" : "Encerrar o atendimento?"}</AlertDialogTitle>
          <AlertDialogDescription>{shown.canCancel ? "O pedido sai da fila. Se precisar, você pode pedir de novo." : "A conversa com o Anjo termina. Um atendimento encerrado não é reaberto."}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction onClick={() => void act(shown.canCancel ? "cancel" : "close")}>{shown.canCancel ? "Cancelar pedido" : "Encerrar atendimento"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Apoio com Anjo" data-testid="support-room">
      <div className="space-y-2.5 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 h-8 shrink-0 rounded-full px-2.5" aria-label="Voltar para a INIA" onClick={onBack}>
            <ArrowLeft />
            <span className="hidden sm:inline">Voltar</span>
          </Button>
          <div className="min-w-0 flex-1 leading-tight">
            <h3 className="truncate text-sm font-semibold">Apoio com Anjo</h3>
            <p className="truncate font-mono text-xs text-muted-foreground">{shown.protocol}</p>
          </div>
          {action}
        </div>
        <div className={cn(toneSurface(look.tone), "flex items-start gap-2.5 px-3 py-2 text-sm")} role="status" aria-live="polite">
          <StatusIcon className={cn("mt-0.5 size-4 shrink-0", look.iconClass)} aria-hidden />
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">{statusLine(shown, ended)}</p>
            {queued && availability ? <p className="text-muted-foreground">{AVAILABILITY_TEXT[availability.status]}</p> : null}
            {estimate ? <p className="text-muted-foreground">{estimate.headline}</p> : null}
            {queued && shown.queueExpiresAt ? <p className="text-muted-foreground">Seu pedido fica na fila até {formatClockTime(shown.queueExpiresAt)}.</p> : null}
            {reconnecting ? <p className="text-xs text-amber-700 dark:text-amber-300">Reconectando…</p> : null}
          </div>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1 bg-muted/30">
        <div className="space-y-3 px-4 py-3">
          <SharedContextCard context={shown.sharedContext} title="O que você compartilhou" collapsible className="bg-card" />
          {hasOlder ? (
            <div className="text-center"><Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => void loadOlder()}>Carregar mensagens anteriores</Button></div>
          ) : null}
          {messages.map((message) => <SupportMessage key={message.id} message={message} anjoAvatarUrl={shown.anjo?.avatarUrl ?? null} peerReceipts={shown.peerReceipts} />)}
          {live && shown.anjo ? <PeerTyping name={shown.anjo.name} typingMs={shown.peerTypingMs} stamp={shown} avatar={<PersonAvatar name={shown.anjo.name} avatarUrl={shown.anjo.avatarUrl} className="size-7" />} /> : null}
          {pending && !live ? <SupportEvaluation pending={pending} onSaved={() => refresh()} /> : null}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <div className="border-t border-border bg-card">
        {actionError ? <p role="alert" className="px-4 pt-2 text-xs text-destructive">{actionError}</p> : null}
        {live ? (
          <SupportComposer
            placeholder="Mensagem para o Anjo"
            hint={queued ? "O Anjo verá quando receber o pedido." : null}
            onInput={typing.onInput}
            onSend={async (body) => {
              const message = await sendSupportMessage(shown.id, { clientMessageId: crypto.randomUUID(), body })
              typing.onSent()
              addMessages(shown.id, [message])
            }}
          />
        ) : (
          <p className="px-4 pt-3 text-sm text-muted-foreground">Este atendimento terminou. Se precisar, peça ajuda de novo pela INIA.</p>
        )}
        <p className="flex items-center gap-1.5 px-4 pb-3 text-xs text-muted-foreground"><ShieldCheck className="size-3.5 shrink-0" aria-hidden />{SUPPORT_ROOM_NOTICE}</p>
      </div>
    </section>
  )
}

/** Tom e ícone do estado da sala: na fila (âmbar), em atendimento (verde), aguardando a primeira resposta (primária), encerrado (neutro). */
function roomLook(request: OperatorRequestView, ended: boolean): { tone: Tone; icon: LucideIcon; iconClass: string } {
  if (ended || (request.status !== "WAITING" && request.status !== "IN_PROGRESS")) return { tone: "neutral", icon: CheckCircle2, iconClass: "text-muted-foreground" }
  if (request.status === "WAITING") return { tone: "warning", icon: Clock, iconClass: "text-amber-700 dark:text-amber-300" }
  if (request.anjo?.awaitingFirstResponse) return { tone: "info", icon: Clock, iconClass: "text-primary" }
  return { tone: "success", icon: MessagesSquare, iconClass: "text-emerald-700 dark:text-emerald-300" }
}

function SupportMessage({ message, anjoAvatarUrl, peerReceipts }: { message: MessageView; anjoAvatarUrl: string | null; peerReceipts: Receipts }) {
  const time = formatClockTime(message.occurredAt)
  if (message.authorKind === "SYSTEM") {
    return (
      <p className="mx-auto w-fit max-w-[90%] rounded-full border border-border bg-card px-3 py-1 text-center text-xs text-muted-foreground" data-author="system">
        {message.body} · {time}
      </p>
    )
  }
  const mine = message.authorKind === "OPERATOR"
  const name = message.authorName ?? "Anjo"
  return (
    <Message align={mine ? "end" : "start"} data-author={mine ? "operator" : "anjo"} data-seq={message.seq}>
      {!mine ? (
        <MessageAvatar>
          <PersonAvatar name={name} avatarUrl={anjoAvatarUrl} className="size-7" />
        </MessageAvatar>
      ) : null}
      <MessageContent className="max-w-[85%]">
        {!mine ? (
          <MessageHeader className="gap-1.5 px-1">
            {name}
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">Anjo</Badge>
          </MessageHeader>
        ) : null}
        <Bubble variant={mine ? "default" : "outline"} align={mine ? "end" : "start"} className="max-w-full">
          <BubbleContent className={cn("whitespace-pre-wrap shadow-xs", !mine && "border-border bg-card")}>{message.body}</BubbleContent>
        </Bubble>
        <MessageFooter className="gap-1 px-1 font-normal">
          <span className="tabular-nums">{time}</span>
          {mine ? <MessageReceipt status={receiptStatus(message.seq, peerReceipts)} /> : null}
        </MessageFooter>
      </MessageContent>
    </Message>
  )
}
