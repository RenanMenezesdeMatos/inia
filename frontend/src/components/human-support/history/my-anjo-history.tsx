"use client"

import { useState } from "react"

import { Skeleton } from "@/components/ui/skeleton"
import { useOperationHistoryQuery } from "@/queries/human-support/use-human-support-admin"

import { PanelError } from "../monitoring/panel-error"
import { defaultPanelPeriod, PeriodPicker, type PanelPeriod } from "../monitoring/period-picker"
import { AnjoHistoryDetail, CoverageNote } from "./operation-history"

/** O PRÓPRIO histórico do Anjo (migration 191): a jornada e os indicadores de atendimento dele no período — nunca os de outro Anjo. */
export function MyAnjoHistory() {
  const [period, setPeriod] = useState<PanelPeriod>(() => defaultPanelPeriod())
  const query = useOperationHistoryQuery(period, "anjo")
  const mine = query.data?.anjos[0] ?? null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Seu tempo em cada estado e seus atendimentos no período.</p>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>
      {query.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" aria-label="Carregando o seu histórico" />
      ) : query.isError ? (
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <CoverageNote coverage={query.data.coverage} />
          {mine ? <AnjoHistoryDetail anjo={mine} multiDay={query.data.days.length > 1} /> : null}
        </>
      )}
    </div>
  )
}
