"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, Download, RotateCcw, XCircle } from "lucide-react"

import { useAdminListState } from "@/hooks/use-admin-list-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { ListMultiSelectFilter, ListSearchInput, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { useCancelRunMutation, useDataRejectionsPageQuery, useDataRunQuery, useReprocessRunMutation } from "@/queries/admin/use-data-hub-queries"
import { downloadRejectionsCsv } from "@/services/admin/data-hub-service"
import { RUN_STATUS_LABELS, RUN_TRIGGER_LABELS, type Rejection, type RunDetail } from "@/schemas/admin/data-hub.schema"
import { cn } from "@/lib/utils"

import { formatBytes, formatCount, formatDateTime, formatDuration, formatTime } from "./data-hub-format"
import { RunStatusBadge } from "./status-badges"

function Timeline({ run }: { run: RunDetail }) {
  return (
    <ol className="space-y-2">
      {run.stages.map((stage, index) => {
        const duration = stage.finishedAt ? new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime() : null
        const current = !stage.finishedAt
        return (
          <li key={`${stage.stage}-${index}`} className="flex gap-3 text-sm">
            <span className={cn("mt-1 inline-block size-2.5 shrink-0 rounded-full", current ? "animate-pulse bg-primary" : "bg-emerald-500")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {RUN_STATUS_LABELS[stage.stage]} <span className="text-xs font-normal tabular-nums text-muted-foreground">{formatTime(stage.startedAt)}{duration !== null ? ` · ${formatDuration(duration)}` : ""}</span>
              </p>
              {stage.detail ? <p className="text-xs text-muted-foreground">{stage.detail}</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function RejectionsTable({ rows }: { rows: Rejection[] }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-right">Linha</TableHead>
            <TableHead>Chave do registro</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>Campo</TableHead>
            <TableHead>Mensagem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-right tabular-nums">{row.recordNumber}</TableCell>
              <TableCell className="font-mono text-xs">{row.sourceRecordKey ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{row.errorCode}</TableCell>
              <TableCell className="font-mono text-xs">{row.field ?? "—"}</TableCell>
              <TableCell className="max-w-lg whitespace-normal text-xs">{row.message}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function RejectionsSection({ run }: { run: RunDetail }) {
  const list = useAdminListState<{ search: string; errorCode: string[] }>({ storageKey: `data-hub-rejections-${run.id}`, defaultFilters: { search: "", errorCode: [] }, defaultPageSize: 20 })
  const query = useDataRejectionsPageQuery(run.id, list.params)
  const [downloading, setDownloading] = useState(false)
  const options = run.rejectionSummary.map((entry) => ({ value: entry.code, label: `${entry.code} (${entry.count})` }))
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Quarentena</CardTitle>
            <CardDescription>
              {formatCount(run.recordsRejected)} registro(s) rejeitado(s), {formatCount(run.errorCount)} erro(s), {formatCount(run.warningCount)} aviso(s). Avisos são registros APLICADOS com ressalva (ex.: conflito de situação funcional resolvido pela precedência) — nunca contam como erro. Guardamos linha, chave, campo, código e mensagem — nunca o payload inteiro.
            </CardDescription>
          </div>
          {run.errorCount > 0 || run.warningCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={downloading}
              onClick={async () => {
                setDownloading(true)
                try {
                  const { blob, filename } = await downloadRejectionsCsv(run.id)
                  const url = URL.createObjectURL(blob)
                  const anchor = document.createElement("a")
                  anchor.href = url
                  anchor.download = filename ?? `rejeicoes-${run.id.slice(0, 8)}.csv`
                  anchor.click()
                  URL.revokeObjectURL(url)
                } finally {
                  setDownloading(false)
                }
              }}
            >
              <Download /> Exportar CSV
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {run.rejectionSummary.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {run.rejectionSummary.map((entry) => (
              <li key={entry.code} className="rounded-md bg-muted px-2 py-1 text-xs">
                <span className="tabular-nums">{formatCount(entry.count)}</span> × <span className="font-mono">{entry.code}</span> <span className="text-muted-foreground">— {entry.label}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {run.errorCount > 0 || run.warningCount > 0 ? (
          <>
            <ListToolbar search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por chave, campo ou mensagem" ariaLabel="Buscar rejeição" pending={list.isSearchPending} />} hasActiveFilters={list.hasActiveFilters} onClearFilters={list.resetFilters}>
              <ListMultiSelectFilter label="Código" values={list.filters.errorCode} onChange={(values) => list.setFilter("errorCode", values)} options={options} />
            </ListToolbar>
            <AdminListView state={list} query={query} errorMessage="Não foi possível carregar a quarentena." empty={{ icon: XCircle, title: "Nenhuma rejeição" }} noResultsTitle="Nenhuma rejeição corresponde aos filtros" itemLabel={["rejeição", "rejeições"]} renderList={(rows) => <RejectionsTable rows={rows} />} renderCards={(rows) => <RejectionsTable rows={rows} />} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhum registro rejeitado nesta carga.</p>
        )}
      </CardContent>
    </Card>
  )
}

export function RunDetailPage({ runId }: { runId: string }) {
  const query = useDataRunQuery(runId)
  const reprocess = useReprocessRunMutation()
  const cancel = useCancelRunMutation()
  if (query.isLoading) return <Skeleton className="h-96 rounded-xl" aria-hidden />
  if (query.isError || !query.data) return <ListErrorState message="Não foi possível carregar a carga." onRetry={() => query.refetch()} />
  const run = query.data
  const metrics: [string, string][] = [
    ["Recebidos", formatCount(run.recordsReceived)],
    ["Lidos", formatCount(run.recordsParsed)],
    ["Válidos", formatCount(run.recordsValid)],
    ["Rejeitados", formatCount(run.recordsRejected)],
    ["Inseridos", formatCount(run.recordsInserted)],
    ["Atualizados", formatCount(run.recordsUpdated)],
    ["Inalterados", formatCount(run.recordsUnchanged)],
    ["Desativados", formatCount(run.recordsDeactivated)],
    ["Erros", formatCount(run.errorCount)],
    ["Avisos", formatCount(run.warningCount)],
    ["Bytes", formatBytes(run.bytes)],
    ["Duração", formatDuration(run.durationMs)],
    ["Tentativas", String(run.attempts)],
  ]
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href="/admin/data-hub?tab=runs">
              <ArrowLeft /> Cargas
            </Link>
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">
            Carga de {run.feedName ?? "feed removido"} <span className="font-normal text-muted-foreground">· {run.sourceName ?? "fonte removida"}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <RunStatusBadge status={run.status} errorMessage={run.errorMessage} />
            <span className="text-xs text-muted-foreground">
              {RUN_TRIGGER_LABELS[run.triggerKind]} · {run.contractKey}@{run.contractVersion} · iniciada {formatDateTime(run.startedAt ?? run.queuedAt)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {run.status === "QUEUED" ? (
            <Button variant="outline" onClick={() => cancel.mutate(run.id)} disabled={cancel.isPending}>
              Cancelar
            </Button>
          ) : null}
          {run.rawAvailable && ["COMPLETED", "PARTIAL", "FAILED"].includes(run.status) ? (
            <Button variant="outline" onClick={() => reprocess.mutate(run.id)} disabled={reprocess.isPending}>
              <RotateCcw /> Reprocessar
            </Button>
          ) : null}
        </div>
      </div>

      {run.errorCode ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          <p className="font-medium">
            {run.errorLabel ?? run.errorCode} <span className="font-mono text-xs">({run.errorCode})</span>
          </p>
          {run.errorMessage ? <p className="mt-1">{run.errorMessage}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Linha do tempo</CardTitle>
            <CardDescription>Conectou · Baixou · Leu · Mapeou · Validou · Aplicou</CardDescription>
          </CardHeader>
          <CardContent>{run.stages.length ? <Timeline run={run} /> : <p className="text-sm text-muted-foreground">Aguardando início.</p>}</CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Métricas</CardTitle>
            <CardDescription>
              Último dado de negócio recebido: {run.businessMaxEventTime ? formatDateTime(run.businessMaxEventTime) : "—"}
              {run.reprocessOfRunId ? (
                <>
                  {" "}
                  · reprocessamento de{" "}
                  <Link href={`/admin/data-hub/runs/${run.reprocessOfRunId}`} className="underline">
                    carga anterior
                  </Link>
                </>
              ) : null}
              {run.idempotencyKey ? ` · chave de idempotência ${run.idempotencyKey}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {metrics.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border p-2">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {run.checkpointBefore || run.checkpointAfter ? (
              <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-lg border border-border p-2">
                  <p className="text-muted-foreground">Checkpoint antes</p>
                  <pre className="overflow-x-auto font-mono">{JSON.stringify(run.checkpointBefore ?? null)}</pre>
                </div>
                <div className="rounded-lg border border-border p-2">
                  <p className="text-muted-foreground">Checkpoint depois (só avança após aplicar)</p>
                  <pre className="overflow-x-auto font-mono">{JSON.stringify(run.checkpointAfter ?? null)}</pre>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <RejectionsSection run={run} />
    </div>
  )
}
