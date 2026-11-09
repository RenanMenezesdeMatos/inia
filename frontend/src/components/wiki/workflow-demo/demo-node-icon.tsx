import { createElement } from "react"

import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { nodeIconOf } from "./demo-node-meta"

/** O ícone do nó, igual ao da paleta do editor. Decorativo: o nome do nó sempre aparece em texto ao lado. */
export function NodeIcon({ node, className }: { node: FlowNode; className?: string }) {
  return createElement(nodeIconOf(node), { className, "aria-hidden": true })
}
