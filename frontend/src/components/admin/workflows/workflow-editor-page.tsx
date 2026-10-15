"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  addEdge,
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { useReactFlowColorMode } from "@/hooks/use-react-flow-color-mode"
import { ArrowLeft, Play, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ManualRunDialog } from "./manual-run-dialog"

import { useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useOrchestratorsQuery } from "@/queries/admin/use-assistant-queries"
import { usePublishedPolicySummariesQuery } from "@/queries/admin/use-intervention-policy-queries"
import {
  useDeleteWorkflowMutation,
  useSaveWorkflowDraftMutation,
  useUpdateWorkflowMutation,
  useWorkflowQuery,
} from "@/queries/admin/use-workflow-queries"
import { useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import { type FlowGraph, type FlowNode, type FlowNodeType } from "@/schemas/admin/workflow-graph.schema"
import { goLiveImpactFromError, triggerBadgeText, triggerLabel, triggerProvidesValue, triggerValueIsBoolean, withDraftConfiguration, type WorkflowDetail } from "@/schemas/admin/workflow.schema"
import { validateWorkflowGraph } from "@/schemas/admin/workflow-validation"

import { resolveStructuredFields } from "./content-sources"
import { fromReactFlow, toReactFlow, toReactFlowNodeType, type RFEdge, type RFNode } from "./graph-mappers"
import { NodeConfigPanel } from "./node-config-panel"
import { NodePalette, WORKFLOW_NODE_DRAG_MIME } from "./node-palette"
import { combineIssues, usePublishValidation } from "./use-publish-validation"
import { WorkflowIssuesPanel } from "./workflow-issues-panel"
import { WORKFLOW_NODE_TYPES } from "./workflow-node"
import { WorkflowEditorProvider } from "./workflow-editor-context"
import { WorkflowEnrollmentsTab } from "./workflow-enrollments-tab"
import { WorkflowResultsTab } from "./workflow-results-tab"
import { formatScopeLabel } from "@/lib/admin/scope-compatibility"
import { CONSOLIDATED_STRUCTURE_LABELS } from "@/schemas/admin/consolidated-structure-schema"
import { WorkflowSettingsSheet } from "./workflow-settings-sheet"
import { GoLiveImpactDialog } from "./go-live-impact-dialog"
import { usePublishFlow } from "./use-publish-flow"
import { describeConfigurationChanges } from "./workflow-configuration-summary"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** Badge "Individual"/"Consolidado · <estrutura>" ao lado da Abrangência — herança visual do
 * Modo de avaliação, nunca uma pergunta de novo dentro do editor (mesmo espírito da Abrangência). */
function describeAnalysisMode(workflow: WorkflowDetail): string {
  if (!workflow.consolidatedStructure) return "Individual"
  return `Consolidado · ${CONSOLIDATED_STRUCTURE_LABELS[workflow.consolidatedStructure.kind]}`
}

function defaultConfigFor(type: FlowNodeType, trigger: WorkflowDetail["trigger"]): FlowNode["config"] {
  switch (type) {
    case "trigger":
    case "end":
      return {}
    case "wait":
      return { durationMs: 60 * 60 * 1000 }
    case "condition":
      // Agenda não tem valor "disparado" pra comparar (Parte 14 do pedido de Abrangência/Unidade
      // de Análise) — um Condition novo já nasce em modo Histórico do indicador, nunca no modo
      // "Valor do gatilho" (que ficaria preso, sem UI pra sair dele — ver node-config/condition-form.tsx).
      if (!triggerProvidesValue(trigger)) {
        return {
          comparator: "GTE",
          thresholdNumeric: 1,
          thresholdBoolean: null,
          historicalQuery: {
            kind: "INDICATOR_THRESHOLD_COUNT",
            indicatorCode: "",
            aggregation: "COUNT",
            comparator: "LT",
            indicatorThreshold: 0,
            period: { kind: "ROLLING_DAYS", days: 7 },
          },
        }
      }
      return triggerValueIsBoolean(trigger)
        ? { comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null }
        : { comparator: "GTE", thresholdBoolean: null, thresholdNumeric: 1 }
    case "select_employees":
      // Mesmo default "fresco" de uma Condition histórica nova (Valor do indicador, Quantidade
      // de ocorrências) — o critério reaproveita literalmente o mesmo builder, então nasce com a
      // mesma forma inicial, nunca um estado vazio exigindo um clique a mais.
      return {
        criterion: {
          comparator: "GTE",
          thresholdNumeric: 1,
          thresholdBoolean: null,
          historicalQuery: {
            kind: "INDICATOR_THRESHOLD_COUNT",
            indicatorCode: "",
            aggregation: "COUNT",
            comparator: "LT",
            indicatorThreshold: 0,
            period: { kind: "ROLLING_DAYS", days: 7 },
          },
        },
      }
    case "apply_individually":
    case "consolidate_results":
      return {}
    case "action":
      return { actionType: "CALL_AGENT", agentId: "" }
    case "orchestrator":
      return { orchestratorId: "", instruction: "Analise esta ocorrência e traga diagnóstico, aderência a processos e recomendação de feedback." }
    case "human_review":
      return { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } }
    case "output":
      return { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "" }
    case "intervention_policy":
      // Nasce em "Somente recomendar": abrir de fato é uma escolha explícita de quem configura.
      return { policyId: "", mode: "RECOMMEND_ONLY", analysisSourceNodeIds: [] }
  }
}

