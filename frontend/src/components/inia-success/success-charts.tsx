"use client"

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import type { Average, Bucket, Rate } from "@/schemas/inia-success/inia-success.schema"

import { averageValue, bucketLabel, bucketTitle, formatCount, formatPercent, formatSeconds, NO_BASE, plural, rateBase, rateValue, seriesConfig, SMALL_SAMPLE, type SeriesKey } from "./success-format"
import { ChartTip } from "./success-ui"

/**
 * Gráficos da evolução (componentes de gráfico do kit, Recharts por baixo). Um eixo só, uma série por gráfico (a cor é a da entidade);
 * ponto sem base suficiente fica em branco — nunca zero. Cada gráfico tem a tabela equivalente para leitor de tela.
 */
type TipProps = {
  active?: boolean
  payload?: readonly { payload?: unknown }[]
}

const MARGIN = { left: 4, right: 12, top: 12, bottom: 0 }
const PERCENT_TICKS = [0, 0.25, 0.5, 0.75, 1]

function hiddenNote(total: number, hidden: number) {
  if (total === 0 || hidden === 0) return null
  return hidden === total
    ? "Cada ponto precisa de 5 itens ou mais para mostrar a taxa ou a média. Amplie o período ou tire o filtro."
    : `${formatCount(hidden)} de ${formatCount(total)} pontos sem base suficiente (menos de 5 itens) ficam em branco.`
}

/** Nenhum ponto com base suficiente: um aviso no lugar de um plano vazio (que pareceria "zero"). */
function EmptyPlot() {
  return (
    <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
      Sem base suficiente em nenhum ponto do período
    </div>
  )
}

export type RatePoint = { bucket: Bucket; rate: Rate }

/** Taxa no tempo (0–100%, eixo fixo para comparar entre gráficos). O tooltip mostra a taxa, o numerador e o denominador. */
export function RateTrend({ name, points, series, unit }: { name: string; points: readonly RatePoint[]; series: SeriesKey; unit: readonly [string, string] }) {
  const data = points.map((point) => ({
    label: bucketLabel(point.bucket),
    title: bucketTitle(point.bucket),
    [series]: point.rate.status === "OK" ? point.rate.value : null,
    rate: point.rate,
  }))
  const hidden = points.filter((point) => point.rate.status !== "OK").length
  const tip = ({ active, payload }: TipProps) => {
    const datum = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined
    if (!datum) return null
    const detail = datum.rate.status === "NO_DATA" ? `Nenhum item em ${unit[1]}` : rateBase(datum.rate, unit)
    return <ChartTip title={datum.title} rows={[{ label: name, value: rateValue(datum.rate), detail, series }]} />
  }
  return (
    <figure className="space-y-2">
      {hidden === points.length ? (
        <EmptyPlot />
      ) : (
        <ChartContainer config={seriesConfig(series, name)} className="aspect-auto h-44 w-full">
          <LineChart data={data} margin={MARGIN} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <YAxis domain={[0, 1]} ticks={PERCENT_TICKS} tickFormatter={(value: number) => formatPercent(value)} tickLine={false} axisLine={false} width={44} />
            <ChartTooltip cursor={{ strokeDasharray: "3 3" }} content={tip as never} />
            <Line
              dataKey={series}
              type="monotone"
              stroke={`var(--color-${series})`}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, fill: "var(--background)" }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      )}
      <figcaption className="text-xs text-muted-foreground">{hiddenNote(points.length, hidden)}</figcaption>
      <table className="sr-only">
        <caption>{name}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucket.key}>
              <th scope="row">{bucketTitle(point.bucket)}</th>
              <td>{rateValue(point.rate)}</td>
              <td>{point.rate.status === "NO_DATA" ? NO_BASE : rateBase(point.rate, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

export type AveragePoint = { bucket: Bucket; average: Average; base: number }

/** Média de tempo no tempo (segundos). O tooltip mostra a média, quantas respostas a sustentam e quantas perguntas houve. */
export function SecondsTrend({
  name,
  points,
  series,
  unit,
  baseUnit,
}: {
  name: string
  points: readonly AveragePoint[]
  series: SeriesKey
  unit: readonly [string, string]
  baseUnit: readonly [string, string]
}) {
  const data = points.map((point) => ({
    label: bucketLabel(point.bucket),
    title: bucketTitle(point.bucket),
    [series]: point.average.status === "OK" ? point.average.value : null,
    average: point.average,
    base: point.base,
  }))
  const hidden = points.filter((point) => point.average.status !== "OK").length
  const tip = ({ active, payload }: TipProps) => {
    const datum = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined
    if (!datum) return null
    return (
      <ChartTip
        title={datum.title}
        rows={[
          {
            label: name,
            value: averageValue(datum.average),
            detail: `${plural(datum.average.count, unit)} de ${plural(datum.base, baseUnit)}`,
            series,
          },
        ]}
      />
    )
  }
  return (
    <figure className="space-y-2">
      {hidden === points.length ? (
        <EmptyPlot />
      ) : (
        <ChartContainer config={seriesConfig(series, name)} className="aspect-auto h-44 w-full">
          <LineChart data={data} margin={MARGIN} accessibilityLayer>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <YAxis domain={[0, "auto"]} tickFormatter={(value: number) => formatSeconds(value)} tickLine={false} axisLine={false} width={52} />
            <ChartTooltip cursor={{ strokeDasharray: "3 3" }} content={tip as never} />
            <Line
              dataKey={series}
              type="monotone"
              stroke={`var(--color-${series})`}
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, fill: "var(--background)" }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      )}
      <figcaption className="text-xs text-muted-foreground">{hiddenNote(points.length, hidden)}</figcaption>
      <table className="sr-only">
        <caption>{name}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucket.key}>
              <th scope="row">{bucketTitle(point.bucket)}</th>
              <td>{point.average.status === "OK" ? formatSeconds(point.average.value) : point.average.status === "SMALL_SAMPLE" ? SMALL_SAMPLE : NO_BASE}</td>
              <td>{`${plural(point.average.count, unit)} de ${plural(point.base, baseUnit)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** Quantidade por intervalo (barras). Zero aqui é zero de verdade: é contagem de registros, não taxa. */
export function CountBars({ name, points, series, unit }: { name: string; points: readonly { bucket: Bucket; count: number }[]; series: SeriesKey; unit: readonly [string, string] }) {
  const data = points.map((point) => ({
    label: bucketLabel(point.bucket),
    title: bucketTitle(point.bucket),
    [series]: point.count,
  }))
  const tip = ({ active, payload }: TipProps) => {
    const datum = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined
    if (!datum) return null
    return (
      <ChartTip
        title={datum.title}
        rows={[
          {
            label: name,
            value: plural(Number(datum[series] ?? 0), unit),
            series,
          },
        ]}
      />
    )
  }
  return (
    <figure className="space-y-2">
      <ChartContainer config={seriesConfig(series, name)} className="aspect-auto h-36 w-full">
        <BarChart data={data} margin={MARGIN} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={tip as never} />
          <Bar dataKey={series} fill={`var(--color-${series})`} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>{name}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.bucket.key}>
              <th scope="row">{bucketTitle(point.bucket)}</th>
              <td>{plural(point.count, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
