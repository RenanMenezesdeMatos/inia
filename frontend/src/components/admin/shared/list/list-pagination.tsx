"use client"

import type { ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LIST_PAGE_SIZE_OPTIONS } from "@/hooks/use-admin-list-state"
import { pageCount } from "@/lib/admin/list-query"
import { cn } from "@/lib/utils"

/**
 * PAGINAÇÃO ÚNICA DO APP (decisão do responsável em 2026-11-10: "como está em Registro"). Sempre o mesmo desenho: à esquerda,
 * "1–25 de 134 bases · página 1 de 6"; à direita, "Por página" e a navegação (anterior, páginas, próxima). Duas formas:
 *  - `ListPagination`: listas com total conhecido (offset) — mostra as páginas com reticências e pula para qualquer uma;
 *  - `CursorPagination`: listas que avançam por posição do servidor (keyset, sem pular para a página N, total opcional) — mesma
 *    moldura, só anterior / página atual / próxima.
 * `stacked`: em coluna estreita (lista ao lado do detalhe), as duas partes ficam uma embaixo da outra.
 */
export type PaginationLayout = { stacked?: boolean | undefined; className?: string | undefined }

// Páginas visíveis: sempre a primeira e a última, mais a vizinhança da atual; buracos viram "…".
function visiblePages(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set<number>([1, total, current - 1, current, current + 1])
  if (current <= 3) [2, 3, 4].forEach((page) => pages.add(page))
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => pages.add(page))
  const sorted = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b)
  const result: (number | "gap")[] = []
  for (const [index, page] of sorted.entries()) {
    if (index > 0 && page - sorted[index - 1]! > 1) result.push("gap")
    result.push(page)
  }
  return result
}

const plural = (count: number, itemLabel: [string, string]) => (count === 1 ? itemLabel[0] : itemLabel[1])

function PaginationFrame({ summary, pageSize, pageSizeOptions, onPageSizeChange, isFetching, stacked, className, children }: PaginationLayout & { summary: ReactNode; pageSize: number; pageSizeOptions: readonly number[]; onPageSizeChange: (pageSize: number) => void; isFetching: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-3 border-t pt-3", !stacked && "sm:flex-row sm:items-center sm:justify-between", className)} aria-busy={isFetching} data-usage-element="list.pagination">
      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {summary}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Por página</span>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger size="sm" className="w-18" aria-label="Itens por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pageSizeOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Pagination className="mx-0 w-auto" aria-label="Paginação">
          <PaginationContent>{children}</PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}

function PageButton({ page, current, onClick }: { page: number; current: boolean; onClick?: () => void }) {
  return (
    <PaginationItem>
      <Button type="button" variant={current ? "outline" : "ghost"} size="icon-sm" aria-label={`Página ${page}`} aria-current={current ? "page" : undefined} onClick={onClick}>
        {page}
      </Button>
    </PaginationItem>
  )
}

function StepButton({ direction, disabled, onClick }: { direction: "previous" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <PaginationItem>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={direction === "previous" ? "Página anterior" : "Próxima página"} disabled={disabled} onClick={onClick}>
        {direction === "previous" ? <ChevronLeft /> : <ChevronRight />}
      </Button>
    </PaginationItem>
  )
}

export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  itemLabel,
  isFetching = false,
  pageSizeOptions = LIST_PAGE_SIZE_OPTIONS,
  ...layout
}: PaginationLayout & {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  // Singular e plural do que está sendo listado: ["base", "bases"].
  itemLabel: [string, string]
  isFetching?: boolean
  pageSizeOptions?: readonly number[]
}) {
  const pages = pageCount(total, pageSize)
  const current = Math.min(page, pages)
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1
  const last = Math.min(total, current * pageSize)
  const summary = `${total === 0 ? `0 ${itemLabel[1]}` : `${first}–${last} de ${total} ${plural(total, itemLabel)}`} · página ${current} de ${pages}`

  return (
    <PaginationFrame summary={summary} pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageSizeChange={onPageSizeChange} isFetching={isFetching} {...layout}>
      <StepButton direction="previous" disabled={current <= 1} onClick={() => onPageChange(current - 1)} />
      {visiblePages(current, pages).map((entry, index) =>
        entry === "gap" ? (
          <PaginationItem key={`gap-${index}`}>
            <PaginationEllipsis />
          </PaginationItem>
        ) : (
          <PageButton key={entry} page={entry} current={entry === current} onClick={() => onPageChange(entry)} />
        ),
      )}
      <StepButton direction="next" disabled={current >= pages} onClick={() => onPageChange(current + 1)} />
    </PaginationFrame>
  )
}

/**
 * Paginação de lista que avança por POSIÇÃO do servidor (keyset): não dá para pular para a página N, então a navegação é anterior /
 * página atual / próxima. Com o total conhecido (ex.: depois de "Contar registros"), o texto fica igual ao da `ListPagination`.
 */
export function CursorPagination({
  page,
  pageSize,
  shownCount,
  total = null,
  hasNext,
  onPrevious,
  onNext,
  onPageSizeChange,
  itemLabel,
  isFetching = false,
  pageSizeOptions = LIST_PAGE_SIZE_OPTIONS,
  ...layout
}: PaginationLayout & {
  /** Página atual (1 = primeira). */
  page: number
  pageSize: number
  /** Itens nesta página. */
  shownCount: number
  /** Total quando conhecido; `null` = desconhecido. */
  total?: number | null
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  onPageSizeChange: (pageSize: number) => void
  itemLabel: [string, string]
  isFetching?: boolean
  pageSizeOptions?: readonly number[]
}) {
  const first = shownCount === 0 ? 0 : (page - 1) * pageSize + 1
  const last = (page - 1) * pageSize + shownCount
  const range = shownCount === 0 ? `0 ${itemLabel[1]}` : total !== null ? `${first}–${last} de ${total} ${plural(total, itemLabel)}` : `${first}–${last} ${plural(last, itemLabel)}`
  const summary = `${range} · página ${page}${total !== null ? ` de ${Math.max(1, pageCount(total, pageSize))}` : ""}`
  return (
    <PaginationFrame summary={summary} pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageSizeChange={onPageSizeChange} isFetching={isFetching} {...layout}>
      <StepButton direction="previous" disabled={page <= 1 || isFetching} onClick={onPrevious} />
      <PageButton page={page} current />
      <StepButton direction="next" disabled={!hasNext || isFetching} onClick={onNext} />
    </PaginationFrame>
  )
}
