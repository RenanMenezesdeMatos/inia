"use client"

import { useState } from "react"
import { MessagesSquare, UserRoundSearch } from "lucide-react"

import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useSupportAbandonmentListQuery } from "@/queries/human-support/use-human-support-admin"
import type { AbandonmentKind, AbandonmentListItem } from "@/schemas/human-support/monitoring.schema"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import { PanelError } from "../monitoring/panel-error"
import { RequestDetail } from "../monitoring/request-detail"
import { OperatorAvatar } from "../monitoring/request-presentation"

const REASON_LABELS: Record<AbandonmentKind, Partial<Record<AbandonmentListItem["reason"], string>>> = {
  WAITING: { CLOSED_INIA: "Fechou a INIA antes de ser atendido", CANCELLED: "Cancelou o pedido" },
  ANJO: { NO_REPLY: "Parou de responder (perdeu o atendimento)", LOGGED_OUT: "Saiu (deslogou) e derrubou o operador" },
  OPERATOR: { LEFT_INIA: "Saiu da INIA no meio", NO_REPLY: "Parou de responder (Anjo liberado)" },
}
const LIST_TITLE: Record<AbandonmentKind, string> = {
  WAITING: "Operadores que desistiram na espera",
  ANJO: "Anjos que abandonaram o atendimento",
  OPERATOR: "Operadores que abandonaram no atendimento",
}
const placeText = (team: string | null, subteam: string | null) => [team, subteam].filter(Boolean).join(" › ") || "Sem Grupo"

/**
 * QUEM ABANDONOU (pedido do responsável em 2026-11-17): o número de cada card de abandono abre, num Popover, a lista de quem abandonou —
 * mais recentes primeiro, com data/hora, motivo, o outro lado do atendimento e o pedido de origem. O servidor decide o alcance e usa a
 * MESMA coorte e regra do número (`GET …/abandonment/list`), paginada lá (10/20/50). O protocolo abre a conversa do pedido num diálogo
 * (a leitura grava o registro LGPD, como na aba Pedidos). Número zero não abre nada.
 */
export function AbandonmentPeople({ kind, total, title, filter, live }: { kind: AbandonmentKind; total: number; title: string; filter: PanelFilter; live: boolean }) {
  const [open, setOpen] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const number = <span className="text-2xl font-semibold tabular-nums">{total}</span>
  if (total === 0) return <p>{number}</p>
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${total} — ver quem: ${title}`}
            data-testid={`abandon-people-${kind.toLowerCase()}`}
            className="group -mx-1 flex items-baseline gap-2 rounded-md px-1 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {number}
            <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
              <UserRoundSearch className="size-3.5" aria-hidden />
              Ver quem
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(34rem,calc(100vw-2rem))] p-0">
          {open ? (
            <PeopleList
              kind={kind}
              filter={filter}
              live={live}
              onOpenRequest={(id) => {
                setOpen(false)
                setRequestId(id)
              }}
            />
          ) : null}
        </PopoverContent>
      </Popover>
      <Dialog open={requestId !== null} onOpenChange={(next) => (next ? undefined : setRequestId(null))}>
        <DialogContent className="flex h-[min(85dvh,46rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogTitle className="sr-only">Pedido de origem do abandono</DialogTitle>
          <DialogDescription className="sr-only">A conversa do pedido com o Anjo, só leitura.</DialogDescription>
          <div className="min-h-0 flex-1">{requestId ? <RequestDetail key={requestId} requestId={requestId} /> : null}</div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PeopleList({ kind, filter, live, onOpenRequest }: { kind: AbandonmentKind; filter: PanelFilter; live: boolean; onOpenRequest: (requestId: string) => void }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const query = useSupportAbandonmentListQuery({ ...filter, kind, page, pageSize }, { enabled: true, live })
  return (
    <section aria-label={LIST_TITLE[kind]} className="flex max-h-[min(70dvh,36rem)] flex-col">
      <header className="border-b px-4 py-3">
        <h4 className="text-sm font-semibold">{LIST_TITLE[kind]}</h4>
        <p className="text-xs text-muted-foreground">Mais recentes primeiro. Clique no protocolo para ler a conversa do pedido.</p>
      </header>
      {query.isPending ? (
        <div className="space-y-2 p-3" aria-label="Carregando quem abandonou">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-14 w-full rounded-lg" />)}</div>
      ) : query.isError ? (
        <div className="p-3"><PanelError error={query.error} onRetry={() => void query.refetch()} /></div>
      ) : query.data.items.length === 0 ? (
        <div className="p-4"><AnalyticsEmptyState icon={UserRoundSearch} title="Ninguém nesta página" /></div>
      ) : (
        <>
          <ul className={cn("min-h-0 flex-1 divide-y overflow-y-auto", query.isPlaceholderData && "opacity-60")} data-testid="abandon-people-list">
            {query.data.items.map((item) => <PersonRow key={`${item.request.id}:${item.attendanceStartedAt ?? ""}:${item.at}`} kind={kind} item={item} onOpenRequest={onOpenRequest} />)}
          </ul>
          <ListPagination
            stacked
            className="px-4 pb-3"
            page={query.data.page}
            pageSize={pageSize}
            total={query.data.total}
            itemLabel={["abandono", "abandonos"]}
            isFetching={query.isFetching}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      )}
    </section>
  )
}

function PersonRow({ kind, item, onOpenRequest }: { kind: AbandonmentKind; item: AbandonmentListItem; onOpenRequest: (requestId: string) => void }) {
  const counterpart = item.counterpart ? `${kind === "ANJO" ? "Operador" : "Anjo"}: ${item.counterpart.name}` : null
  return (
    <li className="flex gap-3 px-4 py-2.5" data-testid="abandon-person">
      <OperatorAvatar name={item.person.name} avatarUrl={item.person.avatarUrl} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
        <p className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{item.person.name}</span>
          <time dateTime={item.at} className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(item.at)}</time>
        </p>
        <p className="text-muted-foreground">{REASON_LABELS[kind][item.reason] ?? item.reason}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <button type="button" onClick={() => onOpenRequest(item.request.id)} className="inline-flex items-center gap-1 font-medium text-primary tabular-nums hover:underline focus-visible:underline focus-visible:outline-none" aria-label={`Abrir o pedido ${item.request.protocol}`}>
            <MessagesSquare className="size-3.5" aria-hidden />
            {item.request.protocol}
          </button>
          {counterpart ? <span>{counterpart}</span> : null}
          <span>{placeText(item.request.teamName, item.request.subteamName)}</span>
        </p>
      </div>
    </li>
  )
}
