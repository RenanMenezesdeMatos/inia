"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LIST_PAGE_SIZE_OPTIONS } from "@/hooks/use-admin-list-state"
import { pageCount } from "@/lib/admin/list-query"

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

export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  itemLabel,
  isFetching = false,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  // Singular e plural do que está sendo listado: ["base", "bases"].
  itemLabel: [string, string]
  isFetching?: boolean
}) {
  const pages = pageCount(total, pageSize)
  const current = Math.min(page, pages)
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1
  const last = Math.min(total, current * pageSize)

  return (
    <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between" aria-busy={isFetching} data-usage-element="list.pagination">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {total === 0 ? `0 ${itemLabel[1]}` : `${first}–${last} de ${total} ${total === 1 ? itemLabel[0] : itemLabel[1]}`}
        {" · "}página {current} de {pages}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Por página</span>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger size="sm" className="w-18" aria-label="Itens por página">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIST_PAGE_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <Pagination className="mx-0 w-auto" aria-label="Paginação">
          <PaginationContent>
            <PaginationItem>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Página anterior" disabled={current <= 1} onClick={() => onPageChange(current - 1)}>
                <ChevronLeft />
              </Button>
            </PaginationItem>
            {visiblePages(current, pages).map((entry, index) =>
              entry === "gap" ? (
                <PaginationItem key={`gap-${index}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={entry}>
                  <Button
                    type="button"
                    variant={entry === current ? "outline" : "ghost"}
                    size="icon-sm"
                    aria-label={`Página ${entry}`}
                    aria-current={entry === current ? "page" : undefined}
                    onClick={() => onPageChange(entry)}
                  >
                    {entry}
                  </Button>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Próxima página" disabled={current >= pages} onClick={() => onPageChange(current + 1)}>
                <ChevronRight />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  )
}
