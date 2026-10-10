"use client"

import { Clock, Coins, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { QA_RUN_STATUS_LABELS, type QaRun } from "@/schemas/admin/qa-lab.schema"
import { formatDuration, formatNumber } from "../qa-lab-format"
import { formatTokens, TokenBudgetBadge, tokensSavedText, ToolBudgetBadge } from "../qa-telemetry"

const STATUS_TONE: Record<QaRun["status"], string> = {
  RUNNING: "bg-primary/10 text-primary",
  WAITING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  PAUSED: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  COMPLETED: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  FAILED: "bg-red-500/10 text-red-600 dark:text-red-400",
}

type WorkflowRunMeta = { workflowState?: string; graphChecksum?: string; versionId?: string | null; capturedAt?: string; rerunOfSnapshot?: boolean }

/** "Rascunho · abc123" / "Publicada · abc123" — contra qual configuração este QA Run rodou
 * (Parte 25/27 do hardening); ausente em runs anteriores ao snapshot. */
export function workflowStateOfRun(run: Pick<QaRun, "resourceType" | "context">): WorkflowRunMeta | null {
  if (run.resourceType !== "WORKFLOW") return null
  const meta = (run.context as { workflow?: WorkflowRunMeta }).workflow
  return meta?.workflowState ? meta : null
}

export function WorkflowStateBadge({ meta }: { meta: WorkflowRunMeta }) {
  const isDraft = meta.workflowState === "DRAFT"
  return (
    <Badge variant="outline" className={cn(isDraft ? "border-amber-500/50 text-amber-700 dark:text-amber-300" : "border-emerald-500/50 text-emerald-700 dark:text-emerald-300")}>
      {isDraft ? "Rascunho" : "Publicada"}
      {meta.graphChecksum ? <span className="ml-1 font-mono text-[10px] opacity-80">{meta.graphChecksum}</span> : null}
    </Badge>
  )
}

export function RunSummaryBadges({ run }: { run: QaRun }) {
  const workflowMeta = workflowStateOfRun(run)
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Badge className={cn("border-transparent", STATUS_TONE[run.status])}>{QA_RUN_STATUS_LABELS[run.status]}</Badge>
      {workflowMeta ? <WorkflowStateBadge meta={workflowMeta} /> : null}
      <span className="flex items-center gap-1 text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Requests de IA: {run.aiCalls}
        {typeof (run.input as { maxAiCalls?: unknown }).maxAiCalls === "number" ? ` / ${(run.input as { maxAiCalls: number }).maxAiCalls}` : ""}
      </span>
      <span className="flex items-center gap-1 text-muted-foreground">
        <Coins className="h-3.5 w-3.5" /> Input {formatNumber(run.inputTokens)} · Cached {formatTokens(run.trace.telemetry?.tokens.cached ?? null)} · Output {formatNumber(run.outputTokens)} · Total {formatNumber(run.totalTokens)}
      </span>
      <span className="flex items-center gap-1 text-muted-foreground">
        <Clock className="h-3.5 w-3.5" /> {formatDuration(run.durationMs)}
      </span>
      {run.trace.telemetry ? (
        <>
          <ToolBudgetBadge toolBudget={run.trace.telemetry.toolBudget} />
          <TokenBudgetBadge tokenBudget={run.trace.telemetry.tokenBudget} />
          {tokensSavedText(run.trace.telemetry) ? <span className="text-muted-foreground">{tokensSavedText(run.trace.telemetry)}</span> : null}
        </>
      ) : null}
    </div>
  )
}
