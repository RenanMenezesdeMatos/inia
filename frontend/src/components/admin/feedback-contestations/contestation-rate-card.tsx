"use client"

import { useState } from "react"
import { MessageSquareWarning } from "lucide-react"

import { DateRangePicker, periodWithinDays, presetRangeById } from "@/components/ui/date-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineError } from "@/components/ui/states"
import { IconBadge, SURFACE_CARD } from "@/components/ui/surface"
import { formatPercent } from "@/lib/format/number"
import { cn } from "@/lib/utils"
import { useContestationSummaryQuery } from "@/queries/admin/use-feedback-contestation-queries"
import type { ContestationSummary } from "@/schemas/admin/feedback-contestation.schema"
import { CONTESTATION_DECISION_LABELS } from "@/schemas/feedback-ratings/feedback-rating.schema"

/**
 * TAXA DE CONTESTAÇÃO (KPI de experiência do operador): dos feedbacks entregues no período a pessoas do seu escopo, quantos o
 * colaborador marcou como “não foi útil” — vigente ou já respondida (a mesma regra da fila abaixo). A porcentagem só aparece com 5
 * ou mais feedbacks; antes disso, a contagem e o aviso. Motivos e respostas do maior para o menor. O período (padrão: último mês)
 * vale só para este cartão; a fila abaixo continua com todas as contestações.
 */
const MAX_DAYS = 366
const RATE_MIN_SAMPLE = 5
const validatePeriod = periodWithinDays(MAX_DAYS)

export function ContestationRateCard() {
  const [period, setPeriod] = useState(() => presetRangeById("last-month"))
  const query = useContestationSummaryQuery(period)
  return (
    <section aria-labelledby="contestation-rate-title" className={cn(SURFACE_CARD, "flex flex-col gap-4 p-4 sm:p-5")} data-testid="contestation-rate-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <IconBadge icon={MessageSquareWarning} tone="neutral" size="sm" />
          <div className="min-w-0 space-y-0.5">
            <h2 id="contestation-rate-title" className="text-sm font-semibold">
              Taxa de contestação
            </h2>
            <p className="text-xs text-muted-foreground">Dos feedbacks entregues no período, quantos o colaborador marcou como “não foi útil”.</p>
          </div>
        </div>
        <DateRangePicker
          aria-label="Período da taxa de contestação"
          value={period}
          confirm={{ validate: validatePeriod }}
          onChange={(next) => {
            if (next.from && next.to) setPeriod({ from: next.from, to: next.to })
          }}
        />
      </header>
      {query.isPending ? (
        <Skeleton className="h-20 w-full rounded-xl" />
      ) : query.isError ? (
        <InlineError message="Não foi possível calcular a taxa de contestação." onRetry={() => void query.refetch()} />
      ) : (
        <SummaryBody summary={query.data} />
      )}
    </section>
  )
}

function SummaryBody({ summary }: { summary: ContestationSummary }) {
  if (summary.delivered === 0) return <p className="text-sm text-muted-foreground">Nenhum feedback entregue no período.</p>
  const statuses = [
    { key: "pending", label: "Aguardando resposta", count: summary.byStatus.pending },
    { key: "ACCEPTED", label: CONTESTATION_DECISION_LABELS.ACCEPTED, count: summary.byStatus.ACCEPTED },
    { key: "PARTIALLY_ACCEPTED", label: CONTESTATION_DECISION_LABELS.PARTIALLY_ACCEPTED, count: summary.byStatus.PARTIALLY_ACCEPTED },
    { key: "REJECTED", label: CONTESTATION_DECISION_LABELS.REJECTED, count: summary.byStatus.REJECTED },
  ].sort((a, b) => b.count - a.count)
  return (
    <div className="grid gap-5 sm:grid-cols-[minmax(10rem,auto)_minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-0.5">
        {summary.rate !== null ? (
          <p className="text-3xl font-semibold tabular-nums text-primary dark:text-chart-4" data-testid="contestation-rate">
            {formatPercent(summary.rate)}
          </p>
        ) : (
          <p className="text-base font-semibold">Poucos dados</p>
        )}
        <p className="text-xs text-muted-foreground tabular-nums">
          {summary.contested} de {summary.delivered} {summary.delivered === 1 ? "feedback entregue" : "feedbacks entregues"}
        </p>
        {summary.rate === null ? <p className="text-xs text-muted-foreground">A porcentagem aparece com {RATE_MIN_SAMPLE} feedbacks ou mais no período.</p> : null}
      </div>
      <CountList title="Por motivo" items={summary.byReason.map((entry) => ({ key: entry.reason, label: entry.label, count: entry.count }))} empty="Nenhuma contestação no período." />
      {summary.contested > 0 ? <CountList title="Resposta de quem revisa" items={statuses} /> : null}
    </div>
  )
}

function CountList({ title, items, empty }: { title: string; items: { key: string; label: string; count: number }[]; empty?: string }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.key} className={cn("flex items-baseline justify-between gap-3", item.count === 0 && "text-muted-foreground")}>
              <span className="min-w-0">{item.label}</span>
              <span className="shrink-0 tabular-nums">{item.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
