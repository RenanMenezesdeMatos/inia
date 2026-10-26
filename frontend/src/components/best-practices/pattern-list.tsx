"use client"

import { useState } from "react"
import { Lightbulb } from "lucide-react"

import { ListBooleanFilter, ListSearchInput, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListPagination } from "@/components/admin/shared/list/list-pagination"
import { AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { usePatternsQuery } from "@/queries/best-practices/use-best-practices"
import type { BestPracticesMeta, DataOrigin, PatternFilters, ReviewStatus } from "@/schemas/best-practices/best-practices.schema"

import { percentLabel, REVIEW_LABELS, reviewBadgeVariant, STRENGTH_LABELS } from "./best-practice-labels"

const STATUS_OPTIONS = (Object.keys(REVIEW_LABELS) as ReviewStatus[]).map((value) => ({ value, label: REVIEW_LABELS[value] }))
const ORIGIN_OPTIONS: { value: DataOrigin; label: string }[] = [
  { value: "REAL", label: "Dados reais" },
  { value: "SYNTHETIC", label: "Dados sintéticos (teste)" },
]

/** Lista da base: filtros por indicador, contexto, Grupo, estado e origem; a linha abre o detalhe. */
export function PatternList({ meta, onOpen }: { meta: BestPracticesMeta | undefined; onOpen: (id: string) => void }) {
  const [filters, setFilters] = useState<PatternFilters>({ page: 1, pageSize: 20 })
  const query = usePatternsQuery(filters)
  const set = <K extends keyof PatternFilters>(key: K, value: PatternFilters[K]) => setFilters((current) => ({ ...current, [key]: value, page: key === "page" ? (value as number) : 1 }))
  const hasActiveFilters = Boolean(filters.indicatorId || filters.teamId || filters.origin || filters.reviewStatus || filters.available !== undefined || filters.context || filters.search)

  return (
    <section className="space-y-3">
      <ListToolbar
        search={<ListSearchInput value={filters.search ?? ""} onChange={(value) => set("search", value || undefined)} placeholder="Buscar por comportamento" ariaLabel="Buscar boa prática" />}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={() => setFilters({ page: 1, pageSize: filters.pageSize })}
      >
        <ListSelectFilter ariaLabel="Indicador" allLabel="Todos os indicadores" value={filters.indicatorId} onChange={(value) => set("indicatorId", value)} options={(meta?.indicators ?? []).map((indicator) => ({ value: indicator.id, label: indicator.name }))} />
        <ListSearchInput value={filters.context ?? ""} onChange={(value) => set("context", value || undefined)} placeholder="Contexto (motivo)" ariaLabel="Filtrar por contexto" />
        <ListSelectFilter ariaLabel="Grupo" allLabel="Todos os grupos" value={filters.teamId} onChange={(value) => set("teamId", value)} options={(meta?.teams ?? []).map((team) => ({ value: team.id, label: team.name }))} />
        <ListSelectFilter ariaLabel="Estado de revisão" allLabel="Qualquer estado" value={filters.reviewStatus} onChange={(value) => set("reviewStatus", value)} options={STATUS_OPTIONS} />
        <ListBooleanFilter ariaLabel="Disponível para recomendações" allLabel="Disponível ou não" trueLabel="Orienta operadores" falseLabel="Não orienta" value={filters.available} onChange={(value) => set("available", value)} />
        <ListSelectFilter ariaLabel="Origem dos dados" allLabel="Qualquer origem" value={filters.origin} onChange={(value) => set("origin", value)} options={ORIGIN_OPTIONS} />
      </ListToolbar>

      {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
      {query.isPending ? <TableSkeleton rows={5} /> : null}
      {query.data && query.data.items.length === 0 ? (
        <AnalyticsEmptyState icon={Lightbulb} title={hasActiveFilters ? "Nenhum padrão com estes filtros" : "A base ainda não tem padrões"} description="Padrões nascem de uma análise que compara as chamadas dos operadores com melhores resultados com as do grupo de referência. Só associação sustentada e que não é obrigação do processo entra." />
      ) : null}
      {query.data && query.data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Boa prática</TableHead>
                <TableHead>Indicador</TableHead>
                <TableHead>Contextos</TableHead>
                <TableHead className="text-right">Melhores × referência</TableHead>
                <TableHead>Força</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((item) => {
                const main = item.supportedContexts[0]
                return (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => onOpen(item.id)}>
                    <TableCell className="max-w-md whitespace-normal">
                      <button type="button" className="text-left font-medium hover:underline" onClick={(event) => { event.stopPropagation(); onOpen(item.id) }}>{item.name}</button>
                      <p className="line-clamp-2 text-xs text-muted-foreground">{item.description}</p>
                      {item.dataOrigin === "SYNTHETIC" ? <Badge variant="outline" className="mt-1 border-amber-500/50 text-amber-700 dark:text-amber-300">Sintético · {item.syntheticDatasetLabel}</Badge> : null}
                    </TableCell>
                    <TableCell className="text-sm">{item.indicatorName}{item.outcomeSource === "CALL_SIGNAL" ? <span className="text-xs text-muted-foreground"> · sinal da chamada</span> : null}<p className="text-xs text-muted-foreground">{item.teamName ?? "—"}{item.subteamName ? ` · ${item.subteamName}` : ""}</p></TableCell>
                    <TableCell className="max-w-xs whitespace-normal text-sm">{item.supportedContexts.length > 0 ? item.supportedContexts.map((context) => context.label).join(" · ") : <span className="text-muted-foreground">Nenhum sustentado</span>}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{main ? `${percentLabel(main.topRatePercent)} × ${percentLabel(main.referenceRatePercent)}` : "—"}</TableCell>
                    <TableCell className="text-sm">{STRENGTH_LABELS[item.currentStrength]}</TableCell>
                    <TableCell>
                      <Badge variant={reviewBadgeVariant(item.reviewStatus)}>{REVIEW_LABELS[item.reviewStatus]}</Badge>
                      <p className="mt-1 text-xs text-muted-foreground">{item.available ? "Orienta operadores" : "Não orienta"}</p>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
      {query.data && query.data.total > 0 ? <ListPagination page={filters.page} pageSize={filters.pageSize} total={query.data.total} onPageChange={(page) => set("page", page)} onPageSizeChange={(pageSize) => setFilters((current) => ({ ...current, pageSize, page: 1 }))} itemLabel={["padrão", "padrões"]} isFetching={query.isFetching} /> : null}
    </section>
  )
}
