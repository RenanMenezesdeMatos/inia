import type { Edge, Node } from "@xyflow/react"
import type { FlowEdge, FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"

export type RFNodeData = { flowNode: FlowNode } & Record<string, unknown>
export type RFNode = Node<RFNodeData>
export type RFEdge = Edge

/**
 * Tipo do nó NO REACT FLOW (chave de `nodeTypes`), derivado do tipo de domínio. Nunca igual ao
 * tipo de domínio quando ele colide com um tipo embutido do React Flow: "output" (e também
 * "input"/"default"/"group") ganha a classe `react-flow__node-output` e o CSS padrão da biblioteca
 * (width 150px, padding 10px, borda, fundo) — o card de Output ficava num wrapper de 150px, com os
 * handles posicionados em relação ao wrapper (no meio do card, parcialmente atrás dele) e menor
 * que os demais nós. Achado real do QA visual da rodada de hardening dos Workflows-modelo
 * (2026-09-16). O tipo de domínio persistido (`data.flowNode.type`) não muda.
 */
export function toReactFlowNodeType(type: FlowNode["type"]): string {
  return type === "output" ? "workflow_output" : type
}

export function toReactFlow(graph: FlowGraph): { nodes: RFNode[]; edges: RFEdge[] } {
  const nodes: RFNode[] = graph.nodes.map((node) => ({
    id: node.id,
    type: toReactFlowNodeType(node.type),
    position: node.position,
    deletable: node.type !== "trigger",
    data: { flowNode: node },
  }))
  const edges: RFEdge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
  }))
  return { nodes, edges }
}

/**
 * Handles laterais (esquerda/direita) são espelhos visuais de um branch canônico,
 * com id "branchId::left" / "branchId::right" só para o React Flow não confundir
 * os dois pontos de saída com o mesmo id. Ao persistir, volta pro id canônico.
 */
export function canonicalHandle(handleId: string | null | undefined): string {
  if (!handleId) return "always"
  const separatorIndex = handleId.indexOf("::")
  return separatorIndex === -1 ? handleId : handleId.slice(0, separatorIndex)
}

export function fromReactFlow(nodes: RFNode[], edges: RFEdge[]): FlowGraph {
  return {
    nodes: nodes.map((node) => ({ ...node.data.flowNode, position: node.position })),
    edges: edges.map(
      (edge): FlowEdge => ({
        id: edge.id,
        source: edge.source,
        sourceHandle: canonicalHandle(edge.sourceHandle),
        target: edge.target,
      }),
    ),
  }
}
