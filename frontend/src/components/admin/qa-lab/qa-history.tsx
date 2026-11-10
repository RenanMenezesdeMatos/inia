"use client"

import { useState } from "react"
import { CalendarClock, Clock, Coins, FlaskConical, Phone, RotateCcw, Sparkles, UserRound, Wrench } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AdminListView } from "@/components/admin/shared/list/admin-list-view"
import { EntityCard, EntityCardIcon, EntityCardTag } from "@/components/admin/shared/list/entity-card"
import { ListDateRangeFilter, ListMultiSelectFilter, ListSearchInput, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { ListCardGrid } from "@/components/admin/shared/list/list-states"
import { ListViewToggle } from "@/components/admin/shared/list/list-view-toggle"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import type { DateRangeFilter } from "@/lib/admin/list-query"
import { cn } from "@/lib/utils"
import { useQaRunQuery, useQaRunsPageQuery, useRerunQaRunMutation } from "@/queries/admin/use-qa-lab-queries"
import { QA_RESOURCE_TYPE_LABELS, QA_RUN_STATUS_LABELS, type QaResourceType, type QaRunStatus, type QaRunSummary } from "@/schemas/admin/qa-lab.schema"

import { formatDateTime, formatDuration, formatNumber } from "./qa-lab-format"
import { formatTokens, TELEMETRY_COLUMNS, telemetryCells, TokenBudgetBadge, tokensSavedText, ToolBudgetBadge } from "./qa-telemetry"
import { RunResult, WorkflowStateBadge, workflowStateOfRun } from "./run-result"

const STATUS_TONE: Record<QaRunStatus, string> = {
  RUNNING: "bg-primary/10 text-primary",
  WAITING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  PAUSED: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  COMPLETED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  FAILED: "bg-red-500/10 text-red-600 dark:text-red-400",
}

const WORKFLOW_STATE_LABELS = { DRAFT: "Rascunho", PUBLISHED: "Publicada" } as const
type WorkflowStateFilter = keyof typeof WORKFLOW_STATE_LABELS

type QaHistoryFilters = {
  search: string
  resourceType: QaResourceType[]
  status: QaRunStatus[]
  workflowState: WorkflowStateFilter[]
  createdAt: DateRangeFilter
}
const DEFAULT_FILTERS: QaHistoryFilters = { search: "", resourceType: [], status: [], workflowState: [], createdAt: {} }
const RESOURCE_TYPE_OPTIONS = optionsFromLabels(QA_RESOURCE_TYPE_LABELS)
const STATUS_OPTIONS = optionsFromLabels(QA_RUN_STATUS_LABELS)
const WORKFLOW_STATE_OPTIONS = optionsFromLabels(WORKFLOW_STATE_LABELS)

function RunDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = useQaRunQuery(id)
  return (
    <Dialog open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Execução de QA</DialogTitle>
          <DialogDescription>Histórico isolado — nunca misturado com execuções produtivas.</DialogDescription>
        </DialogHeader>
        {query.data ? <RunResult run={query.data} /> : <Skeleton className="h-40 w-full" />}
      </DialogContent>
    </Dialog>
  )
}

/** "Rascunho abc123" / "Publicada" — a listagem leve só tem input.graphSource. */
function configurationOf(run: QaRunSummary) {
  const graphSource = (run.input as { graphSource?: string }).graphSource
  return workflowStateOfRun({ resourceType: run.resourceType, context: graphSource ? { workflow: { workflowState: graphSource } } : {} })
}

/** "Juliana Prado · JULIANA-PRADO-27 · 10/09/2026, 17:08" — o contexto testado, sem transcrição. */
function contextText(run: QaRunSummary): string | null {
  const summary = run.contextSummary
  if (!summary?.operatorName && !summary?.interactionExternalId) return null
  return [summary.operatorName, summary.interactionExternalId, summary.interactionStartedAt ? formatDateTime(summary.interactionStartedAt) : null].filter(Boolean).join(" · ")
}

