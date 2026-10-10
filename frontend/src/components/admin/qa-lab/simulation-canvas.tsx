"use client"

import { useMemo } from "react"
import { Background, ReactFlow, ReactFlowProvider, type Node, type NodeProps } from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { useReactFlowColorMode } from "@/hooks/use-react-flow-color-mode"
import { AlertTriangle, Check, Hourglass, Pause, Play } from "lucide-react"

import { cn } from "@/lib/utils"
import { toReactFlow, type RFNodeData } from "@/components/admin/workflows/graph-mappers"
import { WorkflowEditorProvider } from "@/components/admin/workflows/workflow-editor-context"
import { WorkflowNode } from "@/components/admin/workflows/workflow-node"
import type { NodeDescribeContext } from "@/components/admin/workflows/node-visuals"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import type { QaStep, WorkflowSimulationState } from "@/schemas/admin/qa-lab.schema"

export type NodeSimulationStatus = "completed" | "current" | "waiting" | "paused" | "failed" | "skipped" | "pending"

const STATUS_RING: Record<NodeSimulationStatus, string> = {
  completed: "ring-2 ring-emerald-500/70",
  current: "ring-2 ring-primary",
  waiting: "ring-2 ring-amber-500/80",
  paused: "ring-2 ring-amber-500/80",
  failed: "ring-2 ring-destructive",
  skipped: "opacity-40",
  pending: "opacity-70",
}

const STATUS_BADGE: Record<NodeSimulationStatus, { label: string; icon: typeof Check; className: string } | null> = {
  completed: { label: "Concluído", icon: Check, className: "bg-emerald-500 text-white" },
  current: { label: "Node atual", icon: Play, className: "bg-primary text-primary-foreground" },
  waiting: { label: "Aguardando decisão", icon: Hourglass, className: "bg-amber-500 text-white" },
  paused: { label: "Pausado", icon: Pause, className: "bg-amber-500 text-white" },
  failed: { label: "Erro", icon: AlertTriangle, className: "bg-destructive text-white" },
  skipped: null,
  pending: null,
}

type SimulationNodeData = RFNodeData & { simulationStatus: NodeSimulationStatus; chosenBranch?: string }

/** Envelopa o MESMO card do editor (WorkflowNode) com o estado da simulação — nunca duplica o
 * editor, só decora (Parte 28). */
function SimulationNode(props: NodeProps<Node<SimulationNodeData>>) {
  const status = props.data.simulationStatus
  const badge = STATUS_BADGE[status]
  return (
    <div className={cn("relative rounded-lg transition-all", STATUS_RING[status])}>
      {badge ? (
        <span
          className={cn("absolute -top-2 -right-2 z-10 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium shadow", badge.className)}
          title={badge.label}
        >
          <badge.icon className="h-3 w-3" />
          {badge.label}
        </span>
      ) : null}
      {props.data.chosenBranch ? (
        <span className="absolute -bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
          {props.data.chosenBranch}
        </span>
      ) : null}
      <WorkflowNode {...(props as unknown as NodeProps<Node<RFNodeData>>)} />
    </div>
  )
}

const SIMULATION_NODE_TYPES = {
  trigger: SimulationNode,
  wait: SimulationNode,
  condition: SimulationNode,
  action: SimulationNode,
  orchestrator: SimulationNode,
  human_review: SimulationNode,
  // Chave `workflow_output` (ver toReactFlowNodeType em graph-mappers.ts) — "output" colide com o
  // tipo embutido do React Flow e arrasta o CSS padrão da biblioteca pro card.
  workflow_output: SimulationNode,
  end: SimulationNode,
  select_employees: SimulationNode,
  apply_individually: SimulationNode,
  consolidate_results: SimulationNode,
}

const BRANCH_LABELS: Record<string, string> = { true: "Sim", false: "Não", no_data: "Sem dados", approved: "Aprovado", rejected: "Reprovado", escalated: "Escalar", always: "" }

/** Estado visual de cada node a partir do trace (Parte 28): concluído / atual / aguardando /
 * erro / ignorado (nunca alcançado) / pendente. */
export function nodeStatusesFromTrace(graph: FlowGraph, steps: QaStep[], state: WorkflowSimulationState | null): Record<string, { status: NodeSimulationStatus; branch?: string }> {
  const result: Record<string, { status: NodeSimulationStatus; branch?: string }> = {}
  for (const node of graph.nodes) result[node.id] = { status: state && (state.status === "completed" || state.status === "failed") ? "skipped" : "pending" }
  for (const step of steps) {
    const branch = step.outcome?.branch ? (BRANCH_LABELS[step.outcome.branch] ?? step.outcome.branch) : undefined
    const entry = { status: "completed" as NodeSimulationStatus, ...(branch ? { branch } : {}) }
    if (step.status === "failed") entry.status = "failed"
    else if (step.status === "waiting") entry.status = "waiting"
    else if (step.status === "paused_before_ai" || step.status === "stopped_here") entry.status = "paused"
    result[step.nodeId] = entry
  }
  if (state && state.status !== "completed" && state.status !== "failed") {
    const current = result[state.currentNodeId]
    if (current && current.status !== "waiting" && current.status !== "paused") result[state.currentNodeId] = { ...current, status: "current" }
  }
  return result
}

export function SimulationCanvas({
  graph,
  steps,
  state,
  describeContext,
  onNodeSelect,
  className,
}: {
  graph: FlowGraph
  steps: QaStep[]
  state: WorkflowSimulationState | null
  describeContext: NodeDescribeContext
  onNodeSelect?: (nodeId: string) => void
  className?: string
}) {
  const colorMode = useReactFlowColorMode()
  const statuses = useMemo(() => nodeStatusesFromTrace(graph, steps, state), [graph, steps, state])
  const { nodes, edges } = useMemo(() => {
    const mapped = toReactFlow(graph)
    return {
      nodes: mapped.nodes.map((node) => ({
        ...node,
        draggable: false,
        connectable: false,
        deletable: false,
        data: { ...node.data, simulationStatus: statuses[node.id]?.status ?? "pending", chosenBranch: statuses[node.id]?.branch },
      })),
      edges: mapped.edges.map((edge) => {
        const sourceStatus = statuses[edge.source]
        const targetStatus = statuses[edge.target]
        const traversed = sourceStatus && sourceStatus.status !== "pending" && sourceStatus.status !== "skipped" && targetStatus && targetStatus.status !== "pending" && targetStatus.status !== "skipped"
        return { ...edge, animated: Boolean(traversed), style: traversed ? { strokeWidth: 2 } : { opacity: 0.4 } }
      }),
    }
  }, [graph, statuses])

  return (
    <div className={cn("h-[420px] min-h-[320px] rounded-lg border border-border", className)}>
      <ReactFlowProvider>
        <WorkflowEditorProvider value={describeContext}>
          <ReactFlow
            colorMode={colorMode}
            nodes={nodes}
            edges={edges}
            nodeTypes={SIMULATION_NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            zoomOnDoubleClick={false}
            onNodeClick={(_event, node) => onNodeSelect?.(node.id)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
          </ReactFlow>
        </WorkflowEditorProvider>
      </ReactFlowProvider>
    </div>
  )
}
