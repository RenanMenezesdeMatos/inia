import { ACTION_TYPE_LABELS } from "@/components/admin/workflows/node-visuals"
import { NODE_TYPE_LABELS, type FlowNode } from "@/schemas/admin/workflow-graph.schema"

/** Ícone do nó: o mesmo do editor (cada Ação tem o seu). */
export { nodeIconOf } from "@/components/admin/workflows/node-visuals"

export function nodeKindText(node: FlowNode): string {
  return node.type === "action" ? ACTION_TYPE_LABELS[node.config.actionType] : NODE_TYPE_LABELS[node.type]
}

/** A referência do nó na Wiki (âncoras da página de Nodes). */
export const nodeReferenceHref = (node: FlowNode) => (node.type === "action" ? `/wiki/workflows/nodes#acao-${node.config.actionType}` : `/wiki/workflows/nodes#no-${node.type}`)
