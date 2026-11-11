"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import type { InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query"
import { LifeBuoy, SearchX, Star } from "lucide-react"

import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { dateSeparatorLabel, dayKey, lastActivityLabel } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { durationText, type RequestList, type RequestListItem } from "@/schemas/human-support/monitoring.schema"

import { PanelError } from "./panel-error"
import { RequestDetail } from "./request-detail"
import { messagesLabel, OperatorAvatar, RequestStatusLabel, requestOriginOf } from "./request-presentation"

export type RequestsQuery = UseInfiniteQueryResult<InfiniteData<RequestList>, Error>

/**
 * Pedidos › no formato de "Conversas com a INIA": a barra de filtros em cima; a lista à esquerda, agrupada pelo dia em que o pedido foi
 * aberto (mais novos primeiro, "Carregar mais" pelo cursor do servidor); o pedido aberto à direita, como uma conversa. No celular, um de
 * cada vez. O recorte de quem aparece é do servidor (escopo congelado do pedido); a lista não mostra conteúdo da conversa — só ao abrir
 * o pedido, que grava o registro de leitura (LGPD).
 */
export function RequestsTab({ query, filtered, toolbar }: { query: RequestsQuery; filtered: boolean; toolbar: ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  const total = query.data?.pages[0]?.total ?? null

  // No celular o pedido aparece abaixo dos filtros: ao escolher um, a tela vai até ele.
  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId || typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 1023px)").matches) return
    detailRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" })
  }, [selectedId])

  return (
    <div className="space-y-4">
      {toolbar}
      <div className="grid min-h-[34rem] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl border bg-card lg:h-[calc(100dvh-23rem)] lg:grid-cols-[minmax(19rem,25rem)_minmax(0,1fr)]">
        <div className={cn("flex min-h-0 flex-col border-b lg:border-r lg:border-b-0", selectedId ? "hidden lg:flex" : "flex")}>
          {query.isPending ? (
            <div className="space-y-2 p-3" aria-label="Carregando pedidos">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-lg" />)}</div>
          ) : !query.data ? (
            <div className="p-3"><PanelError error={query.error} onRetry={() => void query.refetch()} /></div>
          ) : items.length === 0 ? (
            <div className="p-4">
              <AnalyticsEmptyState icon={filtered ? SearchX : LifeBuoy} title={filtered ? "Nenhum pedido com esses filtros" : "Nenhum pedido no período"} description={filtered ? undefined : "Os pedidos de apoio dos operadores do seu alcance aparecem aqui."} />
            </div>
          ) : (
            <>
              <RequestList items={items} selectedId={selectedId} onSelect={setSelectedId} />
              <ListFooter shown={items.length} total={total} query={query} />
            </>
          )}
        </div>
        <div ref={detailRef} className={cn("min-h-[32rem] min-w-0 scroll-mt-4 lg:min-h-0", selectedId ? "block" : "hidden lg:block")}>
          {selectedId ? (
            <RequestDetail key={selectedId} requestId={selectedId} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-muted"><LifeBuoy className="size-6 text-muted-foreground" aria-hidden /></span>
              <div className="space-y-1">
                <p className="font-medium">Escolha um pedido</p>
                <p className="max-w-sm text-sm text-muted-foreground">A conversa com o Anjo aparece aqui, como o operador viu — com o que ele compartilhou, os horários, a classificação e a avaliação.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Lista agrupada pelo dia em que o pedido foi aberto ("Hoje", "Ontem", data), com o cabeçalho do dia fixo ao rolar. */
function RequestList({ items, selectedId, onSelect }: { items: RequestListItem[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const groups: { key: string; label: string; items: RequestListItem[] }[] = []
  for (const item of items) {
    const key = dayKey(item.createdAt)
    const current = groups.at(-1)
    if (current?.key === key) current.items.push(item)
    else groups.push({ key, label: dateSeparatorLabel(item.createdAt), items: [item] })
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Pedidos">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h2 className="sticky top-0 z-10 border-b bg-card/95 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">{group.label}</h2>
          <ul className="divide-y">
            {group.items.map((item) => <RequestRow key={item.id} item={item} selected={item.id === selectedId} onSelect={() => onSelect(item.id)} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

/** Quem atendeu e em quanto tempo respondeu — sem nada do conteúdo da conversa. */
function anjoText(item: RequestListItem): string {
  if (item.anjoNames.length === 0) return item.status === "WAITING" ? "Aguardando um Anjo" : "Nenhum Anjo atendeu"
  const response = item.firstResponseSeconds !== null ? ` · 1ª resposta em ${durationText(item.firstResponseSeconds)}` : ""
  return `Anjo: ${item.anjoNames.join(", ")}${response}`
}

function RequestRow({ item, selected, onSelect }: { item: RequestListItem; selected: boolean; onSelect: () => void }) {
  const origin = requestOriginOf(item.origin)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="support-request"
        className={cn(
          "relative flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
          selected && "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary hover:bg-primary/10",
        )}
      >
        <OperatorAvatar name={item.operatorName} avatarUrl={item.operatorAvatarUrl} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.operatorName}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{lastActivityLabel(item.createdAt)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-sm">
            <Tooltip>
              <TooltipTrigger asChild><origin.icon className="size-3.5 shrink-0 text-primary" aria-label={origin.label} /></TooltipTrigger>
              <TooltipContent>{origin.label}</TooltipContent>
            </Tooltip>
            <span className="min-w-0 truncate">
              <span className="font-medium tabular-nums">{item.protocol}</span>
              <span className="text-muted-foreground"> · {origin.label}</span>
            </span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">{anjoText(item)}</span>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pt-0.5 text-xs text-muted-foreground">
            <RequestStatusLabel status={item.status} />
            <span className="tabular-nums">{messagesLabel(item.messageCount)}</span>
            {item.stars !== null ? (
              <span className="inline-flex items-center gap-0.5 tabular-nums" aria-label={`${item.stars} de 5 estrelas`}>
                <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
                {item.stars}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Rodapé da coluna da lista: quantos pedidos estão na tela de quantos há e o "Carregar mais" (cursor do servidor). */
function ListFooter({ shown, total, query }: { shown: number; total: number | null; query: RequestsQuery }) {
  if (!query.hasNextPage && !query.isFetchNextPageError) return null
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground tabular-nums">
      <span>{total !== null ? `${shown.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}` : `${shown.toLocaleString("pt-BR")} pedidos`}</span>
      <span className="flex items-center gap-2">
        {query.isFetchNextPageError ? <span className="text-destructive" role="alert">Não foi possível carregar mais.</span> : null}
        <Button type="button" variant="ghost" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
        </Button>
      </span>
    </div>
  )
}
