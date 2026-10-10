import type { Orchestrator } from "../assistant.schema"
import { flattenOutputSchema, type FlatOutputSchemaField } from "../output-schema-fields"
import type { FlowGraph } from "../workflow-graph.schema"

// Caminhos de conteúdo (`nodeOutputs.<nó>[.campo]`, `variables.<id>`) e o catálogo do resultado estruturado do Orquestrador.

/** Mesma convenção de path de `sourcePath`/`output.source` ("nodeOutputs.<nodeId>.<campo>" ou
 * "variables.<variableId>") reimplementada aqui — schemas/ não depende de components/, então não
 * importa o `decodeSourcePath` de content-sources.ts. */
export function decodeSourcePathLocal(path: string): { kind: "node"; nodeId: string; field: string } | { kind: "variable"; variableId: string } | null {
  if (path.startsWith("variables.")) return { kind: "variable", variableId: path.slice("variables.".length) }
  if (!path.startsWith("nodeOutputs.")) return null
  const rest = path.slice("nodeOutputs.".length)
  if (!rest) return null
  const dotIndex = rest.indexOf(".")
  if (dotIndex === -1) return { kind: "node", nodeId: rest, field: "" }
  return { kind: "node", nodeId: rest.slice(0, dotIndex), field: rest.slice(dotIndex + 1) }
}

/** Catálogo de campos do Orquestrador — fonte única (071): `structuredOutputFields` já vem
 * achatado do backend; o formato legado só como fallback. `undefined` = sem catálogo conhecido. */
export function structuredFieldsOf(orchestrator: Orchestrator | undefined): FlatOutputSchemaField[] | undefined {
  if (!orchestrator) return undefined
  if (orchestrator.structuredOutputFields && orchestrator.structuredOutputFields.length > 0) return orchestrator.structuredOutputFields
  return orchestrator.outputSchema ? flattenOutputSchema(orchestrator.outputSchema) : undefined
}

export function findField(fields: FlatOutputSchemaField[] | undefined, path: string): FlatOutputSchemaField | undefined {
  return fields?.find((field) => field.path === path)
}

/** Espelha WORKFLOW_STRUCTURED_FIELD_NOT_FOUND do publish: um path `structuredResult.<campo>`
 * cujo Orquestrador DECLARA o resultado estruturado mas não tem esse campo (renomeado/apagado
 * no construtor visual). Devolve o path relativo do campo ausente, ou null. */
export function describeStaleStructuredField(graph: FlowGraph, sourcePath: string | undefined, orchestratorsById: Map<string, Orchestrator>): string | null {
  if (!sourcePath) return null
  const decoded = decodeSourcePathLocal(sourcePath)
  if (decoded?.kind !== "node" || !decoded.field.startsWith("structuredResult.")) return null
  const sourceNode = graph.nodes.find((candidate) => candidate.id === decoded.nodeId)
  const fields = sourceNode?.type === "orchestrator" ? structuredFieldsOf(orchestratorsById.get(sourceNode.config.orchestratorId)) : undefined
  if (!fields) return null
  const fieldPath = decoded.field.slice("structuredResult.".length)
  return findField(fields, fieldPath) ? null : fieldPath
}
