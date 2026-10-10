import { DomainError } from "../../../../shared/domain/domain-error.js"
import type { FlatOutputSchemaField } from "../../../assistant/domain/output-schema-fields.js"
import { findStructuredOutputField } from "../../../assistant/domain/structured-output-definition.js"
import type { FlowGraph, OutputSurface } from "../../domain/graph-schema.js"
import type { PublishCatalogContext } from "./context.js"
import { parseSourcePath } from "./source-paths.js"

// Família OUTPUT E DESTINATÁRIOS: conteúdo publicado (e revisado/escalonado) e superfícies conversacionais. Os
// destinatários de gestão resolvidos pela estrutura ficam no modo Consolidado (fan-out.ts). Espelho no editor:
// workflow-validation/outputs.ts.

/**
 * Nunca deixa publicar objeto completo (múltiplos campos) ou campo do tipo lista pra uma
 * superfície conversacional (Avatar/Chat) — renderizaria JSON cru pro operador. Só bloqueia
 * quando há CERTEZA de tipo (schema do orquestrador conhecido); nunca quando a origem não tem
 * schema (preserva Outputs publicados antes deste conceito existir, ex.: TESTE 07). Reaproveitada
 * pelo Output (`source`) e pela Action Escalonar (`contentSource`) — mesma regra, mesmo motivo.
 */
export function validateConversationalSurfaceContent(
  graph: FlowGraph,
  label: string,
  sourcePath: string,
  surfaces: OutputSurface[],
  orchestratorSchemasById: Map<string, FlatOutputSchemaField[] | null>,
  errorCode: string,
): void {
  const hasAvatarOrChat = surfaces.includes("AVATAR") || surfaces.includes("CHAT")
  if (!hasAvatarOrChat) return
  const parsed = parseSourcePath(sourcePath)
  if (parsed?.kind !== "node") return
  const sourceNode = graph.nodes.find((candidate) => candidate.id === parsed.nodeId)
  const schema = sourceNode?.type === "orchestrator" ? orchestratorSchemasById.get(sourceNode.config.orchestratorId) : undefined
  if (!schema) return
  if (!parsed.field) {
    throw new DomainError(
      `O nó "${label}" publica o resultado completo (um objeto com vários campos) pra uma superfície conversacional (Avatar/Chat) — escolha um campo específico.`,
      errorCode,
      422,
    )
  }
  if (parsed.field.startsWith("structuredResult.")) {
    const fieldPath = parsed.field.slice("structuredResult.".length)
    const field = findStructuredOutputField(schema, fieldPath)
    if (!field) {
      throw new DomainError(`O nó "${label}" publica o campo "${fieldPath}", que não existe mais no resultado estruturado do Orquestrador.`, "WORKFLOW_STRUCTURED_FIELD_NOT_FOUND", 422)
    }
    if (field.type === "ARRAY") {
      throw new DomainError(
        `O nó "${label}" publica uma lista pra uma superfície conversacional (Avatar/Chat) — escolha um campo de texto, número ou verdadeiro/falso.`,
        errorCode,
        422,
      )
    }
  }
}

/**
 * Qualquer consumidor de `nodeOutputs.<orquestrador>.structuredResult.<campo>` (Output, Revisão
 * humana, Escalonar): quando o Orquestrador DECLARA o resultado estruturado (definição nova ou
 * legado com metadado), o campo precisa existir — renomear/apagar um campo no Orquestrador
 * nunca deixa um Workflow publicar apontando pro nada (Parte Z do construtor visual). Sem
 * catálogo (legado só texto) não há como conferir — libera, como sempre foi.
 */
function validateStructuredSourceExists(
  graph: FlowGraph,
  subject: string,
  sourcePath: string | undefined,
  orchestratorSchemasById: Map<string, FlatOutputSchemaField[] | null>,
  errorCode: string,
): void {
  if (!sourcePath) return
  const parsed = parseSourcePath(sourcePath)
  if (parsed?.kind !== "node" || !parsed.field.startsWith("structuredResult.")) return
  const sourceNode = graph.nodes.find((candidate) => candidate.id === parsed.nodeId)
  const schema = sourceNode?.type === "orchestrator" ? orchestratorSchemasById.get(sourceNode.config.orchestratorId) : undefined
  if (!schema) return
  const fieldPath = parsed.field.slice("structuredResult.".length)
  if (!findStructuredOutputField(schema, fieldPath)) {
    throw new DomainError(`${subject} o campo "${fieldPath}", que não existe mais no resultado estruturado do Orquestrador — escolha outro campo.`, errorCode, 422)
  }
}

/** Conteúdo de Output, Revisão humana e Escalonar: campo estruturado existente e nada cru no Avatar/Chat. */
export function validateOutputContent(context: PublishCatalogContext): void {
  const { graph, orchestratorSchemasById } = context
  // Output pra superfície conversacional (Avatar/Chat) publicando um objeto estruturado com
  // mais de um campo (ou um campo do tipo lista) renderizaria JSON cru pro operador — só
  // bloqueia quando há CERTEZA de tipo (schema conhecido); nunca quando a origem não tem
  // schema (preserva Outputs publicados antes deste conceito existir, ex.: TESTE 07).
  for (const node of graph.nodes) {
    if (node.type !== "output") continue
    validateStructuredSourceExists(graph, `O nó "${node.label}" publica`, node.config.source, orchestratorSchemasById, "WORKFLOW_INVALID_OUTPUT")
    validateConversationalSurfaceContent(graph, node.label, node.config.source, node.config.surfaces, orchestratorSchemasById, "WORKFLOW_INVALID_OUTPUT")
  }
  for (const node of graph.nodes) {
    if (node.type === "human_review") validateStructuredSourceExists(graph, `O nó "${node.label}" revisa`, node.config.contentSource, orchestratorSchemasById, "WORKFLOW_INVALID_HUMAN_REVIEW")
    if (node.type === "action" && node.config.actionType === "ESCALATE") validateStructuredSourceExists(graph, `O nó "${node.label}" escalona`, node.config.contentSource, orchestratorSchemasById, "WORKFLOW_INVALID_ACTION")
  }
}
