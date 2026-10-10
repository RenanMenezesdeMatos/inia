"use client"

import { useState } from "react"
import { AlertTriangle, FastForward, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { AI_CALL_ROLE_LABELS, type QaRun } from "@/schemas/admin/qa-lab.schema"
import { useRerunQaRunMutation, useRerunQaRunWithCurrentDraftMutation } from "@/queries/admin/use-qa-lab-queries"
import { formatDateTime } from "./qa-lab-format"
import { KnowledgeTracePanel } from "./knowledge-trace"
import { RunTelemetryPanel } from "./qa-telemetry"
import { AiCallCard } from "./run-result/ai-call-card"
import { ContextPanel, frozenTranscriptOfRun, highlightsOfRun } from "./run-result/context-panel"
import { EffectCard } from "./run-result/effect-card"
import { EmployeeRunGroup } from "./run-result/employee-run-group"
import { PendingControls } from "./run-result/pending-controls"
import { RunSummaryBadges, workflowStateOfRun } from "./run-result/run-summary"
import { StepCard } from "./run-result/step-card"

/** Resultado de uma execução de QA — trace, efeitos simulados, chamadas de IA e contexto.
 * Compartilhado pelos três modos e pelo histórico.
 *
 * `onRerun`: "Executar novamente"/"Testar rascunho atual" criam um QA Run NOVO (id diferente do
 * `run` atual) — o cache do React Query é atualizado para esse id novo (mesmo mecanismo de
 * sempre, ver useQaRunMutation), mas nada relê esse cache se o chamador ainda estiver "preso" no
 * id antigo (como `workflow-lab.tsx`, que guarda o run corrente em estado local). Bug real
 * encontrado no passeio manual desta rodada: clicar em "Testar rascunho atual" criava a nova
 * execução de verdade (confirmado via rede — coleção/contagens corretas), mas a tela nunca
 * trocava pra mostrar o resultado novo, silenciosamente. `onRerun` deixa o chamador acompanhar
 * o id mais recente; opcional porque o Histórico de QA (qa-history.tsx) nunca rerenderiza pra
 * outro run a partir daqui (cada linha do histórico é o seu próprio run fixo). */
export function RunResult({ run, canvas, onRerun }: { run: QaRun; canvas?: React.ReactNode; onRerun?: (run: QaRun) => void }) {
  const rerunMutation = useRerunQaRunMutation()
  const rerunCurrentMutation = useRerunQaRunWithCurrentDraftMutation()
  const workflowMeta = workflowStateOfRun(run)
  const [tab, setTab] = useState<"trace" | "effects" | "ai" | "telemetry" | "context">("trace")
  const tabs: { id: typeof tab; label: string; count?: number }[] = [
    { id: "trace", label: "Passo a passo", count: run.trace.steps.length },
    { id: "effects", label: "Efeitos simulados", count: run.trace.effects.length },
    { id: "ai", label: "Requests de IA", count: run.trace.aiCalls.length },
    { id: "telemetry", label: "Tokens e eficiência" },
    { id: "context", label: "Contexto utilizado" },
  ]
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">
              {run.resourceName}
              <span className="ml-2 text-xs font-normal text-muted-foreground">{run.resourceType}</span>
            </CardTitle>
            <CardDescription>
              Executado por {run.executedByName ?? "—"} em {formatDateTime(run.createdAt)} · modo QA_SIMULATION
              {workflowMeta
                ? ` · testou ${workflowMeta.workflowState === "DRAFT" ? "o rascunho" : "a versão publicada"} capturad${workflowMeta.workflowState === "DRAFT" ? "o" : "a"} em ${formatDateTime(workflowMeta.capturedAt)}${workflowMeta.rerunOfSnapshot ? " (reexecução do mesmo snapshot)" : ""}`
                : ""}
            </CardDescription>
            <RunSummaryBadges run={run} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              disabled={rerunMutation.isPending || rerunCurrentMutation.isPending}
              onClick={() => rerunMutation.mutate(run.id, { onSuccess: onRerun })}
            >
              <RotateCcw className="h-4 w-4" /> {workflowMeta ? "Executar novamente esta versão" : "Executar novamente"}
            </Button>
            {workflowMeta ? (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1"
                disabled={rerunMutation.isPending || rerunCurrentMutation.isPending}
                onClick={() => rerunCurrentMutation.mutate(run.id, { onSuccess: onRerun })}
              >
                <FastForward className="h-4 w-4" /> Testar rascunho atual
              </Button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {run.errorMessage ? (
          <p className="flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {run.errorMessage}
          </p>
        ) : null}
        <PendingControls run={run} />
        {canvas}
        <div className="flex flex-wrap gap-1 border-b border-border">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                tab === item.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {item.count !== undefined ? <span className="ml-1 text-xs text-muted-foreground">({item.count})</span> : null}
            </button>
          ))}
        </div>
        {tab === "trace" ? (
          <div className="space-y-4">
            {run.trace.steps.map((step) => (
              <StepCard key={`${step.index}-${step.nodeId}`} step={step} effects={run.trace.effects} people={run.trace.people} />
            ))}
            {run.trace.steps.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum passo executado.</p> : null}
            {run.trace.employeeRuns && run.trace.employeeRuns.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Aplicar individualmente — {run.trace.employeeRuns.length} colaborador(es)
                </p>
                {run.trace.employeeRuns.map((employeeRun) => (
                  <EmployeeRunGroup key={employeeRun.employeeId} run={run} employeeRun={employeeRun} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {tab === "effects" ? (
          <div className="space-y-3">
            {run.trace.effects.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum efeito seria produzido por esta execução.</p> : null}
            {run.trace.effects.map((effect) => (
              <EffectCard key={effect.id} effect={effect} people={run.trace.people} />
            ))}
          </div>
        ) : null}
        {tab === "ai" ? (
          <div className="space-y-2">
            {run.trace.aiCalls.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma request ao modelo foi feita.</p> : null}
            {run.trace.aiCalls.length === 0 && (run.trace.knowledgeRetrievals?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Retrieval de bases de conhecimento já executado (sem custo de IA) — é exatamente o que entraria no prompt se a request fosse liberada.
                </p>
                {run.trace.knowledgeRetrievals!.map((retrieval, index) => (
                  <div key={index} className="space-y-1">
                    <p className="text-sm font-medium">
                      {AI_CALL_ROLE_LABELS[retrieval.role]}
                      {retrieval.agentName ? ` — ${retrieval.agentName}` : ""}
                    </p>
                    <KnowledgeTracePanel trace={retrieval} />
                  </div>
                ))}
              </div>
            ) : null}
            {run.trace.aiCalls.map((call) => (
              <AiCallCard key={call.sequence} call={call} />
            ))}
            {run.trace.aiCalls.length > 0 ? (
              <>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  Chaves e credenciais nunca fazem parte do prompt — o que está acima é exatamente o texto enviado ao modelo.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        {tab === "telemetry" ? <RunTelemetryPanel run={{ aiCalls: run.aiCalls, inputTokens: run.inputTokens, outputTokens: run.outputTokens, totalTokens: run.totalTokens, durationMs: run.durationMs, telemetry: run.trace.telemetry ?? null }} /> : null}
        {tab === "context" ? <ContextPanel context={run.trace.context} people={run.trace.people} highlights={highlightsOfRun(run)} frozenTranscript={frozenTranscriptOfRun(run)} /> : null}
      </CardContent>
    </Card>
  )
}

export { evidenceLines } from "./run-result/operational-evidence"
export { highlightsOfRun, frozenTranscriptOfRun } from "./run-result/context-panel"
export { workflowStateOfRun, WorkflowStateBadge, RunSummaryBadges } from "./run-result/run-summary"
