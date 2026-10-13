"use client"

import { Bot } from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Message, MessageAvatar, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { OperatorDateFilter } from "./operator-date-filter"

export function IniaFeed({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="flex h-full min-h-0 flex-col bg-card"><header className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-semibold">{title}</h2><p className="text-sm text-muted-foreground">{description}</p></div><OperatorDateFilter defaultMode="today"/></header><Separator/><ScrollArea className="min-h-0 flex-1"><div className="px-5 py-2">{children}</div></ScrollArea></section>
}

/**
 * Um item do feed da INIA. A linha do autor ("INIA · data") tem a altura do avatar, então nome e data ficam centralizados
 * com a foto; à direita dela fica o `meta` do item (ex.: quando o atendimento aconteceu). O conteúdo começa na mesma coluna
 * do nome (as ações de um feedback ficam no topo do cartão dele).
 * `recipient` (só no Acompanhamento da estrutura) diz de quem é o item ("para Larissa Monteiro"), logo depois da data.
 * `footer` (ex.: "Este conteúdo foi útil?") só existe onde a ação é real — nada de botão só de tela.
 */
export function IniaFeedItem({ timestamp, recipient, meta, footer, children }: { timestamp: string; recipient?: React.ReactNode; meta?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Message align="start" className="gap-3 py-5">
      <MessageAvatar className="self-start bg-transparent group-has-data-[slot=message-footer]/message:translate-y-0">
        <Avatar className="size-9">
          <AvatarImage src="/INIA.png" alt="INIA" />
          <AvatarFallback className="bg-primary text-primary-foreground"><Bot className="size-4" /></AvatarFallback>
        </Avatar>
      </MessageAvatar>
      <MessageContent className="w-full max-w-none gap-3">
        {/* Altura do avatar; no celular o `meta` desce para uma segunda linha em vez de ser cortado. */}
        <MessageHeader className="min-h-9 flex-wrap gap-x-1.5 gap-y-0.5 px-0">
          <strong className="font-heading text-sm text-primary dark:text-chart-4">INIA</strong>
          <span aria-hidden className="text-muted-foreground/50">·</span>
          <span className="shrink-0 font-normal tabular-nums">{timestamp}</span>
          {recipient ? <><span aria-hidden className="text-muted-foreground/50">·</span><span className="min-w-0 truncate font-normal" data-slot="feed-item-recipient">{recipient}</span></> : null}
          {meta ? <div className="flex min-w-0 items-center max-sm:basis-full sm:ml-auto sm:pl-3">{meta}</div> : null}
        </MessageHeader>
        {/* No celular o conteúdo usa a largura inteira (passa sob a coluna do avatar); do sm para cima, alinha com o nome. */}
        <div className="flex min-w-0 flex-col gap-3 max-sm:-ml-12">
          {children}
          {footer ? <MessageFooter className="px-0 font-normal">{footer}</MessageFooter> : null}
        </div>
      </MessageContent>
    </Message>
  )
}
