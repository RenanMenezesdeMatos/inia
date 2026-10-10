"use client"

import Link from "next/link"
import { History } from "lucide-react"

import { useAdminListState } from "@/hooks/use-admin-list-state"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { ListDateRangeFilter, ListMultiSelectFilter, ListSearchInput, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { useDataRunsPageQuery } from "@/queries/admin/use-data-hub-queries"
import { RUN_STATUS_LABELS, RUN_TRIGGER_LABELS, type RunListItem, type RunStatus, type RunTriggerKind } from "@/schemas/admin/data-hub.schema"

import { formatCount, formatDateTime, formatDuration } from "./data-hub-format"
import { RunStatusBadge } from "./status-badges"

type RunFilters = { search: string; status: RunStatus[]; triggerKind: RunTriggerKind[]; createdAt: { from?: string; to?: string }; sourceId?: string; feedId?: string }

const STATUS_OPTIONS = optionsFromLabels(RUN_STATUS_LABELS)
const TRIGGER_OPTIONS = optionsFromLabels(RUN_TRIGGER_LABELS)

export function RunsTable({ runs, showSource = true }: { runs: RunListItem[]; showSource?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Hora</TableHead>
            {showSource ? <TableHead>Fonte</TableHead> : null}
            <TableHead>Feed</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Recebidos</TableHead>
            <TableHead className="text-right">Inseridos</TableHead>
            <TableHead className="text-right">Atualizados</TableHead>
            <TableHead className="text-right">Rejeitados</TableHead>
            <TableHead className="text-right">Duração</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="whitespace-nowrap tabular-nums">
                <Link href={`/admin/data-hub/runs/${run.id}`} className="font-medium hover:underline">
                  {formatDateTime(run.startedAt ?? run.queuedAt)}
                </Link>
              </TableCell>
              {showSource ? <TableCell className="text-sm">{run.sourceName}</TableCell> : null}
              <TableCell className="text-sm">
                {run.feedName}
                <p className="text-xs text-muted-foreground">{run.contractKey}</p>
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{RUN_TRIGGER_LABELS[run.triggerKind]}</TableCell>
              <TableCell>
                <RunStatusBadge status={run.status} errorMessage={run.errorMessage} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(run.recordsReceived)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(run.recordsInserted)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(run.recordsUpdated)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(run.recordsRejected)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatDuration(run.durationMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export function RunsTab({ sourceId, feedId }: { sourceId?: string; feedId?: string } = {}) {
  const defaults: RunFilters = { search: "", status: [], triggerKind: [], createdAt: {}, ...(sourceId ? { sourceId } : {}), ...(feedId ? { feedId } : {}) }
  const list = useAdminListState<RunFilters>({ storageKey: `data-hub-runs-${sourceId ?? feedId ?? "all"}`, defaultFilters: defaults, defaultPageSize: 20 })
  const query = useDataRunsPageQuery(list.params)
  return (
    <div className="space-y-4">
      <ListToolbar
        search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por feed, fonte ou contrato" ariaLabel="Buscar carga" pending={list.isSearchPending} />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.resetFilters}
      >
        <ListMultiSelectFilter label="Status" values={list.filters.status} onChange={(values) => list.setFilter("status", values)} options={STATUS_OPTIONS} />
        <ListMultiSelectFilter label="Origem" values={list.filters.triggerKind} onChange={(values) => list.setFilter("triggerKind", values)} options={TRIGGER_OPTIONS} />
        <ListDateRangeFilter label="Período" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
      </ListToolbar>
      <AdminListView
        state={list}
        query={query}
        errorMessage="Não foi possível carregar as cargas."
        empty={{ icon: History, title: "Nenhuma carga ainda", description: "Cada sincronização, importação ou envio cria uma carga com métricas completas, linha do tempo e quarentena." }}
        noResultsTitle="Nenhuma carga corresponde aos filtros"
        itemLabel={["carga", "cargas"]}
        renderList={(runs) => <RunsTable runs={runs} showSource={!sourceId} />}
        renderCards={(runs) => <RunsTable runs={runs} showSource={!sourceId} />}
      />
    </div>
  )
}
