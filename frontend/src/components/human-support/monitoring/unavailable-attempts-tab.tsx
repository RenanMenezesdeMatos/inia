"use client"

import { useState } from "react"
import { UserX } from "lucide-react"

import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime } from "@/lib/format/date"
import { useUnavailableAttemptsQuery } from "@/queries/human-support/use-human-support-admin"
import { REQUEST_ORIGIN_LABELS } from "@/schemas/human-support/catalogs.schema"
import type { PanelFilter } from "@/services/human-support/human-support-service"

import { PanelError } from "./panel-error"

/**
 * Sem Anjo em serviço › quem tentou pedir ajuda quando nenhum Anjo estava em serviço (D4; M9). Não são pedidos: no máximo uma linha
 * por pessoa a cada 10 min. Mais novas primeiro, "Carregar mais" pelo cursor.
 */
export function UnavailableAttemptsTab({ filter }: { filter: PanelFilter }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Tentativas de pedir ajuda quando nenhum Anjo estava em serviço. Não são pedidos: contam no máximo uma vez por pessoa a cada 10 minutos.</p>
      {/* A chave remonta a lista (volta à primeira página) quando o período ou o filtro muda. */}
      <AttemptList key={JSON.stringify(filter)} filter={filter} />
    </div>
  )
}

function AttemptList({ filter }: { filter: PanelFilter }) {
  const [cursors, setCursors] = useState<(string | null)[]>([null])
  const first = useUnavailableAttemptsQuery({ ...filter, cursor: null })
  if (first.isPending) return <Skeleton className="h-40 w-full rounded-xl" aria-label="Carregando as tentativas" />
  if (first.isError) return <PanelError error={first.error} onRetry={() => void first.refetch()} />
  if (first.data.items.length === 0) return <AnalyticsEmptyState icon={UserX} title="Nenhuma tentativa sem Anjo em serviço no período" />
  return (
    <div className={TABLE_FRAME}>
      <Table aria-label="Tentativas sem Anjo em serviço">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Quem</TableHead>
            <TableHead>Grupo › Subgrupo</TableHead>
            <TableHead>Origem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cursors.map((cursor, index) => (
            <AttemptPage key={cursor ?? "first"} filter={filter} cursor={cursor} last={index === cursors.length - 1} onMore={(next) => setCursors((current) => [...current, next])} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AttemptPage({ filter, cursor, last, onMore }: { filter: PanelFilter; cursor: string | null; last: boolean; onMore: (cursor: string) => void }) {
  const query = useUnavailableAttemptsQuery({ ...filter, cursor })
  if (query.isPending) return <TableRow><TableCell colSpan={4}><Skeleton className="h-8 w-full" aria-label="Carregando mais tentativas" /></TableCell></TableRow>
  if (query.isError) return <TableRow><TableCell colSpan={4}><PanelError error={query.error} onRetry={() => void query.refetch()} /></TableCell></TableRow>
  return (
    <>
      {query.data.items.map((item, index) => (
        <TableRow key={`${item.occurredAt}:${item.personName}:${index}`}>
          <TableCell className="tabular-nums">{formatDateTime(item.occurredAt)}</TableCell>
          <TableCell className="whitespace-normal">{item.personName}</TableCell>
          <TableCell className="whitespace-normal">{[item.teamName, item.subteamName].filter(Boolean).join(" › ") || "Sem Grupo"}</TableCell>
          <TableCell className="whitespace-normal">{item.origin ? REQUEST_ORIGIN_LABELS[item.origin] : "—"}</TableCell>
        </TableRow>
      ))}
      {last && query.data.nextCursor ? (
        <TableRow>
          <TableCell colSpan={4} className="text-center">
            <Button type="button" variant="outline" size="sm" onClick={() => onMore(query.data.nextCursor!)}>
              Carregar mais
            </Button>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  )
}
