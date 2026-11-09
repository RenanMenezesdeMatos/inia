"use client"

import { CornerDownRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { formatDateTime } from "@/lib/format/date"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import { AGENT_RECORD_STATUS_LABELS } from "@/schemas/admin/workflow-retry.schema"
import { enrollmentStatusLabel, type WorkflowEnrollment } from "@/schemas/admin/workflow.schema"

import { agentVersionText, BLOCKED_GUIDANCE, blockedReasonText, blockReasonOf, nodeLabelOf, shortExecutionId } from "./enrollment-format"
import { ExecutionHistoryPopover } from "./execution-history-popover"

const requested = (by: string | null, at: string | null) => [by ? `pedida por ${by}` : null, at ? `em ${formatDateTime(at)}` : null].filter(Boolean).join(" ")

/** O que fazer com esta execução bloqueada — conforme o motivo: agente inativo, acesso não autorizado ou revisão sem revisor ou sem conteúdo. */
export function blockedGuidanceOf(enrollment: Pick<WorkflowEnrollment, "blockedReason">): string {
  return BLOCKED_GUIDANCE[blockReasonOf(enrollment.blockedReason)]
}

/**
 * Onde parou e por quê (PEN-070/073; acesso não autorizado desde a revisão de 03/11/2026; revisão desde a P5c) — texto puro, para a linha
 * da tabela e a descrição do cartão.
 */
export function blockedStepText(enrollment: WorkflowEnrollment, graph: FlowGraph | null): string {
  const step = nodeLabelOf(graph, enrollment.blockedNodeId ?? enrollment.currentNodeId)
  return `Parou na etapa “${step}” — ${blockedReasonText(blockReasonOf(enrollment.blockedReason), enrollment.blockedDetails)}.`
}

/** Motivo do bloqueio na própria linha: etapa, motivo e o que fazer. As etapas já concluídas mantêm os resultados. */
export function BlockedReason({ enrollment, graph }: { enrollment: WorkflowEnrollment; graph: FlowGraph | null }) {
  return (
    <span className="mt-0.5 block space-y-0.5 text-xs whitespace-normal" data-testid="blocked-reason">
      <span className="block text-amber-800 dark:text-amber-300">{blockedStepText(enrollment, graph)}</span>
      <span className="block text-muted-foreground">{blockedGuidanceOf(enrollment)} As etapas já concluídas mantêm os resultados.</span>
    </span>
  )
}

/**
 * Versão confirmada × usada de um agente numa nova tentativa: a prévia mostrou a vigente na confirmação; a chamada resolve a vigente
 * de novo. Diferem quando alguém publicou entre as duas — dito explicitamente (null quando não há o que comparar).
 */
function versionDifferenceText(enrollment: WorkflowEnrollment, run: WorkflowEnrollment["agentRuns"][number]): string | null {
  const confirmed = enrollment.retryAgents.find((agent) => agent.nodeId === run.nodeId && agent.agentId === run.agentId)
  if (!confirmed || typeof confirmed.agentVersionNumber !== "number" || typeof run.agentVersionNumber !== "number") return null
  if (confirmed.agentVersionNumber === run.agentVersionNumber) return null
  return `Confirmada com a versão ${confirmed.agentVersionNumber}; executada na versão ${run.agentVersionNumber}, publicada depois da confirmação.`
}

/** Vínculo resumido: esta é uma nova tentativa, ou desta saíram novas tentativas (null quando não há vínculo). */
export function retryLinkText(enrollment: WorkflowEnrollment): string | null {
  if (enrollment.retryOfEnrollmentId) {
    return `Nova tentativa da execução ${shortExecutionId(enrollment.retryOfEnrollmentId)}${enrollment.retryRequestedByName ? ` · por ${enrollment.retryRequestedByName}` : ""}`
  }
  const last = enrollment.retries[enrollment.retries.length - 1]
  if (!last) return null
  return `${enrollment.retries.length === 1 ? "1 nova tentativa" : `${enrollment.retries.length} novas tentativas`} · última: ${enrollmentStatusLabel(last.status)}`
}

export function RetryLinkNote({ enrollment }: { enrollment: WorkflowEnrollment }) {
  const text = retryLinkText(enrollment)
  if (!text) return null
  return (
    <span className="mt-0.5 flex items-center gap-1 text-xs" data-testid="retry-link-note">
      <CornerDownRight className="h-3 w-3 shrink-0" />
      {text}
    </span>
  )
}

/**
 * Detalhe da execução (PEN-073/074, CA-WF101.7): a versão do Workflow usada, o vínculo original ↔ novas tentativas (quem
 * pediu, quando, como está), as versões de agente confirmadas e as realmente usadas (com a diferença dita quando alguém publicou
 * entre a confirmação e a chamada) e a entrada "Ver histórico desta execução".
 */
export function ExecutionLinks({ workflowId, enrollment, graph }: { workflowId: string; enrollment: WorkflowEnrollment; graph: FlowGraph | null }) {
  return (
    <div className="space-y-1.5 border-b py-2 text-xs" data-testid="execution-links">
      <p>
        <span className="font-medium">Execução {shortExecutionId(enrollment.id)}</span>
        {typeof enrollment.versionNumber === "number" ? <span className="text-muted-foreground"> · versão {enrollment.versionNumber} do Workflow</span> : null}
      </p>

      {enrollment.retryOfEnrollmentId ? (
        <div className="space-y-0.5">
          <p>
            Nova tentativa da execução <span className="font-medium">{shortExecutionId(enrollment.retryOfEnrollmentId)}</span>
            {enrollment.retryRequestedByName || enrollment.retryRequestedAt ? <span className="text-muted-foreground"> — {requested(enrollment.retryRequestedByName, enrollment.retryRequestedAt)}</span> : null}
          </p>
          {enrollment.retryAgents.length > 0 ? (
            <p className="text-muted-foreground" data-testid="execution-retry-agents">
              Confirmada com:{" "}
              {enrollment.retryAgents.map((agent) => `${agent.nodeLabel ? `${agent.nodeLabel}: ` : ""}${agent.agentName ?? "agente não encontrado"} (${agentVersionText(agent.agentVersionNumber)})`).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {enrollment.retries.length > 0 ? (
        <div className="space-y-0.5">
          <p>Novas tentativas desta execução:</p>
          <ul className="space-y-0.5 pl-4" data-testid="execution-retries">
            {enrollment.retries.map((retry) => (
              <li key={retry.id} className="list-disc text-muted-foreground">
                <span className="font-medium text-foreground">{shortExecutionId(retry.id)}</span> · {enrollmentStatusLabel(retry.status)}
                {retry.requestedByName || retry.requestedAt ? ` · ${requested(retry.requestedByName, retry.requestedAt)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {enrollment.agentRuns.length > 0 ? (
        <div className="space-y-0.5">
          <p>Agentes usados:</p>
          <ul className="space-y-0.5 pl-4" data-testid="execution-agent-runs">
            {enrollment.agentRuns.map((run) => {
              const difference = versionDifferenceText(enrollment, run)
              return (
                <li key={run.agentRunId} className="list-disc text-muted-foreground">
                  <span className="text-foreground">{run.agentName}</span> · {agentVersionText(run.agentVersionNumber)}
                  {run.nodeId ? ` · etapa “${nodeLabelOf(graph, run.nodeId)}”` : ""} · {AGENT_RECORD_STATUS_LABELS[run.status] ?? run.status}
                  {!run.agentActive ? (
                    <Badge variant="outline" className="ml-1.5 border-amber-500/40 text-amber-800 dark:text-amber-300">
                      Agente inativo
                    </Badge>
                  ) : null}
                  {difference ? (
                    <span className="mt-0.5 block text-amber-800 dark:text-amber-300" data-testid="agent-version-difference">
                      {difference}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <ExecutionHistoryPopover workflowId={workflowId} enrollmentId={enrollment.id} graph={graph} />
        </div>
      ) : null}
    </div>
  )
}
