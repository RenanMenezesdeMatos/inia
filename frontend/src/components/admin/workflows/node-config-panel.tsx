"use client"

import { Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useOrchestratorsQuery } from "@/queries/admin/use-assistant-queries"
import { useTeamsQuery } from "@/queries/admin/use-org-structure-queries"
import type { FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"
import type { WorkflowTrigger } from "@/schemas/admin/workflow.schema"
import { TriggerConfigEditor } from "./trigger-fields"
import { ActionForm } from "./node-config/action-form"
import { ConditionForm } from "./node-config/condition-form"
import { ApplyIndividuallyPanel, ConsolidateResultsPanel } from "./node-config/fan-out-panels"
import { HumanReviewForm } from "./node-config/human-review-form"
import { OrchestratorForm } from "./node-config/orchestrator-form"
import { InterventionPolicyForm } from "./node-config/intervention-policy-form"
import { OutputForm } from "./node-config/output-form"
import { SelectEmployeesForm } from "./node-config/select-employees-form"
import { NextStepFields } from "./node-config/next-step-fields"
import { WaitForm } from "./node-config/wait-form"
import { nodeKindLabel } from "./node-visuals"

export function NodeConfigPanel({
  node,
  graph,
  trigger,
  workflowId,
  scope,
  evaluationMode,
  consolidatedStructure,
  populationFilter,
  issues,
  onChange,
  onConnectBranch,
  onDelete,
  onClose,
}: {
  node: FlowNode
  graph: FlowGraph
  trigger: WorkflowTrigger
  workflowId: string
  /** Problemas de publicação DESTE nó (lista completa — o card só mostra a contagem). */
  issues?: string[]
  scope?: { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId?: string; subteamId?: string }
  /** Individual x Consolidado — controla, por exemplo, se "Performance do colaborador" é uma
   * Condition oferecida (só faz sentido em modo Individual). Ausente = Individual (padrão). */
  evaluationMode?: "INDIVIDUAL" | "CONSOLIDATED"
  // Só pra análise de impacto ao trocar o TIPO do Gatilho (Parte 37-42) — nunca usados fora
  // disso, evaluationMode já resume o que os Nodes de fato precisam saber.
  consolidatedStructure?: { kind: string } | null
  populationFilter?: { kind: string } | null
  onChange: (next: FlowNode) => void
  /** Liga uma saída desta etapa a outra (ou desliga, com `null`) — a alternativa a arrastar no canvas. */
  onConnectBranch?: (branchId: string, targetId: string | null) => void
  onDelete: () => void
  onClose: () => void
}) {
  const agentsQuery = useAgentsQuery()
  const orchestratorsQuery = useOrchestratorsQuery()
  const teamsQuery = useTeamsQuery()
  const agentsById = new Map((agentsQuery.data ?? []).map((agent) => [agent.id, agent]))
  const orchestratorsById = new Map((orchestratorsQuery.data ?? []).map((orchestrator) => [orchestrator.id, orchestrator]))

  return (
    <aside className="h-full space-y-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{nodeKindLabel(node)}</p>
          <Input
            aria-label="Nome da etapa"
            placeholder={nodeKindLabel(node)}
            value={node.label}
            onChange={(event) => onChange({ ...node, label: event.target.value })}
            className="mt-1 h-8 px-2 text-base font-medium shadow-none"
          />
        </div>
        <div className="flex shrink-0 gap-1">
          {node.type !== "trigger" ? (
            <Button size="icon" variant="ghost" aria-label="Excluir nó" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" aria-label="Fechar painel" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {issues && issues.length > 0 ? (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <p className="font-medium">
            {issues.length === 1 ? "1 problema impede a publicação" : `${issues.length} problemas impedem a publicação`}
          </p>
          <ul className="list-disc space-y-1 pl-4">
            {issues.map((message, index) => (
              <li key={index} className="break-words">
                {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {node.type === "trigger" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {trigger.kind === "channel_flag" ? (
              <>
                Este fluxo começa quando a flag <strong>{trigger.flagName}</strong> ({trigger.channel}) chega em uma interação.
              </>
            ) : trigger.kind === "indicator" ? (
              <>
                Este fluxo começa quando chega uma nova medição do indicador <strong>{trigger.indicatorName}</strong>.
              </>
            ) : trigger.kind === "manual" ? (
              <>
                Este fluxo só começa quando alguém clica em <strong>Executar agora</strong> e escolhe um colaborador
                {trigger.context === "INTERACTION" ? " e uma interação dele" : trigger.context === "INDICATOR_MEASUREMENT" ? " e uma medição do indicador" : ""}.
              </>
            ) : (
              <>
                Este fluxo começa nos dias e horários abaixo{evaluationMode === "CONSOLIDATED" ? ", com uma execução para a estrutura escolhida" : ", com uma execução para cada colaborador"}.
              </>
            )}
          </p>
          <TriggerConfigEditor
            trigger={trigger}
            workflowId={workflowId}
            scope={scope}
            graph={graph}
            consolidatedStructure={consolidatedStructure ?? null}
            populationFilter={populationFilter ?? null}
          />
        </div>
      ) : null}
      {node.type === "wait" ? <WaitForm key={node.id} node={node} onChange={onChange} /> : null}
      {node.type === "condition" ? (
        <ConditionForm
          node={node}
          graph={graph}
          agentsById={agentsById}
          orchestratorsById={orchestratorsById}
          trigger={trigger}
          workflowId={workflowId}
          evaluationMode={evaluationMode}
          onChange={onChange}
        />
      ) : null}
      {node.type === "select_employees" ? <SelectEmployeesForm node={node} onChange={onChange} /> : null}
      {node.type === "apply_individually" ? <ApplyIndividuallyPanel node={node} graph={graph} /> : null}
      {node.type === "consolidate_results" ? <ConsolidateResultsPanel node={node} graph={graph} /> : null}
      {node.type === "action" ? (
        <ActionForm
          node={node}
          graph={graph}
          agents={agentsQuery.data ?? []}
          agentsById={agentsById}
          orchestratorsById={orchestratorsById}
          trigger={trigger}
          workflowId={workflowId}
          onChange={onChange}
        />
      ) : null}
      {node.type === "orchestrator" ? (
        <OrchestratorForm node={node} orchestrators={orchestratorsQuery.data ?? []} teams={teamsQuery.data ?? []} scope={scope} trigger={trigger} onChange={onChange} />
      ) : null}
      {node.type === "human_review" ? (
        <HumanReviewForm node={node} graph={graph} agentsById={agentsById} orchestratorsById={orchestratorsById} workflowId={workflowId} onChange={onChange} />
      ) : null}
      {node.type === "output" ? (
        <OutputForm
          node={node}
          graph={graph}
          agentsById={agentsById}
          orchestratorsById={orchestratorsById}
          workflowId={workflowId}
          evaluationMode={evaluationMode}
          trigger={trigger}
          onChange={onChange}
        />
      ) : null}
      {node.type === "intervention_policy" ? <InterventionPolicyForm node={node} graph={graph} onChange={onChange} /> : null}
      {node.type === "end" ? <p className="text-sm text-muted-foreground">Marca o fim deste caminho do fluxo.</p> : null}
      {onConnectBranch ? <NextStepFields node={node} graph={graph} onConnectBranch={onConnectBranch} /> : null}
    </aside>
  )
}

export { type IndicatorAnalysisKind, buildIndicatorAnalysisConfig } from "./node-config/indicator-analysis"
export { InteractionFeedbackForm, GenerateFeedbackForm } from "./node-config/feedback-action-forms"
