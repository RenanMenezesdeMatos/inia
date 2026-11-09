import { Sparkles, TrendingUp, Variable, Zap, type LucideIcon } from "lucide-react"

import { ACTION_TYPE_LABELS, NODE_ICONS } from "@/components/admin/workflows/node-visuals"
import { NODE_TYPE_LABELS, type FlowNode } from "@/schemas/admin/workflow-graph.schema"

/** Ícone e nome do nó, iguais aos da paleta do editor (cada Ação tem o seu). */
const ACTION_ICONS: Partial<Record<string, LucideIcon>> = { CALL_AGENT: Zap, GENERATE_FEEDBACK: Sparkles, ESCALATE: TrendingUp, SET_VARIABLE: Variable }

export function nodeIconOf(node: FlowNode): LucideIcon {
  if (node.type === "action") return ACTION_ICONS[node.config.actionType] ?? NODE_ICONS.action
  return NODE_ICONS[node.type]
}

export function nodeKindText(node: FlowNode): string {
  return node.type === "action" ? ACTION_TYPE_LABELS[node.config.actionType] : NODE_TYPE_LABELS[node.type]
}

/** A referência do nó na Wiki (âncoras da página de Nodes). */
export const nodeReferenceHref = (node: FlowNode) => (node.type === "action" ? `/wiki/workflows/nodes#acao-${node.config.actionType}` : `/wiki/workflows/nodes#no-${node.type}`)
