import { findAncestorNodeIds, type FlowGraph, type FlowNode } from "../workflow-graph.schema"
import type { ValidationContext } from "./types"
import { decodeSourcePathLocal } from "./source-paths"

// Referências a etapas e variáveis (P5b e WF-41). Espelho do backend: workflows/application/publish-validation/node-references.ts.

type ContentReference = { path: string; code: string; subject: string }

function contentReferencesOf(node: FlowNode): ContentReference[] {
  if (node.type === "output" && node.config.source) return [{ path: node.config.source, code: "WORKFLOW_INVALID_OUTPUT", subject: "O conteúdo escolhido" }]
  if (node.type === "human_review" && node.config.contentSource) return [{ path: node.config.contentSource, code: "WORKFLOW_INVALID_HUMAN_REVIEW", subject: "O conteúdo a revisar" }]
  if (node.type === "action" && node.config.actionType === "ESCALATE" && node.config.contentSource) return [{ path: node.config.contentSource, code: "WORKFLOW_INVALID_ACTION", subject: "O conteúdo escalonado" }]
  return []
}

function conditionPathsOf(node: FlowNode): string[] {
  if (node.type !== "condition") return []
  return [node.config.sourcePath, ...(node.config.group?.rules ?? []).map((rule) => rule.sourcePath)].filter((path): path is string => Boolean(path))
}

/** O caminho aponta para uma etapa: ela existe e vem antes? `nodeOutputs.trigger` é a raiz do fluxo, sempre disponível. */
function nodeReferenceProblem(graph: FlowGraph, node: FlowNode, referencedNodeId: string): "MISSING" | "NOT_BEFORE" | null {
  if (referencedNodeId === "trigger") return null
  const referenced = graph.nodes.find((candidate) => candidate.id === referencedNodeId)
  if (!referenced) return "MISSING"
  // Output de "Gerar feedback" tem regra própria, que no backend vem antes (reliable-feedback.ts): não repete o mesmo problema aqui.
  if (node.type === "output" && referenced.type === "action" && referenced.config.actionType === "GENERATE_FEEDBACK") return null
  return findAncestorNodeIds(graph, node.id).has(referencedNodeId) ? null : "NOT_BEFORE"
}

const NODE_PROBLEM_TEXT = {
  MISSING: "vem de uma etapa que não existe mais — escolha outro.",
  NOT_BEFORE: "vem de uma etapa que não vem antes desta no fluxo — escolha outro.",
} as const

const CONDITION_PROBLEM_TEXT = {
  MISSING: "usa o resultado de uma etapa que não existe mais — escolha outra origem.",
  NOT_BEFORE: "usa o resultado de uma etapa que não vem antes dela no fluxo — escolha outra origem.",
} as const

/** Variáveis que alguma etapa anterior define: as únicas com valor quando esta etapa roda. */
export function variablesDefinedBefore(graph: FlowGraph, nodeId: string): Set<string> {
  const ancestors = findAncestorNodeIds(graph, nodeId)
  const defined = new Set<string>()
  for (const candidate of graph.nodes) {
    if (ancestors.has(candidate.id) && candidate.type === "action" && candidate.config.actionType === "SET_VARIABLE" && candidate.config.variableId) defined.add(candidate.config.variableId)
  }
  return defined
}

export function validateNodeReferences(context: ValidationContext): void {
  const { graph, variablesById, issues } = context
  for (const node of graph.nodes) {
    for (const { path, code, subject } of contentReferencesOf(node)) {
      const parsed = decodeSourcePathLocal(path)
      if (!parsed) {
        issues.push({ nodeId: node.id, code, message: `${subject} tem uma origem inválida — escolha outro.` })
      } else if (parsed.kind === "node") {
        const problem = nodeReferenceProblem(graph, node, parsed.nodeId)
        if (problem) issues.push({ nodeId: node.id, code, message: `${subject} ${NODE_PROBLEM_TEXT[problem]}` })
      } else if (node.type === "output" && node.config.target.type === "CURRENT_OPERATOR" && node.config.surfaces.includes("FOLLOW_UP")) {
        issues.push({ nodeId: node.id, code, message: `${subject} não pode vir de uma variável: o Acompanhamento do próprio colaborador precisa do resultado inteiro de uma análise.` })
      } else if (!variablesById.has(parsed.variableId)) {
        issues.push({ nodeId: node.id, code, message: `${subject} usa uma variável que não existe mais neste workflow — escolha outro.` })
      } else if (!variablesDefinedBefore(graph, node.id).has(parsed.variableId)) {
        issues.push({ nodeId: node.id, code, message: `${subject} usa uma variável que nenhuma etapa anterior define — escolha outro ou defina a variável antes.` })
      }
    }
    for (const path of conditionPathsOf(node)) {
      const parsed = decodeSourcePathLocal(path)
      if (parsed?.kind !== "node") continue
      const problem = nodeReferenceProblem(graph, node, parsed.nodeId)
      if (problem) issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_CONDITION", message: `"${node.label}" ${CONDITION_PROBLEM_TEXT[problem]}` })
    }
  }
}
