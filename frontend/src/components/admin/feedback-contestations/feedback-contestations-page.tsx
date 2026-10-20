"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, Lock, MessageSquareWarning, SearchX } from "lucide-react"

import { ListSearchInput, ListSelectFilter, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { ApiError } from "@/lib/api/api-client"
import { formatShortDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useContestationsQuery } from "@/queries/admin/use-feedback-contestation-queries"
import { CONTESTATION_STATUS_LABELS, type ContestationItem, type ContestationStatus } from "@/schemas/admin/feedback-contestation.schema"
import { DISLIKE_REASON_COPY, type FeedbackDislikeReason } from "@/schemas/feedback-ratings/feedback-rating.schema"

import { ContestationDetailPanel } from "./contestation-detail"

const PAGE_SIZE = 25
type Filters = { search: string; status: ContestationStatus | undefined; reason: FeedbackDislikeReason | undefined }
const DEFAULT_FILTERS: Filters = { search: "", status: "PENDING", reason: undefined }
const REASON_LABELS = Object.fromEntries(Object.entries(DISLIKE_REASON_COPY).map(([reason, copy]) => [reason, copy.label])) as Record<FeedbackDislikeReason, string>

/**
 * "Contestações de feedback" — quando um colaborador marca um feedback da INIA como "não foi útil" (impreciso, processo errado…)
 * e descreve o problema, alguém do escopo dele lê e responde. A resposta aparece para o colaborador junto do feedback; o
 * feedback em si não muda. A lista à esquerda (sem resposta primeiro), a contestação aberta à direita; no celular, uma de cada vez.
 */
export function FeedbackContestationsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("contestation")
  const list = useAdminListState<Filters>({ storageKey: "feedback-contestations", defaultFilters: DEFAULT_FILTERS, defaultPageSize: PAGE_SIZE })
  const query = useContestationsQuery({ search: list.params.search, status: list.filters.status, reason: list.filters.reason, page: list.page, pageSize: list.pageSize })

  function select(id: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (id) next.set("contestation", id)
    else next.delete("contestation")
    router.replace(`${pathname}${next.size > 0 ? `?${next}` : ""}`, { scroll: false })
  }

  const forbidden = query.error instanceof ApiError && query.error.status === 403
  const total = query.data?.total ?? 0
  const pending = query.data?.pendingCount ?? 0

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Contestações de feedback</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Quando um colaborador do seu escopo marca um feedback da INIA como “não foi útil”, ele explica o motivo. Leia, compare com o feedback e responda — a resposta aparece para ele junto do feedback.</p>
        </div>
        {query.data ? <p className="text-sm text-muted-foreground tabular-nums">{pending === 0 ? "Nenhuma aguardando resposta" : `${pending} ${pending === 1 ? "aguardando resposta" : "aguardando resposta"}`}</p> : null}
      </header>

      {forbidden ? (
        <div className="flex flex-col items-center rounded-xl border p-8 text-center" role="alert">
          <Lock className="size-8 text-muted-foreground/60" aria-hidden />
          <p className="mt-3 font-medium">Sem acesso às contestações de feedback</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Peça a um administrador o papel “Revisor de contestações de feedback”.</p>
        </div>
      ) : (
        <>
          <ListToolbar
            search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por colaborador" ariaLabel="Buscar contestação por colaborador" pending={list.isSearchPending} />}
            hasActiveFilters={list.hasActiveFilters}
            onClearFilters={list.resetFilters}
          >
            <ListSelectFilter value={list.filters.status} onChange={(value) => list.setFilter("status", value)} options={optionsFromLabels(CONTESTATION_STATUS_LABELS)} allLabel="Todas" ariaLabel="Filtrar por situação" />
            <ListSelectFilter value={list.filters.reason} onChange={(value) => list.setFilter("reason", value)} options={optionsFromLabels(REASON_LABELS)} allLabel="Todos os motivos" ariaLabel="Filtrar por motivo" />
          </ListToolbar>

          <div className="grid min-h-[34rem] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl border bg-card lg:h-[calc(100dvh-20rem)] lg:grid-cols-[minmax(19rem,25rem)_minmax(0,1fr)]">
            <div className={cn("flex min-h-0 flex-col border-b lg:border-r lg:border-b-0", selectedId ? "hidden lg:flex" : "flex")}>
              {query.isPending ? (
                <div className="space-y-2 p-3" aria-label="Carregando contestações">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-lg" />)}</div>
              ) : query.isError ? (
                <div className="space-y-3 p-6 text-center" role="alert">
                  <p className="text-sm text-destructive">Não foi possível carregar as contestações.</p>
                  <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
                </div>
              ) : query.data.items.length === 0 ? (
                <div className="p-4">
                  <AnalyticsEmptyState
                    icon={list.hasActiveFilters ? SearchX : MessageSquareWarning}
                    title={list.filters.status === "PENDING" && !list.filters.reason && !list.filters.search ? "Nenhuma contestação aguardando resposta" : "Nenhuma contestação com esses filtros"}
                    description={list.filters.status === "PENDING" ? "Quando um colaborador do seu escopo contestar um feedback, ela aparece aqui e no sino." : undefined}
                  />
                </div>
              ) : (
                <>
                  <ul className="min-h-0 flex-1 divide-y overflow-y-auto" aria-label="Contestações">
                    {query.data.items.map((item) => <ContestationRow key={item.id} item={item} selected={item.id === selectedId} onSelect={() => select(item.id)} />)}
                  </ul>
                  <CompactPager page={list.page} pageSize={list.pageSize} total={total} isFetching={query.isFetching} onPageChange={list.setPage} />
                </>
              )}
            </div>
            <div className={cn("min-h-[32rem] min-w-0 lg:min-h-0", selectedId ? "block" : "hidden lg:block")}>
              {selectedId ? (
                <ContestationDetailPanel key={selectedId} contestationId={selectedId} onBack={() => select(null)} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full bg-muted"><MessageSquareWarning className="size-6 text-muted-foreground" aria-hidden /></span>
                  <div className="space-y-1">
                    <p className="font-medium">Escolha uma contestação</p>
                    <p className="max-w-sm text-sm text-muted-foreground">Você vê o que o colaborador escreveu, o que a INIA disse no feedback e responde por aqui.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function ContestationRow({ item, selected, onSelect }: { item: ContestationItem; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="feedback-contestation"
        className={cn(
          "relative flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
          selected && "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary hover:bg-primary/10",
        )}
      >
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.collaborator.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatShortDateTime(item.contestedAt)}</span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="text-[11px]">{DISLIKE_REASON_COPY[item.reason].label}</Badge>
          {item.status === "PENDING" ? <Badge className="bg-amber-500/15 text-[11px] text-amber-700 dark:text-amber-300">Aguardando resposta</Badge> : <Badge variant="secondary" className="text-[11px]">Respondida</Badge>}
        </span>
        <span className="line-clamp-2 text-xs text-muted-foreground">“{item.comment}”</span>
      </button>
    </li>
  )
}

/** Paginação que cabe na coluna da lista: "26–43 de 43" e anterior/próxima. */
function CompactPager({ page, pageSize, total, isFetching, onPageChange }: { page: number; pageSize: number; total: number; isFetching: boolean; onPageChange: (page: number) => void }) {
  if (total <= pageSize && page === 1) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground tabular-nums">
      <span className={cn(isFetching && "opacity-60")}>{first}–{last} de {total}</span>
      <span className="flex gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page === 1} onClick={() => onPageChange(page - 1)} aria-label="Página anterior"><ChevronLeft /></Button>
        <Button variant="ghost" size="icon-sm" disabled={last >= total} onClick={() => onPageChange(page + 1)} aria-label="Próxima página"><ChevronRight /></Button>
      </span>
    </div>
  )
}
