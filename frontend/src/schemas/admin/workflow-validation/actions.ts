import type { Orchestrator } from "../assistant.schema"
import type { OutputSchemaFieldType } from "../output-schema-fields"
import { findAncestorNodeIds, type FlowGraph, type FlowNode } from "../workflow-graph.schema"
import type { WorkflowVariableType } from "../workflow-variable.schema"
import type { ValidationContext, ValidationIssue, VariableInfo } from "./types"
import { decodeSourcePathLocal, findField, structuredFieldsOf } from "./source-paths"

// Família AÇÕES E AGENTES: "Definir variável" (valor fixo/dinâmico, ciclos) e "Chamar agente" sem destino.
// Espelho do backend: workflows/application/publish-validation/actions.ts.

// Mesmo mapa de compatibilidade usado no picker de origem dinâmica
// (components/admin/workflows/content-sources.ts) — reimplementado aqui porque schemas/ nunca
// importa de components/ (mesma convenção já usada por `decodeSourcePathLocal` abaixo).
function mapFieldTypeToVariableType(type: OutputSchemaFieldType): WorkflowVariableType | undefined {
  if (type === "STRING") return "TEXT"
  if (type === "NUMBER") return "NUMERIC"
  if (type === "BOOLEAN") return "BOOLEAN"
  return undefined
}

function isValueOfVariableType(value: boolean | number | string | undefined, type: WorkflowVariableType): boolean {
  if (type === "BOOLEAN") return typeof value === "boolean"
  if (type === "NUMERIC") return typeof value === "number" && Number.isFinite(value)
  return typeof value === "string"
}

/**
 * Espelha `validateDynamicVariableSource` do publish no backend (workflow-router.ts) — valida a
 * origem dinâmica de uma Action "Definir variável" contra o TIPO DA VARIÁVEL de destino
 * (atribuição, não comparador). "trigger" é sempre uma origem válida (raiz do grafo). Mensagem
 * amigável sugerida pelo pedido (Parte 32): "Essa variável depende de um resultado que não está
 * mais disponível neste caminho."
 */
function validateDynamicVariableSource(
  label: string,
  variableType: WorkflowVariableType,
  sourcePath: string,
  actionNodeId: string,
  graph: FlowGraph,
  variablesById: Map<string, VariableInfo>,
  orchestratorsById: Map<string, Orchestrator>,
  issues: ValidationIssue[],
): void {
  const decoded = decodeSourcePathLocal(sourcePath)
  if (!decoded) {
    issues.push({ nodeId: actionNodeId, code: "WORKFLOW_INVALID_ACTION", message: `"${label}" tem uma origem dinâmica inválida.` })
    return
  }

  if (decoded.kind === "variable") {
    const origin = variablesById.get(decoded.variableId)
    if (!origin) {
      issues.push({ nodeId: actionNodeId, code: "WORKFLOW_INVALID_ACTION", message: `"${label}" referencia uma variável de origem que não existe mais neste workflow.` })
      return
    }
    if (origin.type !== variableType) {
      issues.push({ nodeId: actionNodeId, code: "WORKFLOW_INVALID_ACTION", message: `"${label}" tenta atribuir o valor de uma variável de outro tipo — os tipos precisam ser exatamente iguais.` })
    }
    return
  }

  if (decoded.nodeId === "trigger") return // raiz do grafo — sempre uma origem válida

  const sourceNode = graph.nodes.find((candidate) => candidate.id === decoded.nodeId)
  if (!sourceNode || !findAncestorNodeIds(graph, actionNodeId).has(decoded.nodeId)) {
    issues.push({ nodeId: actionNodeId, code: "WORKFLOW_INVALID_ACTION", message: `Essa variável depende de um resultado que não está mais disponível neste caminho.` })
    return
  }
  if (decoded.field.startsWith("structuredResult.")) {
    const fields = sourceNode.type === "orchestrator" ? structuredFieldsOf(orchestratorsById.get(sourceNode.config.orchestratorId)) : undefined
    const fieldPath = decoded.field.slice("structuredResult.".length)
    const field = findField(fields, fieldPath)
    if (fields && !field) {
      issues.push({ nodeId: actionNodeId, code: "WORKFLOW_STRUCTURED_FIELD_NOT_FOUND", message: `"${label}" usa o campo "${fieldPath}", que não existe mais no resultado estruturado do Orquestrador.` })
      return
    }
    if (field && mapFieldTypeToVariableType(field.type) !== variableType) {
      issues.push({ nodeId: actionNodeId, code: "WORKFLOW_INVALID_ACTION", message: `"${label}" tenta atribuir um valor de tipo incompatível com a variável.` })
    }
  }
}

/**
 * Espelha `validateNoVariableCycles` do publish no backend — nunca permite uma variável depender
 * (direta ou indiretamente) de si mesma através de Actions "Definir variável" com origem de outra
 * variável (Parte 12 do pedido). Auto-referência é pega como o caso trivial de ciclo de 1.
 */
