"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, CircleHelp, Download, FlaskConical, Info, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TABLE_FRAME, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminApiError } from "@/lib/admin/admin-api"
import { startUsageAction } from "@/lib/usage/usage-provider"
import { cn } from "@/lib/utils"
import type { Coverage, MetricDefinition, MetricValue, UsabilityMeta } from "@/schemas/admin/usability.schema"
import { downloadUsabilityCsv, type UsabilityQuery, type UsabilityTab } from "@/services/admin/usability-service"

import { formatCount, formatInstant, formatMetricValue } from "./usability-format"
import { withoutPaging, type FilterKey } from "./usability-url-state"

/** O que toda seção do painel precisa saber: dicionário, fuso, recorte atual e como mudar o recorte. */
export type UsabilityPanelContext = {
  tab: UsabilityTab
  query: UsabilityQuery
  timezone: string
  dictionary: ReadonlyMap<string, MetricDefinition>
  can: UsabilityMeta["can"]
  setFilters: (changes: Partial<Record<FilterKey, string | undefined>>) => void
  openTab: (tab: UsabilityTab, changes?: Partial<Record<FilterKey, string | undefined>>) => void
  personHref: (personId: string) => string
}

const PanelContext = createContext<UsabilityPanelContext | null>(null)
export const UsabilityPanelProvider = PanelContext.Provider
export function usePanel(): UsabilityPanelContext {
  const value = useContext(PanelContext)
  if (!value) throw new Error("usePanel fora do painel de usabilidade")
  return value
}

/** "?" com a definição oficial da métrica (dicionário versionado do backend). */
export function DefinitionButton({ metricId, label }: { metricId: string; label?: string }) {
  const { dictionary } = usePanel()
  const definition = dictionary.get(metricId)
  if (!definition) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-label={`O que é: ${label ?? definition.label}`}>
          <CircleHelp className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2 text-xs" align="start">
        <p className="text-sm font-medium">{definition.label}</p>
        <p>{definition.definition}</p>
        <DefinitionRow term="Fórmula" value={definition.formula} mono />
        <DefinitionRow term="Fonte" value={definition.source} />
        {definition.denominator ? <DefinitionRow term="Base" value={definition.denominator} /> : null}
        <DefinitionRow term="Deduplicação" value={definition.dedupe} />
        <DefinitionRow term="Cobertura" value={definition.coverage} />
        <DefinitionRow term="Exclusões" value={definition.exclusions} />
        <DefinitionRow term="Limitações" value={definition.limitations} />
      </PopoverContent>
    </Popover>
  )
}

function DefinitionRow({ term, value, mono = false }: { term: string; value: string; mono?: boolean }) {
  return (
    <p>
      <span className="font-medium text-foreground">{term}: </span>
      <span className={cn("text-muted-foreground", mono && "font-mono")}>{value}</span>
    </p>
  )
}

const coverageLabel = (coverage: Coverage) => (coverage.status === "PARTIAL" ? "Cobertura parcial" : coverage.status === "NONE" ? "Sem cobertura" : null)

