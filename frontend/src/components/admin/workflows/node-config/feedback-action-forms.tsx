"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { resolveFeedbackOrigins } from "../content-sources"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import { PERIOD_WINDOW_LABELS, type FlowGraph, type InteractionFeedbackSource, type FeedbackDomainSelection, FEEDBACK_DOMAIN_LABELS, feedbackSourceTypeOf, findNode, resolveFeedbackDomain, sourceOutputContractOf } from "@/schemas/admin/workflow-graph.schema"
import { triggerDataOrigin, type WorkflowTrigger } from "@/schemas/admin/workflow.schema"

export const DEFAULT_INTERACTION_SAMPLE = { kind: "COLLABORATOR_SAMPLE", period: "D1", sampleSize: 3, strategy: "DETERMINISTIC_SAMPLE" } as const

const INTERACTION_SAMPLE_STRATEGY_LABELS = { DETERMINISTIC_SAMPLE: "Amostra reproduzível", MOST_RECENT: "Mais recentes" } as const

/**
 * V1.5.10 — "Gerar feedback de atendimento": o admin escolhe SÓ o operacional (quais atendimentos). Prompt, modelo,
 * validadores e política de QA/entrega são da INIA — nunca aparecem aqui.
 */
export function InteractionFeedbackForm({ source, trigger, moduleEnabled, onChange }: { source: InteractionFeedbackSource; trigger: WorkflowTrigger; moduleEnabled: boolean; onChange: (next: InteractionFeedbackSource) => void }) {
  const flagTrigger = triggerDataOrigin(trigger) === "channel_flag"
  return (
    <div className="space-y-3" data-testid="interaction-feedback-form">
      {!moduleEnabled ? <p className="text-xs font-medium text-destructive">O feedback de atendimento está desligado neste ambiente — este nó não pode ser publicado.</p> : null}
      <div className="space-y-1.5">
        <Label>Quais atendimentos</Label>
        <Select value={source.kind} onValueChange={(value) => onChange(value === "TRIGGER_INTERACTION" ? { kind: "TRIGGER_INTERACTION" } : { ...DEFAULT_INTERACTION_SAMPLE })}>
          <SelectTrigger className="w-full" aria-label="Quais atendimentos">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="TRIGGER_INTERACTION" disabled={!flagTrigger}>Interação que disparou o Workflow{flagTrigger ? "" : " (só com gatilho por Flag)"}</SelectItem>
            <SelectItem value="COLLABORATOR_SAMPLE">Interações do colaborador no período</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {source.kind === "COLLABORATOR_SAMPLE" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Período</Label>
            <Select value={source.period} onValueChange={(period) => onChange({ ...source, period: period as typeof source.period })}>
              <SelectTrigger className="w-full" aria-label="Período">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PERIOD_WINDOW_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="interaction-feedback-size">Quantidade por colaborador</Label>
            <Input id="interaction-feedback-size" type="number" min={1} max={10} value={source.sampleSize} onChange={(event) => onChange({ ...source, sampleSize: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })} />
          </div>
          <div className="space-y-1.5">
            <Label>Como escolher</Label>
            <Select value={source.strategy} onValueChange={(strategy) => onChange({ ...source, strategy: strategy as typeof source.strategy })}>
              <SelectTrigger className="w-full" aria-label="Como escolher">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INTERACTION_SAMPLE_STRATEGY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">
        A INIA gera um feedback individual para cada atendimento. O que é claro e seguro vai direto para o Acompanhamento do colaborador; casos ambíguos
        vão para o QA de feedback, sem prender o Workflow; o que não pode ser comunicado com segurança não é entregue. Cada atendimento recebe no máximo
        um feedback deste nó{source.kind === "COLLABORATOR_SAMPLE" ? " — execuções seguintes escolhem outros atendimentos" : ""}.
      </p>
    </div>
  )
}

/**
 * V1.5.12 — "Gerar feedback": escolhe EXPLICITAMENTE a origem (um "Chamar agente" ou "Orquestrador" anterior — nunca "o nó
 * anterior" implícito) e o tipo (Automático/Monitoria/Indicador). Não mostra modelo, prompt, validadores nem política:
 * a confiabilidade é obrigatória, não configurável.
 */
export function GenerateFeedbackForm({
  config,
  graph,
  fromNodeId,
  agentsById,
  orchestratorsById,
  trigger,
  moduleEnabled,
  onChange,
}: {
  config: { sourceNodeId: string; feedbackDomain: FeedbackDomainSelection }
  graph: FlowGraph
  fromNodeId: string
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  trigger: WorkflowTrigger
  moduleEnabled: boolean
  onChange: (next: { sourceNodeId: string; feedbackDomain: FeedbackDomainSelection }) => void
}) {
  const origins = resolveFeedbackOrigins(graph, fromNodeId, agentsById, orchestratorsById)
  const sourceType = feedbackSourceTypeOf(findNode(graph, config.sourceNodeId))
  const effective = resolveFeedbackDomain(config.feedbackDomain, trigger.kind, sourceType, sourceOutputContractOf(findNode(graph, config.sourceNodeId)))
  return (
    <div className="space-y-3" data-testid="generate-feedback-form">
      {!moduleEnabled ? <p className="text-xs font-medium text-destructive">A camada de confiabilidade do feedback está desligada neste ambiente — este nó não pode ser publicado.</p> : null}
      <div className="space-y-1.5">
        <Label>Origem</Label>
        {origins.length === 0 ? (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Conecte este nó depois de um &quot;Chamar agente&quot; ou de um &quot;Orquestrador&quot;: o feedback é gerado a partir do resultado deles.</p>
        ) : (
          <Select value={config.sourceNodeId || undefined} onValueChange={(sourceNodeId) => onChange({ ...config, sourceNodeId })}>
            <SelectTrigger className="w-full" aria-label="Origem">
              <SelectValue placeholder="Selecione o Agente ou Orquestrador" />
            </SelectTrigger>
            <SelectContent>
              {origins.map((origin) => (
                <SelectItem key={origin.nodeId} value={origin.nodeId}>{origin.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="space-y-1.5">
        <Label>Tipo</Label>
        <Select value={config.feedbackDomain} onValueChange={(value) => onChange({ ...config, feedbackDomain: value as FeedbackDomainSelection })}>
          <SelectTrigger className="w-full" aria-label="Tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(FEEDBACK_DOMAIN_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {config.feedbackDomain === "AUTO" && config.sourceNodeId ? (
          <p className="text-xs text-muted-foreground">{effective ? `Automático: ${FEEDBACK_DOMAIN_LABELS[effective].toLowerCase()} (pelo gatilho e pela origem).` : "Automático não consegue decidir com este gatilho e esta origem — escolha o tipo."}</p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        O resultado da origem passa pela camada de confiabilidade da INIA: evidência conferida na transcrição (monitoria) ou dados oficiais do sistema
        (indicador), texto validado e privacidade. O que é seguro segue no Workflow; o que é ambíguo espera o QA de feedback; o que não é seguro nunca é
        emitido. Este nó não entrega nada — a entrega é do Output.
      </p>
    </div>
  )
}
