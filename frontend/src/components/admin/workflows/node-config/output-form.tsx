"use client"

import { useId, useMemo } from "react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { decodeSourcePath } from "../content-sources"
import { StructuredContentPicker } from "../structured-content-picker"
import { PersonPicker } from "./person-picker"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import { AVATAR_INTERACTION_MODE_LABELS, ESCALATION_ROLE_LABELS, OUTPUT_SURFACE_LABELS, OUTPUT_TARGET_LABELS, VISIBLE_OUTPUT_SURFACES, type AvatarInteractionMode, type EscalationRole, type FlowGraph, type FlowNode, type OutputSurface, type OutputTargetType, RELIABLE_FEEDBACK_SURFACES, findNode, resolveNodeContexts } from "@/schemas/admin/workflow-graph.schema"
import { triggerDataOrigin, type WorkflowTrigger } from "@/schemas/admin/workflow.schema"

const OUTPUT_TARGET_OPTIONS: Record<OutputTargetType, string> = { ...OUTPUT_TARGET_LABELS, CURRENT_OPERATOR: "O próprio colaborador" }

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
  // "O próprio colaborador" exige um colaborador individual naquele ponto do fluxo: em um Workflow consolidado, só no caminho entre
  // "Aplicar individualmente" e "Consolidar resultados" (a mesma regra da publicação, `workflow-validation/fan-out.ts`), nunca pelo modo
  // do Workflow inteiro. O valor já salvo fica na lista mesmo onde não vale: campo em branco esconderia o que está configurado, e quem
  // aponta o problema é a validação do painel.
  const nodeContext = useMemo(() => resolveNodeContexts(graph).get(node.id), [graph, node.id])
  const offersCurrentOperator = evaluationMode !== "CONSOLIDATED" || nodeContext === "EMPLOYEE" || config.target.type === "CURRENT_OPERATOR"
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
  const fieldId = useId()

  function updateTargetType(type: OutputTargetType) {
    if (type === "ROLE") onChange({ ...node, config: { ...config, target: { type: "ROLE", role: "SUPERVISOR" } } })
    else if (type === "USER") onChange({ ...node, config: { ...config, target: { type: "USER", userId: "" } } })
    else onChange({ ...node, config: { ...config, target: { type } } })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-target`}>Destinatário</Label>
        <Select value={config.target.type} onValueChange={(value) => updateTargetType(value as OutputTargetType)}>
          <SelectTrigger id={`${fieldId}-target`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(OUTPUT_TARGET_OPTIONS)
              .filter(([value]) => offersCurrentOperator || value !== "CURRENT_OPERATOR")
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
          <Label htmlFor={`${fieldId}-role`}>Cargo</Label>
          <Select
            value={config.target.role}
            onValueChange={(role) => onChange({ ...node, config: { ...config, target: { type: "ROLE", role: role as EscalationRole } } })}
          >
            <SelectTrigger id={`${fieldId}-role`} className="w-full">
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
          <Label htmlFor={`${fieldId}-user`}>Pessoa</Label>
          <PersonPicker id={`${fieldId}-user`} value={config.target.userId} onChange={(userId) => onChange({ ...node, config: { ...config, target: { type: "USER", userId } } })} />
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label id={`${fieldId}-surfaces`}>Onde entregar</Label>
        <ToggleGroup
          type="multiple"
          aria-labelledby={`${fieldId}-surfaces`}
          value={config.surfaces}
          onValueChange={(value) => onChange({ ...node, config: { ...config, surfaces: value as OutputSurface[] } })}
          className="flex-wrap justify-start"
        >
          {/* "Pendências" não tem tela que leia: só continua aparecendo onde já estava escolhida, para poder tirar. */}
          {VISIBLE_OUTPUT_SURFACES.filter((surface) => surface !== "INBOX" || config.surfaces.includes("INBOX")).map((surface) => (
            <ToggleGroupItem key={surface} value={surface} className="text-xs" disabled={reliableSource && !RELIABLE_FEEDBACK_SURFACES.includes(surface) && !config.surfaces.includes(surface)}>
              {OUTPUT_SURFACE_LABELS[surface]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {/* Workflow Outputs V1: Chat (conversa nova da INIA) e Avatar (recado de voz com aceite) têm consumidor real;
            Pendências ainda só grava um registro — nenhuma tela o lê. */}
        <p className="text-xs text-muted-foreground" data-testid="surfaces-without-consumer">
          {reliableSource
            ? "Este feedback pode ir para Acompanhamento, Notificação, Chat ou Avatar. Chat e Avatar só valem para o próprio colaborador."
            : "Chat abre uma conversa nova com a INIA. Avatar deixa um recado de voz, falado só quando a pessoa aceitar ouvir."}
          {config.surfaces.includes("INBOX") ? " Pendências não tem tela que mostre este conteúdo: troque por outro destino." : ""}
        </p>
      </div>

      {hasAvatarOrChat ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-interaction-mode`}>Modo de interação com o avatar</Label>
          <Select
            value={config.interactionMode ?? "PROMPT"}
            onValueChange={(value) => onChange({ ...node, config: { ...config, interactionMode: value as AvatarInteractionMode } })}
          >
            <SelectTrigger id={`${fieldId}-interaction-mode`} className="w-full">
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