/** Cartão de métrica: valor com estado, base, variação (sempre com o rótulo do backend) e cobertura. */
export function MetricCard({ metric, onDrill, drillLabel }: { metric: MetricValue; onDrill?: () => void; drillLabel?: string }) {
  const { dictionary } = usePanel()
  const definition = dictionary.get(metric.metric)
  const label = definition?.label ?? metric.metric
  const coverage = coverageLabel(metric.coverage)
  const variation = metric.variation
  const Arrow = variation?.status === "VALUE" && variation.value !== null ? (variation.value > 0 ? ArrowUpRight : variation.value < 0 ? ArrowDownRight : ArrowRight) : null
  const muted = metric.status === "NO_DATA" || metric.status === "NOT_APPLICABLE"
  return (
    <Card className="gap-2 py-4" data-metric={metric.metric}>
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <CardDescription className="text-xs font-medium text-muted-foreground">{label}</CardDescription>
          <DefinitionButton metricId={metric.metric} label={label} />
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4">
        <p className={cn("text-2xl font-semibold tabular-nums tracking-tight", muted && "text-base font-medium text-muted-foreground")}>{formatMetricValue(metric, definition?.unit)}</p>
        {metric.denominator !== null && metric.numerator !== null ? <p className="text-xs text-muted-foreground">{formatCount(metric.numerator)} de {formatCount(metric.denominator)}</p> : null}
        {variation ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {Arrow ? <Arrow className="size-3.5" aria-hidden /> : null}
            {variation.label}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-1.5">
          {coverage ? (
            <Badge variant="outline" className="gap-1 text-[11px] font-normal" title={metric.coverage.note ?? undefined}>
              <AlertTriangle className="size-3" aria-hidden /> {coverage}
            </Badge>
          ) : null}
          {onDrill ? (
            <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onDrill} data-usage-element="usability.drilldown">
              {drillLabel ?? "Ver lista"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

/** Número simples com rótulo (quando não é uma métrica do dicionário com variação). */
export function StatTile({ label, value, hint, metricId, onDrill }: { label: string; value: ReactNode; hint?: ReactNode; metricId?: string; onDrill?: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {metricId ? <DefinitionButton metricId={metricId} label={label} /> : null}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {onDrill ? (
        <Button type="button" variant="link" size="sm" className="mt-1 h-auto p-0 text-xs" onClick={onDrill} data-usage-element="usability.drilldown">
          Ver lista
        </Button>
      ) : null}
    </div>
  )
}

export function Section({ title, description, metricId, actions, children, className }: { title: string; description?: ReactNode; metricId?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-3", className)}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-1.5 text-base">
            {title}
            {metricId ? <DefinitionButton metricId={metricId} label={title} /> : null}
          </CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** Exportar CSV: o mesmo recorte da tela. Só aparece com `usability.export`. */
export function ExportButton({ table, label = "Exportar CSV", query: override }: { table: string; label?: string; query?: UsabilityQuery }) {
  const { can, tab, query } = usePanel()
  const [busy, setBusy] = useState(false)
  if (!can.export) return null
  async function run() {
    setBusy(true)
    const action = startUsageAction("usability.export")
    try {
      await downloadUsabilityCsv(tab, table, withoutPaging(override ?? query))
      action.succeed()
    } catch (error) {
      action.fail(error instanceof AdminApiError && error.code ? error.code : "UNKNOWN")
      toast.error(error instanceof AdminApiError ? error.message : "Não foi possível exportar.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={run} disabled={busy} data-usage-element="usability.export">
      {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}
      {label}
    </Button>
  )
}

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: "right" | "left"; className?: string }

export function DataTable<T>({ columns, rows, rowKey, empty = "Nenhum registro no recorte.", caption }: { columns: Column<T>[]; rows: readonly T[]; rowKey: (row: T, index: number) => string; empty?: string; caption?: string }) {
  if (rows.length === 0) return <EmptyNote>{empty}</EmptyNote>
  return (
    <div className={TABLE_FRAME}>
      <Table>
        {caption ? <TableCaption className="sr-only">{caption}</TableCaption> : null}
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={cn(column.align === "right" && "text-right", column.className)}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={rowKey(row, index)}>
              {columns.map((column) => (
                <TableCell key={column.key} className={cn(column.align === "right" && "text-right tabular-nums", column.className)}>
                  {column.cell(row)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Barras horizontais simples (ranking): o valor é sempre escrito, a barra só reforça. */
export function BarList({ items, empty = "Nenhum registro no recorte." }: { items: { key: string; label: ReactNode; value: number; display?: ReactNode; onClick?: () => void }[]; empty?: string }) {
  if (items.length === 0) return <EmptyNote>{empty}</EmptyNote>
  const max = Math.max(...items.map((item) => item.value), 1)
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            {item.onClick ? (
              <button type="button" className="min-w-0 truncate text-left underline-offset-2 hover:underline" onClick={item.onClick} data-usage-element="usability.drilldown">
                {item.label}
              </button>
            ) : (
              <span className="min-w-0 truncate">{item.label}</span>
            )}
            <span className="shrink-0 tabular-nums text-muted-foreground">{item.display ?? formatCount(item.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>
}

export function HeuristicBadge() {
  return (
    <Badge variant="outline" className="gap-1 text-[11px] font-normal">
      <FlaskConical className="size-3" aria-hidden /> Sinal heurístico
    </Badge>
  )
}

/** Aviso de cobertura do recorte (início da coleta no meio do período, fontes oficiais mais novas etc.). */
export function CoverageBanner({ coverage }: { coverage: Record<string, unknown> | undefined }) {
  const { timezone } = usePanel()
  const partial = Object.entries(coverage ?? {}).filter((entry): entry is [string, Coverage] => {
    const value = entry[1] as Coverage | undefined
    return Boolean(value && typeof value === "object" && "status" in value && value.status !== "FULL")
  })
  if (partial.length === 0) return null
  // Mesma origem e mesmo início = uma linha só (uso, adoção e atividade costumam começar juntos).
  const lines = [...new Map(partial.map(([key, value]) => [`${value.status}|${value.from ?? ""}|${value.note ?? ""}`, [key, value] as const])).values()]
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <Info className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      <div className="space-y-0.5">
        <p className="font-medium">Parte do período não tem medição completa.</p>
        {lines.map(([key, value]) => (
          <p key={key} className="text-xs text-muted-foreground">
            {value.status === "NONE" ? "Sem medição no período" : `Medição desde ${formatInstant(value.from, timezone)}`}
            {value.note ? ` — ${value.note}` : ""}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">Antes do início da medição o painel mostra “sem dados”, nunca zero.</p>
      </div>
    </div>
  )
}

export function SubjectLink({ personId, name }: { personId: string | null | undefined; name: string | null | undefined }) {
  const { can, personHref } = usePanel()
  if (!name) return <span className="text-muted-foreground">—</span>
  if (!personId || !can.people) return <span>{name}</span>
  return (
    <a href={personHref(personId)} className="font-medium underline-offset-2 hover:underline" data-usage-element="usability.drilldown">
      {name}
    </a>
  )
}
