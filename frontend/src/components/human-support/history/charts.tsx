"use client"

import { useEffect, useId, useState, type ReactNode } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { formatCivilDate } from "@/lib/format/date"
import { durationText, hoursMinutesText, type JourneyDay } from "@/schemas/human-support/monitoring.schema"

/**
 * GRÁFICOS DO PAINEL DOS ANJOS (componentes de gráfico do kit — modelo do shadcn/ui, Recharts por baixo). Cada um tem a descrição em
 * texto para leitor de tela. Dia sem medida fica em branco, nunca zero.
 */
const MARGIN = { left: 4, right: 12, top: 12, bottom: 0 }
const shortDay = (day: string) => formatCivilDate(day).slice(0, 5)

/** Evita a corrida do contêiner responsivo com a aba ainda montando (mesmo padrão dos outros gráficos do app). */
function Deferred({ children, height }: { children: ReactNode; height: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timeout = window.setTimeout(() => setReady(true), 150)
    return () => window.clearTimeout(timeout)
  }, [])
  if (!ready) return <div className="w-full animate-pulse rounded-lg bg-muted/40" style={{ height }} aria-hidden />
  return <>{children}</>
}

/** `height`: altura do gráfico em px (a tela deriva dos blocos do card com `chartHeightPx`). */

/** Curva de acionamentos por hora do dia (hora local da operação). */
export function HourlyChart({ byHour, height = 224 }: { byHour: number[]; height?: number }) {
  const captionId = useId()
  const config: ChartConfig = { count: { label: "Acionamentos", color: "var(--chart-1)" } }
  const data = byHour.map((count, hour) => ({ label: `${String(hour).padStart(2, "0")}h`, count }))
  const peak = byHour.reduce((best, count, hour) => (count > (byHour[best] ?? 0) ? hour : best), 0)
  return (
    <figure aria-describedby={captionId} className="space-y-1" data-testid="hourly-chart">
      <Deferred height={height}>
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
          <BarChart data={data} margin={MARGIN} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={2} />
            <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Bar dataKey="count" fill="var(--color-count)" radius={3} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </Deferred>
      <figcaption id={captionId} className="text-xs text-muted-foreground">
        {byHour.some((count) => count > 0) ? `Horário com mais acionamentos: ${String(peak).padStart(2, "0")}h (${byHour[peak]}).` : "Nenhum acionamento no período."}
        <span className="sr-only"> {data.filter((point) => point.count > 0).map((point) => `${point.label}: ${point.count}`).join("; ")}</span>
      </figcaption>
    </figure>
  )
}

type TipProps = { active?: boolean; label?: unknown; payload?: readonly { payload?: unknown }[] }

/** Dica dos gráficos de tempo: título e uma linha por série, com a cor da série e o tempo em horas e minutos (nunca hora decimal). */
function TimeTip({ title, rows, total }: { title: string; rows: { label: string; color: string; value: string }[]; total?: string }) {
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{title}</p>
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: row.color }} />
          <span className="flex-1 text-muted-foreground">{row.label}</span>
          <span className="font-medium tabular-nums">{row.value}</span>
        </div>
      ))}
      {total ? (
        <div className="flex items-center gap-2 border-t border-border/50 pt-1.5">
          <span className="flex-1 font-medium">Online</span>
          <span className="font-medium tabular-nums">{total}</span>
        </div>
      ) : null}
    </div>
  )
}

/** Marcas do eixo em horas cheias ("0 h", "1 h", …): de 1 em 1 h até 8 h, de 2 em 2 acima. Valores do gráfico em minutos. */
export function hourTicks(maxMinutes: number): number[] {
  const hours = Math.max(1, Math.ceil(maxMinutes / 60))
  const step = hours > 8 ? 2 : 1
  return Array.from({ length: Math.floor(hours / step) + 1 }, (_, index) => index * step * 60).concat(hours % step ? [Math.ceil(hours / step) * step * 60] : [])
}
export const hourTick = (minutes: number) => `${Math.round(minutes / 60)} h`

