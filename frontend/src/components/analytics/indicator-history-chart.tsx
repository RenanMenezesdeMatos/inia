"use client"

import { useEffect, useId, useState } from "react"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatPercent, NO_DATA_LABEL } from "@/lib/analytics/format"
import type { HistoryPoint } from "@/schemas/analytics/analytics.schema"

const chartConfig = { value: { label: "Atingimento", color: "var(--primary)" } } satisfies ChartConfig

/**
 * Histórico mês a mês de atingimento (%) — linha de referência em 100%, SEM DADOS vira lacuna na
 * linha (nunca um zero desenhado) e a tabela em `sr-only` dá o equivalente textual pro leitor de
 * tela. `DeferredMount` evita a corrida do ResponsiveContainer com containers ainda animando
 * (mesma proteção que a tela antiga precisava dentro de Accordion/Sheet).
 */
export function IndicatorHistoryChart({ points, title, heightClassName = "h-52", compact = false }: { points: HistoryPoint[]; title: string; heightClassName?: string; compact?: boolean }) {
  const captionId = useId()
  const hasAnyValue = points.some((point) => point.value !== null)
  if (!hasAnyValue) {
    return <p className="rounded-lg bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">Sem histórico oficial nas últimas {points.length} períodos.</p>
  }
  const values = points.map((point) => point.value).filter((value): value is number => value !== null)
  // Eixo sempre rotulado e sempre incluindo a linha de 100%; a base acompanha os dados (com folga)
  // pra variação de poucos p.p. não virar uma linha reta colada no topo.
  const max = Math.ceil((Math.max(110, ...values) + 5) / 10) * 10
  const min = Math.max(0, Math.floor((Math.min(90, ...values) - 15) / 10) * 10)

  return (
    <figure aria-describedby={captionId}>
      <DeferredMount heightClassName={heightClassName}>
        <ChartContainer config={chartConfig} className={`${heightClassName} w-full aspect-auto`}>
          <LineChart data={points} margin={{ left: compact ? 0 : 4, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis domain={[min, max]} tickLine={false} axisLine={false} width={compact ? 32 : 40} tickFormatter={(value: number) => `${value}%`} />
            <ReferenceLine y={100} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
            <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value) => <span className="font-medium">{typeof value === "number" ? formatPercent(value) : NO_DATA_LABEL}</span>} />} />
            <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2.5} dot={{ r: 3.5, fill: "var(--color-value)" }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ChartContainer>
      </DeferredMount>
      <figcaption id={captionId} className="mt-1 text-[11px] text-muted-foreground">
        <span aria-hidden>Linha tracejada: meta (100%). Meses sem ponto não têm dado oficial.</span>
        <span className="sr-only">
          {title}: atingimento por período. {points.map((point) => `${point.label}: ${point.value === null ? NO_DATA_LABEL : formatPercent(point.value)}`).join("; ")}. A linha tracejada marca a meta de 100%.
        </span>
      </figcaption>
    </figure>
  )
}

function DeferredMount({ children, heightClassName }: { children: React.ReactNode; heightClassName: string }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timeout = window.setTimeout(() => setReady(true), 150)
    return () => window.clearTimeout(timeout)
  }, [])
  if (!ready) return <div className={`w-full animate-pulse rounded-lg bg-muted/40 ${heightClassName}`} aria-hidden />
  return <>{children}</>
}
