"use client"

import { useId } from "react"
import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts"

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { useIsMobile } from "@/hooks/use-mobile"

import { plural, rateOf } from "./diagnostics-shared"
import { percent } from "./memory-labels"

/**
 * GRÁFICOS DO DIAGNÓSTICO (shadcn/Recharts). Uma cor por TRABALHO, a mesma em todos os gráficos:
 *   - desvios = vermelho de alerta (status crítico do guia de dataviz);
 *   - acertos = roxo da marca.
 * A dupla foi VALIDADA (validate_palette, claro sobre #ffffff e escuro sobre #1d1b16): CVD ΔE 22,2, visão normal 22,6, contraste ≥ 3:1.
 * Vermelho × verde reprovou (ΔE 4,1 em deuteranopia) — por isso acerto não é verde. Legenda sempre presente; o valor de cada barra está
 * no tooltip, na legenda acessível (figcaption) e nas listas das outras visões (a "tabela" do gráfico).
 */
export const OUTCOME_CHART_CONFIG = {
  deviations: { label: "Desvios", color: "#d03b3b" },
  met: { label: "Acertos", color: "#b266d9" },
} satisfies ChartConfig

/** Uma linha do gráfico: o rótulo (nome curto), um contexto opcional (tema, documento) e as contagens de regras avaliadas. */
export type OutcomeRow = { key: string; label: string; context?: string | null; deviations: number; met: number; assessed: number }

/** Quebra o rótulo em até duas linhas (layout, não leitura); o que não couber termina em "…" e o texto inteiro fica no <title>. */
function wrapLabel(text: string, maxChars: number): string[] {
  const lines: string[] = []
  let current = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word
    if (next.length <= maxChars || !current) current = next
    else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  if (lines.length <= 2) return lines
  const second = lines.slice(1).join(" ")
  return [lines[0]!, `${second.slice(0, Math.max(maxChars - 1, 1)).trimEnd()}…`]
}

type TickProps = { x?: number; y?: number; payload?: { value: string }; labels: ReadonlyMap<string, string>; maxChars: number }
export function CategoryTick({ x = 0, y = 0, payload, labels, maxChars }: TickProps) {
  const full = labels.get(payload?.value ?? "") ?? payload?.value ?? ""
  const lines = wrapLabel(full, maxChars)
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{full}</title>
      <text x={-10} y={0} textAnchor="end" className="fill-foreground text-xs">
        {lines.map((line, index) => (
          <tspan key={index} x={-10} dy={index === 0 ? (lines.length > 1 ? "-0.2em" : "0.35em") : "1.2em"}>{line}</tspan>
        ))}
      </text>
    </g>
  )
}

type SegmentProps = { x?: number; y?: number; width?: number; height?: number; fill?: string; outer: boolean }
/** Segmento da barra empilhada: ponta arredondada (4px) só no fim da barra, base reta; 2px de respiro na cor da superfície. */
function Segment({ x = 0, y = 0, width = 0, height = 0, fill, outer }: SegmentProps) {
  if (width <= 0 || height <= 0) return <g />
  return <Rectangle x={x} y={y} width={width} height={height} fill={fill} radius={outer ? [0, 4, 4, 0] : 0} stroke="var(--card)" strokeWidth={2} />
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} />
}

/** Dica de uma linha: desvios, acertos, avaliações e taxa — o texto em tinta de texto, a cor só no marcador. */
function OutcomeTooltipBody({ row }: { row: OutcomeRow }) {
  return (
    <div className="grid max-w-72 min-w-48 gap-1.5 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-xl">
      <div>
        <p className="font-medium">{row.label}</p>
        {row.context ? <p className="text-muted-foreground">{row.context}</p> : null}
      </div>
      <div className="grid gap-1">
        <p className="flex items-center gap-2"><Swatch color={OUTCOME_CHART_CONFIG.deviations.color} /><span className="text-muted-foreground">Desvios</span><span className="ml-auto font-medium tabular-nums">{row.deviations}</span></p>
        <p className="flex items-center gap-2"><Swatch color={OUTCOME_CHART_CONFIG.met.color} /><span className="text-muted-foreground">Acertos</span><span className="ml-auto font-medium tabular-nums">{row.met}</span></p>
      </div>
      <p className="text-muted-foreground">{plural(row.assessed, "avaliação", "avaliações")} · taxa de desvio {percent(rateOf(row.deviations, row.assessed))}</p>
    </div>
  )
}

/**
 * ACERTOS × DESVIOS por linha (tema, ponto, documento, seção): barras horizontais empilhadas a partir da MESMA base — desvios primeiro
 * (alinhados no zero, comparáveis entre linhas), acertos em seguida. Altura cresce com o número de linhas (nunca rolagem dentro do
 * gráfico). Clicar numa barra abre as chamadas, quando a tela oferece.
 */
