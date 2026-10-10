"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { resolveAgentSpecialty } from "@/schemas/admin/orchestrator-policy"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { INVESTIGATION_CAPABILITY_LABELS, type InvestigationCapability } from "@/schemas/admin/investigation.schema"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { AgentPicker } from "../agent-picker"
import { resolveFeedbackOrigins } from "../content-sources"
import { IndicatorSelect } from "../indicator-select"
import { fetchAgentPromptPreview } from "@/services/admin/agent-service"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import { AGENT_OUTPUT_CONTRACT_LABELS, FLAG_OUTPUT_CONTRACTS, INDICATOR_DIAGNOSIS_HINT, PERFORMANCE_OUTPUT_CONTRACT_LABELS, PRV_CLOSING_DIAGNOSIS_HINT, DIRECT_INDICATOR_DIAGNOSIS_HINT, INDICATOR_OUTPUT_CONTRACT_LABELS, PROCESS_ASSESSMENT_HINT, type FlowGraph, type FlowNode, resolveNodeContexts } from "@/schemas/admin/workflow-graph.schema"
import { triggerDataOrigin, type WorkflowTrigger } from "@/schemas/admin/workflow.schema"
import { EscalateForm } from "./escalate-form"
import { DEFAULT_INTERACTION_SAMPLE, GenerateFeedbackForm, InteractionFeedbackForm } from "./feedback-action-forms"
import { ScheduledDataSourceForm } from "./scheduled-data-source-form"
import { SetVariableForm } from "./set-variable-form"

