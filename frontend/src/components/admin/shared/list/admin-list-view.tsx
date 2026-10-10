"use client"

import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { useClampListPage, type AdminListState } from "@/hooks/use-admin-list-state"
import type { PageResult } from "@/lib/admin/list-query"
import { cn } from "@/lib/utils"

import { ListPagination } from "./list-pagination"
import { ListEmptyState, ListErrorState, ListNoResultsState, ListSkeleton } from "./list-states"

type PageQuery<T> = {
  data: PageResult<T> | undefined
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  isPlaceholderData: boolean
  refetch: () => unknown
}

// Corpo padrão de uma listagem: decide entre carregando / erro / vazio / sem resultado / itens,
// renderiza lista ou cards com os MESMOS dados e fecha com a paginação. Cada tela só entrega
// como desenhar a tabela e o card.
export function AdminListView<T, F extends { search: string }>({
  state,
  query,
  errorMessage,
  empty,
  noResultsTitle,
  itemLabel,
  renderList,
  renderCards,
}: {
  state: AdminListState<F>
  query: PageQuery<T>
  errorMessage: string
  empty: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }
  noResultsTitle: string
  itemLabel: [string, string]
  renderList: (items: T[]) => ReactNode
  renderCards: (items: T[]) => ReactNode
}) {
  useClampListPage(query.data, state.page, state.pageSize, state.setPage)

  if (query.isLoading) return <ListSkeleton view={state.view} />
  if (query.isError || !query.data) return <ListErrorState message={errorMessage} onRetry={() => query.refetch()} />

  const { items, total } = query.data
  if (total === 0) {
    if (state.hasActiveFilters) return <ListNoResultsState title={noResultsTitle} onClear={state.resetFilters} />
    return <ListEmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
  }

  return (
    <div className="space-y-4">
      <div aria-busy={query.isFetching} className={cn("transition-opacity", query.isPlaceholderData && "opacity-60")}>
        {state.view === "cards" ? renderCards(items) : renderList(items)}
      </div>
      <ListPagination
        page={state.page}
        pageSize={state.pageSize}
        total={total}
        onPageChange={state.setPage}
        onPageSizeChange={state.setPageSize}
        itemLabel={itemLabel}
        isFetching={query.isFetching}
      />
    </div>
  )
}
