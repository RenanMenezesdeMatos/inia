"use client"

import { useState } from "react"
import { AlertTriangle, Check, ChevronDown, ChevronRight, Hourglass, Pause } from "lucide-react"
import { cn } from "@/lib/utils"
import { QA_STEP_STATUS_LABELS, type QaEffect, type QaRun, type QaStep } from "@/schemas/admin/qa-lab.schema"
import { formatDuration, formatNumber, roleLabel } from "../qa-lab-format"
import { StructuredOutput } from "../structured-output"
import { CollectionSummaryCard, isEmployeeCollectionOutput } from "./collection-summary"
import { ConditionDebug } from "./condition-debug"
import { EffectCard } from "./effect-card"
import { FanInSummaryCard, isEmployeeFanInOutput } from "./fan-in-summary"
import { BRANCH_LABELS, nodeTypeLabel } from "./run-format"
import { StepSupportMaterials, StepToolTrace } from "./step-ai-output"

const STEP_ICON: Record<QaStep["status"], { icon: typeof Check; className: string }> = {
  completed: { icon: Check, className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  waiting: { icon: Hourglass, className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  paused_before_ai: { icon: Pause, className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  stopped_here: { icon: Pause, className: "bg-muted text-muted-foreground" },
  failed: { icon: AlertTriangle, className: "bg-red-500/15 text-red-600 dark:text-red-400" },
}

type ResolvedRecipient = { id: string; name: string; role: string }

function isResolvedRecipientList(value: unknown): value is ResolvedRecipient[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && typeof (item as ResolvedRecipient).name === "string")
}

/** "Destinatário resolvido: Gerente Fulano" — o evento `output_dispatched` carrega quem o motor
 * resolveu de verdade (pela estrutura, quando pós-Join; pela cadeia do operador, no caminho
 * individual). Quando NÃO resolve (ambíguo/não encontrado) o step falha e o motivo aparece no erro
 * do próprio step — nunca some em silêncio. */
function ResolvedRecipients({ recipients }: { recipients: ResolvedRecipient[] }) {
  return (
    <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
      <span className="font-medium">Destinatário resolvido:</span>{" "}
      {recipients.map((recipient) => `${roleLabel(recipient.role)} ${recipient.name}`).join(", ")}
    </p>
  )
}

export function StepCard({ step, effects, people }: { step: QaStep; effects: QaEffect[]; people: QaRun["trace"]["people"] }) {
  const [open, setOpen] = useState(step.status !== "completed")
  const icon = STEP_ICON[step.status]
  const evaluation = step.outcome?.payload?.evaluation as Record<string, unknown> | undefined
  const resolvedRecipients = step.nodeType === "output" && isResolvedRecipientList(step.outcome?.payload?.recipients) ? step.outcome.payload.recipients : null
  const nodeEffects = effects.filter((effect) => effect.nodeId === step.nodeId)
  const collectionOutput = step.nodeType === "select_employees" && isEmployeeCollectionOutput(step.nodeOutput) ? step.nodeOutput : undefined
  const fanInOutput = step.nodeType === "consolidate_results" && isEmployeeFanInOutput(step.nodeOutput) ? step.nodeOutput : undefined
  const hasDetails = Boolean(step.nodeOutput !== undefined || step.error || evaluation || nodeEffects.length > 0 || resolvedRecipients)
  return (
    <div className="flex gap-3">
      <div className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full", icon.className)}>
        <icon.icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => hasDetails && setOpen((current) => !current)}>
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {step.index}. {step.label}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{nodeTypeLabel(step.nodeType)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {QA_STEP_STATUS_LABELS[step.status]}
              {step.outcome?.branch ? ` · ramo ${BRANCH_LABELS[step.outcome.branch] ?? step.outcome.branch}` : ""}
              {step.aiCalls > 0 ? ` · ${step.aiCalls} request(s) de IA · ${formatNumber(step.totalTokens)} tokens` : ""}
              {step.durationMs > 0 ? ` · ${formatDuration(step.durationMs)}` : ""}
            </p>
          </div>
          {hasDetails ? open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
        </button>
        {open ? (
          <div className="mt-1 space-y-2">
            {step.error ? (
              <p className={cn("rounded-md px-3 py-2 text-xs", step.status === "failed" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300")}>{step.error}</p>
            ) : null}
            {resolvedRecipients ? <ResolvedRecipients recipients={resolvedRecipients} /> : null}
            {evaluation ? <ConditionDebug evaluation={evaluation} branch={step.outcome?.branch} /> : null}
            {collectionOutput ? <CollectionSummaryCard output={collectionOutput} people={people} /> : null}
            {fanInOutput ? <FanInSummaryCard output={fanInOutput} people={people} /> : null}
            {step.nodeOutput !== undefined && !collectionOutput && !fanInOutput && step.nodeType !== "trigger" ? <StepToolTrace output={step.nodeOutput} /> : null}
            {step.nodeOutput !== undefined && !collectionOutput && !fanInOutput && step.nodeType !== "trigger" ? <StepSupportMaterials output={step.nodeOutput} /> : null}
            {step.nodeOutput !== undefined && !collectionOutput && !fanInOutput && step.nodeType !== "trigger" ? <StructuredOutput value={step.nodeOutput} title="Resultado do node" /> : null}
            {step.nodeOutput !== undefined && step.nodeType === "trigger" ? <StructuredOutput value={step.nodeOutput} title="Contexto do gatilho" /> : null}
            {nodeEffects.map((effect) => (
              <EffectCard key={effect.id} effect={effect} people={people} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