function RerunButton({ run, onCreated, compact = false }: { run: QaRunSummary; onCreated: (id: string) => void; compact?: boolean }) {
  const rerunMutation = useRerunQaRunMutation()
  const label = run.resourceType === "WORKFLOW" ? "Executar novamente esta versão" : "Executar novamente"
  return (
    <Button
      size={compact ? "icon" : "sm"}
      variant="ghost"
      className={cn(!compact && "gap-1")}
      aria-label={label}
      title={label}
      disabled={rerunMutation.isPending}
      onClick={(event) => {
        event.stopPropagation()
        rerunMutation.mutate(run.id, { onSuccess: (created) => onCreated(created.id) })
      }}
    >
      <RotateCcw className="h-3.5 w-3.5" /> {compact ? null : label}
    </Button>
  )
}

export function QaRunsTable({ runs, onOpen }: { runs: QaRunSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Administrador</TableHead>
            <TableHead>Recurso</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Configuração</TableHead>
            <TableHead>Contexto</TableHead>
            <TableHead>Status</TableHead>
            {TELEMETRY_COLUMNS.map((column) => (
              <TableHead key={column} className={column.endsWith("Budget") ? undefined : "text-right"}>
                {column}
              </TableHead>
            ))}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const meta = configurationOf(run)
            const context = contextText(run)
            return (
              <TableRow key={run.id} className="cursor-pointer" onClick={() => onOpen(run.id)}>
                <TableCell className="whitespace-nowrap text-xs">
                  {/* A linha abre pelo clique; este botão é o mesmo acesso pelo teclado. */}
                  <button type="button" className="text-left hover:underline" aria-label={`Abrir a execução de ${run.resourceName} em ${formatDateTime(run.createdAt)}`} onClick={(event) => { event.stopPropagation(); onOpen(run.id) }}>
                    {formatDateTime(run.createdAt)}
                  </button>
                </TableCell>
                <TableCell className="text-sm">{run.executedByName ?? "—"}</TableCell>
                <TableCell className="max-w-56 truncate text-sm" title={run.resourceName}>
                  {run.resourceName}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{QA_RESOURCE_TYPE_LABELS[run.resourceType]}</Badge>
                </TableCell>
                <TableCell>{meta ? <WorkflowStateBadge meta={meta} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                <TableCell className="max-w-64 text-xs">
                  {context ? (
                    <span className="block truncate" title={context}>
                      {context}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={cn("border-transparent", STATUS_TONE[run.status])}>{QA_RUN_STATUS_LABELS[run.status]}</Badge>
                </TableCell>
                {telemetryCells(run).map((cell) => (
                  <TableCell key={cell.key} className={cn("whitespace-nowrap text-xs tabular-nums", cell.key.endsWith("Budget") ? undefined : "text-right")}>
                    {cell.node}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <RerunButton run={run} onCreated={onOpen} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function QaRunCard({ run, onOpen }: { run: QaRunSummary; onOpen: (id: string) => void }) {
  const meta = configurationOf(run)
  const context = contextText(run)
  return (
    <EntityCard
      icon={<EntityCardIcon icon={FlaskConical} />}
      kicker={
        <>
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{QA_RESOURCE_TYPE_LABELS[run.resourceType]}</span>
          {meta ? (
            <>
              <span aria-hidden>·</span>
              <WorkflowStateBadge meta={meta} />
            </>
          ) : null}
        </>
      }
      title={run.resourceName}
      onOpen={() => onOpen(run.id)}
      actions={<RerunButton run={run} onCreated={onOpen} compact />}
      description={[context, tokensSavedText(run.telemetry)].filter(Boolean).join(" · ") || null}
      descriptionFallback="Sem colaborador/interação registrados neste contexto."
      tags={
        <>
          <EntityCardTag icon={Sparkles}>{run.telemetry?.requests ?? run.aiCalls} request(s) de IA</EntityCardTag>
          <EntityCardTag icon={Wrench}>
            {run.telemetry
              ? run.telemetry.toolBudget
                ? `${run.telemetry.toolBudget.executed} tool call(s)${run.telemetry.toolBudget.investigation !== null && run.telemetry.toolBudget.investigation !== undefined ? ` (${run.telemetry.toolBudget.preflight ?? 0} preflight + ${run.telemetry.toolBudget.investigation} Agent)` : ""} · ${run.telemetry.toolBudget.planningRounds ?? "—"} rodada(s)`
                : "sem investigação"
              : "Tool calls: não informado"}
          </EntityCardTag>
          <EntityCardTag icon={Coins}>
            {formatNumber(run.totalTokens)} tokens · in {formatTokens(run.telemetry?.tokens.input ?? run.inputTokens)} · out {formatTokens(run.telemetry?.tokens.output ?? run.outputTokens)}
          </EntityCardTag>
          <EntityCardTag icon={Coins}>
            cached {formatTokens(run.telemetry?.tokens.cached ?? null)} · reasoning {formatTokens(run.telemetry?.tokens.reasoning ?? null)}
          </EntityCardTag>
          <EntityCardTag icon={Clock}>{formatDuration(run.durationMs)}</EntityCardTag>
          {run.contextSummary?.interactionExternalId ? <EntityCardTag icon={Phone}>{run.contextSummary.interactionExternalId}</EntityCardTag> : null}
        </>
      }
      footerStart={
        <>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" />
            <time dateTime={run.createdAt}>{formatDateTime(run.createdAt)}</time>
          </span>
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3.5" />
            {run.executedByName ?? "—"}
          </span>
        </>
      }
      footerEnd={
        <span className="flex flex-wrap items-center justify-end gap-1">
          <ToolBudgetBadge toolBudget={run.telemetry ? run.telemetry.toolBudget : undefined} />
          <TokenBudgetBadge tokenBudget={run.telemetry ? run.telemetry.tokenBudget : undefined} />
          <Badge className={cn("border-transparent", STATUS_TONE[run.status])}>{QA_RUN_STATUS_LABELS[run.status]}</Badge>
        </span>
      }
    />
  )
}

/** Histórico de QA Runs (Parte 46/48): tabela própria (qa_runs), separada de tudo que é
 * produtivo — com busca, filtros e paginação no mesmo padrão das listagens administrativas. */
export function QaHistory() {
  const list = useAdminListState({ storageKey: "qa-lab-history", defaultFilters: DEFAULT_FILTERS })
  const pageQuery = useQaRunsPageQuery(list.params)
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <ListToolbar
        search={
          <ListSearchInput
            value={list.filters.search}
            onChange={(value) => list.setFilter("search", value)}
            placeholder="Buscar por recurso, administrador, colaborador ou protocolo"
            ariaLabel="Buscar execução de QA"
            pending={list.isSearchPending}
          />
        }
        viewToggle={<ListViewToggle value={list.view} onChange={list.setView} />}
        hasActiveFilters={list.hasActiveFilters}
        onClearFilters={list.resetFilters}
      >
        <ListMultiSelectFilter label="Tipo" values={list.filters.resourceType} onChange={(values) => list.setFilter("resourceType", values)} options={RESOURCE_TYPE_OPTIONS} />
        <ListMultiSelectFilter label="Status" values={list.filters.status} onChange={(values) => list.setFilter("status", values)} options={STATUS_OPTIONS} />
        <ListMultiSelectFilter label="Configuração" values={list.filters.workflowState} onChange={(values) => list.setFilter("workflowState", values)} options={WORKFLOW_STATE_OPTIONS} />
        <ListDateRangeFilter label="Executado em" value={list.filters.createdAt} onChange={(value) => list.setFilter("createdAt", value)} />
      </ListToolbar>

      <AdminListView
        state={list}
        query={pageQuery}
        errorMessage="Não foi possível carregar o histórico de QA."
        empty={{
          icon: FlaskConical,
          title: "Nenhuma execução de QA ainda",
          description: "As execuções feitas aqui ficam registradas neste histórico, separado das execuções produtivas.",
        }}
        noResultsTitle="Nenhuma execução corresponde à busca ou aos filtros"
        itemLabel={["execução", "execuções"]}
        renderList={(runs) => <QaRunsTable runs={runs} onOpen={setOpenId} />}
        renderCards={(runs) => (
          <ListCardGrid>
            {runs.map((run) => (
              <QaRunCard key={run.id} run={run} onOpen={setOpenId} />
            ))}
          </ListCardGrid>
        )}
      />
      <RunDetailDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}
