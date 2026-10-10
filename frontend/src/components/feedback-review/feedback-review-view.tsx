"use client"

import { useMemo } from "react"
import { Inbox, Lock, SearchX, ShieldAlert } from "lucide-react"

import { AnalyticsCard, AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { ListDateRangeFilter, ListSearchInput, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { FeedbackReviewSheet } from "@/components/feedback-review/feedback-review-sheet"
import { Badge } from "@/components/ui/badge"
import { useAdminListState, useClampListPage } from "@/hooks/use-admin-list-state"
import type { DateRangeFilter } from "@/lib/admin/list-query"
import { formatDateTime } from "@/lib/format/date"
import { useFeedbackQualityAccessQuery, useFeedbackReviewsQuery } from "@/queries/feedback-review/use-feedback-reviews"
import { SECTION_LABELS, STATUS_FILTER_LABELS, type FeedbackReviewListParams, type FeedbackReviewQueueItem, type FeedbackReviewStatus } from "@/schemas/feedback-review/feedback-review.schema"

type Filters = { search: string; status: FeedbackReviewStatus | "ALL" | undefined; collaboratorId: string | undefined; teamId: string | undefined; section: "STRENGTH" | "OPPORTUNITY" | undefined; period: DateRangeFilter }
const DEFAULT_FILTERS: Filters = { search: "", status: undefined, collaboratorId: undefined, teamId: undefined, section: undefined, period: {} }
const STATUS_OPTIONS = (["APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED", "ALL"] as const).map((value) => ({ value, label: STATUS_FILTER_LABELS[value] }))
const SECTION_OPTIONS = (["STRENGTH", "OPPORTUNITY"] as const).map((value) => ({ value, label: SECTION_LABELS[value] }))

/**
 * QA Lab › Feedbacks (V1.5.5): fila dos feedbacks SELECIONADOS PARA QA pela política de entrega (no piloto, todos os
 * entregáveis) — avaliação da qualidade do output da INIA, não aprovação obrigatória do supervisor. Só aparece para quem tem
 * a capability explícita FEEDBACK_QUALITY_REVIEW; o escopo é o das concessões (backend). Avaliar NÃO entrega nada.
 */
export function FeedbackReviewView({ openReviewId, onOpenReview }: { openReviewId: string | null; onOpenReview: (reviewId: string | null) => void }) {
  const access = useFeedbackQualityAccessQuery()
  if (access.isPending) return <section className="space-y-4" aria-busy><TableSkeleton rows={3} /></section>
  if (access.isError) return <AnalyticsErrorState error={access.error} onRetry={() => void access.refetch()} />
  if (!access.data.enabled) {
    return <AnalyticsEmptyState icon={Lock} title="QA de feedback desativado neste ambiente" description="O módulo de QA de feedback não está ligado aqui. Não é uma questão de permissão." />
  }
  if (!access.data.canReview) {
    return <AnalyticsEmptyState icon={Lock} title="Sem permissão de QA de feedback" description="A avaliação de feedbacks exige a permissão de QA de feedback, concedida pela administração." />
  }
  return <FeedbackQualityQueue openReviewId={openReviewId} onOpenReview={onOpenReview} scopeLabel={access.data.scopes.map((scope) => scope.label).join(" · ")} />
}

function FeedbackQualityQueue({ openReviewId, onOpenReview, scopeLabel }: { openReviewId: string | null; onOpenReview: (reviewId: string | null) => void; scopeLabel: string }) {
  const list = useAdminListState({ storageKey: "feedback-review", defaultFilters: DEFAULT_FILTERS, defaultPageSize: 20 })
  const params: FeedbackReviewListParams = useMemo(
    () => ({ status: list.params.status ?? "PENDING_REVIEW", search: list.params.search, collaboratorId: list.params.collaboratorId, teamId: list.params.teamId, section: list.params.section, from: list.params.period.from, to: list.params.period.to, page: list.params.page, pageSize: list.params.pageSize }),
    [list.params],
  )
  const query = useFeedbackReviewsQuery(params)
  useClampListPage(query.data, list.page, list.pageSize, list.setPage)
  const data = query.data
  const showingPending = params.status === "PENDING_REVIEW"

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Feedbacks</h2>
        <p className="mt-1 text-sm text-muted-foreground">Avalie a qualidade dos feedbacks escritos pela INIA. A fila mostra os feedbacks selecionados para QA pela política de entrega — no piloto, todos os que podem ser entregues. Avaliar não autoriza envio: nada é entregue ao colaborador nesta fase.</p>
        {scopeLabel ? <p className="mt-1 text-xs text-muted-foreground">Seu escopo de QA: {scopeLabel}</p> : null}
      </div>

      <AnalyticsCard>
        <ListToolbar
          search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar colaborador pelo nome" ariaLabel="Buscar colaborador" pending={list.isSearchPending} />}
          hasActiveFilters={list.hasActiveFilters}
          onClearFilters={list.resetFilters}
        >
          <ListSelectFilter value={list.filters.status} onChange={(value) => list.setFilter("status", value)} options={STATUS_OPTIONS} allLabel={STATUS_FILTER_LABELS.PENDING_REVIEW} ariaLabel="Filtrar por status" />
          <ListSelectFilter value={list.filters.collaboratorId} onChange={(value) => list.setFilter("collaboratorId", value)} options={(data?.filterOptions.collaborators ?? []).map((entry) => ({ value: entry.id, label: entry.name }))} allLabel="Todos os colaboradores" ariaLabel="Filtrar por colaborador" />
          {(data?.filterOptions.teams.length ?? 0) > 1 ? <ListSelectFilter value={list.filters.teamId} onChange={(value) => list.setFilter("teamId", value)} options={(data?.filterOptions.teams ?? []).map((entry) => ({ value: entry.id, label: entry.name }))} allLabel="Todas as equipes" ariaLabel="Filtrar por equipe" /> : null}
          <ListSelectFilter value={list.filters.section} onChange={(value) => list.setFilter("section", value)} options={SECTION_OPTIONS} allLabel="Todos os tipos de ponto" ariaLabel="Filtrar por tipo de ponto" />
          <ListDateRangeFilter label="Data do atendimento" value={list.filters.period} onChange={(value) => list.setFilter("period", value)} />
        </ListToolbar>

        <div className="mt-4">
          {query.isPending ? <TableSkeleton rows={5} /> : null}
          {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
          {data && data.items.length === 0 ? (
            list.hasActiveFilters ? (
              <AnalyticsEmptyState icon={SearchX} title="Nenhum feedback com esses filtros" description="Ajuste ou limpe os filtros para ver outros itens." />
            ) : (
              <AnalyticsEmptyState icon={Inbox} title={showingPending ? "Nenhum feedback aguardando avaliação" : "Nenhum feedback encontrado"} description={showingPending ? "Quando a INIA escrever um feedback selecionado para QA no seu escopo, ele aparece aqui." : undefined} />
            )
          ) : null}
          {data && data.items.length > 0 ? (
            <>
              <ul className="divide-y divide-border" aria-label="Feedbacks para QA">
                {data.items.map((item) => (
                  <QueueRow key={item.reviewId} item={item} onOpen={() => onOpenReview(item.reviewId)} />
                ))}
              </ul>
              <div className="mt-3">
                <ListPagination page={list.page} pageSize={list.pageSize} total={data.total} onPageChange={list.setPage} onPageSizeChange={list.setPageSize} itemLabel={["feedback", "feedbacks"]} isFetching={query.isFetching} />
              </div>
            </>
          ) : null}
        </div>
      </AnalyticsCard>

      <FeedbackReviewSheet reviewId={openReviewId} onOpenChange={(open) => (!open ? onOpenReview(null) : undefined)} onNavigate={(reviewId) => onOpenReview(reviewId)} />
    </section>
  )
}

function QueueRow({ item, onOpen }: { item: FeedbackReviewQueueItem; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} data-testid="feedback-review-row" className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-lg px-2 py-3 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">
            {item.collaborator.name}
            {item.team ? <span className="font-normal text-muted-foreground"> · {item.team.name}</span> : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Badge variant="outline" className={item.section === "STRENGTH" ? "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200" : "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-200"}>{item.sectionLabel}</Badge>
            <span>{item.kindLabel}</span>
            {item.isFallback ? (
              <span className="inline-flex items-center gap-1 text-xs">
                <ShieldAlert className="size-3.5" aria-hidden />
                Texto de fallback de segurança
              </span>
            ) : null}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
          <span className={item.status === "PENDING_REVIEW" ? "font-medium text-amber-700 dark:text-amber-300" : item.status === "REJECTED" ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-300"}>{item.statusLabel}</span>
          <span>Atendimento: {item.occurredAt ? formatDateTime(item.occurredAt) : item.interactionLabel}</span>
        </span>
      </button>
    </li>
  )
}
