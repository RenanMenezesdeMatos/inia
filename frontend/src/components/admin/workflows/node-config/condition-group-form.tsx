"use client"

import { useId } from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { decodeSourcePath, encodeVariableSourcePath } from "../content-sources"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import type { ConditionRule, FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"
import { NodeResultConditionForm, WorkflowVariableConditionForm } from "./node-result-condition-forms"

type GroupRuleOrigin = "node_result" | "variable"

function groupRuleOriginOf(rule: ConditionRule): GroupRuleOrigin {
  return decodeSourcePath(rule.sourcePath ?? "")?.kind === "variable" ? "variable" : "node_result"
}

/** Uma linha dentro de um `ConditionGroup` (AND/OR — Parte 3) — reaproveita EXATAMENTE os mesmos
 * blocos tipados de uma Condition simples (`NodeResultConditionForm`/`WorkflowVariableConditionForm`),
 * já que uma regra de grupo tem o mesmo formato de uma Condition simples sem histórico. */
function GroupRuleForm({
  rule,
  index,
  graph,
  fromNodeId,
  agentsById,
  orchestratorsById,
  workflowId,
  onChange,
  onRemove,
  removable,
}: {
  rule: ConditionRule
  index: number
  graph: FlowGraph
  fromNodeId: string
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  workflowId: string
  onChange: (next: ConditionRule) => void
  onRemove: () => void
  removable: boolean
}) {
  const origin = groupRuleOriginOf(rule)
  const originId = useId()

  function setOrigin(next: GroupRuleOrigin) {
    onChange({
      comparator: "EQUALS",
      thresholdBoolean: null,
      thresholdNumeric: null,
      thresholdText: undefined,
      sourcePath: next === "variable" ? encodeVariableSourcePath("") : "",
    })
  }

  return (
    <div className="space-y-2 rounded-md border p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">Regra {index + 1}</p>
        {removable ? (
          <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Remover regra" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={originId} className="text-xs text-muted-foreground">Origem</Label>
        <Select value={origin} onValueChange={(value) => setOrigin(value as GroupRuleOrigin)}>
          <SelectTrigger id={originId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="node_result">Resultado de um nó anterior</SelectItem>
            <SelectItem value="variable">Variável do Workflow</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {origin === "variable" ? (
        <WorkflowVariableConditionForm rule={rule} workflowId={workflowId} onChange={onChange} />
      ) : (
        <NodeResultConditionForm rule={rule} graph={graph} fromNodeId={fromNodeId} agentsById={agentsById} orchestratorsById={orchestratorsById} onChange={onChange} />
      )}
    </div>
  )
}

export const EMPTY_GROUP_RULE: ConditionRule = { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, sourcePath: "" }

/** AND/OR (Parte 3) — "Todas as regras abaixo" (E) ou "Qualquer regra abaixo" (OU). Cada regra é
 * independente (pode vir de nodes/variáveis diferentes); histórico não é composável aqui (ver
 * relatório) — só sourcePath/variável, mesma tipagem de sempre. */
export function ConditionGroupForm({
  node,
  graph,
  agentsById,
  orchestratorsById,
  workflowId,
  onChange,
}: {
  node: Extract<FlowNode, { type: "condition" }>
  graph: FlowGraph
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  workflowId: string
  onChange: (next: FlowNode) => void
}) {
  const group = node.config.group!
  const operatorId = useId()

  function updateRuleAt(index: number, nextRule: ConditionRule) {
    const rules = group.rules.map((rule, i) => (i === index ? nextRule : rule))
    onChange({ ...node, config: { ...node.config, group: { ...group, rules } } })
  }

  function removeRuleAt(index: number) {
    const rules = group.rules.filter((_, i) => i !== index)
    onChange({ ...node, config: { ...node.config, group: { ...group, rules } } })
  }

  function addRule() {
    onChange({ ...node, config: { ...node.config, group: { ...group, rules: [...group.rules, { ...EMPTY_GROUP_RULE }] } } })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Grupo de condições</p>
      <div className="space-y-1.5">
        <Label htmlFor={operatorId}>Combinar regras com</Label>
        <Select
          value={group.operator}
          onValueChange={(value) => onChange({ ...node, config: { ...node.config, group: { ...group, operator: value as "ALL" | "ANY" } } })}
        >
          <SelectTrigger id={operatorId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas as regras abaixo (E)</SelectItem>
            <SelectItem value="ANY">Qualquer regra abaixo (OU)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        {group.rules.map((rule, index) => (
          <GroupRuleForm
            key={index}
            rule={rule}
            index={index}
            graph={graph}
            fromNodeId={node.id}
            agentsById={agentsById}
            orchestratorsById={orchestratorsById}
            workflowId={workflowId}
            onChange={(next) => updateRuleAt(index, next)}
            onRemove={() => removeRuleAt(index)}
            removable={group.rules.length > 1}
          />
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addRule}>
        <Plus className="h-3.5 w-3.5" /> Adicionar regra
      </Button>
    </div>
  )
}
