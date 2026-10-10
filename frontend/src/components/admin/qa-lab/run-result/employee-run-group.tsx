"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Clock, FastForward, Pause, ShieldCheck, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { HumanReviewDecision } from "@/schemas/admin/workflow-graph.schema"
import type { QaRun, QaTrace } from "@/schemas/admin/qa-lab.schema"
import { useDecideQaRunMutation, useResumeQaRunMutation } from "@/queries/admin/use-qa-lab-queries"
import { formatDateTime, personLabel } from "../qa-lab-format"
import { ReviewPresentationView } from "@/components/pending/review-presentation"
import { StructuredOutput } from "../structured-output"
import { DECISION_LABELS } from "./run-format"
import { StepCard } from "./step-card"

type EmployeeChildState = { status: string; pauseReason: string | null; resumeAt: string | null; currentNodeId: string }

/** Estado interno (pauseReason/resumeAt/currentNodeId) de UM colaborador do fan-out simulado —
 * `QaTrace.employeeRuns` só carrega `status` (o que a UI precisa pra listar), o resto vive em
 * `state.session.employeeRuns[].state` (mesmo lugar que `frozenTranscriptOfRun` já lê acima),
 * persistido mas não fica no trace público. Ausente só se o run for anterior a este recurso. */
function employeeChildStateOf(run: Pick<QaRun, "state">, employeeId: string): EmployeeChildState | undefined {
  const employeeRuns = (run.state as { session?: { employeeRuns?: { employeeId: string; state: EmployeeChildState }[] } } | null)?.session?.employeeRuns
  return employeeRuns?.find((item) => item.employeeId === employeeId)?.state
}

const EMPLOYEE_RUN_STATUS_LABELS: Record<string, string> = { active: "Em execução", waiting: "Aguardando", completed: "Concluído", failed: "Falhou", paused: "Pausado" }

/**
 * Sub-trace de UM colaborador dentro de um fan-out simulado ("Aplicar individualmente" —
 * EMPLOYEE_COLLECTION, Parte 47/48 do pedido): mesmo visual de `PendingControls`, mas escopado
 * a este `employeeId` — cada colaborador pausa/decide/retoma de forma independente, nunca o
 * trace principal inteiro (que já ficou `completed` no momento do fan-out). Os efeitos
 * simulados de cada passo não são reatribuídos aqui (várias execuções passam pelo MESMO nodeId,
 * então `nodeId` sozinho não identifica de quem é um efeito) — eles continuam visíveis, todos
 * juntos, na aba "Efeitos simulados"; limitação documentada, não um bug de dados.
 */
export function EmployeeRunGroup({ run, employeeRun }: { run: QaRun; employeeRun: NonNullable<QaTrace["employeeRuns"]>[number] }) {
  const [open, setOpen] = useState(true)
  const resumeMutation = useResumeQaRunMutation()
  const decideMutation = useDecideQaRunMutation()
  const busy = resumeMutation.isPending || decideMutation.isPending
  const name = personLabel(run.trace.people, employeeRun.employeeId)
  const childState = employeeChildStateOf(run, employeeRun.employeeId)
  const aiBudget = typeof (run.input as { maxAiCalls?: unknown }).maxAiCalls === "number" ? (run.input as { maxAiCalls: number }).maxAiCalls : null

  return (
    <div className="rounded-lg border border-border">
      <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left" onClick={() => setOpen((current) => !current)}>
        <p className="text-sm font-medium">
          {name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {employeeRun.steps.length} passo(s) · {EMPLOYEE_RUN_STATUS_LABELS[employeeRun.status] ?? employeeRun.status}
          </span>
        </p>
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open ? (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {employeeRun.steps.map((step) => (
            <StepCard key={`${step.index}-${step.nodeId}`} step={step} effects={[]} people={run.trace.people} />
          ))}
          {employeeRun.steps.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum passo executado ainda.</p> : null}

          {employeeRun.pendingReview ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4" /> Revisão humana simulada — {name}
              </p>
              <p className="mt-1 text-sm">
                Revisor que seria utilizado:{" "}
                {employeeRun.pendingReview.reviewerIds.length > 0
                  ? employeeRun.pendingReview.reviewerIds.map((id) => personLabel(run.trace.people, id)).join(", ")
                  : "ninguém encontrado na hierarquia"}
              </p>
              {employeeRun.pendingReview.instruction ? <p className="mt-1 text-sm text-muted-foreground">Instrução: {employeeRun.pendingReview.instruction}</p> : null}
              {employeeRun.pendingReview.content !== null && employeeRun.pendingReview.content !== undefined ? (
                <div className="mt-2">
                  {employeeRun.pendingReview.presentation ? (
                    <ReviewPresentationView presentation={employeeRun.pendingReview.presentation} technicalDetails={<StructuredOutput value={employeeRun.pendingReview.content} title="Conteúdo a revisar (payload técnico)" />} />
                  ) : (
                    <StructuredOutput value={employeeRun.pendingReview.content} title="Conteúdo a revisar" />
                  )}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                {(Object.keys(DECISION_LABELS) as HumanReviewDecision[]).map((decision) => (
                  <Button
                    key={decision}
                    size="sm"
                    variant={decision === "approved" ? "default" : "outline"}
                    disabled={busy}
                    onClick={() => decideMutation.mutate({ id: run.id, decision, employeeId: employeeRun.employeeId })}
                  >
                    {DECISION_LABELS[decision]}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">Nenhuma pendência real foi criada — a decisão continua somente esta simulação, só pra {name}.</p>
            </div>
          ) : null}

          {!employeeRun.pendingReview && employeeRun.status === "waiting" && childState?.pauseReason === "WAIT" ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4" /> Aguardando (tempo simulado) — {name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {childState.resumeAt ? `Continua em ${formatDateTime(childState.resumeAt)}. ` : ""}Nenhum job real foi agendado.
              </p>
              <Button size="sm" className="mt-3 gap-1" disabled={busy} onClick={() => resumeMutation.mutate({ id: run.id, input: { employeeId: employeeRun.employeeId } })}>
                <FastForward className="h-4 w-4" /> Avançar e continuar
              </Button>
            </div>
          ) : null}

          {!employeeRun.pendingReview && employeeRun.status === "paused" ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Pause className="h-4 w-4" /> Execução pausada — {name}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {childState?.pauseReason === "AI_BUDGET"
                  ? `Limite de requests de IA atingido (orçamento compartilhado entre todos os colaboradores: ${run.aiCalls} / ${aiBudget ?? run.aiCalls}).`
                  : 'Pausado antes da request de IA (política "Parar antes da IA").'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={busy}
                  onClick={() => resumeMutation.mutate({ id: run.id, input: { aiPolicy: "REAL", maxAiCalls: null, mode: "RUN_ALL", employeeId: employeeRun.employeeId } })}
                >
                  <Sparkles className="h-4 w-4" /> Continuar com IA real (sem limite)
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
