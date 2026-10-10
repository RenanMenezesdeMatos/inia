"use client"

import { useMemo, useState } from "react"
import { Play, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useOrchestratorsQuery } from "@/queries/admin/use-assistant-queries"
import { useRunWorkflowSimulationMutation } from "@/queries/admin/use-qa-lab-queries"
import { useWorkflowQuery, useWorkflowsQuery } from "@/queries/admin/use-workflow-queries"
import { useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import type { NodeDescribeContext } from "@/components/admin/workflows/node-visuals"
import { formatScopeLabel } from "@/lib/admin/scope-compatibility"
import { RUN_MODE_LABELS, type QaInteraction, type QaPersonOption, type QaRun, type StructureAnchor, type WorkflowRunMode, type WorkflowSubject } from "@/schemas/admin/qa-lab.schema"
import {
  CONSOLIDATED_STRUCTURE_ANCHOR_ROLE,
  CONSOLIDATED_STRUCTURE_LABELS,
  consolidatedStructureAnchorId,
  consolidatedStructureGroupId,
  type ConsolidatedStructureKind,
} from "@/schemas/admin/consolidated-structure-schema"
import { NODE_TYPE_LABELS, type Comparator, type FlowGraph, type FlowNode } from "@/schemas/admin/workflow-graph.schema"
import { triggerBadgeText, triggerLabel, type WorkflowDetail } from "@/schemas/admin/workflow.schema"

import { AiControls, type AiControlsValue } from "./ai-controls"
import { InteractionEvidencePicker } from "./interaction-evidence"
import { LiveRun } from "./live-run"
import { localInputToIso, nowLocalInput } from "./qa-lab-format"
import { RunResult } from "./run-result"
import { SimulationCanvas } from "./simulation-canvas"
import { ConditionPreviewPicker, MeasurementPicker, PersonPicker, type ThresholdHint } from "./test-data-pickers"

/** Estrutura consolidada do workflow, se houver — ausente = modo Individual. */
function readConsolidatedStructure(workflow: WorkflowDetail): StructureAnchor | null {
  return (workflow.consolidatedStructure as StructureAnchor | null) ?? null
}

/** Primeira Condition sobre o valor do gatilho — vira a dica "Atende / Não atende" dos pickers. */
function triggerConditionHint(graph: FlowGraph): ThresholdHint | null {
  const condition = graph.nodes.find((node): node is Extract<FlowNode, { type: "condition" }> => node.type === "condition" && !node.config.group && !node.config.historicalQuery && !node.config.performanceQuery && !node.config.sourcePath)
  if (!condition) return null
  return { comparator: condition.config.comparator as Comparator, thresholdNumeric: condition.config.thresholdNumeric ?? null, thresholdBoolean: condition.config.thresholdBoolean ?? null }
}

/** Etapas que enviam a transcrição pra IA (Action "Chamar Agent" / node Orchestrator) — espelha
 * `graphNeedsTranscript` do backend, só pra avisar cedo na UI. */
function graphNeedsTranscript(graph: FlowGraph): boolean {
  return graph.nodes.some((node) => node.type === "orchestrator" || (node.type === "action" && node.config.actionType === "CALL_AGENT"))
}

/** Conditions que dependem do EVENTO (valor do gatilho / contexto de execução) — não têm prévia
 * populacional: só são avaliáveis depois de escolher a interação. */
function eventConditions(graph: FlowGraph): { id: string; label: string }[] {
  return graph.nodes
    .filter((node): node is Extract<FlowNode, { type: "condition" }> => node.type === "condition" && !node.config.performanceQuery && !node.config.historicalQuery)
    .map((node) => ({ id: node.id, label: node.label }))
}

function withAnchor(kind: StructureAnchor["kind"], personId: string): StructureAnchor | null {
  switch (kind) {
    case "SUPERVISOR_TEAM":
      return { kind, supervisorId: personId }
    case "COORDINATOR_STRUCTURE":
      return { kind, coordinatorId: personId }
    case "MANAGER_STRUCTURE":
      return { kind, managerId: personId }
    case "SENIOR_MANAGER_STRUCTURE":
      return { kind, seniorManagerId: personId }
    case "DIRECTOR_STRUCTURE":
      return { kind, directorId: personId }
    default:
      return null
  }
}

function WorkflowSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const workflowsQuery = useWorkflowsQuery()
  if (workflowsQuery.isLoading) return <Skeleton className="h-10 w-full" />
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Selecione o workflow" />
      </SelectTrigger>
      <SelectContent>
        {(workflowsQuery.data ?? []).map((workflow) => (
          <SelectItem key={workflow.id} value={workflow.id}>
            <span className="flex items-center gap-2">
              <span>
                {workflow.name} · {triggerBadgeText(workflow.trigger)} · {formatScopeLabel(workflow)}
              </span>
              <Badge variant="outline" className={workflow.published ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300" : "border-amber-500/50 text-amber-700 dark:text-amber-300"}>
                {workflow.published ? "Publicado" : "Rascunho"}
              </Badge>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function WorkflowLab() {
  const [workflowId, setWorkflowId] = useState("")
  const workflowQuery = useWorkflowQuery(workflowId)
  const workflow = workflowQuery.data ?? null
  // null = automático (publicada quando existe, senão rascunho).
  const [graphSourceChoice, setGraphSourceChoice] = useState<"PUBLISHED" | "DRAFT" | null>(null)
  const [subject, setSubject] = useState<WorkflowSubject | null>(null)
  const [subjectLabel, setSubjectLabel] = useState<string>("")
  // Trigger por Flag: colaborador → interação (UMA por QA Run).
  const [flagOperator, setFlagOperator] = useState<QaPersonOption | null>(null)
  const [flagInteraction, setFlagInteraction] = useState<QaInteraction | null>(null)
  const [simulatedNowInput, setSimulatedNowInput] = useState(nowLocalInput())
  const [scheduledForInput, setScheduledForInput] = useState(nowLocalInput())
  const [mode, setMode] = useState<WorkflowRunMode>("RUN_ALL")
  const [untilNodeId, setUntilNodeId] = useState("")
  const [ai, setAi] = useState<AiControlsValue>({ aiPolicy: "REAL", maxAiCalls: null })
  const [result, setResult] = useState<QaRun | null>(null)
  const runMutation = useRunWorkflowSimulationMutation()

  const agentsQuery = useAgentsQuery()
  const orchestratorsQuery = useOrchestratorsQuery()
  const variablesQuery = useWorkflowVariablesQuery(workflowId)

  // Trocar de workflow zera a seleção de contexto — "UM RECURSO + UM CONTEXTO" nunca vaza de
  // um workflow pro outro.
  function handleWorkflowChange(id: string) {
    setWorkflowId(id)
    setSubject(null)
    setSubjectLabel("")
    setFlagOperator(null)
    setFlagInteraction(null)
    setResult(null)
    setUntilNodeId("")
    setGraphSourceChoice(null)
  }

  // "Publicado · alterações não publicadas" existe quando o rascunho persistido difere do grafo
  // pinado pela publicação — informação já disponível no detalhe (draftGraph x publishedGraph).
  const hasUnpublishedChanges = Boolean(workflow?.publishedGraph && JSON.stringify(workflow.draftGraph) !== JSON.stringify(workflow.publishedGraph))
  // Padrão: o rascunho atual (o QA Lab existe pra testar ANTES de publicar); só cai na versão
  // publicada quando ela é idêntica ao rascunho — aí é o que está em operação.
  const graphSource: "PUBLISHED" | "DRAFT" = graphSourceChoice ?? (workflow?.publishedGraph && !hasUnpublishedChanges ? "PUBLISHED" : "DRAFT")
  const graph: FlowGraph | null = workflow ? (graphSource === "PUBLISHED" ? (workflow.publishedGraph ?? workflow.draftGraph) : workflow.draftGraph) : null
  const structure = workflow ? readConsolidatedStructure(workflow) : null
  const hint = graph ? triggerConditionHint(graph) : null
  const conditionNodes = useMemo(
    () =>
      (graph?.nodes ?? [])
        .filter((node): node is Extract<FlowNode, { type: "condition" }> => node.type === "condition" && Boolean(node.config.performanceQuery || node.config.historicalQuery))
        .map((node) => ({ id: node.id, label: node.label })),
    [graph],
  )
  const simulatedNow = localInputToIso(simulatedNowInput)
  const hasOrchestrator = Boolean(graph?.nodes.some((node) => node.type === "orchestrator"))

  const describeContext: NodeDescribeContext = useMemo(
    () => ({
      triggerLabel: workflow ? triggerLabel(workflow.trigger) : undefined,
      triggerKind: workflow?.trigger.kind,
      getAgentName: (agentId) => agentsQuery.data?.find((agent) => agent.id === agentId)?.name,
      getOrchestratorName: (orchestratorId) => orchestratorsQuery.data?.find((item) => item.id === orchestratorId)?.name,
      getVariable: (variableId) => {
        const variable = variablesQuery.data?.find((candidate) => candidate.id === variableId)
        return variable ? { label: variable.name, type: variable.type } : undefined
      },
      getNodeLabel: (nodeId) => graph?.nodes.find((node) => node.id === nodeId)?.label,
    }),
    [workflow, agentsQuery.data, orchestratorsQuery.data, variablesQuery.data, graph],
  )

  const canRun = Boolean(workflow && subject && !runMutation.isPending && (mode !== "UNTIL_NODE" || untilNodeId))

  async function handleRun() {
    if (!workflow || !subject) return
    const run = await runMutation.mutateAsync({
      workflowId: workflow.id,
      graphSource,
      subject,
      simulatedNow,
      scheduledFor: workflow.trigger.kind === "schedule" && workflow.trigger.mode !== "RELATIVE_TO_SHIFT" ? localInputToIso(scheduledForInput) : undefined,
      mode,
      untilNodeId: mode === "UNTIL_NODE" ? untilNodeId : undefined,
      aiPolicy: ai.aiPolicy,
      maxAiCalls: ai.aiPolicy === "REAL" ? ai.maxAiCalls : null,
    })
    setResult(run)
  }

  const liveResult = result
  const trigger = workflow?.trigger ?? null

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label>Workflow</Label>
          <WorkflowSelect value={workflowId} onChange={handleWorkflowChange} />
        </div>
        {workflow ? (
          <div className="space-y-1.5">
            <Label>Configuração a testar</Label>
            <Select value={graphSource} onValueChange={(next) => setGraphSourceChoice(next as "PUBLISHED" | "DRAFT")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">Testar rascunho atual</SelectItem>
                <SelectItem value="PUBLISHED" disabled={!workflow.publishedGraph}>
                  Testar versão publicada{!workflow.publishedGraph ? " (ainda não publicado)" : ""}
                </SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className={workflow.published ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300" : "border-amber-500/50 text-amber-700 dark:text-amber-300"}>
                Estado: {workflow.published ? (hasUnpublishedChanges ? "Publicado · alterações não publicadas" : "Publicado") : "Rascunho"}
              </Badge>
              <span className="text-muted-foreground">
                {graphSource === "DRAFT"
                  ? "Esta execução usa o rascunho atual e não afeta a versão publicada."
                  : "Esta execução usa a configuração atualmente publicada, mas todos os efeitos continuam simulados."}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {workflowQuery.isLoading ? <Skeleton className="h-40 w-full" /> : null}

      {workflow && graph && trigger ? (
        <>
          {/* Inspeção automática (Parte 15): trigger, abrangência, unidade, nodes. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary" className="gap-1">
              <Zap className="h-3 w-3" /> {triggerBadgeText(trigger)}
            </Badge>
            <Badge variant="outline">Abrangência: {formatScopeLabel(workflow)}</Badge>
            <Badge variant="outline">Modo: {structure ? `Consolidado — ${CONSOLIDATED_STRUCTURE_LABELS[structure.kind as ConsolidatedStructureKind]}` : "Individual (por colaborador)"}</Badge>
            <Badge variant="outline">{graph.nodes.length} nodes</Badge>
            {graph.nodes
              .filter((node) => node.type === "condition")
              .map((node) => (
                <Badge key={node.id} variant="outline">
                  Condição: {node.label}
                </Badge>
              ))}
          </div>

          {/* Contexto do Trigger — um por tipo de gatilho. */}
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-sm font-medium">Contexto do teste</p>
            {trigger.kind === "channel_flag" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Flag <span className="font-mono">{trigger.channel}.{trigger.flagName}</span> — a interação selecionada É o evento do gatilho. Sempre UMA interação por QA Run; só este workflow é executado para ela.
                </p>
                <InteractionEvidencePicker
                  key={workflow.id}
                  workflowId={workflow.id}
                  flagLabel={`${trigger.channel}.${trigger.flagName}`}
                  valueType={trigger.valueType}
                  hint={hint}
                  requiresTranscript={graphNeedsTranscript(graph)}
                  operator={flagOperator}
                  onOperatorChange={(person) => {
                    setFlagOperator(person)
                    setFlagInteraction(null)
                    setSubject(null)
                    setSubjectLabel("")
                  }}
                  value={flagInteraction}
                  onChange={(interaction) => {
                    setFlagInteraction(interaction)
                    setSubject(interaction ? { kind: "interaction", interactionId: interaction.id } : null)
                    setSubjectLabel(interaction ? `${interaction.externalId} · ${interaction.operatorName}` : "")
                  }}
                />
                {eventConditions(graph).length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {eventConditions(graph).map((node) => `“${node.label}”`).join(", ")}: esta Condition depende do evento selecionado e será avaliada após escolher uma interação.
                  </p>
                ) : null}
                {conditionNodes.length > 0 ? (
                  <ConditionPreviewPicker
                    workflowId={workflow.id}
                    graphSource={graphSource}
                    conditionNodes={conditionNodes}
                    simulatedNow={simulatedNow}
                    selectedSubjectId={flagOperator?.id ?? null}
                    onSelect={(row) => {
                      // Em Trigger por Flag a prévia populacional só ajuda a ESCOLHER O COLABORADOR —
                      // a massa continua sendo uma interação dele.
                      if (row.subject.kind !== "operator") return
                      setFlagOperator({ id: row.subjectId, name: row.label, role: "OPERATOR", teamId: null, teamName: row.teamName, subteamId: null, subteamName: null, hasShift: false })
                      setFlagInteraction(null)
                      setSubject(null)
                      setSubjectLabel("")
                    }}
                  />
                ) : null}
              </>
            ) : null}
            {trigger.kind === "manual" && trigger.context === "INTERACTION" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Gatilho Manual com interação — a simulação usa UMA interação real do colaborador, como o &quot;Executar agora&quot; faria, mas sem gravar nem entregar nada.
                </p>
                <InteractionEvidencePicker
                  key={workflow.id}
                  workflowId={workflow.id}
                  flagLabel={null}
                  valueType="NUMERIC"
                  hint={null}
                  requiresTranscript={graphNeedsTranscript(graph)}
                  operator={flagOperator}
                  onOperatorChange={(person) => {
                    setFlagOperator(person)
                    setFlagInteraction(null)
                    setSubject(null)
                    setSubjectLabel("")
                  }}
                  value={flagInteraction}
                  onChange={(interaction) => {
                    setFlagInteraction(interaction)
                    setSubject(interaction ? { kind: "interaction", interactionId: interaction.id } : null)
                    setSubjectLabel(interaction ? `${interaction.externalId} · ${interaction.operatorName}` : "")
                  }}
                />
              </>
            ) : null}
            {trigger.kind === "manual" && trigger.context === "INDICATOR_MEASUREMENT" && trigger.indicatorCode ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Gatilho Manual com medição de <span className="font-mono">{trigger.indicatorCode}</span> — escolha UMA medição real de um colaborador, como o &quot;Executar agora&quot; faria.
                </p>
                <MeasurementPicker
                  indicatorCode={trigger.indicatorCode}
                  indicatorName={trigger.indicatorName ?? trigger.indicatorCode}
                  hint={hint}
                  value={subject?.kind === "measurement" ? subject.measurementId : null}
                  onChange={(measurement) => {
                    setSubject(measurement ? { kind: "measurement", measurementId: measurement.id } : null)
                    setSubjectLabel(measurement ? `${measurement.operatorName} · ${measurement.value}` : "")
                  }}
                />
              </>
            ) : null}
            {trigger.kind === "indicator" ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Indicador <span className="font-mono">{trigger.indicatorCode}</span> — escolha UMA medição real de um colaborador (valor atual x meta).
                </p>
                <MeasurementPicker
                  indicatorCode={trigger.indicatorCode}
                  indicatorName={trigger.indicatorName}
                  hint={hint}
                  value={subject?.kind === "measurement" ? subject.measurementId : null}
                  onChange={(measurement) => {
                    setSubject(measurement ? { kind: "measurement", measurementId: measurement.id } : null)
                    setSubjectLabel(measurement ? `${measurement.operatorName} · ${measurement.value}` : "")
                  }}
                />
              </>
            ) : null}
            {(trigger.kind === "schedule" && (trigger.mode === "RELATIVE_TO_SHIFT" || !structure)) || (trigger.kind === "manual" && trigger.context === "COLLABORATOR") ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <PersonPicker
                    value={subject?.kind === "operator" ? subject.operatorId : null}
                    scope={{ scopeType: workflow.scopeType, teamId: workflow.teamId, subteamId: workflow.subteamId }}
                    onChange={(person) => {
                      setSubject(person ? { kind: "operator", operatorId: person.id } : null)
                      setSubjectLabel(person?.name ?? "")
                    }}
                    emptyHint="Nenhum colaborador na abrangência deste workflow."
                  />
                  {trigger.kind === "schedule" && trigger.mode === "RELATIVE_TO_SHIFT" ? (
                    <p className="text-xs text-muted-foreground">
                      O momento do disparo é calculado a partir da jornada cadastrada do colaborador na data simulada — sem jornada, o teste avisa em vez de inventar um horário.
                    </p>
                  ) : null}
                </div>
                <ConditionPreviewPicker
                  workflowId={workflow.id}
                  graphSource={graphSource}
                  conditionNodes={conditionNodes}
                  simulatedNow={simulatedNow}
                  selectedSubjectId={subject?.kind === "operator" ? subject.operatorId : null}
                  onSelect={(row) => {
                    setSubject(row.subject)
                    setSubjectLabel(`${row.label} — ${row.summary}`)
                  }}
                />
              </div>
            ) : null}
            {trigger.kind === "schedule" && trigger.mode !== "RELATIVE_TO_SHIFT" && structure ? (
              <div className="grid gap-4 md:grid-cols-2">
                <UnitSubjectPicker
                  structure={structure}
                  subject={subject}
                  onChange={(next, label) => {
                    setSubject(next)
                    setSubjectLabel(label)
                  }}
                />
                <ConditionPreviewPicker
                  workflowId={workflow.id}
                  graphSource={graphSource}
                  conditionNodes={conditionNodes}
                  simulatedNow={simulatedNow}
                  consolidatedStructure={subject?.kind === "unit" ? subject.consolidatedStructure : structure}
                  selectedSubjectId={subject?.kind === "unit" ? (consolidatedStructureAnchorId(subject.consolidatedStructure) ?? consolidatedStructureGroupId(subject.consolidatedStructure)) : null}
                  onSelect={(row) => {
                    setSubject(row.subject)
                    setSubjectLabel(`${row.label} — ${row.summary}`)
                  }}
                />
              </div>
            ) : null}
            {subjectLabel && trigger.kind !== "channel_flag" && !(trigger.kind === "manual" && trigger.context === "INTERACTION") ? (
              <p className="text-xs">
                Selecionado: <span className="font-medium">{subjectLabel}</span>
              </p>
            ) : null}
          </div>

          {/* Relógio simulado + modo de execução. */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="qa-simulated-now">Data/hora simulada</Label>
              <Input id="qa-simulated-now" type="datetime-local" value={simulatedNowInput} onChange={(event) => setSimulatedNowInput(event.target.value)} />
              <p className="text-xs text-muted-foreground">Usada por Agenda, Wait, janelas históricas e comparações temporais.</p>
            </div>
            {trigger.kind === "schedule" && trigger.mode !== "RELATIVE_TO_SHIFT" ? (
              <div className="space-y-1.5">
                <Label htmlFor="qa-scheduled-for">Disparo da agenda (simulado)</Label>
                <Input id="qa-scheduled-for" type="datetime-local" value={scheduledForInput} onChange={(event) => setScheduledForInput(event.target.value)} />
                <p className="text-xs text-muted-foreground">Ex.: dia 5 às 09:00 — executa imediatamente, sem esperar o scheduler.</p>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Modo de execução</Label>
              <Select value={mode} onValueChange={(next) => setMode(next as WorkflowRunMode)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RUN_MODE_LABELS) as WorkflowRunMode[]).map((option) => (
                    <SelectItem key={option} value={option}>
                      {RUN_MODE_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mode === "UNTIL_NODE" ? (
                <Select value={untilNodeId} onValueChange={setUntilNodeId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Executar até antes de…" />
                  </SelectTrigger>
                  <SelectContent>
                    {graph.nodes
                      .filter((node) => node.type !== "trigger")
                      .map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {NODE_TYPE_LABELS[node.type]} — {node.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>

          <AiControls
            value={ai}
            onChange={setAi}
            idPrefix="qa-workflow"
            note={hasOrchestrator ? "Este Workflow contém um Orchestrator, que pode realizar mais de uma requisição à IA (roteamento, especialistas, síntese) — a quantidade exata depende do roteamento." : undefined}
          />

          <div className="flex justify-end">
            <Button disabled={!canRun} onClick={handleRun} className="gap-1">
              <Play className="h-4 w-4" />
              {runMutation.isPending ? "Executando…" : "Executar somente este Workflow"}
            </Button>
          </div>
        </>
      ) : null}

      {liveResult && graph ? (
        <RunResultWithCanvas run={liveResult} graph={graph} describeContext={describeContext} onRerun={setResult} />
      ) : null}
    </div>
  )
}

/** O resultado lê sempre a versão mais recente do run no cache (retomadas/decisões atualizam
 * o cache via setQueryData) — por isso o canvas/trace mudam sem refetch. `onRerun` acompanha o
 * id quando "Executar novamente"/"Testar rascunho atual" cria um QA Run NOVO (id diferente) —
 * sem isso, o `<LiveRun id={run.id}>` abaixo ficava preso pro sempre no id antigo, e clicar
 * nesses botões parecia não fazer nada (bug real, achado no passeio manual desta rodada). */
function RunResultWithCanvas({ run, graph, describeContext, onRerun }: { run: QaRun; graph: FlowGraph; describeContext: NodeDescribeContext; onRerun: (run: QaRun) => void }) {
  return (
    <LiveRun id={run.id} fallback={run}>
      {(current) => (
        <RunResult
          run={current}
          canvas={<SimulationCanvas graph={graph} steps={current.trace.steps} state={current.state} describeContext={describeContext} />}
          onRerun={onRerun}
        />
      )}
    </LiveRun>
  )
}

function UnitSubjectPicker({ structure, subject, onChange }: { structure: StructureAnchor; subject: WorkflowSubject | null; onChange: (subject: WorkflowSubject | null, label: string) => void }) {
  const kind = structure.kind
  const anchorRole = CONSOLIDATED_STRUCTURE_ANCHOR_ROLE[kind as ConsolidatedStructureKind]
  const configuredAnchor = consolidatedStructureAnchorId(structure)
  const selectedAnchor = subject?.kind === "unit" ? consolidatedStructureAnchorId(subject.consolidatedStructure) : null
  const label = CONSOLIDATED_STRUCTURE_LABELS[kind as ConsolidatedStructureKind]

  if (!anchorRole) {
    // Subgrupo/Grupo já estão fixos na configuração do workflow — só confirma a unidade.
    const selected = subject?.kind === "unit"
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">Modo Consolidado: {label}. A simulação executa somente essa estrutura como UMA unidade (nunca uma execução por operador).</p>
        <Button type="button" size="sm" variant={selected ? "default" : "outline"} onClick={() => onChange(selected ? null : { kind: "unit", consolidatedStructure: structure }, selected ? "" : label)}>
          {selected ? "Estrutura selecionada" : `Usar ${label} configurado no workflow`}
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Modo Consolidado: {label}. Escolha UMA pessoa-âncora — a configurada no workflow vem pré-selecionada, mas você pode testar outra sem alterar a configuração.
      </p>
      <PersonPicker
        label={label}
        role={anchorRole}
        value={selectedAnchor ?? configuredAnchor}
        onChange={(person) => {
          const next = person ? withAnchor(kind, person.id) : null
          onChange(next ? { kind: "unit", consolidatedStructure: next } : null, person ? `${label}: ${person.name}` : "")
        }}
      />
      {!subject && configuredAnchor ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ kind: "unit", consolidatedStructure: structure }, `${label} (configurado)`)}>
          Usar a pessoa configurada no workflow
        </Button>
      ) : null}
    </div>
  )
}
