import type { Orchestrator } from "./assistant.schema"
import type { FlowGraph } from "./workflow-graph.schema"
import type { WorkflowTrigger } from "./workflow.schema"
import type { ValidationContext, ValidationIssue, VariableInfo } from "./workflow-validation/types"
import { validateGraphShape, validateInteractionFeedbackSource, validateManualTrigger, validateScheduleDataSources, validateScheduleTrigger, validateTranscriptRequirements } from "./workflow-validation/trigger-context"
import { validateConditions } from "./workflow-validation/conditions"
import { validateAgentHasOutput, validateNoVariableCycles, validateSetVariableNode } from "./workflow-validation/actions"
import { validateOrchestratorNode } from "./workflow-validation/orchestrators"
import { validateInterventionPolicyNode } from "./workflow-validation/intervention-policy"
import { validateEscalations, validateHumanReviewTargets } from "./workflow-validation/review-escalation"
import { validateConversationalOutputs, validateOutputSourceNode, validateStructuredSources } from "./workflow-validation/outputs"
import { validateConsolidatedGraph } from "./workflow-validation/fan-out"
import { validateDiagnosisSources } from "./workflow-validation/indicator-diagnosis"
import { validateReliableFeedbackFlow } from "./workflow-validation/reliable-feedback"

export { type VariableInfo, type GraphIssue, type ValidationIssue } from "./workflow-validation/types"
export { structuredFieldsOf } from "./workflow-validation/source-paths"
export { validateReliableFeedbackFlow } from "./workflow-validation/reliable-feedback"

/**
 * Espelha as regras de validação do publish no backend (workflow-router.ts), pra sinalizar
 * na hora — no canvas — em vez de só descobrir o problema quando o publish falhar.
 * `orchestratorsById` é opcional: sem ele, a guarda de Output pra Avatar/Chat com schema
 * conhecido simplesmente não roda (o publish ainda bloqueia de verdade).
 */
export function validateWorkflowGraph(
  graph: FlowGraph,
  trigger: WorkflowTrigger,
  orchestratorsById: Map<string, Orchestrator> = new Map(),
  variablesById: Map<string, VariableInfo> = new Map(),
  // Modo Consolidado (Estrutura Consolidada configurada) — Performance do colaborador não é uma
  // Condition válida nesse modo (nunca há um colaborador individual como sujeito). Ausente =
  // Individual, comportamento de sempre.
  isConsolidatedMode = false,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []

  const triggerNodes = graph.nodes.filter((node) => node.type === "trigger")
  const context: ValidationContext = { graph, trigger, orchestratorsById, variablesById, isConsolidatedMode, triggerNodes, issues }
  // Cada família de regra mora em workflow-validation/<família>.ts; a ordem das chamadas é a ordem da lista de problemas.
  validateGraphShape(context)
  validateConsolidatedGraph(context)
  validateScheduleTrigger(context)
  for (const node of graph.nodes) {
    validateSetVariableNode(context, node)
    validateOutputSourceNode(context, node)
    validateOrchestratorNode(context, node)
    validateInterventionPolicyNode(context, node)
  }
  validateNoVariableCycles(graph, variablesById, issues)
  validateAgentHasOutput(context)
  validateHumanReviewTargets(context)
  validateConversationalOutputs(context)
  validateStructuredSources(context)
  validateEscalations(context)
  validateManualTrigger(context)
  validateScheduleDataSources(context)
  validateInteractionFeedbackSource(context)

  issues.push(...validateReliableFeedbackFlow(graph, trigger, isConsolidatedMode))
  validateTranscriptRequirements(context)
  validateDiagnosisSources(context)
  validateConditions(context)
  return issues
}