export function OutcomeBarChart({ rows, caption, onSelect }: { rows: readonly OutcomeRow[]; caption: string; onSelect?: (row: OutcomeRow) => void }) {
  const captionId = useId()
  const isMobile = useIsMobile()
  const labels = new Map(rows.map((row) => [row.key, row.label]))
  const height = rows.length * 40 + 72
  const select = onSelect ? (entry: unknown) => { const row = (entry as { payload?: OutcomeRow }).payload; if (row) onSelect(row) } : undefined
  return (
    <figure aria-describedby={captionId}>
      <ChartContainer config={OUTCOME_CHART_CONFIG} className="aspect-auto w-full" style={{ height }}>
        <BarChart data={[...rows]} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barSize={16} accessibilityLayer>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tickMargin={6} />
          <YAxis type="category" dataKey="key" width={isMobile ? 132 : 236} tickLine={false} axisLine={false} interval={0} tick={<CategoryTick labels={labels} maxChars={isMobile ? 18 : 36} />} />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={({ active, payload }) => (active && payload?.[0] ? <OutcomeTooltipBody row={payload[0].payload as OutcomeRow} /> : null)} />
          <ChartLegend verticalAlign="top" content={<ChartLegendContent className="justify-start pb-3" />} />
          <Bar dataKey="deviations" stackId="outcome" fill="var(--color-deviations)" isAnimationActive={false} cursor={select ? "pointer" : undefined} onClick={select}
            shape={(props: unknown) => <Segment {...(props as SegmentProps)} outer={((props as { payload?: OutcomeRow }).payload?.met ?? 0) === 0} />} />
          <Bar dataKey="met" stackId="outcome" fill="var(--color-met)" isAnimationActive={false} cursor={select ? "pointer" : undefined} onClick={select}
            shape={(props: unknown) => <Segment {...(props as SegmentProps)} outer />} />
        </BarChart>
      </ChartContainer>
      <figcaption id={captionId} className="sr-only">
        {caption}: {rows.map((row) => `${row.label}${row.context ? ` (${row.context})` : ""} — ${row.deviations} desvio(s), ${row.met} acerto(s) em ${row.assessed} avaliação(ões)`).join("; ")}.
      </figcaption>
    </figure>
  )
}

/** Ponto do gráfico de prioridade. Pontos com as MESMAS coordenadas viram um marcador só (a dica lista todos — nada some por baixo). */
export type PriorityPoint = { key: string; label: string; context?: string | null; assessed: number; deviations: number }
type PriorityDot = { x: number; y: number; members: PriorityPoint[] }
/** Quantidade neutra (pontos, indicações) = azul: nem desvio (vermelho) nem acerto (roxo) — validado junto do vermelho nos dois temas. */
export const NEUTRAL_SERIES_THEME = { light: "#2a78d6", dark: "#3987e5" }
const PRIORITY_CONFIG = { points: { label: "Pontos do processo", theme: NEUTRAL_SERIES_THEME } } satisfies ChartConfig

/**
 * ONDE AGIR PRIMEIRO: cada ponto do processo pelo volume (avaliações, eixo x) e pela taxa de desvio (eixo y). Mais à direita = mais
 * avaliado; mais acima = mais desvio. A linha marca a taxa do recorte inteiro. Um eixo só por dimensão (nada de eixo duplo).
 */
export function PriorityScatter({ points, reference, caption, onSelect }: { points: readonly PriorityPoint[]; reference: number | null; caption: string; onSelect?: (point: PriorityPoint) => void }) {
  const captionId = useId()
  const dots = new Map<string, PriorityDot>()
  for (const point of points) {
    const y = rateOf(point.deviations, point.assessed) ?? 0
    const key = `${point.assessed}|${y}`
    const existing = dots.get(key)
    if (existing) existing.members.push(point)
    else dots.set(key, { x: point.assessed, y, members: [point] })
  }
  const data = [...dots.values()]
  return (
    <figure aria-describedby={captionId}>
      <ChartContainer config={PRIORITY_CONFIG} className="aspect-auto h-80 w-full">
        <ScatterChart margin={{ left: 4, right: 20, top: 16, bottom: 20 }} accessibilityLayer>
          <CartesianGrid />
          <XAxis type="number" dataKey="x" allowDecimals={false} tickLine={false} axisLine={false} tickMargin={6} label={{ value: "Avaliações", position: "insideBottom", offset: -14, className: "fill-muted-foreground text-xs" }} />
          <YAxis type="number" dataKey="y" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value: number) => `${value}%`} tickLine={false} axisLine={false} width={44} />
          <ZAxis range={[90, 90]} />
          {reference !== null ? <ReferenceLine y={reference} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `taxa do recorte ${percent(reference)}`, position: "insideTopRight", className: "fill-muted-foreground text-xs" }} /> : null}
          <ChartTooltip cursor={false} content={({ active, payload }) => {
            const dot = active ? (payload?.[0]?.payload as PriorityDot | undefined) : undefined
            if (!dot) return null
            return (
              <div className="grid max-w-72 min-w-48 gap-1.5 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-xl">
                <p className="text-muted-foreground">{plural(dot.x, "avaliação", "avaliações")} · taxa de desvio {percent(dot.y)}</p>
                <ul className="grid gap-1">
                  {dot.members.slice(0, 5).map((member) => <li key={member.key}><span className="font-medium">{member.label}</span>{member.context ? <span className="text-muted-foreground"> · {member.context}</span> : null}</li>)}
                </ul>
                {dot.members.length > 5 ? <p className="text-muted-foreground">+{dot.members.length - 5} ponto(s) com os mesmos números</p> : null}
              </div>
            )
          }} />
          <Scatter data={data} fill="var(--color-points)" isAnimationActive={false} cursor={onSelect ? "pointer" : undefined}
            onClick={onSelect ? (entry: unknown) => { const dot = (entry as { payload?: PriorityDot }).payload; if (dot?.members.length === 1) onSelect(dot.members[0]!) } : undefined}
            shape={(props: unknown) => { const { cx = 0, cy = 0, payload } = props as { cx?: number; cy?: number; payload?: PriorityDot }; return <circle cx={cx} cy={cy} r={(payload?.members.length ?? 1) > 1 ? 7 : 5} fill="var(--color-points)" stroke="var(--card)" strokeWidth={2} /> }} />
        </ScatterChart>
      </ChartContainer>
      <figcaption id={captionId} className="sr-only">
        {caption}: {points.map((point) => `${point.label} — ${point.assessed} avaliação(ões), taxa de desvio ${percent(rateOf(point.deviations, point.assessed))}`).join("; ")}.
      </figcaption>
    </figure>
  )
}
