"use client"

import Link from "next/link"
import { ScrollText } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { ListDateRangeFilter, ListMultiSelectFilter, ListSearchInput, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { useAuditEventsPageQuery } from "@/queries/admin/use-data-hub-queries"
import type { AuditEvent } from "@/schemas/admin/data-hub.schema"

import { AUDIT_ACTION_LABELS, describeAuditEvent } from "./audit-log-labels"
import { formatDateTime } from "./data-hub-format"

type AuditFilters = { search: string; action: string[]; createdAt: { from?: string; to?: string }; sourceId?: string; feedId?: string }

const ACTION_OPTIONS = optionsFromLabels(AUDIT_ACTION_LABELS)

function AuditTable({ events, showSource }: { events: AuditEvent[]; showSource: boolean }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Quando</TableHead>
            <TableHead>Quem</TableHead>
            <TableHead>Ação</TableHead>
            {showSource ? <TableHead>Fonte</TableHead> : null}
            <TableHead>Conjunto</TableHead>
            <TableHead>Detalhes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => {
            const details = describeAuditEvent(event)
            return (
              <TableRow key={event.id}>
                <TableCell className="whitespace-nowrap text-xs tabular-nums">{formatDateTime(event.createdAt)}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{event.actorName ?? <span className="text-muted-foreground">Sistema</span>}</TableCell>
                <TableCell className="whitespace-nowrap text-sm font-medium">{AUDIT_ACTION_LABELS[event.action] ?? event.action}</TableCell>
                {showSource ? (
                  <TableCell className="text-sm">
                    {event.sourceId && event.sourceName ? (
                      event.sourceDeletedAt ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {event.sourceName} <Badge variant="outline">Excluída</Badge>
                        </span>
                      ) : (
                        <Link href={`/admin/data-hub/sources/${event.sourceId}`} className="hover:underline">
                          {event.sourceName}
                        </Link>
                      )
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="text-sm">
                  {event.feedName ? (
                    event.feedDeletedAt ? (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {event.feedName} <Badge variant="outline">Excluído</Badge>
                      </span>
                    ) : (
                      <Link href={`/admin/data-hub/feeds/${event.feedId}`} className="hover:underline">
                        {event.feedName}
                      </Link>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="min-w-56 max-w-md whitespace-normal text-xs text-muted-foreground">
                  {details.length > 0 ? details.map((line) => <p key={line}>{line}</p>) : "—"}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** Quem cadastrou, editou, excluiu, liberou, errou a senha ou leu o banco do cliente. Vale também para fonte já excluída. */
export function AuditLogTab({ sourceId }: { sourceId?: string } = {}) {
  const defaults: AuditFilters = { search: "", action: [], createdAt: {}, ...(sourceId ? { sourceId } : {}) }
  const list = useAdminListState<AuditFilters>({ storageKey: `data-hub-audit-${sourceId ?? "all"}`, defaultFilters: defaults, defaultPageSize: 20 })
  const query = useAuditEventsPageQuery(list.params)
  return (
    <div className="space-y-4">
      <ListToolbar
        search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por pessoa, fonte ou conjunto" ariaLabel="Buscar no registro" pending={list.isSearchPending} />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.resetFilters}
      >
        <ListMultiSelectFilter label="Ação" values={list.filters.action} onChange={(values) => list.setFilter("action", values)} options={ACTION_OPTIONS} />
        <ListDateRangeFilter label="Período" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
      </ListToolbar>
      <AdminListView
        state={list}
        query={query}
        errorMessage="Não foi possível carregar o registro."
        empty={{ icon: ScrollText, title: "Nada registrado ainda", description: "Cada cadastro, alteração, exclusão, liberação com senha e leitura do banco do cliente aparece aqui, com o nome de quem fez." }}
        noResultsTitle="Nenhum registro corresponde aos filtros"
        itemLabel={["registro", "registros"]}
        renderList={(events) => <AuditTable events={events} showSource={!sourceId} />}
        renderCards={(events) => <AuditTable events={events} showSource={!sourceId} />}
      />
    </div>
  )
}
