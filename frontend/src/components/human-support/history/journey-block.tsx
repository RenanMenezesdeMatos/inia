"use client"

import type { ReactNode } from "react"
import { ChevronDown, CircleCheck, CirclePause, Gauge, MessagesSquare, Timer } from "lucide-react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { chartHeightPx } from "@/components/ui/customizable-grid/layout"
import { StatusChip, SURFACE_CARD, toneChip, type Tone } from "@/components/ui/surface"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCivilDate } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { PAUSE_REASON_LABELS, PAUSE_REASONS } from "@/schemas/human-support/catalogs.schema"
import { hoursMinutesText, pctText, type JourneyDay, type JourneySummary } from "@/schemas/human-support/monitoring.schema"

import { OnlineByDayChart } from "./charts"
import { TermLabel, type Term } from "./term-hint"

/**
 * JORNADA DO ANJO no período (regras do responsável em 2026-11-11). Tempo ONLINE = Disponível + Em atendimento + Em pausa, mostrado em
 * horas e minutos e usado como BASE dos percentuais; Indisponível é o mesmo estado que offline e fica fora. Base zero = "Sem tempo
 * online no período". Dia produtivo = disponível aguardando + em atendimento, com os dois componentes. Com vários dias: a média diária
 * de disponível e de atendimento entre os dias COM tempo online (e quantos entram nela). Cada termo tem o ⓘ com a definição.
 */
const sumPaused = (paused: JourneyDay["pausedMs"]) => PAUSE_REASONS.reduce((sum, reason) => sum + paused[reason], 0)

function Tile({ icon: Icon, tone, label, term, value, detail }: { icon: typeof Timer; tone: Tone; label: string; term?: Term; value: string; detail?: string | undefined }) {
  return (
    <div className={cn(SURFACE_CARD, "flex h-full items-start gap-3 rounded-xl px-3 py-2.5")}>
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(tone))}>
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-xs text-muted-foreground">{term ? <TermLabel term={term}>{label}</TermLabel> : label}</span>
        <span className="block text-lg font-semibold tabular-nums">{value}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </div>
  )
}

/** Os cartões da jornada, um por medida (cada um vira um card na visão personalizável). Base zero = nenhum cartão (a tela avisa). */
export function journeyTileCards(summary: JourneySummary): { id: string; title: string; render: () => ReactNode }[] {
  const { total, shares } = summary
  const paused = sumPaused(total.pausedMs)
  return [
    { id: "online", title: "Online", render: () => <Tile icon={Timer} tone="info" label="Online" term="online" value={hoursMinutesText(summary.baseMs)} detail="Base dos percentuais" /> },
    { id: "disponivel", title: "Disponível", render: () => <Tile icon={CircleCheck} tone="success" label="Disponível" term="available" value={pctText(shares.available)} detail={hoursMinutesText(total.availableMs)} /> },
    { id: "em-atendimento", title: "Em atendimento", render: () => <Tile icon={MessagesSquare} tone="info" label="Em atendimento" term="attendance" value={pctText(shares.attendance)} detail={hoursMinutesText(total.attendanceMs)} /> },
    { id: "em-pausa", title: "Em pausa (total)", render: () => <Tile icon={CirclePause} tone="warning" label="Em pausa (total)" value={pctText(shares.pausedTotal)} detail={hoursMinutesText(paused)} /> },
    { id: "dia-produtivo", title: "Dia produtivo", render: () => <Tile icon={Gauge} tone="success" label="Dia produtivo" term="productive" value={pctText(shares.productive)} detail={`${hoursMinutesText(total.availableMs)} aguardando + ${hoursMinutesText(total.attendanceMs)} atendendo`} /> },
  ]
}

/** Pausas por tipo e a média diária (um card próprio na visão personalizável). */
export function JourneyPauses({ summary, multiDay }: { summary: JourneySummary; multiDay: boolean }) {
  const { total, shares } = summary
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" aria-label="Pausas por tipo">
        {PAUSE_REASONS.map((reason) => (
          <StatusChip key={reason} tone={total.pausedMs[reason] > 0 ? "warning" : "neutral"} icon={CirclePause}>
            {PAUSE_REASON_LABELS[reason]}: {hoursMinutesText(total.pausedMs[reason])} · {pctText(shares.paused[reason])}
          </StatusChip>
        ))}
      </div>
      {multiDay && summary.dailyAverage ? (
        <p className="text-xs text-muted-foreground" data-testid="journey-daily-average">
          Média diária: {hoursMinutesText(summary.dailyAverage.availableMs)} disponível e {hoursMinutesText(summary.dailyAverage.attendanceMs)} em atendimento, entre {summary.daysWithOnline}{" "}
          {summary.daysWithOnline === 1 ? "dia" : "dias"} com tempo online.
        </p>
      ) : null}
    </div>
  )
}

