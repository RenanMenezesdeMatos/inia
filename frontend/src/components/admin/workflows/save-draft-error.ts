import { AdminApiError } from "@/lib/admin/admin-api"
import { NODE_TYPE_LABELS, type FlowGraph } from "@/schemas/admin/workflow-graph.schema"

/** O que falta, em linguagem de tela, para cada campo que o servidor exige ao salvar o rascunho. */
const FIELD_GUIDANCE: Record<string, string> = {
  agentId: "escolha o agente",
  orchestratorId: "escolha o orquestrador",
  orchestratorVersionId: "escolha o orquestrador de novo",
  policyId: "escolha a política de acompanhamento",
  source: "escolha o conteúdo a entregar",
  sourceNodeId: "escolha a origem",
  variableId: "escolha a variável",
  surfaces: "escolha onde entregar",
  userId: "escolha a pessoa",
}

export type SaveDraftFailure = { nodeId: string | null; message: string }

type ValidationIssue = { path?: unknown }

function asValidationIssues(details: unknown): ValidationIssue[] {
  return Array.isArray(details) ? (details as ValidationIssue[]) : []
}

/**
 * Traduz a recusa de "Salvar rascunho" ("Dados inválidos.", 400 do schema do grafo) para a etapa e o campo. Campo em branco é aceito
 * no rascunho (backend `draft-graph.ts`): sobra o dado inválido, como um id que não existe, vindo de uma versão antiga da tela.
 */
export function describeSaveDraftFailure(error: unknown, graph: FlowGraph): SaveDraftFailure {
  const fallback = error instanceof Error && error.message ? error.message : "Não foi possível salvar o rascunho."
  if (!(error instanceof AdminApiError) || error.code !== "VALIDATION_ERROR") return { nodeId: null, message: fallback }

  for (const issue of asValidationIssues(error.details)) {
    const path = Array.isArray(issue.path) ? issue.path : []
    const nodesAt = path.indexOf("nodes")
    const index = nodesAt === -1 ? undefined : path[nodesAt + 1]
    const node = typeof index === "number" ? graph.nodes[index] : undefined
    if (!node) continue
    const field = [...path].reverse().find((segment): segment is string => typeof segment === "string" && segment in FIELD_GUIDANCE)
    const name = node.label || NODE_TYPE_LABELS[node.type]
    return { nodeId: node.id, message: `Não foi possível salvar: em "${name}", ${field ? FIELD_GUIDANCE[field] : "complete os campos obrigatórios"}.` }
  }
  return { nodeId: null, message: "Não foi possível salvar: há uma etapa com campos obrigatórios sem preencher." }
}
