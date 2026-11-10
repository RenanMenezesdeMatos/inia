"use client"

import { useEffect, useRef, type ReactNode } from "react"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import type { MessageView, Receipts } from "@/schemas/human-support/state.schema"

import { MessageReceipt } from "../conversation/message-receipt"
import { receiptStatus } from "../conversation/receipts"

/**
 * CONVERSA DO APOIO VISTA PELO ANJO, com os componentes de chat do kit (`Message`/`Bubble`): três autores — operador (à esquerda),
 * Anjo (à direita; "Você" nas mensagens deste atendimento, com os tiques de entregue e lido) e sistema (selo centralizado, texto já
 * montado pelo servidor para quem lê). Mensagem humana é texto puro, com as quebras de linha da pessoa; nada vira HTML. Uma mensagem
 * de Anjo anterior ao início deste atendimento (pedido interrompido e reatribuído) aparece com o nome de quem escreveu e sem tiques.
 * `after` (ex.: "digitando…") entra depois da última mensagem.
 */
export type SupportMessageListProps = {
  messages: MessageView[]
  operatorName: string
  /** Início deste atendimento: mensagens de Anjo a partir daqui são da pessoa que está vendo. */
  attendanceStartedAt: string
  /** Até onde o operador recebeu e viu (tiques das mensagens deste Anjo). Ausente = sem tiques (histórico). */
  peerReceipts?: Receipts
  after?: ReactNode
  /** Rola de novo para o fim quando isto muda (ex.: o "digitando" apareceu). */
  scrollKey?: unknown
  className?: string
}

export function SupportMessageList({ messages, operatorName, attendanceStartedAt, peerReceipts, after, scrollKey, className }: SupportMessageListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const lastSeq = messages.at(-1)?.seq ?? 0
  useEffect(() => {
    // Rolagem feita pelo código (mensagem chegando), só dentro da lista — a página não pula e não é interação da pessoa.
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [lastSeq, scrollKey])
  const startedAt = new Date(attendanceStartedAt).getTime()

  return (
    <div ref={listRef} role="log" aria-label="Mensagens do atendimento" aria-live="polite" className={cn("flex min-h-40 flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-muted/40 p-4", className)}>
      {messages.length === 0 && !after ? <p className="m-auto text-sm text-muted-foreground">Nenhuma mensagem ainda.</p> : null}
      {messages.map((message) => {
        const time = formatShortDateTime(message.occurredAt)
        if (message.authorKind === "SYSTEM") {
          return (
            <p key={message.id} className="mx-auto w-fit max-w-[90%] rounded-full border border-border bg-card px-3 py-1 text-center text-xs text-muted-foreground" data-author="system">
              {message.body}
              {time ? <span className="ml-1 tabular-nums">· {time}</span> : null}
            </p>
          )
        }
        const anjo = message.authorKind === "ANJO"
        const mine = anjo && new Date(message.occurredAt).getTime() >= startedAt
        const author = !anjo ? (message.authorName ?? operatorName) : mine ? "Você" : `${message.authorName ?? "Anjo"} · Anjo`
        return (
          <Message key={message.id} align={anjo ? "end" : "start"} data-author={anjo ? "anjo" : "operator"} data-seq={message.seq}>
            <MessageContent className="max-w-[85%]">
              <MessageHeader className="px-1">
                <span className="font-medium text-foreground">{author}</span>
              </MessageHeader>
              <Bubble variant={mine ? "default" : anjo ? "tinted" : "outline"} align={anjo ? "end" : "start"} className="max-w-full">
                <BubbleContent className={cn("whitespace-pre-wrap shadow-xs", !anjo && "border-border bg-card")}>{message.body}</BubbleContent>
              </Bubble>
              <MessageFooter className="gap-1 px-1 font-normal">
                {time ? <span className="tabular-nums">{time}</span> : null}
                {mine && peerReceipts ? <MessageReceipt status={receiptStatus(message.seq, peerReceipts)} /> : null}
              </MessageFooter>
            </MessageContent>
          </Message>
        )
      })}
      {after}
    </div>
  )
}
