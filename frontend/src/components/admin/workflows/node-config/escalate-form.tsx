"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { StructuredContentPicker } from "../structured-content-picker"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import { AVATAR_INTERACTION_MODE_LABELS, OUTPUT_SURFACE_LABELS, VISIBLE_OUTPUT_SURFACES, type ActionConfig, type AvatarInteractionMode, type FlowGraph, type OutputSurface } from "@/schemas/admin/workflow-graph.schema"
import { HierarchicalTargetPicker } from "./hierarchical-target-picker"

/**
 * Action "Escalonar" (evolução da Action, ver relatório): composição de Destino + Conteúdo +
 * Superfície já existentes (Parte 37/REGRA FINAL do pedido — nunca uma implementação isolada de
 * Escalonamento) — reaproveita `HierarchicalTargetPicker` (mesmo componente do Revisor da Revisão
 * Humana), `StructuredContentPicker` (mesmo do Output/Revisão Humana) e o `ToggleGroup` de
 * Superfícies (mesmo do Output). Diferença de semântica pro Output: "Motivo" (por que está sendo
 * encaminhado) e "Após escalonar" (Continuar o fluxo ou Encerrar este branch) — Escalonar nunca
 * pausa o workflow esperando decisão, isso continua sendo exclusividade da Revisão Humana.
 */
export function EscalateForm({
  config,
  graph,
  fromNodeId,
  agentsById,
  orchestratorsById,
  workflowId,
  onChange,
}: {
  config: Extract<ActionConfig, { actionType: "ESCALATE" }>
  graph: FlowGraph
  fromNodeId: string
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  workflowId: string
  onChange: (next: ActionConfig) => void
}) {
  const hasAvatarOrChat = config.surfaces.includes("AVATAR") || config.surfaces.includes("CHAT")

  return (
    <div className="space-y-3">
      <HierarchicalTargetPicker
        target={config.target}
        graph={graph}
        fromNodeId={fromNodeId}
        label="Destino"
        onChange={(target) => onChange({ ...config, target })}
      />

      <p className="text-xs text-muted-foreground">
        Escalonar encaminha a ocorrência e segue em frente — não pausa o workflow esperando decisão nenhuma (isso é exclusividade da Revisão Humana).
      </p>

      <StructuredContentPicker
        label="Conteúdo a escalonar (opcional)"
        graph={graph}
        fromNodeId={fromNodeId}
        agentsById={agentsById}
        orchestratorsById={orchestratorsById}
        workflowId={workflowId}
        path={config.contentSource ?? ""}
        onChange={(source) => onChange({ ...config, contentSource: source || undefined })}
      />

      <div className="space-y-1.5">
        <Label>Superfícies</Label>
        <ToggleGroup
          type="multiple"
          value={config.surfaces}
          onValueChange={(value) => onChange({ ...config, surfaces: value as OutputSurface[] })}
          className="flex-wrap justify-start"
        >
          {VISIBLE_OUTPUT_SURFACES.map((surface) => (
            <ToggleGroupItem key={surface} value={surface} className="text-xs">
              {OUTPUT_SURFACE_LABELS[surface]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {hasAvatarOrChat ? (
        <div className="space-y-1.5">
          <Label>Modo de interação com o avatar</Label>
          <Select value={config.interactionMode ?? "PROMPT"} onValueChange={(value) => onChange({ ...config, interactionMode: value as AvatarInteractionMode })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(AVATAR_INTERACTION_MODE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Motivo (opcional)</Label>
        <Input
          value={config.reason ?? ""}
          onChange={(event) => onChange({ ...config, reason: event.target.value || undefined })}
          placeholder="ex.: Reincidência crítica de qualidade"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Após escalonar</Label>
        <Select
          value={config.continuation ?? "CONTINUE"}
          onValueChange={(value) => onChange({ ...config, continuation: value === "END_BRANCH" ? "END_BRANCH" : undefined })}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CONTINUE">Continuar o fluxo</SelectItem>
            <SelectItem value="END_BRANCH">Encerrar este branch</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
