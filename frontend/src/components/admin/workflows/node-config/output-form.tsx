"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { decodeSourcePath } from "../content-sources"
import { StructuredContentPicker } from "../structured-content-picker"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import { AVATAR_INTERACTION_MODE_LABELS, ESCALATION_ROLE_LABELS, OUTPUT_SURFACE_LABELS, OUTPUT_TARGET_LABELS, VISIBLE_OUTPUT_SURFACES, type AvatarInteractionMode, type EscalationRole, type FlowGraph, type FlowNode, type OutputSurface, type OutputTargetType, RELIABLE_FEEDBACK_SURFACES, findNode } from "@/schemas/admin/workflow-graph.schema"
import { triggerDataOrigin, type WorkflowTrigger } from "@/schemas/admin/workflow.schema"

/** "O próprio operador" só faz sentido com um colaborador individual como sujeito — some do
 * Select em modo Consolidado (o backend também rejeita, mesmo com um payload manual, ver
 * workflow-router.ts) e ganha um rótulo mais concreto em modo Individual (Parte 38 do pedido). */
function outputTargetLabels(evaluationMode?: "INDIVIDUAL" | "CONSOLIDATED"): Record<OutputTargetType, string> {
  if (evaluationMode === "CONSOLIDATED") return OUTPUT_TARGET_LABELS
  return { ...OUTPUT_TARGET_LABELS, CURRENT_OPERATOR: "O próprio colaborador" }
}

export function OutputForm({
  node,
  graph,
  agentsById,
  orchestratorsById,
  workflowId,
  evaluationMode,
  trigger,
  onChange,
}: {
  node: Extract<FlowNode, { type: "output" }>
  graph: FlowGraph
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  workflowId: string
  evaluationMode?: "INDIVIDUAL" | "CONSOLIDATED"
  trigger?: WorkflowTrigger
  onChange: (next: FlowNode) => void
}) {
  const config = node.config
  // V1.5.12: feedback OFICIAL (gatilho por Flag/Indicador, modo Individual) no Acompanhamento do operador só sai de um
  // "Gerar feedback" — o resultado do Agent/Orquestrador direto não é oferecido para essa combinação.
  const officialFeedbackTarget = evaluationMode !== "CONSOLIDATED" && Boolean(trigger) && triggerDataOrigin(trigger!) !== "schedule" && config.surfaces.includes("FOLLOW_UP") && config.target.type === "CURRENT_OPERATOR"
  const decodedSource = decodeSourcePath(config.source)
  const sourceNode = decodedSource?.kind === "node" ? findNode(graph, decodedSource.nodeId) : undefined
  const reliableSource = sourceNode?.type === "action" && sourceNode.config.actionType === "GENERATE_FEEDBACK"
  const hasAvatarOrChat = config.surfaces.includes("AVATAR") || config.surfaces.includes("CHAT")
  // FOLLOW_UP pro próprio operador é o único caso em que o motor exige o objeto inteiro (é o que
  // vira o Feedback publicado) — travar a escolha aqui evita configurar algo que falharia na
  // execução (ver output-executor.ts).
  const requiresWholeObject = config.surfaces.includes("FOLLOW_UP") && config.target.type === "CURRENT_OPERATOR"

  function updateTargetType(type: OutputTargetType) {
    if (type === "ROLE") onChange({ ...node, config: { ...config, target: { type: "ROLE", role: "SUPERVISOR" } } })
    else if (type === "USER") onChange({ ...node, config: { ...config, target: { type: "USER", userId: "" } } })
    else onChange({ ...node, config: { ...config, target: { type } } })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Destinatário</Label>
        <Select value={config.target.type} onValueChange={(value) => updateTargetType(value as OutputTargetType)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(outputTargetLabels(evaluationMode))
              .filter(([value]) => evaluationMode !== "CONSOLIDATED" || value !== "CURRENT_OPERATOR")
              .map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {config.target.type === "ROLE" ? (
        <div className="space-y-1.5">
          <Label>Cargo</Label>
          <Select
            value={config.target.role}
            onValueChange={(role) => onChange({ ...node, config: { ...config, target: { type: "ROLE", role: role as EscalationRole } } })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ESCALATION_ROLE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {config.target.type === "USER" ? (
        <div className="space-y-1.5">
          <Label>Id da pessoa</Label>
          <Input
            value={config.target.userId}
            onChange={(event) => onChange({ ...node, config: { ...config, target: { type: "USER", userId: event.target.value } } })}
          />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label>Superfícies</Label>
        <ToggleGroup
          type="multiple"
          value={config.surfaces}
          onValueChange={(value) => onChange({ ...node, config: { ...config, surfaces: value as OutputSurface[] } })}
          className="flex-wrap justify-start"
        >
          {VISIBLE_OUTPUT_SURFACES.map((surface) => (
            <ToggleGroupItem key={surface} value={surface} className="text-xs" disabled={reliableSource && !RELIABLE_FEEDBACK_SURFACES.includes(surface) && !config.surfaces.includes(surface)}>
              {OUTPUT_SURFACE_LABELS[surface]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* Workflow Outputs V1: Chat (conversa nova da INIA) e Avatar (recado de voz com aceite) têm consumidor real;
            Pendências ainda só grava um registro — nenhuma tela o lê. */}
        <p className="text-xs text-muted-foreground" data-testid="surfaces-without-consumer">
          {reliableSource
            ? "Feedback confiável sai por Acompanhamento, Notificação, Chat ou Avatar (Chat/Avatar só para o próprio operador). Pendências ainda não tem consumidor real."
            : "Chat abre uma conversa nova da INIA com o conteúdo; Avatar deixa um recado de voz que só é falado quando a pessoa aceitar ouvir. Pendências ainda não tem consumidor real."}
        </p>
      </div>

      {hasAvatarOrChat ? (
        <div className="space-y-1.5">
          <Label>Modo de interação com o avatar</Label>
          <Select
            value={config.interactionMode ?? "PROMPT"}
            onValueChange={(value) => onChange({ ...node, config: { ...config, interactionMode: value as AvatarInteractionMode } })}
          >
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

      {requiresWholeObject ? (
        <div className="space-y-1.5" data-testid="output-support-materials">
          <Label>Materiais de apoio</Label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-input"
              aria-label="Incluir materiais de apoio recomendados"
              checked={config.includeSupportMaterials === true}
              onChange={(event) => onChange({ ...node, config: { ...config, includeSupportMaterials: event.target.checked } })}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium leading-none">Incluir materiais de apoio recomendados</span>
              <span className="block text-xs text-muted-foreground">Esta entrega deve apresentar os materiais que o Agent/Orquestrador do node de origem já recomendou? Quem recomenda é configurado no Agent (&quot;responder diretamente&quot;) ou no Orquestrador; aqui só se decide se este Acompanhamento os mostra. Desligado, o Feedback é publicado sem materiais.</span>
            </span>
          </label>
        </div>
      ) : null}

      <StructuredContentPicker
        sourceMode={officialFeedbackTarget ? "FEEDBACK_ONLY" : "WITH_FEEDBACK"}
        label="Conteúdo a publicar"
        graph={graph}
        fromNodeId={node.id}
        agentsById={agentsById}
        orchestratorsById={orchestratorsById}
        workflowId={workflowId}
        path={config.source}
        onChange={(source) => onChange({ ...node, config: { ...config, source } })}
        requireWholeObject={requiresWholeObject}
        requireWholeObjectReason="Publicar em Acompanhamento pro próprio operador precisa do resultado inteiro pra virar o Feedback."
      />
    </div>
  )
}
