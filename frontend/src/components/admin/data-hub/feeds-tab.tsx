"use client"

import Link from "next/link"
import { Layers, Pause, Play, RefreshCw, Star } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { useDataSourcesQuery, useSetFeedStatusMutation, useSyncFeedMutation } from "@/queries/admin/use-data-hub-queries"
import { REMOTE_SOURCE_KINDS, cadenceLabel, type FeedSummary, type SourceSummary } from "@/schemas/admin/data-hub.schema"

import { ignoreHandled, useConfigUnlockPrompt } from "./config-access/use-config-unlock-prompt"
import { formatCount, formatRelative } from "./data-hub-format"
import { FeedStatusBadge, FreshnessBadge } from "./status-badges"

export function FeedRowActions({ feed, source }: { feed: FeedSummary; source: Pick<SourceSummary, "kind" | "status"> }) {
  const status = useSetFeedStatusMutation()
  const prompt = useConfigUnlockPrompt()
  const sync = useSyncFeedMutation()
  const remote = REMOTE_SOURCE_KINDS.includes(source.kind)
  return (
    <div className="flex items-center justify-end gap-1">
      {prompt.dialog}
      {remote && feed.status !== "DRAFT" ? (
        <Button size="sm" variant="ghost" onClick={() => sync.mutate(feed.id)} disabled={sync.isPending}>
          <RefreshCw /> Sincronizar
        </Button>
      ) : null}
      {feed.status === "ACTIVE" || feed.status === "DEGRADED" ? (
        <Button size="icon" variant="ghost" aria-label="Pausar feed" onClick={() => status.mutate({ id: feed.id, action: "PAUSE" })}>
          <Pause className="h-4 w-4" />
        </Button>
      ) : (
        <Button size="icon" variant="ghost" aria-label={feed.status === "DRAFT" ? "Ativar feed" : "Retomar feed"} onClick={() => ignoreHandled(prompt.guarded(() => status.mutateAsync({ id: feed.id, action: feed.status === "DRAFT" ? "ACTIVATE" : "RESUME" })))}>
          <Play className="h-4 w-4" />
        </Button>
      )}
      <Button size="sm" variant="outline" asChild>
        <Link href={`/admin/data-hub/feeds/${feed.id}`}>Mapeamento</Link>
      </Button>
    </div>
  )
}

export function FeedsTable({ rows }: { rows: { feed: FeedSummary; source: SourceSummary }[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Feed</TableHead>
            <TableHead>Fonte</TableHead>
            <TableHead>Contrato</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Dados</TableHead>
            <TableHead>Cadência</TableHead>
            <TableHead>Último sucesso</TableHead>
            <TableHead className="text-right">Última carga</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ feed, source }) => (
            <TableRow key={feed.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Link href={`/admin/data-hub/feeds/${feed.id}`} className="font-medium hover:underline">
                    {feed.name}
                  </Link>
                  {feed.authoritative ? (
                    <Badge variant="outline" className="gap-1">
                      <Star aria-hidden /> Autoritativo
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{feed.feedKey}</p>
              </TableCell>
              <TableCell className="text-sm">
                <Link href={`/admin/data-hub/sources/${source.id}`} className="hover:underline">
                  {source.name}
                </Link>
              </TableCell>
              <TableCell className="text-sm">
                {feed.contractLabel}
                <p className="text-xs text-muted-foreground">
                  {feed.contractKey}@{feed.contractVersion}
                </p>
              </TableCell>
              <TableCell>
                <FeedStatusBadge status={feed.status} />
              </TableCell>
              <TableCell>
                <FreshnessBadge freshness={feed.status === "DRAFT" ? null : feed.freshness} lastSuccessAt={feed.lastSuccessAt} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">{cadenceLabel(feed.cadence)}</TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatRelative(feed.lastSuccessAt)}</TableCell>
              <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">{feed.lastRun ? `${formatCount(feed.lastRun.recordsReceived)} rec. · ${formatCount(feed.lastRun.recordsRejected)} rej.` : "—"}</TableCell>
              <TableCell>
                <FeedRowActions feed={feed} source={source} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function FeedsTab() {
  const query = useDataSourcesQuery()
  if (query.isLoading) return <ListSkeleton view="list" />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar os feeds." onRetry={() => query.refetch()} />
  const rows = query.data.flatMap((source) => source.feeds.map((feed) => ({ feed, source })))
  if (rows.length === 0) {
    return <ListEmptyState icon={Layers} title="Nenhum feed configurado" description="Um feed é um conjunto de dados que uma fonte entrega (colaboradores, medições, interações…), apontando para um contrato da INIA com um mapeamento de campos." action={<Button asChild><Link href="/admin/data-hub/sources/new">Nova fonte</Link></Button>} />
  }
  return <FeedsTable rows={rows} />
}
