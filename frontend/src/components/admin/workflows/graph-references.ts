import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"

/** Campos que guardam o id de outra etapa diretamente — os demais usam o caminho `nodeOutputs.<id>[.campo]`. */
const NODE_ID_FIELDS = new Set(["sourceNodeId", "previousReviewNodeId", "analysisSourceNodeIds"])

function refersTo(value: unknown, nodeId: string, key: string | null): boolean {
  if (typeof value === "string") {
    if (value === `nodeOutputs.${nodeId}` || value.startsWith(`nodeOutputs.${nodeId}.`)) return true
    return key !== null && NODE_ID_FIELDS.has(key) && value === nodeId
  }
  if (Array.isArray(value)) return value.some((item) => refersTo(item, nodeId, key))
  if (value && typeof value === "object") return Object.entries(value).some(([childKey, child]) => refersTo(child, nodeId, childKey))
  return false
}

/** Etapas cuja configuração usa o resultado de `nodeId` (origem de conteúdo, condição, variável, revisão anterior, política). */
export function findNodeDependents(graph: FlowGraph, nodeId: string): FlowGraph["nodes"] {
  return graph.nodes.filter((node) => node.id !== nodeId && refersTo(node.config, nodeId, null))
}