function AgentPromptPreviewButton({ agentId }: { agentId: string }) {
  const [open, setOpen] = useState(false)
  const previewQuery = useQuery({
    queryKey: ["admin", "agent-prompt-preview", agentId],
    queryFn: () => fetchAgentPromptPreview(agentId),
    enabled: open && Boolean(agentId),
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={!agentId} className="w-full">
          <Eye className="h-4 w-4" /> Ver prompt final
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Prompt final do agente</DialogTitle>
          <DialogDescription>Como será enviado ao modelo, incluindo bases de conhecimento e restrições.</DialogDescription>
        </DialogHeader>
        {previewQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : previewQuery.isError ? (
          <p className="text-sm text-destructive">Não foi possível carregar o prompt.</p>
        ) : (
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{previewQuery.data}</pre>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Ferramentas nesta execução" (node Chamar agente): mostra as capacidades que o Agent TEM e deixa
 * restringi-las para esta execução. Todas marcadas = sem override (`allowedCapabilities` ausente,
 * como nos nodes antigos: valem as do Agent). O Workflow nunca concede capacidade que o Agent não tem.
 */
function AgentCapabilitiesRestriction({ agent, allowed, onChange }: { agent: Agent | null; allowed: InvestigationCapability[] | undefined; onChange: (allowed: InvestigationCapability[] | undefined) => void }) {
  if (!agent) return null
  const own = agent.investigationCapabilities
  if (own.length === 0) {
    return <p className="text-xs text-muted-foreground">Este Agent não tem ferramentas de investigação habilitadas — ele responde com o contexto pré-montado, como sempre.</p>
  }
  const effective = allowed === undefined ? own : own.filter((capability) => allowed.includes(capability))
  function toggle(capability: InvestigationCapability) {
    const next = effective.includes(capability) ? effective.filter((item) => item !== capability) : own.filter((item) => item === capability || effective.includes(item))
    onChange(next.length === own.length ? undefined : next)
  }
  return (
    <div className="space-y-1.5" data-testid="agent-capabilities-restriction">
      <Label>Ferramentas nesta execução</Label>
      <div className="space-y-1.5 rounded-md border p-2">
        {own.map((capability) => (
          <label key={capability} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-input" aria-label={`Permitir ${INVESTIGATION_CAPABILITY_LABELS[capability]} nesta execução`} checked={effective.includes(capability)} onChange={() => toggle(capability)} />
            <span>{INVESTIGATION_CAPABILITY_LABELS[capability]}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {allowed === undefined ? "Sem restrição: valem as capacidades configuradas no Agent." : `Restrito a ${effective.length} de ${own.length} capacidade(s) do Agent nesta execução.`} O Workflow só restringe — nunca libera uma capacidade que o Agent não tem.
      </p>
    </div>
  )
}

export function ActionForm({
  node,
  graph,
  agents,
  agentsById,
  orchestratorsById,
  trigger,
  workflowId,
  onChange,
}: {
  node: Extract<FlowNode, { type: "action" }>
  graph: FlowGraph
  agents: Agent[]
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  trigger: WorkflowTrigger
  workflowId: string
  onChange: (next: FlowNode) => void
}) {
  const config = node.config
  // Contexto do node no grafo: depois de "Consolidar resultados" = Agent de síntese (evolução 2026-09-16).
  const afterJoin = useMemo(() => resolveNodeContexts(graph).get(node.id) === "CONSOLIDATED_RESULT", [graph, node.id])
  // V1.5.10: "Gerar feedback de atendimento" só é oferecido com o módulo LIGADO neste ambiente (mesma flag do backend);
  // um nó já existente continua visível para poder ser removido/ajustado.
  const interactionFeedbackEnabled = useCurrentUserQuery().data?.features.interactionFeedbackQa ?? false

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Tipo de ação</Label>
        <Select
          value={config.actionType}
          onValueChange={(value) => {
            if (value === "CALL_AGENT") onChange({ ...node, config: { actionType: "CALL_AGENT", agentId: "" } })
            else if (value === "GENERATE_FEEDBACK") {
              const origins = resolveFeedbackOrigins(graph, node.id, agentsById, orchestratorsById)
              onChange({ ...node, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: origins.length === 1 ? origins[0]!.nodeId : "", feedbackDomain: "AUTO" } })
            } else if (value === "GENERATE_INTERACTION_FEEDBACK") {
              onChange({ ...node, config: { actionType: "GENERATE_INTERACTION_FEEDBACK", interactionSource: triggerDataOrigin(trigger) === "channel_flag" ? { kind: "TRIGGER_INTERACTION" } : { ...DEFAULT_INTERACTION_SAMPLE } } })
            } else if (value === "ESCALATE") {
              onChange({
                ...node,
                config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"] },
              })
            } else onChange({ ...node, config: { actionType: "SET_VARIABLE", variableId: "", value: true } })
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CALL_AGENT">Chamar agente</SelectItem>
            {/* Motor de feedback: sempre disponível — não depende do módulo de QA nem de aprovação. */}
            <SelectItem value="GENERATE_FEEDBACK">Gerar feedback</SelectItem>
            {/* V1.5.12: o feedback DIRETO de atendimento (V1.5.10) virou compatibilidade/legado interno — não é oferecido para nó
             * novo; um nó existente continua visível e editável (workflows publicados continuam executando). */}
            {config.actionType === "GENERATE_INTERACTION_FEEDBACK" ? <SelectItem value="GENERATE_INTERACTION_FEEDBACK">Feedback direto de atendimento (legado)</SelectItem> : null}
            <SelectItem value="ESCALATE">Escalonar</SelectItem>
            <SelectItem value="SET_VARIABLE">Definir variável</SelectItem>
            {/* "Definir configuração" (SET_CONFIG_VALUE) saiu daqui a pedido — não é mais possível
             * criar um node novo desse tipo pelo Builder, mas um node já existente continua
             * funcionando e editável normalmente (ver bloco mais abaixo), preservando
             * compatibilidade com Workflows publicados antes desta mudança. */}
            {config.actionType === "SET_CONFIG_VALUE" ? <SelectItem value="SET_CONFIG_VALUE">Definir configuração</SelectItem> : null}
          </SelectContent>
        </Select>
      </div>

      {config.actionType === "GENERATE_FEEDBACK" ? (
        <GenerateFeedbackForm
          config={config}
          graph={graph}
          fromNodeId={node.id}
          agentsById={agentsById}
          orchestratorsById={orchestratorsById}
          trigger={trigger}
          moduleEnabled={interactionFeedbackEnabled}
          onChange={(next) => onChange({ ...node, config: { actionType: "GENERATE_FEEDBACK", ...next } })}
        />
      ) : null}

      {config.actionType === "GENERATE_INTERACTION_FEEDBACK" ? (
        <InteractionFeedbackForm
          source={config.interactionSource}
          trigger={trigger}
          moduleEnabled={interactionFeedbackEnabled}
          onChange={(interactionSource) => onChange({ ...node, config: { actionType: "GENERATE_INTERACTION_FEEDBACK", interactionSource } })}
        />
      ) : null}

      {config.actionType === "SET_VARIABLE" ? (
        <SetVariableForm
          config={config}
          graph={graph}
          fromNodeId={node.id}
          workflowId={workflowId}
          agentsById={agentsById}
          orchestratorsById={orchestratorsById}
          onChange={(next) => onChange({ ...node, config: next })}
        />
      ) : null}

      {config.actionType === "ESCALATE" ? (
        <EscalateForm
          config={config}
          graph={graph}
          fromNodeId={node.id}
          workflowId={workflowId}
          agentsById={agentsById}
          orchestratorsById={orchestratorsById}
          onChange={(next) => onChange({ ...node, config: next })}
        />
      ) : null}

      {config.actionType === "CALL_AGENT" ? (
        <div className="space-y-2">
          {afterJoin ? (
            <p className="text-xs text-muted-foreground">
              Depois de &quot;Consolidar resultados&quot; este nó chama um <strong>Agent de síntese</strong>: recebe os N resultados individuais já produzidos e
              devolve padrões, riscos, pontos fortes, tendências e próximos passos — em uma única request, sem rotear entre especialistas.
            </p>
          ) : triggerDataOrigin(trigger) === "schedule" ? (
            <p className={config.scheduledDataSource ? "text-xs text-muted-foreground" : "text-xs font-medium text-destructive"}>
              {config.scheduledDataSource
                ? `${trigger.kind === "manual" ? "Gatilho Manual por colaborador" : "Gatilho por agenda"}: a fonte de dados está configurada mais abaixo, depois do agente.`
                : `${trigger.kind === "manual" ? "Gatilho Manual por colaborador" : "Gatilho por agenda"}: role este painel até o final depois de escolher o agente — a fonte de dados é obrigatória e fica logo abaixo.`}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label>Agente</Label>
            <AgentPicker
              agents={agents}
              value={config.agentId}
              onChange={(agentId) => onChange({ ...node, config: { ...config, actionType: "CALL_AGENT", agentId } })}
              disabledReason={(candidate) => {
                // Espelho do publish: pós-Join só Agent que aceita o consolidado; síntese só pós-Join.
                const specialty = resolveAgentSpecialty(candidate)
                if (afterJoin && !specialty.acceptsConsolidated) return "Analisa um colaborador por vez — depois de \"Consolidar resultados\" só um Agent de síntese roda aqui."
                if (!afterJoin && specialty.kind === "SYNTHESIS") return "Agent de síntese — só roda depois de \"Consolidar resultados\"."
                return null
              }}
            />
          </div>
          <AgentPromptPreviewButton agentId={config.agentId} />
          {!afterJoin ? <AgentCapabilitiesRestriction agent={agentsById.get(config.agentId) ?? null} allowed={config.allowedCapabilities} onChange={(allowedCapabilities) => { const { allowedCapabilities: _previous, ...rest } = config; void _previous; onChange({ ...node, config: { ...rest, ...(allowedCapabilities ? { allowedCapabilities } : {}) } }) }} /> : null}
          {afterJoin ? (
            <div className="space-y-1.5">
              <Label htmlFor={`synthesis-instruction-${node.id}`}>Missão da síntese</Label>
              <Textarea
                id={`synthesis-instruction-${node.id}`}
                value={config.instruction ?? ""}
                onChange={(event) => onChange({ ...node, config: { ...config, instruction: event.target.value } })}
                placeholder="Ex.: Sintetize os diagnósticos individuais: padrões, prioridades por impacto e próximos passos para a gestão."
                className="min-h-20 text-sm"
              />
              <p className="text-xs text-muted-foreground">O que a gestão precisa saber a partir dos resultados consolidados. A síntese usa só os resultados fornecidos — nunca recalcula indicador ou PRV.</p>
            </div>
          ) : null}
          {triggerDataOrigin(trigger) === "channel_flag" && !afterJoin ? (
            <div className="space-y-1.5">
              <Label>Formato da análise</Label>
              <Select
                value={config.outputContract ?? "FEEDBACK"}
                onValueChange={(value) =>
                  onChange({ ...node, config: { ...config, outputContract: value === "PROCESS_AUDIT" || value === "PROCESS_ASSESSMENT" ? value : undefined } })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLAG_OUTPUT_CONTRACTS.map((contract) => (
                    <SelectItem key={contract} value={contract}>
                      {AGENT_OUTPUT_CONTRACT_LABELS[contract]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {config.outputContract === "PROCESS_AUDIT"
                  ? "O agente compara as etapas do procedimento oficial (base de conhecimento) com a transcrição: Conforme, Não conforme com evidência, Não foi possível confirmar ou Não aplicável. Etapa sem citação literal nunca vira \"não conforme\"."
                  : config.outputContract === "PROCESS_ASSESSMENT"
                    ? PROCESS_ASSESSMENT_HINT
                    : "Feedback publicável com evidência literal da transcrição, comportamento observado, procedimento relacionado e recomendação."}
              </p>
            </div>
          ) : null}
          {triggerDataOrigin(trigger) === "indicator" && !afterJoin ? (
            <div className="space-y-1.5">
              <Label>Formato da análise</Label>
              <Select
                value={config.outputContract === "INDICATOR_DIAGNOSIS" ? "INDICATOR_DIAGNOSIS" : "FEEDBACK"}
                onValueChange={(value) => onChange({ ...node, config: { ...config, outputContract: value === "INDICATOR_DIAGNOSIS" ? value : undefined } })}
              >
                <SelectTrigger className="w-full" aria-label="Formato da análise">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(INDICATOR_OUTPUT_CONTRACT_LABELS) as (keyof typeof INDICATOR_OUTPUT_CONTRACT_LABELS)[]).map((contract) => (
                    <SelectItem key={contract} value={contract}>
                      {INDICATOR_OUTPUT_CONTRACT_LABELS[contract]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {config.outputContract === "INDICATOR_DIAGNOSIS" ? INDICATOR_DIAGNOSIS_HINT : "O feedback mostra o resultado oficial do período (valor, meta e comparação). Sem diagnóstico, não há orientação: o número não explica o comportamento."}
              </p>
            </div>
          ) : null}
          {triggerDataOrigin(trigger) === "schedule" && !afterJoin ? (
            <ScheduledDataSourceForm
              source={config.scheduledDataSource}
              // A fonte deixa de ser "Fechamentos oficiais": o diagnóstico do fechamento não se aplica mais.
              onChange={(scheduledDataSource) => onChange({ ...node, config: { ...config, scheduledDataSource, ...(scheduledDataSource.kind !== "PERFORMANCE" && (config.outputContract === "PRV_CLOSING_DIAGNOSIS" || config.outputContract === "INDICATOR_DIAGNOSIS") ? { outputContract: undefined } : {}) } })}
            />
          ) : null}
          {triggerDataOrigin(trigger) === "schedule" && !afterJoin && config.scheduledDataSource?.kind === "PERFORMANCE" ? (
            <div className="space-y-1.5">
              <Label>Formato da análise</Label>
              <Select
                value={config.outputContract === "PRV_CLOSING_DIAGNOSIS" || config.outputContract === "INDICATOR_DIAGNOSIS" ? config.outputContract : "FEEDBACK"}
                onValueChange={(value) => {
                  const source = config.scheduledDataSource?.kind === "PERFORMANCE" ? config.scheduledDataSource : null
                  // O indicador só existe no diagnóstico direto: ao sair dele, a fonte volta a ser o fechamento inteiro.
                  const scheduledDataSource = source && value !== "INDICATOR_DIAGNOSIS" ? { kind: source.kind, closures: source.closures } : source
                  onChange({ ...node, config: { ...config, ...(scheduledDataSource ? { scheduledDataSource } : {}), outputContract: value === "PRV_CLOSING_DIAGNOSIS" || value === "INDICATOR_DIAGNOSIS" ? value : undefined } })
                }}
              >
                <SelectTrigger className="w-full" aria-label="Formato da análise">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERFORMANCE_OUTPUT_CONTRACT_LABELS) as (keyof typeof PERFORMANCE_OUTPUT_CONTRACT_LABELS)[]).map((contract) => (
                    <SelectItem key={contract} value={contract}>
                      {PERFORMANCE_OUTPUT_CONTRACT_LABELS[contract]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {config.outputContract === "PRV_CLOSING_DIAGNOSIS" ? PRV_CLOSING_DIAGNOSIS_HINT : config.outputContract === "INDICATOR_DIAGNOSIS" ? DIRECT_INDICATOR_DIAGNOSIS_HINT : "O agente comenta os números oficiais dos últimos fechamentos, sem investigar chamadas."}
              </p>
              {config.outputContract === "INDICATOR_DIAGNOSIS" && config.scheduledDataSource?.kind === "PERFORMANCE" ? (
                <div className="space-y-1.5">
                  <Label>Indicador diagnosticado</Label>
                  <IndicatorSelect
                    value={config.scheduledDataSource.indicatorCode ?? undefined}
                    requirement="OFFICIAL"
                    ariaLabel="Indicador diagnosticado"
                    onValueChange={(indicatorCode) => onChange({ ...node, config: { ...config, scheduledDataSource: { kind: "PERFORMANCE", closures: config.scheduledDataSource?.kind === "PERFORMANCE" ? config.scheduledDataSource.closures : 1, indicatorCode } } })}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {config.actionType === "SET_CONFIG_VALUE" ? (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label>Chave</Label>
            <Input
              value={config.configKey}
              onChange={(event) => onChange({ ...node, config: { ...config, configKey: event.target.value } })}
              placeholder="ex.: acompanhamento.monitorias_por_operador"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select
                value={config.valueType}
                onValueChange={(valueType) =>
                  onChange({
                    ...node,
                    config: {
                      ...config,
                      valueType: valueType as "BOOLEAN" | "NUMERIC" | "TEXT",
                      value: valueType === "BOOLEAN" ? true : valueType === "NUMERIC" ? 0 : "",
                    },
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOOLEAN">Verdadeiro/Falso</SelectItem>
                  <SelectItem value="NUMERIC">Número</SelectItem>
                  <SelectItem value="TEXT">Texto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Valor</Label>
              {config.valueType === "BOOLEAN" ? (
                <Select value={String(config.value)} onValueChange={(value) => onChange({ ...node, config: { ...config, value: value === "true" } })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Verdadeiro</SelectItem>
                    <SelectItem value="false">Falso</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  type={config.valueType === "NUMERIC" ? "number" : "text"}
                  value={String(config.value)}
                  onChange={(event) =>
                    onChange({ ...node, config: { ...config, value: config.valueType === "NUMERIC" ? Number(event.target.value) : event.target.value } })
                  }
                />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
