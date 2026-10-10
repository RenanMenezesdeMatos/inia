import type { FlowNode } from "../workflow-graph.schema"
import type { ValidationContext } from "./types"

// Família ORQUESTRADOR: configuração do nó (o backend recusa os mesmos casos já no esquema do rascunho).

/** Nó Orquestrador: orquestrador, instrução e (roteamento declarado) ao menos um domínio. */
export function validateOrchestratorNode(context: ValidationContext, node: FlowNode): void {
  const { issues } = context
  if (node.type === "orchestrator") {
    if (!node.config.orchestratorId) issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Selecione qual orquestrador este nó deve executar." })
    if (!node.config.instruction.trim()) issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Defina a instrução para o orquestrador." })
    // V1.7.1 — roteamento declarado precisa de ao menos um domínio (o backend confere especialista único por domínio).
    if (node.config.routing?.mode === "DOMAINS" && node.config.routing.businessDomainIds.length === 0) issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Marque ao menos um domínio no roteamento, ou volte para \"Decidido pela IA\"." })
  }
}
