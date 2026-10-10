import type { Orchestrator } from "../assistant.schema"
import type { FlowGraph, FlowNode } from "../workflow-graph.schema"
import type { WorkflowTrigger } from "../workflow.schema"
import type { WorkflowVariableType } from "../workflow-variable.schema"

// Tipos da validação local do editor (workflow-validation.ts).

/** O que cada família de regra recebe de `validateWorkflowGraph` (workflow-validation.ts): o Workflow, o gatilho, os
 * catálogos já carregados pelo editor e a lista onde os problemas são acumulados — na ordem em que as famílias rodam. */
export type ValidationContext = {
  graph: FlowGraph
  trigger: WorkflowTrigger
  orchestratorsById: Map<string, Orchestrator>
  variablesById: Map<string, VariableInfo>
  isConsolidatedMode: boolean
  triggerNodes: FlowNode[]
  issues: ValidationIssue[]
}

/** Tipo + nome (nunca UUID) de uma Workflow Variable, pré-carregado pra validar a Action
 * "Definir variável" (evolução de Variáveis do Workflow) — espelha `variablesById`/
 * `variableNamesById` do publish no backend (workflow-router.ts), só que combinados num mapa só. */
export type VariableInfo = { type: WorkflowVariableType; name: string }

export type GraphIssue = { nodeId: string; message: string }

/** Problema da validação local. `code` é o código da regra do backend que ela espelha (validate-workflow-for-publish.ts;
 * "VALIDATION_ERROR" quando o backend recusa já no esquema do rascunho, ao salvar). A UI não mostra o código: ele existe
 * para o teste de paridade (backend/src/modules/workflows/application/validate-workflow-for-publish.parity.test.ts)
 * comparar os dois lados regra a regra. */
export type ValidationIssue = GraphIssue & { code: string }