function graphsEqual(a: FlowGraph, b: FlowGraph): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Mesmo padrão de "estado local desacoplado" do nome do nó (NodeConfigPanel) e do nome do
 * orquestrador (assistant/orchestrator-editor-page.tsx) — edita na hora, mas só manda o PATCH
 * quando o campo perde o foco (ou Enter), pra não disparar uma mutation a cada tecla digitada.
 */
function WorkflowNameEditor({ workflow }: { workflow: WorkflowDetail }) {
  const updateMutation = useUpdateWorkflowMutation()
  const [value, setValue] = useState(workflow.name)
  // `onBlur`'s `commit` closes over `value` from the render at the time the listener was
  // attached — chamar `setValue` e `blur()` no mesmo handler (caso do Escape) não muda esse
  // valor a tempo, então o commit ainda via o texto editado e salvava mesmo assim (confirmado
  // ao vivo em 2026-09-11: Escape "cancelava" na tela mas um PATCH com o texto errado saía do
  // mesmo jeito). Esse ref é checado por `commit` pra saber que deve só descartar, sem salvar.
  const cancelledRef = useRef(false)

  // Nome salvo mudou (outra aba, recarga): o campo acompanha — ajuste na renderização, sem render extra.
  const [syncedName, setSyncedName] = useState(workflow.name)
  if (syncedName !== workflow.name) {
    setSyncedName(workflow.name)
    setValue(workflow.name)
  }

  function commit() {
    if (cancelledRef.current) {
      cancelledRef.current = false
      return
    }
    const trimmed = value.trim()
    if (trimmed && trimmed !== workflow.name) updateMutation.mutate({ id: workflow.id, name: trimmed })
    else setValue(workflow.name)
  }

  return (
    <Input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur()
        if (event.key === "Escape") {
          cancelledRef.current = true
          setValue(workflow.name)
          event.currentTarget.blur()
        }
      }}
      aria-label="Nome do workflow"
      className="h-8 max-w-md border-0 px-1 text-lg font-semibold shadow-none focus-visible:ring-1"
    />
  )
}

/**
 * `workflow` = como a API devolve: campos de topo = configuração PUBLICADA (o que roda). O canvas edita e valida o
 * RASCUNHO inteiro — grafo E configuração (`editable`), que só passam a valer ao Publicar.
 */