export function validateNoVariableCycles(graph: FlowGraph, variablesById: Map<string, VariableInfo>, issues: ValidationIssue[]): void {
  const dependsOn = new Map<string, Set<string>>()
  const nodeIdByVariableId = new Map<string, string>()
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "SET_VARIABLE" || !node.config.sourcePath) continue
    nodeIdByVariableId.set(node.config.variableId, node.id)
    const decoded = decodeSourcePathLocal(node.config.sourcePath)
    if (decoded?.kind !== "variable") continue
    const dependents = dependsOn.get(decoded.variableId) ?? new Set<string>()
    dependents.add(node.config.variableId)
    dependsOn.set(decoded.variableId, dependents)
  }

  const state = new Map<string, "visiting" | "done">()
  const path: string[] = []

  function visit(variableId: string): boolean {
    const current = state.get(variableId)
    if (current === "done") return false
    if (current === "visiting") {
      const cycleNames = [...path.slice(path.indexOf(variableId)), variableId].map((id) => variablesById.get(id)?.name ?? id)
      const reportNodeId = nodeIdByVariableId.get(variableId) ?? ""
      issues.push({ nodeId: reportNodeId, code: "WORKFLOW_VARIABLE_CYCLE", message: `Ciclo entre variáveis: ${cycleNames.join(" → ")}. Uma variável nunca pode depender dela mesma, mesmo indiretamente.` })
      return true
    }
    state.set(variableId, "visiting")
    path.push(variableId)
    for (const dependent of dependsOn.get(variableId) ?? []) {
      if (visit(dependent)) return true // já reportou — não duplica o mesmo ciclo em cascata
    }
    path.pop()
    state.set(variableId, "done")
    return false
  }

  // Para no primeiro ciclo, como o publish: seguir adiante revisitaria variáveis que ficaram "visitando" na recursão
  // interrompida e relataria o mesmo ciclo de novo (um falso "A → A").
  for (const variableId of dependsOn.keys()) if (visit(variableId)) return
}

/** "Chamar agente" sem agente: o rascunho salva, mas a publicação recusa (backend `draft-graph.ts`). */
export function validateCallAgentNode(context: ValidationContext, node: FlowNode): void {
  if (node.type === "action" && node.config.actionType === "CALL_AGENT" && !node.config.agentId) {
    context.issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Escolha o agente desta etapa." })
  }
}

/** "Definir variável": a variável existe e o valor fixo ou a origem dinâmica é compatível com o tipo dela. */
export function validateSetVariableNode(context: ValidationContext, node: FlowNode): void {
  const { graph, orchestratorsById, variablesById, issues } = context
  if (node.type === "action" && node.config.actionType === "SET_VARIABLE") {
    const variable = variablesById.get(node.config.variableId)
    if (!variable) {
      issues.push({ nodeId: node.id, code: node.config.variableId ? "WORKFLOW_INVALID_ACTION" : "VALIDATION_ERROR", message: "Selecione qual variável esta ação deve definir." })
    } else if (node.config.sourcePath) {
      validateDynamicVariableSource(node.label, variable.type, node.config.sourcePath, node.id, graph, variablesById, orchestratorsById, issues)
    } else if (node.config.value === undefined) {
      issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_ACTION", message: "Defina um valor fixo ou uma origem dinâmica." })
    } else if (!isValueOfVariableType(node.config.value, variable.type)) {
      issues.push({ nodeId: node.id, code: "WORKFLOW_INVALID_ACTION", message: "O valor definido não é compatível com o tipo da variável." })
    }
  }
}

/** "Chamar agente" exige um Output (ou um Escalonar com conteúdo) para o resultado chegar a alguém. */
export function validateAgentHasOutput(context: ValidationContext): void {
  const { graph, issues } = context
  // O Workflow nunca publica sozinho — se chama um agente, precisa de um Output OU de um
  // Escalonar com conteúdo selecionado em algum lugar do grafo pra o resultado chegar a algum
  // destino (mesma regra do backend, workflow-router.ts — Escalonar reaproveita o mesmo mecanismo
  // de entrega do Output, então também conta como publicação válida).
  const hasCallAgent = graph.nodes.some((node) => node.type === "action" && node.config.actionType === "CALL_AGENT")
  const hasOutput = graph.nodes.some((node) => node.type === "output")
  const hasEscalateWithContent = graph.nodes.some(
    (node) => node.type === "action" && node.config.actionType === "ESCALATE" && Boolean(node.config.contentSource),
  )
  if (hasCallAgent && !hasOutput && !hasEscalateWithContent) {
    issues.push({ nodeId: "", code: "WORKFLOW_MISSING_OUTPUT", message: "O workflow chama um agente mas não tem nenhum nó Output — adicione um, senão o resultado nunca é publicado." })
  }
}
