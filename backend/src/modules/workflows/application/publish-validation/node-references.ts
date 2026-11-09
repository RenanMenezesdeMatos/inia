import { DomainError } from "../../../../shared/domain/domain-error.js"
import { findAncestorNodeIds, type FlowGraph, type FlowNode } from "../../domain/graph-schema.js"
import type { PublishCatalogContext } from "./context.js"
import { parseSourcePath } from "./source-paths.js"

// Referências a etapas e variáveis (P5b e WF-41, docs/qa/workflows/propostas.md). Sem esta regra, a referência quebrada publicava e
// só aparecia com o fluxo rodando. Espelho no editor: workflow-validation/node-references.ts. Definir variável, Política, Gerar
// feedback e revisão anterior têm regra própria.

type ContentReference = { path: string; code: string; subject: string }

function contentReferencesOf(node: FlowNode): ContentReference[] {
  if (node.type === "output") return [{ path: node.config.source, code: "WORKFLOW_INVALID_OUTPUT", subject: `O conteúdo de "${node.label}"` }]
  if (node.type === "human_review" && node.config.contentSource) return [{ path: node.config.contentSource, code: "WORKFLOW_INVALID_HUMAN_REVIEW", subject: `O conteúdo a revisar em "${node.label}"` }]
  if (node.type === "action" && node.config.actionType === "ESCALATE" && node.config.contentSource) return [{ path: node.config.contentSource, code: "WORKFLOW_INVALID_ACTION", subject: `O conteúdo escalonado em "${node.label}"` }]
  return []
}

function conditionPathsOf(node: FlowNode): string[] {
  if (node.type !== "condition") return []
  const rules = node.config.group?.rules ?? []
  return [node.config.sourcePath, ...rules.map((rule) => rule.sourcePath)].filter((path): path is string => Boolean(path))
}

/** O caminho aponta para uma etapa: ela existe e vem antes? `nodeOutputs.trigger` é a raiz do fluxo, sempre disponível. */
function nodeReferenceProblem(graph: FlowGraph, node: FlowNode, referencedNodeId: string): "MISSING" | "NOT_BEFORE" | null {
  if (referencedNodeId === "trigger") return null
  if (!graph.nodes.some((candidate) => candidate.id === referencedNodeId)) return "MISSING"
  return findAncestorNodeIds(graph, node.id).has(referencedNodeId) ? null : "NOT_BEFORE"
}

const NODE_PROBLEM_TEXT = { MISSING: "vem de uma etapa que não existe mais", NOT_BEFORE: "vem de uma etapa que não vem antes dela no fluxo" } as const

function definesVariableBefore(graph: FlowGraph, node: FlowNode, variableId: string): boolean {
  const ancestors = findAncestorNodeIds(graph, node.id)
  return graph.nodes.some((candidate) => ancestors.has(candidate.id) && candidate.type === "action" && candidate.config.actionType === "SET_VARIABLE" && candidate.config.variableId === variableId)
}

/** Acompanhamento do próprio colaborador vira Feedback oficial, que precisa do resultado inteiro de uma análise. */
function deliversOfficialFeedback(node: FlowNode): boolean {
  return node.type === "output" && node.config.target.type === "CURRENT_OPERATOR" && node.config.surfaces.includes("FOLLOW_UP")
}

export function validateNodeReferences(context: PublishCatalogContext): void {
  const { graph, variablesById } = context
  for (const node of graph.nodes) {
    const detail = { nodeId: node.id }
    for (const { path, code, subject } of contentReferencesOf(node)) {
      const parsed = parseSourcePath(path)
      if (!parsed) throw new DomainError(`${subject} tem uma origem inválida.`, code, 422, detail)
      if (parsed.kind === "node") {
        const problem = nodeReferenceProblem(graph, node, parsed.nodeId)
        if (problem) throw new DomainError(`${subject} ${NODE_PROBLEM_TEXT[problem]}.`, code, 422, detail)
        continue
      }
      if (deliversOfficialFeedback(node)) throw new DomainError(`${subject} não pode vir de uma variável: o Acompanhamento do próprio colaborador precisa do resultado inteiro de uma análise.`, code, 422, detail)
      if (!variablesById.has(parsed.variableId)) throw new DomainError(`${subject} usa uma variável que não existe mais neste workflow.`, code, 422, detail)
      if (!definesVariableBefore(graph, node, parsed.variableId)) throw new DomainError(`${subject} usa uma variável que nenhuma etapa anterior define.`, code, 422, detail)
    }
    for (const path of conditionPathsOf(node)) {
      const parsed = parseSourcePath(path)
      if (parsed?.kind !== "node") continue
      const problem = nodeReferenceProblem(graph, node, parsed.nodeId)
      if (problem) throw new DomainError(`A origem da condição "${node.label}" ${NODE_PROBLEM_TEXT[problem]}.`, "WORKFLOW_INVALID_CONDITION", 422, detail)
    }
  }
}
