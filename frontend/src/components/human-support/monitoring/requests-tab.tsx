"use client"

import { useState } from "react"
import { Inbox, LifeBuoy, SearchX } from "lucide-react"

import { ListSelectFilter, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useSupportRequestsQuery } from "@/queries/human-support/use-human-support-admin"
import { REQUEST_ORIGIN_LABELS, REQUEST_STATUS_LABELS, type RequestOrigin, type RequestStatus } from "@/schemas/human-support/catalogs.schema"
import { durationText, type RequestListItem } from "@/schemas/human-support/monitoring.schema"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import { PanelError } from "./panel-error"
import { RequestDetail } from "./request-detail"

type ListFilter = PanelFilter & { status?: RequestStatus | undefined; origin?: RequestOrigin | undefined }

/**
 * Pedidos › lista do período (mais novos primeiro, "Carregar mais" pelo cursor do servidor) com filtros de estado e origem; escolher um
 * pedido abre o detalhe ao lado (no celular, no lugar da lista). O recorte de quem aparece é do servidor (escopo congelado do pedido).
 */
export function RequestsTab({ filter }: { filter: PanelFilter }) {
  const [status, setStatus] = useState<RequestStatus | undefined>(undefined)
  const [origin, setOrigin] = useState<RequestOrigin | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const listFilter: ListFilter = { ...filter, status, origin }
  const filtered = status !== undefined || origin !== undefined

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Filtros dos pedidos" className="flex flex-wrap items-center gap-2">
        <ListSelectFilter value={status} onChange={setStatus} options={optionsFromLabels(REQUEST_STATUS_LABELS)} allLabel="Todos os estados" ariaLabel="Filtrar por estado" />
        <ListSelectFilter value={origin} onChange={setOrigin} options={optionsFromLabels(REQUEST_ORIGIN_LABELS)} allLabel="Todas as origens" ariaLabel="Filtrar por origem" />
        {filtered ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setStatus(undefined); setOrigin(undefined) }}>
            Limpar filtros
          </Button>
        ) : null}
      </div>

      <div className="grid min-h-[30rem] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-border bg-card shadow-xs lg:h-[calc(100dvh-22rem)] lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
        <div className={cn("min-h-0 overflow-y-auto border-b lg:border-r lg:border-b-0", selectedId ? "hidden lg:block" : "block")}>
          {/* A chave remonta a lista (volta à primeira página) quando o período ou um filtro muda. */}
          <RequestList key={JSON.stringify(listFilter)} filter={listFilter} filtered={filtered} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        <div className={cn("min-h-[28rem] min-w-0 lg:min-h-0", selectedId ? "block" : "hidden lg:block")}>
          {selectedId ? (
            <RequestDetail key={selectedId} requestId={selectedId} onBack={() => setSelectedId(null)} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
              <LifeBuoy className="size-8 text-muted-foreground/60" aria-hidden />
              <p className="font-medium">Escolha um pedido</p>
              <p className="max-w-sm text-sm text-muted-foreground">O detalhe mostra o que o operador compartilhou, a conversa com o Anjo, a classificação e a avaliação.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RequestList({ filter, filtered, selectedId, onSelect }: { filter: ListFilter; filtered: boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  return (
    <ul className="divide-y" aria-label="Pedidos">
      {cursors.map((cursor, index) => (
        <RequestPage key={cursor ?? "first"} filter={filter} cursor={cursor} first={index === 0} last={index === cursors.length - 1} filtered={filtered} selectedId={selectedId} onSelect={onSelect} onMore={(next) => setCursors((current) => [...current, next])} />
      ))}
    </ul>
  )
}

function RequestPage(props: { filter: ListFilter; cursor: string | null; first: boolean; last: boolean; filtered: boolean; selectedId: string | null; onSelect: (id: string) => void; onMore: (cursor: string) => void }) {
  const query = useSupportRequestsQuery({ ...props.filter, cursor: props.cursor })
  if (query.isPending) return <li className="space-y-2 p-3" aria-label="Carregando pedidos">{Array.from({ length: props.first ? 5 : 2 }).map((_, index) => <Skeleton key={index} className="h-16 w-full rounded-lg" />)}</li>
  if (query.isError) return <li className="p-3"><PanelError error={query.error} onRetry={() => void query.refetch()} /></li>
  if (props.first && query.data.items.length === 0) {
    return (
      <li className="p-4">
        <AnalyticsEmptyState icon={props.filtered ? SearchX : Inbox} title={props.filtered ? "Nenhum pedido com esses filtros" : "Nenhum pedido no período"} description={props.filtered ? undefined : "Os pedidos de apoio dos operadores do seu alcance aparecem aqui."} />
      </li>
    )
  }
  return (
    <>
      {query.data.items.map((item) => <RequestRow key={item.id} item={item} selected={item.id === props.selectedId} onSelect={() => props.onSelect(item.id)} />)}
      {props.last && query.data.nextCursor ? (
        <li className="p-3 text-center">
          <Button type="button" variant="outline" size="sm" onClick={() => props.onMore(query.data.nextCursor!)}>
            Carregar mais
          </Button>
        </li>
      ) : null}
    </>
  )
}

function RequestRow({ item, selected, onSelect }: { item: RequestListItem; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="support-request"
        className={cn(
          "relative flex w-full flex-col gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
          selected && "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary hover:bg-primary/10",
        )}
      >
        <span className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tabular-nums">{item.protocol}</span>
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{REQUEST_STATUS_LABELS[item.status]}</Badge>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{formatShortDateTime(item.createdAt)}</span>
        </span>
        <span className="truncate text-sm">
          {item.operatorName}
          <span className="text-muted-foreground"> · {[item.teamName, item.subteamName].filter(Boolean).join(" › ") || "Sem Grupo"}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {REQUEST_ORIGIN_LABELS[item.origin]}
          {item.anjoNames.length > 0 ? ` · ${item.anjoNames.join(", ")}` : ""}
          {item.firstResponseSeconds !== null ? ` · 1ª resposta em ${durationText(item.firstResponseSeconds)}` : ""}
        </span>
      </button>
    </li>
  )
}