/** Espera média do operador por dia (da entrada na fila ao acolhimento). */
export function WaitByDayChart({ byDay, height = 224 }: { byDay: { day: string; averageSeconds: number | null; count: number }[]; height?: number }) {
  const captionId = useId()
  // Valores em segundos; o eixo mostra segundos quando todas as esperas ficam abaixo de 2 min, senão minutos; a dica, "1 min 15 s".
  const inSeconds = byDay.every((point) => point.averageSeconds === null || point.averageSeconds < 120)
  const config: ChartConfig = { seconds: { label: "Espera média", color: "var(--chart-2)" } }
  const data = byDay.map((point) => ({ label: shortDay(point.day), title: formatCivilDate(point.day), seconds: point.averageSeconds === null ? null : Math.round(point.averageSeconds), count: point.count }))
  const tip = ({ active, payload }: TipProps) => {
    const datum = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined
    if (!datum) return null
    return <TimeTip title={datum.title} rows={[{ label: datum.count === 1 ? "Espera (1 acolhido)" : `Espera média (${datum.count} acolhidos)`, color: "var(--chart-2)", value: datum.seconds === null ? "Sem acolhimento" : durationText(datum.seconds) }]} />
  }
  return (
    <figure aria-describedby={captionId} className="space-y-1" data-testid="wait-chart">
      <Deferred height={height}>
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
          <BarChart data={data} margin={MARGIN} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} tickFormatter={(value: number) => (inSeconds ? `${value} s` : `${Math.round(value / 60)} min`)} />
            <ChartTooltip cursor={false} content={tip} />
            <Bar dataKey="seconds" fill="var(--color-seconds)" radius={3} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </Deferred>
      <figcaption id={captionId} className="sr-only">
        {byDay.map((point) => `${formatCivilDate(point.day)}: ${point.count === 0 ? "sem acolhimento" : `${durationText(point.averageSeconds)} em ${point.count}`}`).join("; ")}
      </figcaption>
    </figure>
  )
}

/** Tempo online por dia, empilhado: disponível, em atendimento e em pausa (Indisponível = offline fica fora). Valores em minutos; eixo em horas cheias; a dica em horas e minutos ("1 h 25 min"), com o total online do dia. */
export function OnlineByDayChart({ days, height = 224 }: { days: JourneyDay[]; height?: number }) {
  const captionId = useId()
  const config: ChartConfig = {
    available: { label: "Disponível", color: "var(--chart-2)" },
    attendance: { label: "Em atendimento", color: "var(--chart-1)" },
    paused: { label: "Em pausa", color: "var(--chart-4)" },
  }
  const minutes = (ms: number) => Math.round(ms / 60_000)
  const data = days.map((day) => ({
    label: shortDay(day.day),
    title: formatCivilDate(day.day),
    available: minutes(day.availableMs),
    attendance: minutes(day.attendanceMs),
    paused: minutes(Object.values(day.pausedMs).reduce((sum, value) => sum + value, 0)),
    baseMs: day.baseMs,
  }))
  const ticks = hourTicks(Math.max(0, ...data.map((point) => point.available + point.attendance + point.paused)))
  const asTime = (value: number) => hoursMinutesText(value * 60_000)
  const tip = ({ active, payload }: TipProps) => {
    const datum = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined
    if (!datum) return null
    return (
      <TimeTip
        title={datum.title}
        rows={[
          { label: "Em atendimento", color: "var(--color-attendance)", value: asTime(datum.attendance) },
          { label: "Disponível", color: "var(--color-available)", value: asTime(datum.available) },
          { label: "Em pausa", color: "var(--color-paused)", value: asTime(datum.paused) },
        ]}
        total={datum.baseMs === 0 ? "Sem tempo online" : hoursMinutesText(datum.baseMs)}
      />
    )
  }
  return (
    <figure aria-describedby={captionId} className="space-y-1" data-testid="online-chart">
      <Deferred height={height}>
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height }}>
          <BarChart data={data} margin={MARGIN} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} width={36} ticks={ticks} domain={[0, ticks.at(-1) ?? 60]} tickFormatter={hourTick} />
            <ChartTooltip cursor={false} content={tip} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="attendance" stackId="online" fill="var(--color-attendance)" isAnimationActive={false} />
            <Bar dataKey="available" stackId="online" fill="var(--color-available)" isAnimationActive={false} />
            <Bar dataKey="paused" stackId="online" fill="var(--color-paused)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      </Deferred>
      <figcaption id={captionId} className="sr-only">
        {days.map((day) => `${formatCivilDate(day.day)}: ${hoursMinutesText(day.baseMs)} online`).join("; ")}
      </figcaption>
    </figure>
  )
}
