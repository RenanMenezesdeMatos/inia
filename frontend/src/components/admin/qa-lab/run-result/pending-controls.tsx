"use client"

import { Clock, FastForward, Pause, ShieldCheck, Sparkles, StepForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { HumanReviewDecision } from "@/schemas/admin/workflow-graph.schema"
import type { QaRun } from "@/schemas/admin/qa-lab.schema"
import { useDecideQaRunMutation, useResumeQaRunMutation } from "@/queries/admin/use-qa-lab-queries"
import { formatDateTime, personLabel } from "../qa-lab-format"
import { ReviewPresentationView } from "@/components/pending/review-presentation"
import { StructuredOutput } from "../structured-output"
import { DECISION_LABELS } from "./run-format"

export function PendingControls({ run }: { run: QaRun }) {
  const resumeMutation = useResumeQaRunMutation()
  const decideMutation = useDecideQaRunMutation()
  const state = run.state
  const aiBudget = typeof (run.input as { maxAiCalls?: unknown }).maxAiCalls === "number" ? (run.input as { maxAiCalls: number }).maxAiCalls : null
  if (!state || run.resourceType !== "WORKFLOW") return null
  const busy = resumeMutation.isPending || decideMutation.isPending

  if (state.status === "waiting" && state.pauseReason === "HUMAN_REVIEW" && run.trace.pendingReview) {
    const review = run.trace.pendingReview
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4" /> Revisão humana simulada
        </p>
        <p className="mt-1 text-sm">
          Revisor que seria utilizado: {review.reviewerIds.length > 0 ? review.reviewerIds.map((id) => personLabel(run.trace.people, id)).join(", ") : "ninguém encontrado na hierarquia"}
        </p>
        {review.instruction ? <p className="mt-1 text-sm text-muted-foreground">Instrução: {review.instruction}</p> : null}
        {review.content !== null && review.content !== undefined ? (
          <div className="mt-2">
            {review.presentation ? (
              <ReviewPresentationView presentation={review.presentation} technicalDetails={<StructuredOutput value={review.content} title="Conteúdo a revisar (payload técnico)" />} />
            ) : (
              <StructuredOutput value={review.content} title="Conteúdo a revisar" />
            )}
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(DECISION_LABELS) as HumanReviewDecision[]).map((decision) => (
            <Button key={decision} size="sm" variant={decision === "approved" ? "default" : "outline"} disabled={busy} onClick={() => decideMutation.mutate({ id: run.id, decision })}>
              {DECISION_LABELS[decision]}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Nenhuma pendência real foi criada — a decisão continua somente esta simulação.</p>
      </div>
    )
  }

  if (state.status === "waiting" && state.pauseReason === "WAIT") {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="h-4 w-4" /> Aguardando (tempo simulado)
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Relógio simulado: {formatDateTime(state.simulatedNow)} → continua em {formatDateTime(state.resumeAt)}. Nenhum job real foi agendado.
        </p>
        <Button size="sm" className="mt-3 gap-1" disabled={busy} onClick={() => resumeMutation.mutate({ id: run.id, input: {} })}>
          <FastForward className="h-4 w-4" /> Avançar até {formatDateTime(state.resumeAt)} e continuar
        </Button>
      </div>
    )
  }

  if (state.status === "paused") {
    const reason = state.pauseReason
    const description =
      reason === "STEP"
        ? "Passo a passo: o próximo node ainda não foi executado."
        : reason === "UNTIL_NODE"
          ? "Parou antes do node escolhido em \"Executar até aqui\"."
          : reason === "AI_BUDGET"
            ? `Limite de requests de IA atingido antes da próxima etapa (utilizado: ${run.aiCalls} / ${aiBudget ?? run.aiCalls}). Não é um erro: a execução foi interrompida antes da próxima request.`
            : "Pausado antes da request de IA (política \"Parar antes da IA\")."
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Pause className="h-4 w-4" /> Execução pausada
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {description} Próximo node: <span className="font-mono">{state.currentNodeId}</span>.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {reason === "STEP" ? (
            <Button size="sm" className="gap-1" disabled={busy} onClick={() => resumeMutation.mutate({ id: run.id, input: { mode: "STEP" } })}>
              <StepForward className="h-4 w-4" /> Continuar (próximo node)
            </Button>
          ) : null}
          {reason === "AI_BLOCKED" || reason === "AI_BUDGET" ? (
            <Button size="sm" className="gap-1" disabled={busy} onClick={() => resumeMutation.mutate({ id: run.id, input: { aiPolicy: "REAL", maxAiCalls: null, mode: "RUN_ALL" } })}>
              <Sparkles className="h-4 w-4" /> Continuar com IA real (sem limite)
            </Button>
          ) : null}
          <Button size="sm" variant="outline" className="gap-1" disabled={busy} onClick={() => resumeMutation.mutate({ id: run.id, input: { mode: "RUN_ALL", aiPolicy: reason === "AI_BLOCKED" ? "REAL" : undefined } })}>
            <FastForward className="h-4 w-4" /> Executar até o fim
          </Button>
        </div>
      </div>
    )
  }
  return null
}
