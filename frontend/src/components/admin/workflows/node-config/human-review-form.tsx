"use client"

import { useId } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StructuredContentPicker } from "../structured-content-picker"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import type { FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"
import { HierarchicalTargetPicker } from "./hierarchical-target-picker"

export function HumanReviewForm({
  node,
  graph,
  agentsById,
  orchestratorsById,
  workflowId,
  onChange,
}: {
  node: Extract<FlowNode, { type: "human_review" }>
  graph: FlowGraph
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  workflowId: string
  onChange: (next: FlowNode) => void
}) {
  const instructionId = useId()
  return (
    <div className="space-y-3">
      <HierarchicalTargetPicker
        target={node.config.reviewTarget}
        graph={graph}
        fromNodeId={node.id}
        label="Revisor"
        onChange={(reviewTarget) => onChange({ ...node, config: { ...node.config, reviewTarget } })}
      />

      <p className="text-xs text-muted-foreground">
        O workflow fica parado — sem prazo — até essa pessoa aprovar, reprovar ou escalar na aba Execuções.
      </p>

      <StructuredContentPicker
        sourceMode="WITH_FEEDBACK"
        label="Conteúdo a revisar (opcional)"
        graph={graph}
        fromNodeId={node.id}
        agentsById={agentsById}
        orchestratorsById={orchestratorsById}
        workflowId={workflowId}
        path={node.config.contentSource ?? ""}
        onChange={(source) => onChange({ ...node, config: { ...node.config, contentSource: source || undefined } })}
      />

      <div className="space-y-1.5">
        <Label htmlFor={instructionId}>Instrução para o revisor (opcional)</Label>
        <Input
          id={instructionId}
          value={node.config.instruction ?? ""}
          onChange={(event) => onChange({ ...node, config: { ...node.config, instruction: event.target.value || undefined } })}
          placeholder="ex.: Valide se a ocorrência identificada pela IA realmente configura conduta inadequada."
        />
      </div>
    </div>
  )
}
