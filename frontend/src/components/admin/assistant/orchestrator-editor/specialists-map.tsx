"use client"

import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from "@xyflow/react"
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

const HANDLE_CLASS = "!h-3 !w-3 !border-2 !border-card"

type OrchestratorNodeData = { name: string; agentName: string }
type SpecialistNodeData = { agentName: string; agentType: Agent["agentType"] | null }

function OrchestratorNodeCard({ data, selected }: NodeProps & { data: OrchestratorNodeData }) {
  return (
    <div
      className={cn(
        // Mesmo contraste das etapas do Workflow (18/11/2026): cartão branco, contorno firme, sombra e faixa no topo.
        "w-64 rounded-xl border border-t-4 border-foreground/20 border-t-primary bg-card p-3 shadow-md",
        selected && "border-primary ring-4 ring-primary/30",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-wider text-primary uppercase">Orquestrador</p>
          <p className="truncate text-sm font-semibold text-foreground" title={data.name}>{data.name || "Orquestrador"}</p>
          <p className="truncate text-xs text-foreground/70" title={data.agentName}>{data.agentName || "Sem agente definido"}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={cn(HANDLE_CLASS, "!bg-primary")} />
    </div>
  )
}

function SpecialistNodeCard({ data, selected }: NodeProps & { data: SpecialistNodeData }) {
  const Icon = data.agentType ? AGENT_TYPE_ICONS[data.agentType] : Sparkles
  const colors = data.agentType ? AGENT_TYPE_COLORS[data.agentType] : { icon: "text-muted-foreground", iconBg: "bg-muted" }
  return (
    <div className={cn("w-60 rounded-xl border border-foreground/20 bg-card p-3 shadow-md", selected && "border-primary ring-4 ring-primary/20")}>
      <Handle type="target" position={Position.Left} className={cn(HANDLE_CLASS, "!bg-muted-foreground")} />
      <div className="flex items-center gap-2">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", colors.iconBg)}>
          <Icon className={cn("h-4 w-4", colors.icon)} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground" title={data.agentName}>{data.agentName || "Selecione um agente"}</p>
          <p className="truncate text-xs text-foreground/70">{data.agentType ? AGENT_TYPE_LABELS[data.agentType] : "Especialista"}</p>
        </div>
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
  const specialistHeight = 92
  const totalHeight = Math.max(specialists.length * specialistHeight, specialistHeight)
  const nodes: Node[] = [
    {
      id: "orchestrator",
      type: "orchestrator",
      position: { x: 0, y: totalHeight / 2 - 40 },
      data: { name, agentName: orchestratorAgentName },
      draggable: false,
      selected: selectedNodeId === "orchestrator",
    },
    ...specialists.map((specialist, index) => ({
      id: `specialist-${index}`,
      type: "specialist",
      position: { x: 380, y: index * specialistHeight },
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
    // Altura (18/11/2026, "pouco espaço para trabalhar"): acompanha a tela, nunca menos de 480 px.
    <div className="inia-flow-canvas h-[calc(100vh-20rem)] min-h-[480px] min-w-0 overflow-hidden rounded-2xl border border-foreground/15">
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
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.6} color="var(--flow-canvas-dot)" />
          <Controls className="overflow-hidden rounded-lg border border-foreground/15 shadow-md" />
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
