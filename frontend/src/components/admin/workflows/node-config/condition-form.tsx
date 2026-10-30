"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { decodeSourcePath, encodeVariableSourcePath } from "../content-sources"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import { COMPARATOR_LABELS, type Comparator, type FlowGraph, type FlowNode } from "@/schemas/admin/workflow-graph.schema"
import { triggerProvidesValue, triggerValueIsBoolean, type WorkflowTrigger } from "@/schemas/admin/workflow.schema"
import { ConditionGroupForm, EMPTY_GROUP_RULE } from "./condition-group-form"
import { buildIndicatorAnalysisConfig } from "./indicator-analysis"
import { IndicatorConditionForm } from "./indicator-condition-form"
import { NodeResultConditionForm, WorkflowVariableConditionForm } from "./node-result-condition-forms"

type ConditionMode = "trigger" | "indicator" | "node_result" | "variable" | "group"

function conditionModeOf(config: Extract<FlowNode, { type: "condition" }>["config"]): ConditionMode {
  if (config.group) return "group"
  if (config.historicalQuery || config.performanceQuery) return "indicator"
  if (config.sourcePath !== undefined) {
    return decodeSourcePath(config.sourcePath)?.kind === "variable" ? "variable" : "node_result"
  }
  return "trigger"
}

const CONDITION_MODE_LABELS: Record<ConditionMode, string> = {
  trigger: "Valor do gatilho",
  indicator: "Indicador / PRV",
  node_result: "Resultado de um nó anterior",
  variable: "Variável do Workflow",
  group: "Grupo de condições (E/OU)",
}

export function ConditionForm({
  node,
  graph,
  agentsById,
  orchestratorsById,
  trigger,
  workflowId,
  evaluationMode,
  onChange,
}: {
  node: Extract<FlowNode, { type: "condition" }>
  graph: FlowGraph
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  trigger: WorkflowTrigger
  workflowId: string
  evaluationMode?: "INDIVIDUAL" | "CONSOLIDATED"
  onChange: (next: FlowNode) => void
}) {
  const mode = conditionModeOf(node.config)
  const fieldId = useId()

  function setMode(next: ConditionMode) {
    if (next === "indicator") {
      onChange({ ...node, config: buildIndicatorAnalysisConfig("VALUE", node.config) })
    } else if (next === "node_result") {
      onChange({ ...node, config: { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, sourcePath: "" } })
    } else if (next === "variable") {
      onChange({ ...node, config: { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, sourcePath: encodeVariableSourcePath("") } })
    } else if (next === "group") {
      onChange({ ...node, config: { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, group: { operator: "ALL", rules: [{ ...EMPTY_GROUP_RULE }] } } })
    } else {
      onChange({
        ...node,
        config:
          triggerValueIsBoolean(trigger)
            ? { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null }
            : { comparator: "GTE", thresholdBoolean: null, thresholdNumeric: 1 },
      })
    }
  }

  const modeSelector = (
    <div className="space-y-1.5">
      <Label htmlFor={`${fieldId}-mode`}>Baseado em</Label>
      <Select value={mode} onValueChange={(value) => setMode(value as ConditionMode)}>
        <SelectTrigger id={`${fieldId}-mode`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(CONDITION_MODE_LABELS)
            // Agenda (e Manual sem medição) não tem um valor "disparado" — nunca oferece esse modo.
            .filter(([value]) => triggerProvidesValue(trigger) || value !== "trigger")
            .map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  )

  if (mode === "indicator") {
    return (
      <div className="space-y-3">
        {modeSelector}
        <IndicatorConditionForm node={node} evaluationMode={evaluationMode} onChange={onChange} />
      </div>
    )
  }

  if (mode === "group") {
    return (
      <div className="space-y-3">
        {modeSelector}
        <ConditionGroupForm node={node} graph={graph} agentsById={agentsById} orchestratorsById={orchestratorsById} workflowId={workflowId} onChange={onChange} />
      </div>
    )
  }

  if (mode === "node_result") {
    return (
      <div className="space-y-3">
        {modeSelector}
        <div className="rounded-md border p-3">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Resultado de um nó anterior</p>
          <NodeResultConditionForm
            rule={node.config}
            graph={graph}
            fromNodeId={node.id}
            agentsById={agentsById}
            orchestratorsById={orchestratorsById}
            onChange={(next) => onChange({ ...node, config: next })}
          />
        </div>
      </div>
    )
  }

  if (mode === "variable") {
    return (
      <div className="space-y-3">
        {modeSelector}
        <div className="rounded-md border p-3">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Variável do Workflow</p>
          <WorkflowVariableConditionForm rule={node.config} workflowId={workflowId} onChange={(next) => onChange({ ...node, config: next })} />
        </div>
      </div>
    )
  }

  if (!triggerProvidesValue(trigger)) {
    // Agenda não dispara com um valor "disparado" pra comparar (Parte 14 do pedido de
    // Abrangência/Unidade de Análise) — nunca bloqueia o nó inteiro (isso obrigava a excluir e
    // recriar), só impede ficar no modo "Valor do gatilho": o seletor acima já nem oferece essa
    // opção pra Agenda, então só sobra aqui quem já tinha esse modo salvo de antes desta correção.
    return (
      <div className="space-y-3">
        {modeSelector}
        <p className="text-sm text-destructive">
          Não há um valor &quot;disparado&quot; pra comparar {trigger.kind === "manual" ? "neste gatilho Manual" : "em um gatilho por Agenda"} — escolha outra opção em &quot;Baseado em&quot; acima
          (Indicador / PRV, Resultado de um nó anterior, Variável do Workflow ou Grupo de condições).
        </p>
      </div>
    )
  }

  if (triggerValueIsBoolean(trigger)) {
    return (
      <div className="space-y-3">
        {modeSelector}
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-flag-value`}>Quando a flag vier</Label>
          <Select
            value={node.config.thresholdBoolean ? "true" : "false"}
            onValueChange={(value) =>
              onChange({ ...node, config: { comparator: "EQUALS", thresholdBoolean: value === "true", thresholdNumeric: null } })
            }
          >
            <SelectTrigger id={`${fieldId}-flag-value`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Verdadeira</SelectItem>
              <SelectItem value="false">Falsa</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {modeSelector}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-comparator`}>Condição</Label>
          <Select
            value={node.config.comparator}
            onValueChange={(value) => onChange({ ...node, config: { ...node.config, comparator: value as Comparator, thresholdBoolean: null } })}
          >
            <SelectTrigger id={`${fieldId}-comparator`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(COMPARATOR_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-threshold`}>Valor</Label>
          <Input
            id={`${fieldId}-threshold`}
            type="number"
            value={node.config.thresholdNumeric ?? ""}
            onChange={(event) => onChange({ ...node, config: { ...node.config, thresholdNumeric: Number(event.target.value), thresholdBoolean: null } })}
          />
        </div>
      </div>
    </div>
  )
}
