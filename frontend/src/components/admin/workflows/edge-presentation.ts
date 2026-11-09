import { addEdge, type Connection } from "@xyflow/react"

import { nodeBranches } from "@/schemas/admin/workflow-graph.schema"

import { canonicalHandle, type RFEdge, type RFNode } from "./graph-mappers"

/**
 * Rótulo da saída na própria ligação ("Sim", "Não", "Aprovado"…) quando a etapa de origem tem mais de uma saída: no meio de
 * um fluxo, o rodapé do card fica longe. É só apresentação: `fromReactFlow` nunca grava o rótulo no grafo.
 */
export function withEdgeLabels(edges: RFEdge[], nodes: RFNode[]): RFEdge[] {
  const branchesByNode = new Map(nodes.map((node) => [node.id, nodeBranches(node.data.flowNode)]))
  return edges.map((edge) => {
    const branches = branchesByNode.get(edge.source) ?? []
    if (branches.length < 2) return edge
    const label = branches.find((branch) => branch.id === canonicalHandle(edge.sourceHandle))?.label
    return label ? { ...edge, label } : edge
  })
}

/**
 * Cada saída leva a um único destino, seja pelo ponto de baixo ou pelos laterais: são a mesma saída (`always` e `always::right`).
 * Comparar o id cru deixava duas ligações na tela, e o motor só seguia a primeira.
 */
export function connectBranch(current: RFEdge[], connection: Connection): RFEdge[] {
  const branch = canonicalHandle(connection.sourceHandle)
  const others = current.filter((edge) => !(edge.source === connection.source && canonicalHandle(edge.sourceHandle) === branch))
  return addEdge({ ...connection, id: crypto.randomUUID() }, others)
}
