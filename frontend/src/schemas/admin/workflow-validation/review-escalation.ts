import { findAncestorNodeIds, type FlowGraph, type HierarchicalTarget } from "../workflow-graph.schema"
import type { ValidationContext, ValidationIssue } from "./types"
import { validateConversationalSurfaceContent } from "./outputs"

// Família REVISÃO HUMANA E ESCALONAMENTO: revisor relativo a uma revisão anterior e conteúdo escalonado.
// Espelho do backend: workflows/application/publish-validation/review-escalation.ts.

/**
 * `target.type === "ROLE_OF_PREVIOUS_REVIEWER"` precisa apontar pra um node human_review que
 * seja ancestral REAL (por edges) do node que o usa — reaproveitada tanto pela própria Revisão
 * Humana (`reviewTarget`) quanto pela Action Escalonar (`target`), já que os dois usam o mesmo
 * `HierarchicalTarget`. Espelha `validatePreviousReviewerTarget` do publish no backend.
 */
function validatePreviousReviewerTarget(graph: FlowGraph, nodeId: string, target: HierarchicalTarget, errorCode: string, issues: ValidationIssue[]): void {
  // "Pessoa específica" sem pessoa escolhida: o rascunho salva, mas a publicação recusa (backend `draft-graph.ts`).
  if (target.type === "SPECIFIC_USER" && !target.userId) {
    issues.push({ nodeId, code: "VALIDATION_ERROR", message: "Escolha a pessoa." })
    return
  }
  if (target.type !== "ROLE_OF_PREVIOUS_REVIEWER") return
  const previousNode = graph.nodes.find((candidate) => candidate.id === target.previousReviewNodeId)
  if (!previousNode || previousNode.type !== "human_review") {
    issues.push({ nodeId, code: errorCode, message: "A revisão anterior selecionada não existe mais neste workflow." })
    return
  }
  if (!findAncestorNodeIds(graph, nodeId).has(previousNode.id)) {
    issues.push({ nodeId, code: errorCode, message: "A revisão anterior selecionada precisa vir ANTES deste nó no fluxo." })
  }
}

/** Revisor relativo a uma revisão anterior que exista e venha antes no fluxo. */
export function validateHumanReviewTargets(context: ValidationContext): void {
  const { graph, issues } = context
  // Human Review: "revisor relativo ao revisor anterior" só pode apontar pra um node human_review
  // que vem ANTES dele no fluxo (mesma checagem do publish).
  for (const node of graph.nodes) {
    if (node.type !== "human_review") continue
    validatePreviousReviewerTarget(graph, node.id, node.config.reviewTarget, "WORKFLOW_INVALID_HUMAN_REVIEW", issues)
  }
}

/** Escalonar: revisor anterior real e conteúdo compatível com Avatar/Chat. */
export function validateEscalations(context: ValidationContext): void {
  const { graph, orchestratorsById, issues } = context
  // Action Escalonar — Target + Conteúdo + Surface, reaproveitando as MESMAS 2 validações acima
  // (nunca uma 3ª implementação): revisor anterior precisa ser ancestral real, e a mesma guarda
  // de Avatar/Chat contra objeto/lista crua também vale pro conteúdo escalonado.
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "ESCALATE") continue
    validatePreviousReviewerTarget(graph, node.id, node.config.target, "WORKFLOW_INVALID_ACTION", issues)
    if (node.config.surfaces.length === 0) issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Escolha onde entregar o conteúdo." })
    if (node.config.contentSource) {
      validateConversationalSurfaceContent(graph, node.id, node.config.contentSource, node.config.surfaces, orchestratorsById, "WORKFLOW_INVALID_ACTION", issues)
    }
  }
}
