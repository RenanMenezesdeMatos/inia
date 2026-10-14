"use client"

import { AlertTriangle, Sparkles, Target } from "lucide-react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { nodeBranches, NODE_TYPE_LABELS, type FlowNodeType } from "@/schemas/admin/workflow-graph.schema"

import type { RFNodeData } from "./graph-mappers"
import { describeNodeConfig, describeSetVariableBadge, NODE_COLORS, NODE_ICONS } from "./node-visuals"
import { useWorkflowEditorContext } from "./workflow-editor-context"

/**
 * Classes compartilhadas por TODOS os handles (entrada e saída, de todos os tipos de nó) — ponto
 * visual pequeno (10px) com HIT AREA confortável via pseudo-elemento (`after:` ≈ 30px), sem
 * inflar o desenho. O `::after` é filho do próprio handle, então o React Flow recebe o
 * pointerdown normalmente. `z-10` mantém o handle acima do card mesmo quando o conteúdo cresce
 * (rodada de hardening dos Workflows-modelo, 2026-09-16: no Output a área de conexão ficava
 * parcialmente atrás do card e menor que nos demais nós).
 */
const HANDLE_BASE_CLASS = "!h-2.5 !w-2.5 !border-2 !border-background z-10 after:absolute after:-inset-2.5 after:rounded-full after:content-['']"
const TARGET_HANDLE_CLASS = cn(HANDLE_BASE_CLASS, "!bg-muted-foreground")
const SOURCE_HANDLE_CLASS = cn(HANDLE_BASE_CLASS, "!bg-primary")
/** Handles laterais: entrada no terço superior, saída no terço inferior — mesma distância visual
 * em todos os nós, independente da altura do card. */
const SIDE_TARGET_STYLE = { top: "35%" } as const
const SIDE_SOURCE_STYLE = { top: "65%" } as const

export function WorkflowNode({ data, selected }: NodeProps<Node<RFNodeData>>) {
  const node = data.flowNode
  const context = useWorkflowEditorContext()
  const Icon = NODE_ICONS[node.type]
  const colors = NODE_COLORS[node.type]
  const branches = nodeBranches(node)
  const subtitle = describeNodeConfig(node, context)
  const hasTarget = node.type !== "trigger"
  const nodeIssue = context.issuesByNodeId?.[node.id]
  const issue = nodeIssue?.message
  // Linguagem visual Fixo/Dinâmico do card de "Definir variável" (Parte 16-22 do pedido de
  // variáveis dinâmicas) — sempre ícone + texto, nunca só cor (acessibilidade, Parte 41).
  const setVariableBadge = describeSetVariableBadge(node)

  return (
    <div
      title={issue}
      className={cn(
        "w-56 rounded-lg border bg-card p-3 shadow-sm transition-colors",
        issue ? "border-destructive ring-2 ring-destructive/30" : selected ? cn("ring-2", colors.ring) : "border-border",
      )}
    >
      {hasTarget ? (
        <>
          <Handle type="target" position={Position.Top} className={TARGET_HANDLE_CLASS} />
          <Handle type="target" position={Position.Left} id="target::left" className={TARGET_HANDLE_CLASS} style={SIDE_TARGET_STYLE} />
          <Handle type="target" position={Position.Right} id="target::right" className={TARGET_HANDLE_CLASS} style={SIDE_TARGET_STYLE} />
        </>
      ) : null}

      <div className="flex items-center gap-2">
        <div className={cn("flex h-6 w-6 items-center justify-center rounded", colors.iconBg)}>
          <Icon className={cn("h-3.5 w-3.5", colors.icon)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{NODE_TYPE_LABELS[node.type]}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground/70" title={node.id}>
            {node.id}
          </p>
        </div>
        {setVariableBadge === "FIXED" ? (
          <Badge variant="outline" className="shrink-0 gap-1">
            <Target className="h-3 w-3" />
            Fixo
          </Badge>
        ) : null}
        {setVariableBadge === "DYNAMIC" ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Sparkles className="h-3 w-3" />
            Dinâmico
          </Badge>
        ) : null}
        {issue ? <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" /> : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm">{subtitle}</p>
      {/* O card nunca cresce com a mensagem inteira: contagem + uma linha (tooltip/painel têm o
        * resto) — informação crítica visível, layout previsível. */}
      {nodeIssue ? (
        <p className="mt-1 line-clamp-1 text-xs text-destructive">
          {nodeIssue.count > 1 ? <span className="font-medium">{nodeIssue.count} problemas · </span> : null}
          {nodeIssue.message}
        </p>
      ) : null}

      {branches.length > 0 ? (
        <div className={cn("mt-2 flex border-t pt-2 text-xs text-muted-foreground", branches.length > 1 ? "justify-between" : "justify-end")}>
          {branches.map((branch) => (
            <span key={branch.id}>{branch.label}</span>
          ))}
        </div>
      ) : null}

      {branches.map((branch, index) => (
        <Handle
          key={branch.id}
          type="source"
          position={Position.Bottom}
          id={branch.id}
          className={SOURCE_HANDLE_CLASS}
          style={{ left: `${((index + 1) / (branches.length + 1)) * 100}%` }}
        />
      ))}

      {/* Handles laterais de saída: um por lado, nunca dois no mesmo ponto — com 3 saídas
        * (Revisão humana: Aprovado/Reprovado/Escalar; Condição com "Sem dados") o 2º e o 3º
        * caíam AMBOS à direita em `top: 65%`, um em cima do outro (QA visual 2026-09-16). Primeira
        * saída à esquerda, última à direita; as do meio só têm o handle inferior. */}
      {branches.length === 1 ? (
        <Handle type="source" position={Position.Right} id={`${branches[0]!.id}::right`} className={SOURCE_HANDLE_CLASS} style={SIDE_SOURCE_STYLE} />
      ) : (
        branches
          .map((branch, index) => ({ branch, side: index === 0 ? ("left" as const) : index === branches.length - 1 ? ("right" as const) : null }))
          .filter((entry): entry is { branch: (typeof branches)[number]; side: "left" | "right" } => entry.side !== null)
          .map(({ branch, side }) => (
            <Handle
              key={`${branch.id}-side`}
              type="source"
              position={side === "left" ? Position.Left : Position.Right}
              id={`${branch.id}::${side}`}
              className={SOURCE_HANDLE_CLASS}
              style={SIDE_SOURCE_STYLE}
            />
          ))
      )}
    </div>
  )
}

// `satisfies Record<FlowNodeType, ...>` — nunca mais um tipo de node novo fica "invisível" no
// canvas (renderizado em branco pelo node padrão do React Flow) por esquecimento de registro
// aqui: faltar uma chave agora quebra o typecheck, em vez de só um warning silencioso do RF.
// A chave de "output" é `workflow_output` (ver toReactFlowNodeType em graph-mappers.ts) — nunca a
// chave embutida "output" do React Flow, que arrasta o CSS padrão da biblioteca pro card.
export const WORKFLOW_NODE_TYPES = {
  trigger: WorkflowNode,
  wait: WorkflowNode,
  condition: WorkflowNode,
  action: WorkflowNode,
  orchestrator: WorkflowNode,
  human_review: WorkflowNode,
  workflow_output: WorkflowNode,
  end: WorkflowNode,
  select_employees: WorkflowNode,
  apply_individually: WorkflowNode,
  consolidate_results: WorkflowNode,
  intervention_policy: WorkflowNode,
} satisfies Record<Exclude<FlowNodeType, "output"> | "workflow_output", typeof WorkflowNode>
