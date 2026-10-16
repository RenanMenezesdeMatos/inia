"use client"

import Link from "next/link"
import { useEffect } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useDeliveryQuery } from "@/queries/reports/use-reports"
import { markDeliveryRead } from "@/services/reports/reports-service"
import { ReportDeliveryView } from "./report-delivery-view"

/** Uma entrega (ou aviso) que a pessoa recebeu, com o histórico permitido desse report. */
export function ReportDeliveryPage({ deliveryId }: { deliveryId: string }) {
  const query = useDeliveryQuery(deliveryId)
  useEffect(() => {
    if (query.data && !query.data.delivery.readAt) void markDeliveryRead(deliveryId).catch(() => undefined)
  }, [query.data, deliveryId])
  if (query.isLoading) return <div className="mx-auto max-w-4xl space-y-3 px-4 py-6"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-72 w-full" /></div>
  if (query.isError || !query.data) return <p className="px-4 py-6 text-sm text-destructive">Entrega não encontrada.</p>
  const { delivery, report, history } = query.data
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <Link href="/reports" className="text-xs text-muted-foreground hover:underline">← Reports</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{report.name}</h1>
          {delivery.kind === "DELIVERY" ? <Badge>Entrega</Badge> : <Badge variant="outline" className="border-amber-400 text-amber-800 dark:text-amber-300">Não encaminhado</Badge>}
          {report.deleted ? <Badge variant="secondary">Report excluído</Badge> : report.status !== "ACTIVE" ? <Badge variant="secondary">Report inativo</Badge> : null}
        </div>
        {report.description ? <p className="text-sm text-muted-foreground">{report.description}</p> : null}
        {report.configChangedSince ? <p className="text-xs text-muted-foreground">A configuração do report mudou depois desta entrega — compare com cautela com as entregas mais novas.</p> : null}
        {report.isOwner && !report.deleted ? <Link href={`/reports/${report.id}`} className="text-xs font-medium text-primary hover:underline">Gerenciar este report</Link> : null}
      </header>
      <Card>
        <CardContent className="pt-6">
          <ReportDeliveryView
            showDetailsLink={false}
            model={{ deliveryId: delivery.id, kind: delivery.kind, reason: delivery.reason, periodLabel: delivery.periodLabel, structureLabel: delivery.structureLabel, sources: delivery.sources, visualization: delivery.visualization, dataset: delivery.dataset, comparison: delivery.comparison, analysisStatus: delivery.analysisStatus, analysisText: delivery.analysisText, empty: delivery.empty, occurrences: delivery.occurrences, lastCheckedAt: delivery.lastCheckedAt, createdAt: delivery.createdAt }}
          />
        </CardContent>
      </Card>
      {history.length > 1 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Histórico deste report</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {history.map((item) => (
                <li key={item.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2", item.id === delivery.id && "font-medium")}>
                  <Link href={`/reports/entregas/${item.id}`} className="hover:underline">{[item.periodLabel, item.structureLabel].filter(Boolean).join(" · ") || "Entrega"}</Link>
                  <span className="text-xs text-muted-foreground">{item.kind === "DELIVERY" ? "Entregue" : "Não encaminhado"} · {formatDateTime(item.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
