import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { affectsWholeResult, diffStructuredOutput, type StructuredOutputBreakingChange, type StructuredOutputDefinition } from "../domain/structured-output-definition.js"

/**
 * Dependências do resultado estruturado (Parte Z): Workflows cujos Conditions/Outputs/Ações/
 * Revisões referenciam `nodeOutputs.<nodeId>.structuredResult.<path>` de um node Orquestrador
 * que aponta para ESTE orquestrador. Descoberto varrendo o grafo (rascunho e versão publicada)
 * — nunca por texto solto: primeiro os nodes `orchestrator` com o id certo, depois qualquer
 * string do grafo que comece com `nodeOutputs.<esseNode>.structuredResult.`.
 */
export type StructuredOutputUsage = {
  workflowId: string
  workflowName: string
  /** true = a referência está na versão PUBLICADA (ativa); false = só no rascunho. */
  published: boolean
  nodeId: string
  nodeLabel: string
  /** Path relativo dentro do resultado estruturado ("sintese.severidade"). */
  path: string
}

type GraphLike = { nodes?: unknown }

function collectStrings(value: unknown, sink: string[]): void {
  if (typeof value === "string") {
    sink.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, sink)
    return
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, sink)
  }
}

/** Referências a paths estruturados do orquestrador `orchestratorId` dentro de UM grafo. */
export function collectStructuredPathReferences(graph: unknown, orchestratorId: string): { nodeId: string; nodeLabel: string; path: string }[] {
  const nodes = Array.isArray((graph as GraphLike | null)?.nodes) ? ((graph as GraphLike).nodes as Record<string, unknown>[]) : []
  const orchestratorNodeIds = new Set<string>()
  for (const node of nodes) {
    const config = node.config as Record<string, unknown> | undefined
    if (node.type === "orchestrator" && config?.orchestratorId === orchestratorId && typeof node.id === "string") orchestratorNodeIds.add(node.id)
  }
  if (orchestratorNodeIds.size === 0) return []

  const references: { nodeId: string; nodeLabel: string; path: string }[] = []
  const seen = new Set<string>()
  for (const node of nodes) {
    const strings: string[] = []
    collectStrings(node.config, strings)
    for (const candidate of strings) {
      const match = /^nodeOutputs\.([^.]+)\.structuredResult\.(.+)$/.exec(candidate)
      if (!match || !orchestratorNodeIds.has(match[1]!)) continue
      const nodeId = typeof node.id === "string" ? node.id : ""
      const nodeLabel = typeof node.label === "string" && node.label ? node.label : nodeId
      const key = `${nodeId}|${match[2]}`
      if (seen.has(key)) continue
      seen.add(key)
      references.push({ nodeId, nodeLabel, path: match[2]! })
    }
  }
  return references
}

export async function loadStructuredOutputUsage(db: Database, organizationId: string, orchestratorId: string): Promise<StructuredOutputUsage[]> {
  const rows = await db.query<{ id: string; name: string; draft_graph: unknown; published_graph: unknown }>(
    `select w.id, w.name, w.draft_graph, v.graph published_graph
       from workflows w
       left join workflow_versions v on v.id = w.active_version_id
      where w.organization_id = $1
        and (w.draft_graph::text like '%structuredResult.%' or v.graph::text like '%structuredResult.%')`,
    [organizationId],
  )
  const usage: StructuredOutputUsage[] = []
  for (const row of rows.rows) {
    for (const reference of collectStructuredPathReferences(row.published_graph, orchestratorId)) {
      usage.push({ workflowId: row.id, workflowName: row.name, published: true, ...reference })
    }
    for (const reference of collectStructuredPathReferences(row.draft_graph, orchestratorId)) {
      // A mesma referência presente no rascunho E na versão publicada conta uma vez, como publicada.
      if (usage.some((entry) => entry.workflowId === row.id && entry.nodeId === reference.nodeId && entry.path === reference.path)) continue
      usage.push({ workflowId: row.id, workflowName: row.name, published: false, ...reference })
    }
  }
  return usage
}

export type StructuredOutputImpact = StructuredOutputUsage & { change: StructuredOutputBreakingChange }

/** Cruza as mudanças breaking com o uso real: um path usado é impactado quando foi removido,
 * mudou de tipo, teve opção removida, ou quando um ANCESTRAL dele (grupo) foi removido/mudou.
 * Mudanças que invalidam o resultado INTEIRO (opcional → obrigatório, faixa numérica mais
 * estreita) impactam QUALQUER referência ao resultado desse orquestrador — o path alterado
 * nem precisa ser o path lido. */