export const JourneyEmpty = () => (
  <p className={cn(SURFACE_CARD, "border-dashed px-3 py-4 text-center text-sm text-muted-foreground")} data-testid="journey-empty">
    Sem tempo online no período
  </p>
)

/** A jornada de UM Anjo (detalhe e "Sua jornada"): os cartões, as pausas e a média. */
export function JourneySummaryTiles({ summary, multiDay }: { summary: JourneySummary; multiDay: boolean }) {
  if (summary.baseMs === 0) return <JourneyEmpty />
  return (
    <div className="space-y-3" data-testid="journey-summary">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {journeyTileCards(summary).map((card) => (
          <div key={card.id}>{card.render()}</div>
        ))}
      </div>
      <JourneyPauses summary={summary} multiDay={multiDay} />
    </div>
  )
}

/**
 * Tempo online por dia, num cartão branco: o gráfico empilhado e, recolhida abaixo dele, a tabela com os mesmos dias (horas,
 * percentuais e o Indisponível). `showUnavailable`: a coluna Indisponível de UM Anjo; somada para vários Anjos (24 h por Anjo sem
 * serviço) não diz nada e fica escondida. `rows`: os blocos do card na visão personalizável (o gráfico ocupa a altura escolhida).
 */
export function JourneyDays({ days, showUnavailable = true, rows = null }: { days: JourneyDay[]; showUnavailable?: boolean; rows?: number | null }) {
  return (
    <div className={cn(SURFACE_CARD, "h-full space-y-3 p-4")}>
      <h4 className="text-sm font-medium">Tempo online por dia</h4>
      <OnlineByDayChart days={days} height={chartHeightPx(rows, 112)} />
      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          <span className="group-data-[state=open]:hidden">Ver por dia em tabela</span>
          <span className="hidden group-data-[state=open]:inline">Esconder a tabela</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <div className={TABLE_FRAME}>
            <Table aria-label="Jornada por dia">
              <TableHeader>
                <TableRow>
                  <TableHead>Dia</TableHead>
                  <TableHead className="text-right">
                    <TermLabel term="online">Online</TermLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <TermLabel term="available">Disponível</TermLabel>
                  </TableHead>
                  <TableHead className="text-right">
                    <TermLabel term="attendance">Em atendimento</TermLabel>
                  </TableHead>
                  <TableHead className="text-right">Em pausa</TableHead>
                  <TableHead className="text-right">
                    <TermLabel term="productive">Dia produtivo</TermLabel>
                  </TableHead>
                  {showUnavailable ? (
                    <TableHead className="text-right">
                      <TermLabel term="unavailable">Indisponível</TermLabel>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {days.map((day) => {
                  const pct = (part: number) => (day.baseMs > 0 ? pctText((part / day.baseMs) * 100) : "—")
                  const paused = sumPaused(day.pausedMs)
                  return (
                    <TableRow key={day.day} className={cn(day.baseMs === 0 && "text-muted-foreground")}>
                      <TableCell>{formatCivilDate(day.day)}</TableCell>
                      <TableCell className="text-right tabular-nums">{day.baseMs === 0 ? "Sem tempo online" : hoursMinutesText(day.baseMs)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hoursMinutesText(day.availableMs)} <span className="text-muted-foreground">({pct(day.availableMs)})</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {hoursMinutesText(day.attendanceMs)} <span className="text-muted-foreground">({pct(day.attendanceMs)})</span>
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums"
                        title={PAUSE_REASONS.filter((reason) => day.pausedMs[reason] > 0).map((reason) => `${PAUSE_REASON_LABELS[reason]}: ${hoursMinutesText(day.pausedMs[reason])}`).join(" · ") || undefined}
                      >
                        {hoursMinutesText(paused)} <span className="text-muted-foreground">({pct(paused)})</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{pct(day.availableMs + day.attendanceMs)}</TableCell>
                      {showUnavailable ? <TableCell className="text-right tabular-nums text-muted-foreground">{hoursMinutesText(day.unavailableMs)}</TableCell> : null}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