function WorkflowCanvas({ workflow }: { workflow: WorkflowDetail }) {
  const editable = useMemo(() => withDraftConfiguration(workflow), [workflow])
  const colorMode = useReactFlowColorMode()
  const agentsQuery = useAgentsQuery()
  const orchestratorsQuery = useOrchestratorsQuery()
  // Só para o nome no card do nó "Avaliar política de acompanhamento" (resumo publicado — lido com workflows.manage).
  const policySummariesQuery = usePublishedPolicySummariesQuery()
  const variablesQuery = useWorkflowVariablesQuery(workflow.id)
  const orchestratorsById = useMemo(() => new Map((orchestratorsQuery.data ?? []).map((orchestrator) => [orchestrator.id, orchestrator])), [orchestratorsQuery.data])
  const saveDraftMutation = useSaveWorkflowDraftMutation(workflow.id)
  const publishFlow = usePublishFlow(workflow.id)
  const { screenToFlowPosition, fitView } = useReactFlow()

  const initial = useMemo(() => toReactFlow(workflow.draftGraph), [workflow.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(initial.edges)
  const [savedGraph, setSavedGraph] = useState<FlowGraph>(workflow.draftGraph)
  const [configNodeId, setConfigNodeId] = useState<string | null>(null)

  const currentGraph = useMemo(() => fromReactFlow(nodes, edges), [nodes, edges])
  const isDirty = !graphsEqual(currentGraph, savedGraph)
  const selectedNode = nodes.find((node) => node.selected)?.data.flowNode ?? null
  const configNode = nodes.find((node) => node.id === configNodeId)?.data.flowNode ?? null

  const variablesById = useMemo(
    () => new Map((variablesQuery.data ?? []).map((variable) => [variable.id, { type: variable.type, name: variable.name }])),
    [variablesQuery.data],
  )

  // Espelha a validação do publish no backend — sinaliza no próprio nó em vez de só estourar
  // erro quando o usuário clicar em Publicar.
  const graphIssues = useMemo(
    () => validateWorkflowGraph(currentGraph, editable.trigger, orchestratorsById, variablesById, Boolean(editable.consolidatedStructure)),
    [currentGraph, editable.trigger, orchestratorsById, variablesById, editable.consolidatedStructure],
  )
  // Dry-run do backend sobre o rascunho PERSISTIDO — "Pronto para publicar" = local + servidor.
  // A revisão muda a cada save e a cada mudança de configuração (Abrangência/Estrutura/Gatilho);
  // nunca a cada tecla (ver use-publish-validation.ts).
  const [savedRevision, setSavedRevision] = useState(0)
  const revision = useMemo(
    () => JSON.stringify([savedRevision, editable.scopeType, editable.teamId, editable.subteamId, editable.trigger, editable.consolidatedStructure ?? null, editable.populationFilter ?? null]),
    [savedRevision, editable.scopeType, editable.teamId, editable.subteamId, editable.trigger, editable.consolidatedStructure, editable.populationFilter],
  )
  const publishValidation = usePublishValidation({ workflowId: workflow.id, revision, isDirty, localIssueCount: graphIssues.length })
  const allIssues = useMemo(() => combineIssues(graphIssues, publishValidation.backendIssue), [graphIssues, publishValidation.backendIssue])
  // Por nó: quantos problemas e o PRIMEIRO deles — o card mostra "N problemas" + uma linha, o
  // painel de configuração mostra a lista completa (ver NodeConfigPanel `issues`).
  const issuesByNodeId = useMemo(() => {
    const map: Record<string, { count: number; message: string }> = {}
    for (const issue of allIssues) {
      if (!issue.nodeId) continue
      const current = map[issue.nodeId]
      map[issue.nodeId] = current ? { count: current.count + 1, message: current.message } : { count: 1, message: issue.message }
    }
    return map
  }, [allIssues])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter") return
      const target = event.target as HTMLElement
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return
      if (selectedNode) setConfigNodeId(selectedNode.id)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedNode])

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => {
        const withoutDuplicateHandle = current.filter(
          (edge) => !(edge.source === connection.source && edge.sourceHandle === connection.sourceHandle),
        )
        return addEdge({ ...connection, id: crypto.randomUUID() }, withoutDuplicateHandle)
      })
    },
    [setEdges],
  )

  function addNodeAt(type: FlowNodeType, position: { x: number; y: number }) {
    const id = crypto.randomUUID()
    const node: RFNode = {
      id,
      type: toReactFlowNodeType(type),
      position,
      deletable: true,
      data: {
        flowNode: {
          id,
          type,
          label: "",
          position: { x: 0, y: 0 },
          config: defaultConfigFor(type, editable.trigger),
        } as FlowNode,
      },
    }
    setNodes((current) => [...current, node])
    setConfigNodeId(id)
  }

  /** Fallback de clique da paleta (ver node-palette.tsx) — reaproveita `addNodeAt`, só calcula
   * uma posição padrão em vez de ler `event.clientX/clientY` do drop nativo: um pouco abaixo do
   * nó mais baixo já no canvas, centralizado na mesma coluna X dele (ou (0,0) no canvas vazio),
   * pra nunca empilhar o novo nó exatamente em cima de outro. */
  function addNodeAtDefaultPosition(type: FlowNodeType) {
    const lowest = nodes.reduce<RFNode | null>((acc, node) => (!acc || node.position.y > acc.position.y ? node : acc), null)
    // 220 (não 160): nodes com mais campos (ex.: Output, Revisão humana com 3 branches) passam
    // de 140px de altura renderizada — um gap menor deixava o próximo node sobrepor o anterior.
    const position = lowest ? { x: lowest.position.x, y: lowest.position.y + 220 } : { x: 0, y: 0 }
    addNodeAt(type, position)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const type = event.dataTransfer.getData(WORKFLOW_NODE_DRAG_MIME) as FlowNodeType | ""
    if (!type) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addNodeAt(type, position)
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes(WORKFLOW_NODE_DRAG_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }

  /** "Erro navega para o nó": seleciona, centraliza (fitView só nesse nó, sem estourar o zoom) e
   * abre o painel de configuração — usado pela lista de problemas do rodapé. */
  function focusNode(nodeId: string) {
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })))
    void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.25, padding: 0.5 })
    setConfigNodeId(nodeId)
  }

  function updateConfigNode(next: FlowNode) {
    setNodes((current) => current.map((node) => (node.id === next.id ? { ...node, data: { flowNode: next } } : node)))
  }

  function deleteConfigNode() {
    if (!configNodeId) return
    setNodes((current) => current.filter((node) => node.id !== configNodeId))
    setEdges((current) => current.filter((edge) => edge.source !== configNodeId && edge.target !== configNodeId))
    setConfigNodeId(null)
  }

  async function handleSaveDraft() {
    try {
      await saveDraftMutation.mutateAsync(currentGraph)
      setSavedGraph(currentGraph)
      setSavedRevision((current) => current + 1)
    } catch {
      // já sinalizado via saveDraftMutation.isError / toast do useAdminMutation
    }
  }

  // Publicar só habilita com o rascunho salvo E o dry-run do servidor válido (`ready`) — e mesmo
  // assim o backend valida de novo dentro do publish: a organização pode ter mudado entre o
  // dry-run e o clique, e o backend continua sendo a autoridade final. Antes de publicar, a prévia
  // do impacto decide se precisa do diálogo (configuração mudando, Agenda que dispara agora…).
  function handlePublish() {
    void publishFlow.start()
  }
  // 409 "confirme o impacto" não é erro para o rodapé: vira o diálogo.
  const publishError = publishFlow.isError && !goLiveImpactFromError(publishFlow.error) ? (publishFlow.error as Error).message : null

  const editorContextValue = useMemo(
    () => ({
      triggerLabel: triggerLabel(editable.trigger),
      triggerKind: editable.trigger.kind,
      isConsolidatedMode: Boolean(editable.consolidatedStructure),
      getAgentName: (agentId: string) => agentsQuery.data?.find((agent) => agent.id === agentId)?.name,
      getOrchestratorName: (orchestratorId: string) => orchestratorsQuery.data?.find((orchestrator) => orchestrator.id === orchestratorId)?.name,
      getPolicyName: (policyId: string) => policySummariesQuery.data?.find((policy) => policy.id === policyId)?.name,
      getStructuredFieldLabel: (nodeId: string, fieldPath: string) =>
        resolveStructuredFields(currentGraph, nodeId, orchestratorsById, new Map((policySummariesQuery.data ?? []).map((policy) => [policy.id, policy])))?.find((field) => field.path === fieldPath)?.label,
      getStructuredFieldOptionLabel: (nodeId: string, fieldPath: string, value: string) =>
        resolveStructuredFields(currentGraph, nodeId, orchestratorsById, new Map((policySummariesQuery.data ?? []).map((policy) => [policy.id, policy])))
          ?.find((field) => field.path === fieldPath)
          ?.enumOptions?.find((option) => option.value === value)?.label,
      getVariable: (variableId: string) => {
        const variable = variablesQuery.data?.find((candidate) => candidate.id === variableId)
        return variable ? { label: variable.name, type: variable.type } : undefined
      },
      getNodeLabel: (nodeId: string) => currentGraph.nodes.find((candidate) => candidate.id === nodeId)?.label,
      issuesByNodeId,
    }),
    [editable.trigger, editable.consolidatedStructure, agentsQuery.data, orchestratorsQuery.data, policySummariesQuery.data, orchestratorsById, currentGraph, variablesQuery.data, issuesByNodeId],
  )

  return (
    // Coluna: canvas em cima, rodapé de ações FORA da área do React Flow (safe area real — nenhum
    // nó fica atrás de "Salvar rascunho"/"Publicar", e o fitView do canvas nunca precisa
    // compensar controle nenhum; ver rodada de hardening dos Workflows-modelo, 2026-09-16).
    // 18rem = cabeçalho do admin + título/badges + abas (≈250px medidos) + respiro inferior: o
    // rodapé de ações precisa caber SEM rolagem da página em 900px de altura (1440×900 / 1280×800
    // / 1024×768 verificados) — com 13rem o conjunto estourava e os botões ficavam abaixo da dobra.
    <div className="flex h-[calc(100vh-18rem)] min-h-[480px] flex-col">
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 rounded-lg border">
        <ResizablePanel defaultSize="16" minSize="10" maxSize="28" className="overflow-y-auto p-3">
          <NodePalette isConsolidatedMode={Boolean(editable.consolidatedStructure)} onAddNode={addNodeAtDefaultPosition} />
        </ResizablePanel>
        <ResizableHandle withHandle />

        <ResizablePanel minSize="30">
          <div className="h-full min-w-0" onDrop={handleDrop} onDragOver={handleDragOver}>
            <WorkflowEditorProvider value={editorContextValue}>
              <ReactFlow
                colorMode={colorMode}
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={(_event, node) => {
                  // Painel já aberto: acompanha o clique e troca pro nó clicado.
                  // Painel fechado: clique só seleciona (abrir é só com duplo clique/Enter).
                  setConfigNodeId((current) => (current ? node.id : current))
                }}
                onNodeDoubleClick={(_event, node) => setConfigNodeId(node.id)}
                onPaneClick={() => setConfigNodeId(null)}
                nodeTypes={WORKFLOW_NODE_TYPES}
                deleteKeyCode={["Delete", "Backspace"]}
                fitView
                fitViewOptions={{ padding: 0.1, maxZoom: 1 }}
                // minZoom padrão (0.5) impedia o fit dos modelos grandes (11 nós numa coluna ≈
                // 2.300px): "Ajustar à tela" cortava topo e fim. Com 0.15 o grafo inteiro cabe no
                // canvas mesmo em 1024×768 (≈416px úteis) e o admin aproxima onde precisar.
                minZoom={0.15}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </WorkflowEditorProvider>
          </div>
        </ResizablePanel>

        {configNode ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="26" minSize="18" maxSize="42" className="overflow-y-auto">
              <NodeConfigPanel
                node={configNode}
                graph={currentGraph}
                trigger={editable.trigger}
                workflowId={workflow.id}
                scope={{ scopeType: editable.scopeType, teamId: editable.teamId ?? undefined, subteamId: editable.subteamId ?? undefined }}
                evaluationMode={editable.consolidatedStructure ? "CONSOLIDATED" : "INDIVIDUAL"}
                consolidatedStructure={editable.consolidatedStructure ?? null}
                populationFilter={editable.populationFilter ?? null}
                issues={allIssues.filter((issue) => issue.nodeId === configNode.id).map((issue) => issue.message)}
                onChange={updateConfigNode}
                onDelete={deleteConfigNode}
                onClose={() => setConfigNodeId(null)}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2" data-testid="workflow-editor-footer">
        <WorkflowIssuesPanel issues={allIssues} status={publishValidation.status} nodeLabelById={(nodeId) => currentGraph.nodes.find((node) => node.id === nodeId)?.label || undefined} onSelectIssue={focusNode} onRevalidate={publishValidation.revalidate} />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {saveDraftMutation.isError ? <p className="max-w-md truncate text-sm text-destructive" title={(saveDraftMutation.error as Error).message}>{(saveDraftMutation.error as Error).message}</p> : null}
          {publishError ? <p className="max-w-md truncate text-sm text-destructive" title={publishError}>{publishError}</p> : null}
          <Button variant="outline" disabled={!isDirty || saveDraftMutation.isPending} onClick={handleSaveDraft}>
            {saveDraftMutation.isPending ? "Salvando..." : "Salvar rascunho"}
          </Button>
          <Button
            disabled={publishFlow.isPending || publishFlow.checking || saveDraftMutation.isPending || publishValidation.status !== "ready"}
            title={
              publishValidation.status === "stale"
                ? "Salve o rascunho para validar a publicação."
                : publishValidation.status === "validating"
                  ? "Aguarde a validação no servidor."
                  : publishValidation.status === "ready"
                    ? undefined
                    : "Corrija os problemas sinalizados antes de publicar."
            }
            onClick={handlePublish}
          >
            {publishFlow.isPending ? "Publicando..." : publishFlow.checking ? "Verificando..." : "Publicar"}
          </Button>
        </div>
      </div>
      <GoLiveImpactDialog
        key={publishFlow.dialog?.impact.fingerprint ?? "none"}
        open={publishFlow.dialog !== null}
        onOpenChange={(open) => !open && publishFlow.close()}
        impact={publishFlow.dialog?.impact ?? null}
        impactChanged={publishFlow.dialog?.impactChanged ?? false}
        changes={publishFlow.dialog ? describeConfigurationChanges(workflow, publishFlow.dialog.impact.configurationChanges) : []}
        pending={publishFlow.isPending}
        onConfirm={(fingerprint) => void publishFlow.confirm(fingerprint)}
      />
    </div>
  )
}

