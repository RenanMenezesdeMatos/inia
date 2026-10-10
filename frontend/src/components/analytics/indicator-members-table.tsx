"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowUpDown, Search, UserRound } from "lucide-react"

import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { formatIndicatorValue, formatPercent, initials } from "@/lib/analytics/format"
import type { SubjectRef } from "@/lib/analytics/subject-params"
import { useIndicatorMembersQuery } from "@/queries/analytics/use-analytics-queries"
import type { IndicatorMembersParams } from "@/services/analytics/analytics-service"

import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "./analytics-states"
import { ReferenceStatusText, referenceStatusFrom } from "./reference-status"
import { TrendIndicator } from "./trend-indicator"

type Sort = NonNullable<IndicatorMembersParams["sort"]>
const SORT_LABELS: Record<Sort, string> = { achievement: "Atingimento", name: "Nome", delta: "Variação" }
const PAGE_SIZE = 10

/** Membros da estrutura em um indicador — busca, ordenação e paginação resolvidas no backend. */
export function IndicatorMembersTable({ subject, period, code, employeeHref }: { subject: SubjectRef | null; period: string | null; code: string; employeeHref: (personId: string) => string }) {
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>("achievement")
  const [order, setOrder] = useState<"asc" | "desc">("asc")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const debouncedSearch = useDebouncedValue(search.trim(), 300)
  const query = useIndicatorMembersQuery(subject, period, code, { search: debouncedSearch || undefined, sort, order, page, pageSize })

  return (
    <section aria-label="Colaboradores neste indicador" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Buscar colaborador" aria-label="Buscar colaborador" className="pl-8" />
        </div>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(value) => { setSort(value as Sort); setPage(1) }}>
            <SelectTrigger className="w-40" aria-label="Ordenar por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as Sort[]).map((option) => (
                <SelectItem key={option} value={option}>
                  {SORT_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon" aria-label={order === "asc" ? "Ordem crescente — alternar para decrescente" : "Ordem decrescente — alternar para crescente"} onClick={() => setOrder((current) => (current === "asc" ? "desc" : "asc"))}>
            <ArrowUpDown />
          </Button>
        </div>
      </div>

      {query.isPending ? <TableSkeleton rows={5} /> : null}
      {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.data ? (
        query.data.total === 0 ? (
          <AnalyticsEmptyState icon={UserRound} title="Nenhum colaborador encontrado" description={debouncedSearch ? "Ajuste a busca para ver outros colaboradores." : "Esta estrutura não possui colaboradores."} />
        ) : (
          <div className="overflow-x-auto rounded-xl bg-muted/40" aria-busy={query.isFetching}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-right">Atingimento</TableHead>
                  <TableHead>Quartil</TableHead>
                  <TableHead>Tendência</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Abrir</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((row) => (
                  <TableRow key={row.personId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarImage src={row.avatarUrl ?? undefined} alt="" />
                          <AvatarFallback className="text-xs">{initials(row.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{row.name}</p>
                          <ReferenceStatusText status={referenceStatusFrom(row.withinTarget)} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatIndicatorValue(row.value, query.data.indicator.unit)}
                      {row.targetValue !== null ? <span className="block text-[11px] text-muted-foreground">meta {formatIndicatorValue(row.targetValue, query.data.indicator.unit)}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatPercent(row.achievementPercent)}</TableCell>
                    <TableCell>{row.quartile ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <TrendIndicator trend={row.trend} deltaPp={row.deltaPp} compact />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={employeeHref(row.personId)}>Abrir</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-3 pb-3">
              <ListPagination page={query.data.page} pageSize={query.data.pageSize} total={query.data.total} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} itemLabel={["colaborador", "colaboradores"]} isFetching={query.isFetching} />
            </div>
          </div>
        )
      ) : null}
    </section>
  )
}
