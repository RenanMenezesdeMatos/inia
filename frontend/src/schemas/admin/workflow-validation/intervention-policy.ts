import { findAncestorNodeIds, type FlowNode } from "../workflow-graph.schema"
import type { ValidationContext } from "./types"

// Família POLÍTICA DE ACOMPANHAMENTO (espelho de backend/.../publish-validation/intervention-policy.ts): só o que dá para checar
// sem banco. Política existente/ativa/publicada e escopo compatível ficam com o dry-run do backend.

/** Nó "Avaliar política de acompanhamento": política escolhida e referências de análise que vêm ANTES dele no fluxo. */
export function validateInterventionPolicyNode(context: ValidationContext, node: FlowNode): void {
  if (node.type !== "intervention_policy") return
  const { issues, graph } = context
  if (!node.config.policyId) issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Selecione a política de acompanhamento que este nó deve avaliar." })
  const ancestors = findAncestorNodeIds(graph, node.id)
  if (node.config.analysisSourceNodeIds.some((sourceId) => !ancestors.has(sourceId))) {
    issues.push({ nodeId: node.id, code: "WORKFLOW_INTERVENTION_POLICY_SOURCE_NOT_ANCESTOR", message: `O nó "${node.label}" usa como referência de análise um nó que não vem antes dele no fluxo.` })
  }
}
