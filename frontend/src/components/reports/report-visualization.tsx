"use client"

import { useState } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { QueryTableCard } from "@/schemas/leadership/leadership.schema"
import type { VisualizationData } from "@/schemas/reports/reports.schema"

/**
 * Visualização de uma entrega de report — o conjunto de dados vem PRONTO do backend (calculado pela aplicação). A tabela com os
 * valores exatos está sempre a um clique; "sem dado" nunca é desenhado como zero; vazio é dito como vazio.
 */
const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]
const QUARTILE_COLORS: Record<string, string> = { Q1: "var(--chart-2)", Q2: "var(--chart-1)", Q3: "var(--chart-4)", Q4: "var(--chart-5)" }

export function formatUnitValue(value: number | null | undefined, unit: string | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "sem dado"
  const text = value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
  if (unit === "PERCENT") return `${text}%`
  if (unit === "PP") return `${text} p.p.`
  if (unit === "SECONDS") return `${text} s`
  if (unit === "STARS") return `${text} ★`
  if (unit === "POINTS") return `${text} pts`
  return text
}

const safeKey = (key: string, index: number) => `s${index}_${key.replace(/[^a-zA-Z0-9]/g, "")}`

export function ExactValuesTable({ card }: { card: QueryTableCard }) {
  if (card.rows.length === 0) return <p className="text-sm text-muted-foreground">Nenhuma linha atende aos filtros neste período.</p>
  return (
    <div className={cn(TABLE_FRAME, "max-h-96 overflow-auto")}>
      <Table>
        <TableHeader>
          <TableRow>
            {card.columns.map((column) => (
              <TableHead key={column.key} className={cn(column.numeric && "text-right")}>{column.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {card.rows.map((row, index) => (
            <TableRow key={index}>
              {card.columns.map((column) => (
                <TableCell key={column.key} className={cn("whitespace-nowrap", column.numeric && "text-right tabular-nums")}>{row.cells[column.key] ?? "—"}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {card.totalRows > card.rows.length ? <p className="border-t px-3 py-2 text-xs text-muted-foreground">Mostrando {card.rows.length} de {card.totalRows} linhas.</p> : null}
    </div>
  )
}

function Chart({ data }: { data: VisualizationData }) {
  const series = data.series.map((item, index) => ({ ...item, dataKey: safeKey(item.key, index) }))
  const config: ChartConfig = Object.fromEntries(series.map((item, index) => [item.dataKey, { label: item.label, color: data.type === "DISTRIBUTION" ? (QUARTILE_COLORS[item.key] ?? PALETTE[index % PALETTE.length]) : PALETTE[index % PALETTE.length] }]))
  const points = data.categories.map((category, index) => ({ category, ...Object.fromEntries(series.map((item) => [item.dataKey, item.values[index] ?? null])) }))
  const tooltip = <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value, name) => <span className="flex w-full justify-between gap-3"><span className="text-muted-foreground">{config[String(name)]?.label ?? String(name)}</span><span className="font-medium tabular-nums">{formatUnitValue(typeof value === "number" ? value : null, data.unit)}</span></span>} />} />
  const tick = (value: string) => (value.length > 18 ? `${value.slice(0, 17)}…` : value)

  if (data.type === "BAR") {
    const horizontal = data.categories.length > 6
    return (
      <ChartContainer config={config} className={cn("aspect-auto w-full", horizontal ? "h-[min(36rem,calc(2rem*var(--rows)+3rem))]" : "h-64")} style={{ ["--rows" as string]: data.categories.length }}>
        <BarChart data={points} layout={horizontal ? "vertical" : "horizontal"} margin={{ left: 4, right: 16, top: 8, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={!horizontal} horizontal={horizontal ? false : true} strokeDasharray="3 3" />
          {horizontal ? <YAxis type="category" dataKey="category" width={140} tickLine={false} axisLine={false} tickFormatter={tick} /> : <XAxis dataKey="category" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={tick} />}
          {horizontal ? <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value: number) => formatUnitValue(value, data.unit)} /> : <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => formatUnitValue(value, data.unit)} />}
          {tooltip}
          {series.map((item) => <Bar key={item.dataKey} dataKey={item.dataKey} fill={`var(--color-${item.dataKey})`} radius={3} isAnimationActive={false} />)}
        </BarChart>
      </ChartContainer>
    )
  }
  if (data.type === "LINE" || data.type === "AREA") {
    const ChartKind = data.type === "LINE" ? LineChart : AreaChart
    return (
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        <ChartKind data={points} margin={{ left: 4, right: 16, top: 8, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="category" tickLine={false} axisLine={false} tickMargin={8} />
          <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(value: number) => formatUnitValue(value, data.unit)} />
          {tooltip}
          {series.length > 1 ? <ChartLegend content={<ChartLegendContent />} /> : null}
          {series.map((item) =>
            data.type === "LINE" ? (
              <Line key={item.dataKey} dataKey={item.dataKey} type="monotone" stroke={`var(--color-${item.dataKey})`} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            ) : (
              <Area key={item.dataKey} dataKey={item.dataKey} type="monotone" stroke={`var(--color-${item.dataKey})`} fill={`var(--color-${item.dataKey})`} fillOpacity={0.15} connectNulls={false} isAnimationActive={false} />
            ),
          )}
        </ChartKind>
      </ChartContainer>
    )
  }
  // DISTRIBUTION: faixas empilhadas (Q1–Q4 ou situações) por recorte, em % de cada linha.
  return (
    <ChartContainer config={config} className="aspect-auto h-[min(36rem,calc(2rem*var(--rows)+4rem))] w-full" style={{ ["--rows" as string]: Math.max(3, data.categories.length) }}>
      <BarChart data={points} layout="vertical" margin={{ left: 4, right: 16, top: 8, bottom: 0 }} stackOffset="expand" accessibilityLayer>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <YAxis type="category" dataKey="category" width={140} tickLine={false} axisLine={false} tickFormatter={tick} />
        <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value: number) => `${Math.round(value * 100)}%`} />
        {tooltip}
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((item) => <Bar key={item.dataKey} dataKey={item.dataKey} stackId="distribution" fill={`var(--color-${item.dataKey})`} isAnimationActive={false} />)}
      </BarChart>
    </ChartContainer>
  )
}

export function ReportVisualization({ data, card, className }: { data: VisualizationData; card: QueryTableCard | null; className?: string }) {
  const [mode, setMode] = useState<"chart" | "table">(data.type === "TABLE" ? "table" : "chart")
  if (data.empty) return <p className={cn("rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground", className)}>Nenhuma linha atende aos filtros neste período — resultado vazio, não zero.</p>
  const hasChart = data.type !== "TABLE"
  return (
    <div className={cn("space-y-3", className)}>
      {data.fallbackReason ? <p className="text-xs text-muted-foreground">{data.fallbackReason}</p> : null}
      {hasChart && card ? (
        <ToggleGroup type="single" value={mode} onValueChange={(value) => { if (value) setMode(value as "chart" | "table") }} aria-label="Forma de ver os dados">
          <ToggleGroupItem value="chart">{data.type === "KPI" ? "Indicadores" : "Gráfico"}</ToggleGroupItem>
          <ToggleGroupItem value="table">Valores exatos</ToggleGroupItem>
        </ToggleGroup>
      ) : null}
      {mode === "table" || !hasChart ? (
        card ? <ExactValuesTable card={card} /> : null
      ) : data.type === "KPI" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {data.kpis.map((kpi) => (
            <div key={kpi.label} className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">{kpi.label}</p>
              <p className="text-lg font-semibold tabular-nums">{kpi.text}</p>
            </div>
          ))}
        </div>
      ) : (
        <div>
          {data.metricLabel ? <p className="mb-1 text-xs text-muted-foreground">{data.metricLabel}</p> : null}
          <Chart data={data} />
        </div>
      )}
    </div>
  )
}
