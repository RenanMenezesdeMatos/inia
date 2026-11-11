"use client"

import { useState } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Timer } from "lucide-react"

import { DateRangePicker, periodWithinDays, presetRangeById } from "@/components/ui/date-picker"
import { Skeleton } from "@/components/ui/skeleton"
import { InlineError } from "@/components/ui/states"
import { IconBadge, SURFACE_CARD } from "@/components/ui/surface"
import { formatSeconds } from "@/lib/format/number"
import { cn } from "@/lib/utils"
import type { ResponseTimeSummary } from "@/schemas/admin/assistant-response-times.schema"
import { fetchConversationResponseTimes, type ResponseTimeFilters } from "@/services/admin/assistant-conversations-service"

/**
 * TEMPO DE RESPOSTA DA INIA (KPI de desempenho técnico): no chat de texto, do envio da pergunta até a resposta completa gravada — o
 * tempo que o colaborador espera pela informação, com tudo o que a INIA fez no meio. Média, mediana e o tempo em que 90% das
 * respostas chegaram, com os filtros da lista (grupo, subgrupo, tipo, situação, busca) e um período próprio sobre a data da
 * resposta (padrão: último mês). A voz fica de fora: lá a pergunta e a resposta são gravadas juntas ao fim da fala.
 */
const MAX_DAYS = 366
const SMALL_SAMPLE = 5
const POLL_MS = 60_000
const validatePeriod = periodWithinDays(MAX_DAYS)

export type ResponseTimeCardProps = { filters: Omit<ResponseTimeFilters, "from" | "to"> }

export function ResponseTimeCard({ filters }: ResponseTimeCardProps) {
  const [period, setPeriod] = useState(() => presetRangeById("last-month"))
  const params: ResponseTimeFilters = { ...filters, ...period }
  const query = useQuery({ queryKey: ["admin-assistant-response-times", params], queryFn: () => fetchConversationResponseTimes(params), placeholderData: keepPreviousData, refetchInterval: POLL_MS })
  return (
    <section aria-labelledby="response-time-title" className={cn(SURFACE_CARD, "flex flex-col gap-4 p-4 sm:p-5")} data-testid="response-time-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <IconBadge icon={Timer} tone="neutral" size="sm" />
          <div className="min-w-0 space-y-0.5">
            <h2 id="response-time-title" className="text-sm font-semibold">
              Tempo de resposta da INIA
            </h2>
            <p className="text-xs text-muted-foreground">Chat de texto: do envio da pergunta até a resposta completa.</p>
          </div>
        </div>
        <DateRangePicker
          aria-label="Período do tempo de resposta"
          value={period}
          confirm={{ validate: validatePeriod }}
          onChange={(next) => {
            if (next.from && next.to) setPeriod({ from: next.from, to: next.to })
          }}
        />
      </header>
      {query.isPending ? (
        <Skeleton className="h-16 w-full rounded-xl" />
      ) : query.isError ? (
        <InlineError message="Não foi possível calcular o tempo de resposta." onRetry={() => void query.refetch()} />
      ) : (
        <SummaryBody summary={query.data} />
      )}
      <p className="text-xs text-muted-foreground">Usa os filtros da lista; o período aqui é o da resposta. A voz fica de fora: lá a pergunta e a resposta são gravadas juntas, ao fim da fala.</p>
    </section>
  )
}

function SummaryBody({ summary }: { summary: ResponseTimeSummary }) {
  if (summary.replies === 0 || summary.averageSeconds === null || summary.medianSeconds === null || summary.p90Seconds === null) {
    return <p className="text-sm text-muted-foreground">Nenhuma resposta da INIA no chat de texto no período.</p>
  }
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Média" value={formatSeconds(summary.averageSeconds)} testId="response-time-average" />
        <Stat label="Mediana" hint="Metade das respostas chegou em até" value={formatSeconds(summary.medianSeconds)} />
        <Stat label="90% em até" hint="Nove em cada dez respostas chegaram em até" value={formatSeconds(summary.p90Seconds)} />
        <Stat label="Respostas" value={summary.replies.toLocaleString("pt-BR")} />
      </dl>
      {summary.replies < SMALL_SAMPLE ? <p className="text-xs text-muted-foreground">Poucos dados: com menos de {SMALL_SAMPLE} respostas, um único caso muda muito o resultado.</p> : null}
    </div>
  )
}

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 px-3 py-2">
      <dt className="text-xs font-medium text-muted-foreground" title={hint}>
        {label}
      </dt>
      <dd className="text-xl font-semibold tabular-nums text-primary dark:text-chart-4" data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}
