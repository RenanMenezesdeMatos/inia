"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { useIsMobile } from "@/hooks/use-mobile"
import { useReactFlowColorMode } from "@/hooks/use-react-flow-color-mode"
import { ArrowLeft, FlaskConical, Play, Trash2 } from "lucide-react"

import {
  AlertDialog,
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

import { useAgentReferencesQuery, useAgentsQuery } from "@/queries/admin/use-agent-queries"
import { useOrchestratorsQuery } from "@/queries/admin/use-assistant-queries"
import { usePublishedPolicySummariesQuery } from "@/queries/admin/use-intervention-policy-queries"
import {
  useDeleteWorkflowMutation,
  useSaveWorkflowDraftMutation,
  useUpdateWorkflowMutation,
  useWorkflowQuery,
} from "@/queries/admin/use-workflow-queries"
import { useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import { useCurrentUserQuery } from "@/queries/auth/use-current-user"
import { resolveNodeContexts, type FlowGraph, type FlowNode, type FlowNodeType } from "@/schemas/admin/workflow-graph.schema"
import { goLiveImpactFromError, triggerBadgeText, triggerLabel, triggerProvidesValue, triggerValueIsBoolean, withDraftConfiguration, type WorkflowDetail } from "@/schemas/admin/workflow.schema"
import { validateWorkflowGraph } from "@/schemas/admin/workflow-validation"

import { resolveStructuredFields } from "./content-sources"
import { connectBranch, withEdgeLabels } from "./edge-presentation"
import { findNodeDependents } from "./graph-references"
import { canonicalHandle, fromReactFlow, toReactFlow, toReactFlowNodeType, type RFEdge, type RFNode } from "./graph-mappers"
import { NodeConfigPanel } from "./node-config-panel"
import { NodePalette, paletteEntryById, WORKFLOW_NODE_DRAG_MIME, type ActionPreset, type PaletteEntry } from "./node-palette"
import { nodeDisplayName } from "./node-visuals"
import { REACT_FLOW_ARIA_LABELS_PT_BR } from "./react-flow-labels"
import { describeSaveDraftFailure, type SaveDraftFailure } from "./save-draft-error"
import { UnsavedChangesGuard } from "./use-unsaved-changes-guard"
import { combineIssues, usePublishValidation } from "./use-publish-validation"
import { WorkflowIssuesPanel } from "./workflow-issues-panel"
import { WORKFLOW_NODE_TYPES } from "./workflow-node"
import { WorkflowEditorProvider } from "./workflow-editor-context"
import { WorkflowEnrollmentsTab } from "./workflow-enrollments-tab"
import { WorkflowResultsTab } from "./workflow-results-tab"
import { WorkflowRunStateBadge } from "./workflow-run-state-badge"
import { describeWorkflowDeletion, hasUnpublishedGraphChanges, isEmptyFlow } from "./workflow-run-state"
import { summarizeWorkflow } from "./workflow-summary"
import { WorkflowSummaryPopover } from "./workflow-summary-view"
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

/** Etapa nova já com a ação escolhida na paleta (mesmos valores iniciais do seletor "Tipo de ação"). */
function defaultActionConfig(actionType: ActionPreset): FlowNode["config"] {
  switch (actionType) {
    case "GENERATE_FEEDBACK":
      return { actionType, sourceNodeId: "", feedbackDomain: "AUTO" }
    case "ESCALATE":
      return { actionType, target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"] }
    case "SET_VARIABLE":
      return { actionType, variableId: "", value: true }
    default:
      return { actionType: "CALL_AGENT", agentId: "" }
  }
}

function defaultConfigFor(type: FlowNodeType, trigger: WorkflowDetail["trigger"], actionType?: ActionPreset): FlowNode["config"] {
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
      return defaultActionConfig(actionType ?? "CALL_AGENT")
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
  const isNarrowScreen = useIsMobile()
  const agentsQuery = useAgentsQuery()
  const orchestratorsQuery = useOrchestratorsQuery()
  // Só para o nome no card do nó "Avaliar política de acompanhamento" (resumo publicado — lido com workflows.manage).
  const policySummariesQuery = usePublishedPolicySummariesQuery()
  const variablesQuery = useWorkflowVariablesQuery(workflow.id)
  const orchestratorsById = useMemo(() => new Map((orchestratorsQuery.data ?? []).map((orchestrator) => [orchestrator.id, orchestrator])), [orchestratorsQuery.data])
  const saveDraftMutation = useSaveWorkflowDraftMutation(workflow.id)
  const publishFlow = usePublishFlow(workflow.id)
  const { screenToFlowPosition, fitView, deleteElements } = useReactFlow()

  const initial = useMemo(() => toReactFlow(workflow.draftGraph), [workflow.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>(initial.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>(initial.edges)
  const [savedGraph, setSavedGraph] = useState<FlowGraph>(workflow.draftGraph)
  const [configNodeId, setConfigNodeId] = useState<string | null>(null)

  const currentGraph = useMemo(() => fromReactFlow(nodes, edges), [nodes, edges])
  const isDirty = !graphsEqual(currentGraph, savedGraph)
  const [saveFailure, setSaveFailure] = useState<(SaveDraftFailure & { graph: FlowGraph }) | null>(null)
  // A recusa fala do grafo que foi enviado: qualquer edição depois dela já pode ter resolvido o problema.
  const visibleSaveFailure = saveFailure && graphsEqual(saveFailure.graph, currentGraph) ? saveFailure : null
  // Rótulos e setas das ligações: só apresentação, `fromReactFlow` nunca os grava.
  const displayedEdges = useMemo(() => withEdgeLabels(edges, nodes), [edges, nodes])
  // Etapa sem nome (rascunhos antigos) nunca aparece como `de ""` nas mensagens de validação.
  const namedGraph = useMemo(() => ({ ...currentGraph, nodes: currentGraph.nodes.map((node) => ({ ...node, label: nodeDisplayName(node) })) }) as FlowGraph, [currentGraph])
  const selectedNode = nodes.find((node) => node.selected)?.data.flowNode ?? null
  const configNode = nodes.find((node) => node.id === configNodeId)?.data.flowNode ?? null

  const variablesById = useMemo(
    () => new Map((variablesQuery.data ?? []).map((variable) => [variable.id, { type: variable.type, name: variable.name }])),
    [variablesQuery.data],
  )

  // Espelha a validação do publish no backend — sinaliza no próprio nó em vez de só estourar
  // erro quando o usuário clicar em Publicar.
  const graphIssues = useMemo(
    () => validateWorkflowGraph(namedGraph, editable.trigger, orchestratorsById, variablesById, Boolean(editable.consolidatedStructure)),
    [namedGraph, editable.trigger, orchestratorsById, variablesById, editable.consolidatedStructure],
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
  // Agente inativo ou nunca publicado numa etapa (CA-009.12, PEN-047): a etapa fica destacada e a tela explica — lido das
  // referências mínimas, que valem também para quem não administra agentes inativos (sem abrir o cadastro deles).
  const referencedAgentIds = useMemo(() => currentGraph.nodes.flatMap((node) => (node.type === "action" && node.config.actionType === "CALL_AGENT" && node.config.agentId ? [node.config.agentId] : [])), [currentGraph])
  const agentReferencesQuery = useAgentReferencesQuery(referencedAgentIds)
  const referenceIssues = useMemo(() => {
    const byId = new Map((agentReferencesQuery.data ?? []).map((reference) => [reference.id, reference]))
    return currentGraph.nodes.flatMap((node) => {
      if (node.type !== "action" || node.config.actionType !== "CALL_AGENT") return []
      const reference = byId.get(node.config.agentId)
      if (!reference) return []
      if (!reference.active) return [{ nodeId: node.id, message: `O agente "${reference.name}" está inativo e não aceita novas execuções — reative-o ou substitua-o nesta etapa.` }]
      if (!reference.published) return [{ nodeId: node.id, message: `O agente "${reference.name}" ainda não foi publicado — publique-o antes de publicar o Workflow.` }]
      return []
    })
  }, [currentGraph, agentReferencesQuery.data])
  const allIssues = useMemo(
    () => [...combineIssues(graphIssues, publishValidation.backendIssue), ...referenceIssues.filter((issue) => issue.nodeId !== publishValidation.backendIssue?.nodeId)],
    [graphIssues, publishValidation.backendIssue, referenceIssues],
  )
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
      // Enter num botão, link ou campo pertence a ele: abrir o painel junto seria um efeito inesperado.
      const target = event.target as HTMLElement
      if (target.closest("button, a, input, textarea, select, [role=combobox], [role=button], [role=menuitem]")) return
      if (selectedNode) setConfigNodeId(selectedNode.id)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedNode])

  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => connectBranch(current, connection)),
    [setEdges],
  )

  /** Etapa removida deixa referência quebrada em quem usa o resultado dela: pergunta antes, pelo painel ou pelo teclado. */
  const [pendingNodeDeletion, setPendingNodeDeletion] = useState<{ names: string[]; dependents: string[]; resolve: (confirmed: boolean) => void } | null>(null)
  const onBeforeDelete = useCallback(
    async ({ nodes: toRemove }: { nodes: RFNode[] }) => {
      const removedIds = new Set(toRemove.map((node) => node.id))
      const dependents = [...new Map(toRemove.flatMap((node) => findNodeDependents(currentGraph, node.id)).filter((node) => !removedIds.has(node.id)).map((node) => [node.id, node])).values()]
      if (dependents.length === 0) return true
      return new Promise<boolean>((resolve) => {
        setPendingNodeDeletion({ names: toRemove.map((node) => nodeDisplayName(node.data.flowNode)), dependents: dependents.map(nodeDisplayName), resolve })
      })
    },
    [currentGraph],
  )
  function settleNodeDeletion(confirmed: boolean) {
    pendingNodeDeletion?.resolve(confirmed)
    setPendingNodeDeletion(null)
  }

  /** Liga uma saída da etapa aberta no painel, ou desliga com `null` — a alternativa a arrastar no canvas. */
  function connectBranchFromPanel(branchId: string, targetId: string | null) {
    if (!configNodeId) return
    const source = configNodeId
    setEdges((current) =>
      targetId
        ? connectBranch(current, { source, sourceHandle: branchId, target: targetId, targetHandle: null })
        : current.filter((edge) => !(edge.source === source && canonicalHandle(edge.sourceHandle) === branchId)),
    )
  }

  function addNodeAt(entry: PaletteEntry, position: { x: number; y: number }) {
    const id = crypto.randomUUID()
    const node: RFNode = {
      id,
      type: toReactFlowNodeType(entry.type),
      position,
      deletable: true,
      data: {
        flowNode: {
          id,
          type: entry.type,
          // Nasce com nome: a lista de problemas e os seletores de origem nunca mostram uma etapa em branco.
          label: entry.label,
          position: { x: 0, y: 0 },
          config: defaultConfigFor(entry.type, editable.trigger, entry.actionType),
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
  function addNodeAtDefaultPosition(entry: PaletteEntry) {
    const lowest = nodes.reduce<RFNode | null>((acc, node) => (!acc || node.position.y > acc.position.y ? node : acc), null)
    // 220 (não 160): nodes com mais campos (ex.: Output, Revisão humana com 3 branches) passam
    // de 140px de altura renderizada — um gap menor deixava o próximo node sobrepor o anterior.
    const position = lowest ? { x: lowest.position.x, y: lowest.position.y + 220 } : { x: 0, y: 0 }
    addNodeAt(entry, position)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const entry = paletteEntryById(event.dataTransfer.getData(WORKFLOW_NODE_DRAG_MIME))
    if (!entry) return
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    addNodeAt(entry, position)
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
    if (configNodeId) void deleteElements({ nodes: [{ id: configNodeId }] })
  }

  async function handleSaveDraft() {
    setSaveFailure(null)
    try {
      await saveDraftMutation.mutateAsync(currentGraph)
      setSavedGraph(currentGraph)
      setSavedRevision((current) => current + 1)
    } catch (error) {
      // O que faltou, em qual etapa: a própria tela leva até lá, e nada do que foi editado se perde.
      const failure = describeSaveDraftFailure(error, currentGraph)
      setSaveFailure({ ...failure, graph: currentGraph })
      if (failure.nodeId) focusNode(failure.nodeId)
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

  const emptyFlow = useMemo(() => isEmptyFlow(currentGraph), [currentGraph])
  const graphChangedSincePublish = useMemo(() => hasUnpublishedGraphChanges(savedGraph, workflow.publishedGraph), [savedGraph, workflow.publishedGraph])
  const nothingToPublish = workflow.published && !graphChangedSincePublish && (workflow.configurationChanges ?? []).length === 0
  const canPublish = publishValidation.status === "ready" && !emptyFlow && !nothingToPublish
  const summary = useMemo(() => summarizeWorkflow(editable, currentGraph), [editable, currentGraph])

  const editorContextValue = useMemo(
    () => ({
      triggerLabel: triggerLabel(editable.trigger),
      triggerKind: editable.trigger.kind,
      isConsolidatedMode: Boolean(editable.consolidatedStructure),
      individualNodeIds: new Set([...resolveNodeContexts(currentGraph)].filter(([, context]) => context === "EMPLOYEE").map(([nodeId]) => nodeId)),
      getAgentName: (agentId: string) => agentsQuery.data?.find((agent) => agent.id === agentId)?.name ?? agentReferencesQuery.data?.find((reference) => reference.id === agentId)?.name,
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
    [editable.trigger, editable.consolidatedStructure, agentsQuery.data, agentReferencesQuery.data, orchestratorsQuery.data, policySummariesQuery.data, orchestratorsById, currentGraph, variablesQuery.data, issuesByNodeId],
  )

  return (
    // Coluna: canvas em cima, rodapé de ações FORA da área do React Flow (safe area real — nenhum
    // nó fica atrás de "Salvar rascunho"/"Publicar", e o fitView do canvas nunca precisa
    // compensar controle nenhum; ver rodada de hardening dos Workflows-modelo, 2026-09-16).
    // 18rem = cabeçalho do admin + título/badges + abas (≈250px medidos) + respiro inferior: o
    // rodapé de ações precisa caber SEM rolagem da página em 900px de altura (1440×900 / 1280×800
    // / 1024×768 verificados) — com 13rem o conjunto estourava e os botões ficavam abaixo da dobra.
    <div className="flex h-[calc(100vh-18rem)] min-h-[640px] flex-col md:min-h-[480px]">
      {/* Fora do canvas: sobre ele, a orientação cobria os cards Gatilho e Fim, e no telefone tomava o canvas inteiro. */}
      {emptyFlow ? (
        <div className="mb-2 shrink-0 rounded-md border bg-card p-3 text-sm" data-testid="workflow-empty-hint">
          <p className="font-medium">Comece adicionando uma etapa</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Escolha uma etapa em &quot;Adicionar etapa&quot;, abra-a com um clique e, em &quot;Próximo passo&quot;, diga para onde o fluxo segue.{" "}
            <Link href="/wiki/workflows/criacao" className="underline underline-offset-2">
              Ver passo a passo
            </Link>
          </p>
        </div>
      ) : null}
      {/* Em tela estreita, paleta acima do canvas: lado a lado, sobravam 120 px de canvas num telefone. */}
      <ResizablePanelGroup key={isNarrowScreen ? "vertical" : "horizontal"} orientation={isNarrowScreen ? "vertical" : "horizontal"} className="min-h-0 flex-1 rounded-lg border">
        <ResizablePanel defaultSize={isNarrowScreen ? "130px" : "220px"} minSize={isNarrowScreen ? "80px" : "180px"} maxSize={isNarrowScreen ? "50%" : "320px"} className="overflow-y-auto p-3">
          <NodePalette isConsolidatedMode={Boolean(editable.consolidatedStructure)} onAddNode={addNodeAtDefaultPosition} />
        </ResizablePanel>
        <ResizableHandle withHandle />

        <ResizablePanel minSize="30">
          <div className="h-full min-w-0" onDrop={handleDrop} onDragOver={handleDragOver}>
            <WorkflowEditorProvider value={editorContextValue}>
              <ReactFlow
                colorMode={colorMode}
                nodes={nodes}
                edges={displayedEdges}
                defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
                ariaLabelConfig={REACT_FLOW_ARIA_LABELS_PT_BR}
                onBeforeDelete={onBeforeDelete}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                // Clicar abre a configuração da etapa; arrastar não dispara o clique, então mover continua só movendo.
                onNodeClick={(_event, node) => setConfigNodeId(node.id)}
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
                {nodes.length >= 8 ? <MiniMap pannable zoomable /> : null}
              </ReactFlow>
            </WorkflowEditorProvider>
          </div>
        </ResizablePanel>

        {configNode ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="360px" minSize="280px" maxSize="50%" className="overflow-y-auto">
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
                onConnectBranch={connectBranchFromPanel}
                onDelete={deleteConfigNode}
                onClose={() => setConfigNodeId(null)}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2" data-testid="workflow-editor-footer">
        <WorkflowIssuesPanel issues={allIssues} status={publishValidation.status} emptyFlow={emptyFlow} nothingToPublish={nothingToPublish} nodeLabelById={(nodeId) => namedGraph.nodes.find((node) => node.id === nodeId)?.label} onSelectIssue={focusNode} onRevalidate={publishValidation.revalidate} />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {visibleSaveFailure ? <p role="alert" className="max-w-md text-sm text-destructive" data-testid="save-draft-failure">{visibleSaveFailure.message}</p> : null}
          {publishError ? <p role="alert" className="max-w-md truncate text-sm text-destructive" title={publishError}>{publishError}</p> : null}
          <p role="status" className={isDirty ? "text-xs font-medium text-amber-700 dark:text-amber-300" : "text-xs text-muted-foreground"} data-testid="workflow-save-state">
            {isDirty ? "Alterações não salvas" : workflow.published && graphChangedSincePublish ? "Salvo · alterações ainda não publicadas" : "Salvo"}
          </p>
          <WorkflowSummaryPopover summary={summary} />
          <Button variant="outline" disabled={!isDirty || saveDraftMutation.isPending} onClick={handleSaveDraft}>
            {saveDraftMutation.isPending ? "Salvando..." : "Salvar rascunho"}
          </Button>
          <Button
            disabled={publishFlow.isPending || publishFlow.checking || saveDraftMutation.isPending || !canPublish}
            title={
              publishValidation.status === "stale"
                ? "Salve o rascunho para validar a publicação."
                : publishValidation.status === "validating"
                  ? "Aguarde a validação no servidor."
                  : publishValidation.status !== "ready"
                    ? "Corrija os problemas sinalizados antes de publicar."
                    : emptyFlow
                      ? "Adicione etapas: este fluxo ainda não faz nada."
                      : nothingToPublish
                        ? "Não há nada novo para publicar."
                        : undefined
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
        summary={summary}
        pending={publishFlow.isPending}
        onConfirm={(fingerprint) => void publishFlow.confirm(fingerprint)}
      />
      <UnsavedChangesGuard dirty={isDirty} />
      <AlertDialog open={pendingNodeDeletion !== null} onOpenChange={(open) => !open && settleNodeDeletion(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {pendingNodeDeletion?.names.map((name) => `"${name}"`).join(", ")}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingNodeDeletion?.dependents.length === 1 ? "A etapa" : "As etapas"} {pendingNodeDeletion?.dependents.map((name) => `"${name}"`).join(", ")} {pendingNodeDeletion?.dependents.length === 1 ? "usa" : "usam"} este resultado e vão precisar de outra origem antes de publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter a etapa</AlertDialogCancel>
            <Button variant="destructive" onClick={() => settleNodeDeletion(true)}>
              Remover mesmo assim
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Exclusão pelo editor: diz o que se perde e, se falhar, continua na tela com o erro já avisado. */
function DeleteWorkflowInEditor({ workflow, onDeleted }: { workflow: WorkflowDetail; onDeleted: () => void }) {
  const deleteMutation = useDeleteWorkflowMutation()
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="ml-auto" aria-label="Excluir workflow">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {workflow.name}?</AlertDialogTitle>
          <AlertDialogDescription>{describeWorkflowDeletion(workflow.activeEnrollments)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending}>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteMutation.isPending}
            onClick={async () => {
              try {
                await deleteMutation.mutateAsync(workflow.id)
                onDeleted()
              } catch {
                // já sinalizado via toast do useAdminMutation
              }
            }}
          >
            {deleteMutation.isPending ? "Excluindo..." : "Excluir workflow"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const editorTabOf = (value: string | null): string | null => (value === "editor" || value === "enrollments" || value === "results" ? value : null)

export function WorkflowEditorPage({ workflowId }: { workflowId: string }) {
  const router = useRouter()
  const workflowQuery = useWorkflowQuery(workflowId)
  const canUseQaLab = useCurrentUserQuery().data?.access.capabilities.canUseQaLab ?? false
  // `?tab=` abre direto numa aba: o aviso de execução bloqueada leva a Execuções. Mudou a URL com a página aberta, a aba acompanha.
  const requestedTab = editorTabOf(useSearchParams().get("tab"))
  const [tab, setTab] = useState(requestedTab ?? "editor")
  const [lastRequestedTab, setLastRequestedTab] = useState(requestedTab)
  if (requestedTab !== lastRequestedTab) {
    setLastRequestedTab(requestedTab)
    if (requestedTab) setTab(requestedTab)
  }
  // Gatilho Manual: cada abertura do "Executar agora" remonta o diálogo (nova intenção = nova chave de idempotência).
  const [manualRunSession, setManualRunSession] = useState(0)
  const [manualRunOpen, setManualRunOpen] = useState(false)
  const editable = useMemo(() => (workflowQuery.data ? withDraftConfiguration(workflowQuery.data) : null), [workflowQuery.data])
  const pendingChanges = useMemo(() => (workflowQuery.data ? describeConfigurationChanges(workflowQuery.data) : []), [workflowQuery.data])
  const flowPendingPublication = useMemo(() => Boolean(workflowQuery.data?.published && hasUnpublishedGraphChanges(workflowQuery.data.draftGraph, workflowQuery.data.publishedGraph)), [workflowQuery.data])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href="/admin/workflows" aria-label="Voltar para a lista de workflows">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        {workflowQuery.data && editable ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <WorkflowNameEditor workflow={workflowQuery.data} />
            <WorkflowRunStateBadge workflow={workflowQuery.data} />
            {flowPendingPublication ? (
              <Badge variant="outline" className="border-amber-500/60 text-amber-700 dark:text-amber-300" title="O fluxo salvo é diferente do que está publicado. As execuções seguem na versão publicada até você Publicar." data-testid="workflow-pending-flow">
                Fluxo não publicado
              </Badge>
            ) : null}
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
            {/* O teste sem efeitos existe só para quem tem o QA Lab. Abre com este workflow já escolhido. */}
            {canUseQaLab ? (
              <Button asChild type="button" size="sm" variant="outline" className="shrink-0" title="Testar no QA Lab, sem efeito em pessoas reais">
                <Link href={`/admin/simulate?workflowId=${workflowId}`}>
                  <FlaskConical className="h-4 w-4" aria-hidden />
                  Testar
                </Link>
              </Button>
            ) : null}
            <WorkflowSettingsSheet workflow={workflowQuery.data} />
            <DeleteWorkflowInEditor workflow={workflowQuery.data} onDeleted={() => router.push("/admin/workflows")} />
          </div>
        ) : workflowQuery.isError ? null : (
          <Skeleton className="h-6 w-64" />
        )}
      </div>

      {workflowQuery.isLoading ? (
        <Skeleton className="h-[520px] w-full" />
      ) : workflowQuery.isError || !workflowQuery.data ? (
        <p role="alert" className="text-sm text-destructive" data-testid="workflow-load-error">
          Não foi possível abrir este workflow: ele pode ter sido excluído, estar fora da sua abrangência ou você pode não ter permissão para administrar workflows.{" "}
          <Link href="/admin/workflows" className="underline underline-offset-2">
            Voltar para a lista
          </Link>
        </p>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="editor">Editor</TabsTrigger>
            <TabsTrigger value="enrollments">Execuções</TabsTrigger>
            <TabsTrigger value="results">Resultados</TabsTrigger>
          </TabsList>
          {/* Fica montado ao trocar de aba: desmontar apagava, sem aviso, as alterações ainda não salvas do canvas. */}
          <TabsContent value="editor" forceMount className="mt-4 data-[state=inactive]:hidden">
            <p className="mb-2 text-xs text-muted-foreground md:hidden">O editor de fluxo funciona melhor em uma tela maior.</p>
            <ReactFlowProvider>
              <WorkflowCanvas workflow={workflowQuery.data} />
            </ReactFlowProvider>
          </TabsContent>
          <TabsContent value="enrollments" className="mt-4">
            <WorkflowEnrollmentsTab workflowId={workflowId} graph={workflowQuery.data.publishedGraph} workflow={workflowQuery.data} />
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
