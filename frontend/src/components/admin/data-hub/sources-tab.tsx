"use client"

import Link from "next/link"
import { Database, MoreHorizontal, Pause, Play, Plug, Plus, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ListEmptyState, ListErrorState, ListSkeleton } from "@/components/admin/shared/list/list-states"
import { useDataSourcesQuery, useSetSourceStatusMutation, useSyncFeedMutation, useTestConnectionMutation } from "@/queries/admin/use-data-hub-queries"
import { REMOTE_SOURCE_KINDS, SOURCE_KIND_LABELS, type SourceSummary } from "@/schemas/admin/data-hub.schema"

import { formatCount, formatFuture, formatRelative } from "./data-hub-format"
import { ConnectionHealthBadge, FreshnessBadge, SourceStatusBadge } from "./status-badges"

export function SourceActionsMenu({ source }: { source: SourceSummary }) {
  const test = useTestConnectionMutation()
  const status = useSetSourceStatusMutation()
  const sync = useSyncFeedMutation()
  const remote = REMOTE_SOURCE_KINDS.includes(source.kind)
  const syncable = source.feeds.filter((feed) => feed.status === "ACTIVE" || feed.status === "DEGRADED")

  async function syncAll() {
    for (const feed of syncable) {
      try {
        await sync.mutateAsync(feed.id)
      } catch {
        // o toast de erro já é exibido pela mutação
      }
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={`Ações da fonte ${source.name}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {remote ? (
          <DropdownMenuItem
            onSelect={() =>
              test.mutate(source.id, {
                onSuccess: (result) => (result.health === "HEALTHY" ? toast.success(`Conexão OK: ${result.detail}`) : toast.error(`Conexão com erro: ${result.detail}`)),
              })
            }
          >
            <Plug /> Testar conexão
          </DropdownMenuItem>
        ) : null}
        {remote && syncable.length > 0 && source.status !== "DRAFT" ? (
          <DropdownMenuItem onSelect={syncAll}>
            <RefreshCw /> Sincronizar agora ({syncable.length} feed{syncable.length === 1 ? "" : "s"})
          </DropdownMenuItem>
        ) : null}
        {source.status === "ACTIVE" || source.status === "ERROR" ? (
          <DropdownMenuItem onSelect={() => status.mutate({ id: source.id, action: "PAUSE" })}>
            <Pause /> Pausar
          </DropdownMenuItem>
        ) : null}
        {source.status === "PAUSED" || source.status === "ERROR" ? (
          <DropdownMenuItem onSelect={() => status.mutate({ id: source.id, action: "RESUME" })}>
            <Play /> Retomar
          </DropdownMenuItem>
        ) : null}
        {source.status === "DRAFT" ? (
          <DropdownMenuItem onSelect={() => status.mutate({ id: source.id, action: "ACTIVATE" })}>
            <Play /> Ativar
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/admin/data-hub/sources/${source.id}`}>Detalhes</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SourcesTab() {
  const query = useDataSourcesQuery()
  if (query.isLoading) return <ListSkeleton view="list" />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar as fontes." onRetry={() => query.refetch()} />
  const sources = query.data
  if (sources.length === 0) {
    return (
      <ListEmptyState
        icon={Database}
        title="Conecte sua primeira fonte"
        description="Uma fonte é de onde os dados vêm (API do RH, data lake de atendimento, SFTP, importação manual). Cada fonte pode entregar vários conjuntos de dados (feeds)."
        action={
          <Button asChild>
            <Link href="/admin/data-hub/sources/new">
              <Plus /> Nova fonte
            </Link>
          </Button>
        }
      />
    )
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Conexão</TableHead>
            <TableHead>Dados</TableHead>
            <TableHead className="text-right">Feeds</TableHead>
            <TableHead>Última carga</TableHead>
            <TableHead>Último sucesso</TableHead>
            <TableHead>Último dado</TableHead>
            <TableHead>Próxima sinc.</TableHead>
            <TableHead className="text-right">Recebidos</TableHead>
            <TableHead className="text-right">Rejeitados</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sources.map((source) => (
            <TableRow key={source.id}>
              <TableCell className="font-medium">
                <Link href={`/admin/data-hub/sources/${source.id}`} className="hover:underline">
                  {source.name}
                </Link>
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{SOURCE_KIND_LABELS[source.kind]}</TableCell>
              <TableCell>
                <SourceStatusBadge status={source.status} />
              </TableCell>
              <TableCell>{REMOTE_SOURCE_KINDS.includes(source.kind) ? <ConnectionHealthBadge health={source.connectionHealth} error={source.connectionError} checkedAt={source.connectionCheckedAt} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
              <TableCell>
                <FreshnessBadge freshness={source.feedCount ? source.freshness : null} lastSuccessAt={source.lastSuccessAt} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{source.activeFeedCount}/{source.feedCount}</TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatRelative(source.lastRunAt)}</TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatRelative(source.lastSuccessAt)}</TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">{source.lastDataAt ? formatRelative(source.lastDataAt) : "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-sm tabular-nums">{formatFuture(source.nextSyncAt)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(source.lastRecordsReceived)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(source.lastRecordsRejected)}</TableCell>
              <TableCell>
                <SourceActionsMenu source={source} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
