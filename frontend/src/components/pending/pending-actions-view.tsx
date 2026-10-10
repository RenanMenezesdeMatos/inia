"use client"

import { ClipboardCheck, Inbox } from "lucide-react"

import { AnalyticsCard, AnalyticsEmptyState, AnalyticsErrorState, TableSkeleton } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { usePendingActionsQuery } from "@/queries/pending-actions/use-pending-actions"
import { DECISION_DONE_LABELS, parseReviewKey, parseWorkdayKey, PENDING_STATUS_LABELS, type PendingActionSummary } from "@/schemas/pending-actions/pending-actions.schema"

import { HumanReviewSheet } from "./human-review-sheet"
import { WorkdayReconciliationSheet } from "./workday-reconciliation-sheet"

export type PendingActionsState = { review: string | null; operator: string | null }

/**
 * Surface PENDÊNCIAS: "tenho algo para decidir". Lista o que exige ação do viewer — Revisões Humanas
 * de Workflow e pendências de produção ("Produção não identificada", calendário operacional)
 * endereçadas a ele — e o histórico do que já foi decidido. Filtro por colaborador e item aberto
 * vivem na URL (deep link do sino e da Equipe): `review=<enrollmentId>:<nodeId>` ou `review=workday:<id>`.
 */
export function PendingActionsView({ state, onStateChange, employeeHref }: { state: PendingActionsState; onStateChange: (patch: Partial<PendingActionsState>) => void; employeeHref?: (personId: string) => string }) {
  const query = usePendingActionsQuery()
  const reviewKey = parseReviewKey(state.review)
  const workdayId = parseWorkdayKey(state.review)
  const operatorFilter = state.operator
  const pending = (query.data?.pending ?? []).filter((item) => !operatorFilter || item.operator?.personId === operatorFilter)
  const history = (query.data?.history ?? []).filter((item) => !operatorFilter || item.operator?.personId === operatorFilter)
  const operatorName = operatorFilter ? [...pending, ...history].find((item) => item.operator?.personId === operatorFilter)?.operator?.name : null

  return (
    <section className="w-full space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-heading text-sm text-muted-foreground">Ação requerida</p>
          <h2 className="text-2xl font-semibold tracking-tight">Pendências</h2>
          <p className="mt-1 text-sm text-muted-foreground">Revisões de workflow e pendências de produção da sua equipe que aguardam sua decisão. Ler um item não decide nada — a decisão é registrada dentro do item.</p>
        </div>
        {operatorFilter ? (
          <Button variant="outline" size="sm" onClick={() => onStateChange({ operator: null })}>
            Filtrando por {operatorName ?? "colaborador"} · limpar
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <AnalyticsCard>
          <TableSkeleton rows={3} />
        </AnalyticsCard>
      ) : null}
      {query.isError ? <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} /> : null}

      {query.data ? (
        <>
          <AnalyticsCard>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden />
              Aguardando sua decisão
              <Badge variant="secondary" className="border-0">{pending.length}</Badge>
            </h3>
            {pending.length === 0 ? (
              <div className="py-6">
                <AnalyticsEmptyState icon={Inbox} title="Nenhuma pendência" description={operatorFilter ? "Este colaborador não tem revisões aguardando você." : "Quando um workflow precisar da sua decisão, a revisão aparece aqui e no sino."} />
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {pending.map((item) => (
                  <PendingRow key={item.id} item={item} onOpen={() => onStateChange({ review: item.id })} />
                ))}
              </ul>
            )}
          </AnalyticsCard>

          {history.length > 0 ? (
            <AnalyticsCard>
              <h3 className="text-sm font-semibold text-muted-foreground">Histórico</h3>
              <ul className="mt-3 divide-y divide-border">
                {history.map((item) => (
                  <PendingRow key={item.id} item={item} onOpen={() => onStateChange({ review: item.id })} />
                ))}
              </ul>
            </AnalyticsCard>
          ) : null}
        </>
      ) : null}

      <HumanReviewSheet reviewKey={reviewKey} onOpenChange={(open) => (!open ? onStateChange({ review: null }) : undefined)} employeeHref={employeeHref} />
      <WorkdayReconciliationSheet reconciliationId={workdayId} onOpenChange={(open) => (!open ? onStateChange({ review: null }) : undefined)} employeeHref={employeeHref} />
    </section>
  )
}

function PendingRow({ item, onOpen }: { item: PendingActionSummary; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} data-testid={item.kind === "WORKDAY_RECONCILIATION" ? "pending-workday-row" : "pending-review-row"} className="flex w-full flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-lg px-2 py-3 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{item.operator?.name ?? "Colaborador não identificado"}{item.operator?.teamName ? <span className="font-normal text-muted-foreground"> · {item.operator.teamName}</span> : null}</span>
          {item.kind === "HUMAN_REVIEW" ? (
            <span className="block truncate text-sm text-muted-foreground">{item.workflowName} · {item.nodeLabel}</span>
          ) : (
            <span className="block truncate text-sm text-muted-foreground">Produção não identificada · {formatCivilDate(item.workday)} · {item.plan}</span>
          )}
          {item.reason ? <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{item.reason}</span> : null}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
          <StatusText item={item} />
          <span>{formatDateTime(item.requestedAt)}</span>
        </span>
      </button>
    </li>
  )
}

function StatusText({ item }: { item: PendingActionSummary }) {
  if (item.status === "PENDING") return <span className="font-medium text-amber-700 dark:text-amber-300">{PENDING_STATUS_LABELS.PENDING}</span>
  if (item.kind === "WORKDAY_RECONCILIATION") return <span className="text-emerald-700 dark:text-emerald-300">{item.resolutionLabel ?? PENDING_STATUS_LABELS.DECIDED}{item.reviewer ? ` · ${item.reviewer.name}` : ""}</span>
  if (item.status === "DECIDED" && item.decision) return <span className="text-emerald-700 dark:text-emerald-300">{DECISION_DONE_LABELS[item.decision]}{item.reviewer ? ` · ${item.reviewer.name}` : ""}</span>
  return <span>{PENDING_STATUS_LABELS.UNAVAILABLE}</span>
}
