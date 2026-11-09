import type { Orchestrator } from "../assistant.schema"
import { CONVERSATIONAL_OUTPUT_SURFACES, type FlowGraph, type FlowNode, type OutputSurface } from "../workflow-graph.schema"
import type { ValidationContext, ValidationIssue } from "./types"
import { decodeSourcePathLocal, describeStaleStructuredField, findField, structuredFieldsOf } from "./source-paths"

// Família OUTPUT E DESTINATÁRIOS: conteúdo publicado (e revisado/escalonado) e superfícies conversacionais.
// Espelho do backend: workflows/application/publish-validation/outputs.ts.

/**
 * Nunca deixa publicar objeto completo ou campo do tipo lista pra uma superfície conversacional
 * (Avatar/Chat) — só bloqueia quando há CERTEZA de tipo (schema conhecido); nunca quando a
 * origem não tem schema (preserva Outputs publicados antes deste conceito existir). Reaproveitada
 * pelo Output (`source`) e pela Action Escalonar (`contentSource`) — mesma regra, mesmo motivo.
 * Espelha `validateConversationalSurfaceContent` do publish no backend.
 */
export function validateConversationalSurfaceContent(
  graph: FlowGraph,
  nodeId: string,
  sourcePath: string,
  surfaces: OutputSurface[],
  orchestratorsById: Map<string, Orchestrator>,
  errorCode: string,
  issues: ValidationIssue[],
): void {
  const hasConversationalSurface = surfaces.some((surface) => CONVERSATIONAL_OUTPUT_SURFACES.includes(surface))
  if (!hasConversationalSurface) return
  const decoded = decodeSourcePathLocal(sourcePath)
  if (decoded?.kind !== "node") return
  const sourceNode = graph.nodes.find((candidate) => candidate.id === decoded.nodeId)
  const schema = sourceNode?.type === "orchestrator" ? structuredFieldsOf(orchestratorsById.get(sourceNode.config.orchestratorId)) : undefined
  if (!schema) return
  if (!decoded.field) {
    issues.push({
      nodeId,
      code: errorCode,
      message: "Publicar o resultado completo pra uma superfície conversacional (Avatar/Chat) mostraria dado cru — escolha um campo específico.",
    })
    return
  }
  if (decoded.field.startsWith("structuredResult.")) {
    const field = findField(schema, decoded.field.slice("structuredResult.".length))
    if (field?.type === "ARRAY") {
      issues.push({
        nodeId,
        code: errorCode,
        message: "Publicar uma lista pra uma superfície conversacional (Avatar/Chat) mostraria dado cru — escolha um campo de texto, número ou verdadeiro/falso.",
      })
    }
  }
}

/** Output com conteúdo, destino e, quando for o caso, a pessoa escolhidos — o rascunho nem é aceito sem eles. */
export function validateOutputSourceNode(context: ValidationContext, node: FlowNode): void {
  const { issues } = context
  if (node.type !== "output") return
  if (!node.config.source) issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Escolha o conteúdo que será publicado." })
  if (node.config.surfaces.length === 0) issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Escolha onde entregar o conteúdo." })
  if (node.config.target.type === "USER" && !node.config.target.userId) issues.push({ nodeId: node.id, code: "VALIDATION_ERROR", message: "Escolha a pessoa que vai receber o conteúdo." })
}

/** Output para Avatar/Chat nunca publica objeto inteiro nem lista quando o tipo do conteúdo é conhecido. */
export function validateConversationalOutputs(context: ValidationContext): void {
  const { graph, orchestratorsById, issues } = context
  // Output pra superfície conversacional (Avatar/Chat): nunca deixa publicar objeto inteiro ou
  // lista crus quando o schema de origem é CONHECIDO — mesma guarda do publish (nunca bloqueia
  // origem sem schema, ex.: um CALL_AGENT puro).
  for (const node of graph.nodes) {
    if (node.type !== "output" || !node.config.source) continue
    validateConversationalSurfaceContent(graph, node.id, node.config.source, node.config.surfaces, orchestratorsById, "WORKFLOW_INVALID_OUTPUT", issues)
  }
}

/** Campo do resultado estruturado do Orquestrador que ainda existe (Output, Revisão humana, Escalonar). */
export function validateStructuredSources(context: ValidationContext): void {
  const { graph, orchestratorsById, issues } = context
  // Campo do resultado estruturado renomeado/apagado no Orquestrador depois de escolhido aqui
  // (Output, Revisão humana, Escalonar) — mesma regra WORKFLOW_STRUCTURED_FIELD_NOT_FOUND do publish.
  for (const node of graph.nodes) {
    const source = node.type === "output" ? node.config.source : node.type === "human_review" ? node.config.contentSource : node.type === "action" && node.config.actionType === "ESCALATE" ? node.config.contentSource : undefined
    const stale = describeStaleStructuredField(graph, source, orchestratorsById)
    if (stale) issues.push({ nodeId: node.id, code: node.type === "output" ? "WORKFLOW_INVALID_OUTPUT" : node.type === "human_review" ? "WORKFLOW_INVALID_HUMAN_REVIEW" : "WORKFLOW_INVALID_ACTION", message: `"${node.label}" usa o campo "${stale}", que não existe mais no resultado estruturado do Orquestrador — escolha outro campo.` })
  }
}
