"use client"

import { ChevronRight, Layers } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatPercent } from "@/lib/analytics/format"
import { subjectToRef, type SubjectRef } from "@/lib/analytics/subject-params"
import { useStructureBreakdownQuery } from "@/queries/analytics/use-analytics-queries"
import { GROUPING_LABELS, type GroupingDimension, type StructureGroupSummary } from "@/schemas/analytics/analytics.schema"

import { AnalyticsCard, AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "./analytics-states"
import { ReferenceStatusText, referenceStatusFromAchievement } from "./reference-status"
import { TrendIndicator } from "./trend-indicator"

/** Controle "Agrupar por" — as opções vêm das capabilities do backend (cargos abaixo do viewer +
 * Grupo/Subgrupo); nenhuma lista de papéis fica hardcoded aqui. */
export function GroupBySelect({ options, value, onChange }: { options: GroupingDimension[]; value: GroupingDimension | null; onChange: (value: GroupingDimension) => void }) {
  if (options.length === 0) return null
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Agrupar por</span>
      <Select value={value ?? undefined} onValueChange={(next) => onChange(next as GroupingDimension)}>
        <SelectTrigger className="w-44 bg-card" aria-label="Agrupar por">
          <SelectValue placeholder="Selecionar" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {GROUPING_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  )
}

/** Tabela dos grupos da estrutura na dimensão escolhida, com drill-down por linha. */
export function StructureGroupTable({ subject, period, groupBy, onDrillDown }: { subject: SubjectRef | null; period: string | null; groupBy: GroupingDimension; onDrillDown: (subject: SubjectRef) => void }) {
  const query = useStructureBreakdownQuery(subject, period, groupBy)
  return (
    <AnalyticsCard>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Estrutura por {GROUPING_LABELS[groupBy].toLowerCase()}</h3>
          <p className="text-sm text-muted-foreground">Abra um grupo para analisar a estrutura dele.</p>
        </div>
      </div>
      <div className="mt-4" aria-busy={query.isFetching}>
        {query.isPending ? <TableSkeleton rows={4} /> : null}
        {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}
        {query.data ? (
          query.data.groups.length === 0 ? (
            <AnalyticsEmptyState icon={Layers} title="Nenhum grupo nesta dimensão" description="A estrutura não possui unidades desse nível." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{GROUPING_LABELS[groupBy]}</TableHead>
                    <TableHead className="text-right">Pessoas</TableHead>
                    <TableHead className="text-right">Atingimento</TableHead>
                    <TableHead>Variação</TableHead>
                    <TableHead className="text-right">Atenção</TableHead>
                    <TableHead className="text-right">Evolução</TableHead>
                    <TableHead className="text-right">Sem dados</TableHead>
                    <TableHead className="hidden xl:table-cell">Indicadores em atenção</TableHead>
                    <TableHead className="text-right">
                      <span className="sr-only">Abrir</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {query.data.groups.map((group) => (
                    <GroupRow key={`${group.label}-${group.subject?.kind ?? "none"}`} group={group} onDrillDown={onDrillDown} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )
        ) : null}
      </div>
    </AnalyticsCard>
  )
}

function GroupRow({ group, onDrillDown }: { group: StructureGroupSummary; onDrillDown: (subject: SubjectRef) => void }) {
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium">{group.label}</p>
        {group.description ? <p className="text-xs text-muted-foreground">{group.description}</p> : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">{group.memberCount}</TableCell>
      <TableCell className="text-right">
        <span className="font-medium tabular-nums">{formatPercent(group.consolidatedAchievementPercent)}</span>
        <div>
          <ReferenceStatusText status={referenceStatusFromAchievement(group.consolidatedAchievementPercent)} />
        </div>
      </TableCell>
      <TableCell>
        <TrendIndicator trend={group.trend} deltaPp={group.deltaPp} compact />
      </TableCell>
      <TableCell className="text-right tabular-nums">{group.attentionCount}</TableCell>
      <TableCell className="text-right tabular-nums">{group.improvingCount}</TableCell>
      <TableCell className="text-right tabular-nums">{group.noDataCount}</TableCell>
      <TableCell className="hidden xl:table-cell">
        {group.topAttentionIndicators.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <ul className="space-y-0.5 text-xs">
            {group.topAttentionIndicators.map((indicator) => (
              <li key={indicator.code}>
                {indicator.name} <span className="text-muted-foreground">({formatPercent(indicator.consolidatedAchievementPercent)})</span>
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell className="text-right">
        {group.subject ? (
          <Button type="button" variant="ghost" size="sm" className="text-primary" onClick={() => onDrillDown(subjectToRef(group.subject!))} aria-label={`Analisar ${group.label}`}>
            Analisar <ChevronRight />
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}