export function resolveStructuredOutputImpacts(changes: StructuredOutputBreakingChange[], usage: StructuredOutputUsage[]): StructuredOutputImpact[] {
  const impacts: StructuredOutputImpact[] = []
  for (const entry of usage) {
    const change =
      changes.find((candidate) => !affectsWholeResult(candidate) && (entry.path === candidate.path || entry.path.startsWith(`${candidate.path}.`))) ??
      changes.find((candidate) => affectsWholeResult(candidate))
    if (change) impacts.push({ ...entry, change })
  }
  return impacts
}

function describeRange(range: { minimum?: number; maximum?: number }): string {
  if (range.minimum !== undefined && range.maximum !== undefined) return `${range.minimum} a ${range.maximum}`
  if (range.minimum !== undefined) return `a partir de ${range.minimum}`
  if (range.maximum !== undefined) return `até ${range.maximum}`
  return "sem limite"
}

export function describeImpact(impact: StructuredOutputImpact): string {
  const where = `${impact.workflowName} (${impact.published ? "publicado" : "rascunho"}) › ${impact.nodeLabel}`
  switch (impact.change.kind) {
    case "REMOVED":
      return `${where} usa "${impact.path}", que deixaria de existir.`
    case "TYPE_CHANGED":
      return `${where} usa "${impact.path}", que mudaria de tipo.`
    case "ENUM_OPTION_REMOVED":
      return `${where} usa "${impact.path}", que perderia a(s) opção(ões) ${impact.change.values.join(", ")}.`
    case "REQUIRED_ADDED":
      return `${where} lê o resultado estruturado, e "${impact.change.path}" passaria a ser obrigatório — respostas sem esse campo, antes válidas, ficariam inválidas por inteiro.`
    case "RANGE_NARROWED":
      return `${where} lê o resultado estruturado, e a faixa de "${impact.change.path}" ficaria mais estreita (${describeRange(impact.change.from)} → ${describeRange(impact.change.to)}) — valores antes aceitos invalidariam o resultado por inteiro.`
  }
}

/**
 * Política de mudança (Parte Z): dependência de versão PUBLICADA bloqueia sempre (409
 * STRUCTURED_OUTPUT_IN_USE_PUBLISHED); dependência só em RASCUNHO exige confirmação explícita
 * (409 STRUCTURED_OUTPUT_IN_USE_DRAFT até vir `acknowledge = true`). Mudanças compatíveis
 * (rótulo, descrição, campo novo, opção nova, obrigatório → opcional, faixa numérica mais larga)
 * nunca passam por aqui — ver `diffStructuredOutput`.
 */
export async function assertStructuredOutputChangeAllowed(
  db: Database,
  organizationId: string,
  orchestratorId: string,
  previous: StructuredOutputDefinition | null,
  next: StructuredOutputDefinition | null,
  acknowledge: boolean,
): Promise<StructuredOutputImpact[]> {
  const changes = diffStructuredOutput(previous, next)
  if (changes.length === 0) return []
  const usage = await loadStructuredOutputUsage(db, organizationId, orchestratorId)
  const impacts = resolveStructuredOutputImpacts(changes, usage)
  if (impacts.length === 0) return []
  const published = impacts.filter((impact) => impact.published)
  if (published.length > 0) {
    throw new DomainError(
      `Esta alteração quebraria ${published.length === 1 ? "um Workflow publicado" : `${published.length} referências em Workflows publicados`}: ${published.map(describeImpact).join(" ")} Ajuste o Workflow antes de alterar o resultado estruturado.`,
      "STRUCTURED_OUTPUT_IN_USE_PUBLISHED",
      409,
      { impacts },
    )
  }
  if (!acknowledge) {
    throw new DomainError(
      `Esta alteração afeta ${impacts.length === 1 ? "um Workflow em rascunho" : `${impacts.length} referências em Workflows em rascunho`}: ${impacts.map(describeImpact).join(" ")} Confirme para salvar mesmo assim — o rascunho precisará ser ajustado antes de publicar.`,
      "STRUCTURED_OUTPUT_IN_USE_DRAFT",
      409,
      { impacts },
    )
  }
  return impacts
}
