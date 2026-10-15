"use client"

import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Bot, Sparkles, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"

import { AGENT_TYPE_ICONS } from "@/components/admin/agents/agent-visuals"
import { useReactFlowColorMode } from "@/hooks/use-react-flow-color-mode"
import { AGENT_TYPE_COLORS, AGENT_TYPE_LABELS, type Agent } from "@/schemas/admin/agent.schema"
import { cn } from "@/lib/utils"

type OrchestratorNodeData = { name: string; agentName: string }
type SpecialistNodeData = { agentName: string; agentType: Agent["agentType"] | null }

function OrchestratorNodeCard({ data, selected }: NodeProps & { data: OrchestratorNodeData }) {
  return (
    <div
      className={cn(
        "w-56 rounded-xl border-2 border-primary/50 bg-card p-3 shadow-sm ring-4 ring-primary/10",
        selected && "border-primary ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{data.name || "Orquestrador"}</p>
          <p className="truncate text-[11px] text-muted-foreground">{data.agentName || "Sem agente definido"}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-primary" />
    </div>
  )
}

function SpecialistNodeCard({ data, selected }: NodeProps & { data: SpecialistNodeData }) {
  const Icon = data.agentType ? AGENT_TYPE_ICONS[data.agentType] : Sparkles
  const colors = data.agentType ? AGENT_TYPE_COLORS[data.agentType] : { icon: "text-muted-foreground", iconBg: "bg-muted" }
  return (
    <div className={cn("w-52 rounded-xl border bg-card p-2.5 shadow-sm", selected && "border-primary ring-4 ring-primary/20")}>
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", colors.iconBg)}>
          <Icon className={cn("h-3.5 w-3.5", colors.icon)} />
        </span>
        <p className="min-w-0 truncate text-sm">{data.agentName || "Selecione um agente"}</p>
      </div>
    </div>
  )
}

const nodeTypes = { orchestrator: OrchestratorNodeCard, specialist: SpecialistNodeCard }

export function buildSpecialistsGraph(
  name: string,
  orchestratorAgentName: string,
  specialists: { agentName: string; agentType: Agent["agentType"] | null }[],
  selectedNodeId: string | null,
) {
  const specialistHeight = 84
  const totalHeight = Math.max(specialists.length * specialistHeight, specialistHeight)
  const nodes: Node[] = [
    {
      id: "orchestrator",
      type: "orchestrator",
      position: { x: 0, y: totalHeight / 2 - 34 },
      data: { name, agentName: orchestratorAgentName },
      draggable: false,
      selected: selectedNodeId === "orchestrator",
    },
    ...specialists.map((specialist, index) => ({
      id: `specialist-${index}`,
      type: "specialist",
      position: { x: 340, y: index * specialistHeight },
      data: specialist,
      draggable: false,
      selected: selectedNodeId === `specialist-${index}`,
    })),
  ]
  const edges: Edge[] = specialists.map((_, index) => ({
    id: `e-orchestrator-specialist-${index}`,
    source: "orchestrator",
    target: `specialist-${index}`,
    animated: true,
  }))
  return { nodes, edges }
}

/** Mapa só de leitura: os nós são derivados do formulário a cada render — nada se arrasta nem se conecta por aqui. */
export function SpecialistsMap({
  nodes,
  edges,
  onSelect,
  onOpenDetails,
}: {
  nodes: Node[]
  edges: Edge[]
  onSelect: (nodeId: string | null) => void
  onOpenDetails: (nodeId: string) => void
}) {
  const colorMode = useReactFlowColorMode()
  return (
    <div className="h-[420px] min-w-0 rounded-lg border bg-muted/20">
      <ReactFlowProvider>
        <ReactFlow
          colorMode={colorMode}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          nodesDraggable={false}
          nodesConnectable={false}
          // Sem isso, o duplo clique do React Flow entra em conflito com o nosso próprio
          // duplo clique de nó (abrir os detalhes) — o padrão da biblioteca é dar zoom no ponto
          // clicado, inclusive quando o clique cai em cima de um nó, então o zoom "vencia" e os
          // detalhes nunca chegavam a abrir de forma perceptível.
          zoomOnDoubleClick={false}
          onNodeClick={(_event, node) => onSelect(node.id)}
          onNodeDoubleClick={(_event, node) => {
            onSelect(node.id)
            onOpenDetails(node.id)
          }}
          onPaneClick={() => onSelect(null)}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}

export function AgentDetailCard({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const Icon = AGENT_TYPE_ICONS[agent.agentType]
  const colors = AGENT_TYPE_COLORS[agent.agentType]
  return (
    <Card data-testid="specialist-detail">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", colors.iconBg)}>
            <Icon className={cn("h-4 w-4", colors.icon)} />
          </span>
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{agent.name}</CardTitle>
            <Badge variant="outline" className="mt-1">
              {AGENT_TYPE_LABELS[agent.agentType]}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="Fechar detalhes" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Objetivo</Label>
          <p className="text-sm">{agent.objective}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Descrição</Label>
          <p className="text-sm">{agent.description}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Prompt (contexto)</Label>
          <p className="max-h-64 overflow-y-auto rounded-md border bg-muted/40 p-2 text-sm whitespace-pre-wrap">{agent.contextPrompt}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Bases de conhecimento consultadas</Label>
          {agent.knowledgeDocuments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma base associada.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {agent.knowledgeDocuments.map((doc) => (
                <li key={doc.id}>{doc.title}</li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