export function WorkflowEditorPage({ workflowId }: { workflowId: string }) {
  const router = useRouter()
  const workflowQuery = useWorkflowQuery(workflowId)
  const deleteMutation = useDeleteWorkflowMutation()
  const [tab, setTab] = useState("editor")
  // Gatilho Manual: cada abertura do "Executar agora" remonta o diálogo (nova intenção = nova chave de idempotência).
  const [manualRunSession, setManualRunSession] = useState(0)
  const [manualRunOpen, setManualRunOpen] = useState(false)
  const editable = useMemo(() => (workflowQuery.data ? withDraftConfiguration(workflowQuery.data) : null), [workflowQuery.data])
  const pendingChanges = useMemo(() => (workflowQuery.data ? describeConfigurationChanges(workflowQuery.data) : []), [workflowQuery.data])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/admin/workflows">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        {workflowQuery.data && editable ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <WorkflowNameEditor workflow={workflowQuery.data} />
            <Badge variant={workflowQuery.data.published ? "default" : "outline"}>
              {workflowQuery.data.published ? "Publicado" : "Rascunho"}
            </Badge>
            {/* Os badges mostram o RASCUNHO (o que se edita aqui); o que roda hoje aparece no aviso de pendência. */}
            <Badge variant="outline">{triggerBadgeText(editable.trigger)}</Badge>
            {/* Herança visual da Abrangência (Parte 8 do pedido) — nunca uma pergunta "qual
              * grupo?" de novo dentro do editor, só o contexto já escolhido no modal inicial. */}
            <Badge variant="outline" title="Abrangência do workflow">
              {formatScopeLabel(editable)}
            </Badge>
            <Badge variant="outline" title="Modo de avaliação">
              {describeAnalysisMode(editable)}
            </Badge>
            {pendingChanges.length > 0 ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300" data-testid="workflow-pending-configuration">
                    Configuração não publicada
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-sm">
                  <p className="mb-1 font-medium">Só passa a valer ao Publicar. Hoje roda:</p>
                  <ul className="space-y-0.5">
                    {pendingChanges.map((item) => (
                      <li key={item.change}>
                        {item.label}: {item.published} → {item.draft}
                      </li>
                    ))}
                  </ul>
                </TooltipContent>
              </Tooltip>
            ) : null}
            {workflowQuery.data.trigger.kind === "manual" ? (
              <Button
                type="button"
                size="sm"
                className="shrink-0"
                data-usage-element="workflow.manual_run.open"
                data-usage-entity-type="WORKFLOW"
                data-usage-entity-id={workflowId}
                onClick={() => {
                  setManualRunSession((current) => current + 1)
                  setManualRunOpen(true)
                }}
              >
                <Play className="h-4 w-4" />
                Executar agora
              </Button>
            ) : null}
            <WorkflowSettingsSheet workflow={workflowQuery.data} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="ml-auto" aria-label="Excluir workflow">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir {workflowQuery.data.name}?</AlertDialogTitle>
                  <AlertDialogDescription>Essa ação não pode ser desfeita. Execuções em andamento serão interrompidas.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      await deleteMutation.mutateAsync(workflowId)
                      router.push("/admin/workflows")
                    }}
                  >
                    Excluir
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <Skeleton className="h-6 w-64" />
        )}
      </div>

      {workflowQuery.isLoading ? (
        <Skeleton className="h-[520px] w-full" />
      ) : workflowQuery.isError || !workflowQuery.data ? (
        <p className="text-sm text-destructive">Não foi possível carregar este workflow.</p>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="enrollments">Execuções</TabsTrigger>
            <TabsTrigger value="results">Resultados</TabsTrigger>
          </TabsList>
          <TabsContent value="editor" className="mt-4">
            <ReactFlowProvider>
              <WorkflowCanvas workflow={workflowQuery.data} />
            </ReactFlowProvider>
          </TabsContent>
          <TabsContent value="enrollments" className="mt-4">
            <WorkflowEnrollmentsTab workflowId={workflowId} graph={workflowQuery.data.publishedGraph} />
          </TabsContent>
          <TabsContent value="results" className="mt-4">
            <WorkflowResultsTab workflowId={workflowId} />
          </TabsContent>
        </Tabs>
      )}
      {workflowQuery.data && workflowQuery.data.trigger.kind === "manual" ? (
        <ManualRunDialog
          key={manualRunSession}
          workflow={workflowQuery.data}
          open={manualRunOpen}
          onOpenChange={setManualRunOpen}
          onShowExecutions={() => setTab("enrollments")}
          onShowResults={() => setTab("results")}
        />
      ) : null}
    </div>
  )
}
