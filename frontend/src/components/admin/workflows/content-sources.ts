import { findAncestorNodeIds, findNode, resolveNodeContexts, type FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import type { PublishedPolicySummary } from "@/schemas/admin/intervention-policy.schema"
import { flattenOutputSchema, type FlatOutputSchemaField, type OutputSchemaFieldType } from "@/schemas/admin/output-schema-fields"
import type { WorkflowVariableType } from "@/schemas/admin/workflow-variable.schema"

export type ContentSource = { nodeId: string; label: string }

/**
 * Nodes upstream de `fromNodeId` — por edges, nunca por posição visual ou "o node anterior na
 * lista" (ver `findAncestorNodeIds`) — cujo resultado é algo publicável/comparável: hoje, uma
 * Ação "Chamar agente" ou um node Orquestrador. Rotulado pelo nome amigável do agente/
 * orquestrador, nunca por id técnico — é o que alimenta os seletores de Output e Condition.
 */
export function resolveContentSources(
  graph: FlowGraph,
  fromNodeId: string,
  agentsById: Map<string, Agent>,
  orchestratorsById: Map<string, Orchestrator>,
): ContentSource[] {
  const ancestorIds = findAncestorNodeIds(graph, fromNodeId)
  const sources: ContentSource[] = []
  for (const nodeId of ancestorIds) {
    const node = findNode(graph, nodeId)
    if (!node) continue
    if (node.type === "action" && node.config.actionType === "CALL_AGENT") {
      const agentName = agentsById.get(node.config.agentId)?.name
      sources.push({ nodeId: node.id, label: `Resultado de: ${agentName ?? "Agente (não configurado)"}` })
    } else if (node.type === "orchestrator") {
      const orchestratorName = orchestratorsById.get(node.config.orchestratorId)?.name
      sources.push({ nodeId: node.id, label: `Resultado de: ${orchestratorName ?? "Orquestrador (não configurado)"}` })
    } else if (node.type === "intervention_policy") {
      sources.push({ nodeId: node.id, label: `Resultado de: ${node.label || "Avaliar política de acompanhamento"}` })
    }
  }
  return sources
}

const OUTCOME_OPTIONS = [
  { value: "CREATED", label: "Intervenção criada" },
  { value: "PENDING_APPROVAL", label: "Aprovação pendente" },
  { value: "RECOMMENDED", label: "Intervenção recomendada" },
  { value: "EXISTING", label: "Intervenção já existente" },
  { value: "NO_MATCH", label: "Nenhuma regra atendida" },
  { value: "INCONCLUSIVE", label: "Avaliação inconclusiva" },
  { value: "CONFLICT", label: "Conflito entre intervenções" },
  { value: "SUPPRESSED", label: "Suprimida pela carência" },
  { value: "NOT_APPLICABLE", label: "Política não aplicável" },
]

const DECISION_OPTIONS = [
  { value: "CREATED", label: "Aberta" },
  { value: "PENDING_APPROVAL", label: "Aberta aguardando aprovação" },
  { value: "RECOMMENDED", label: "Recomendada ao responsável" },
  { value: "EXISTING", label: "Já existia em andamento" },
  { value: "SUPPRESSED", label: "Não reaberta (carência)" },
  { value: "CONFLICT", label: "Não aplicada (conflito)" },
  { value: "NOT_DECIDED", label: "Não pedida nesta avaliação" },
]

/** O que o editor sabe de cada política publicada para montar o seletor das Conditions (tipos citados nas regras). */
export type PolicyResultCatalog = ReadonlyMap<string, Pick<PublishedPolicySummary, "rules" | "types">>

/** Campos do resultado estruturado do nó "Avaliar política de acompanhamento" (contrato fixo do backend). */
export const INTERVENTION_POLICY_RESULT_FIELDS: FlatOutputSchemaField[] = [
  { path: "outcome", label: "Resultado geral", type: "STRING", fieldType: "ENUM", enumValues: OUTCOME_OPTIONS.map((option) => option.value), enumOptions: OUTCOME_OPTIONS },
  { path: "created", label: "Abriu intervenção", type: "BOOLEAN" },
  { path: "pendingApproval", label: "Tem aprovação pendente", type: "BOOLEAN" },
  { path: "recommended", label: "Recomendou intervenção", type: "BOOLEAN" },
  { path: "existing", label: "Encontrou intervenção já ativa", type: "BOOLEAN" },
  { path: "suppressed", label: "Suprimiu pela carência", type: "BOOLEAN" },
  { path: "conflict", label: "Teve conflito", type: "BOOLEAN" },
  { path: "inconclusive", label: "Ficou inconclusiva", type: "BOOLEAN" },
  { path: "noMatch", label: "Nenhuma regra atendida", type: "BOOLEAN" },
  { path: "notApplicable", label: "Política não aplicável", type: "BOOLEAN" },
  { path: "counts.CREATED", label: "Quantidade criada", type: "NUMBER" },
  { path: "counts.PENDING_APPROVAL", label: "Quantidade aguardando aprovação", type: "NUMBER" },
  { path: "counts.RECOMMENDED", label: "Quantidade recomendada", type: "NUMBER" },
]

/**
 * Campos do nó de política: os gerais + UM por tipo de intervenção citado nas regras da versão em vigor ("Decisão — Plano de
 * ação"), com os valores em linguagem de negócio. O backend grava `decisionsByType.<CHAVE>` para todos esses tipos.
 */
export function interventionPolicyResultFields(policy: Pick<PublishedPolicySummary, "rules" | "types"> | undefined): FlatOutputSchemaField[] {
  if (!policy) return INTERVENTION_POLICY_RESULT_FIELDS
  const keys = [...new Set(policy.rules.flatMap((rule) => [...rule.actions, ...rule.inconclusiveActions].map((action) => action.typeKey)))]
  const nameOf = (key: string) => policy.types.find((type) => type.key === key)?.name ?? key
  const perType = keys
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), "pt-BR"))
    .map((key): FlatOutputSchemaField => ({ path: `decisionsByType.${key}`, label: `Decisão — ${nameOf(key)}`, type: "STRING", fieldType: "ENUM", enumValues: DECISION_OPTIONS.map((option) => option.value), enumOptions: DECISION_OPTIONS }))
  return [...INTERVENTION_POLICY_RESULT_FIELDS.slice(0, 1), ...perType, ...INTERVENTION_POLICY_RESULT_FIELDS.slice(1)]
}

/**
 * V1.5.12 — nós "Gerar feedback" ANTERIORES (por edges): o ReliableFeedbackArtifact é a fonte do Output/Revisão humana para
 * feedback oficial. Rótulo = nome do nó (nunca id).
 */
export function resolveReliableFeedbackSources(graph: FlowGraph, fromNodeId: string): ContentSource[] {
  const sources: ContentSource[] = []
  for (const nodeId of findAncestorNodeIds(graph, fromNodeId)) {
    const node = findNode(graph, nodeId)
    if (node?.type === "action" && node.config.actionType === "GENERATE_FEEDBACK") sources.push({ nodeId: node.id, label: `Feedback confiável: ${node.label || "Gerar feedback"}` })
  }
  return sources
}

/**
 * V1.5.12 — ORIGENS aceitas por "Gerar feedback": só "Chamar agente" (no caminho individual — nunca o Agent de síntese
 * pós-JOIN) ou "Orquestrador" ANCESTRAIS. Nenhum outro resultado do Execution Context é oferecido.
 */
export function resolveFeedbackOrigins(graph: FlowGraph, fromNodeId: string, agentsById: Map<string, Agent>, orchestratorsById: Map<string, Orchestrator>): ContentSource[] {
  const contexts = resolveNodeContexts(graph)
  const sources: ContentSource[] = []
  for (const nodeId of findAncestorNodeIds(graph, fromNodeId)) {
    const node = findNode(graph, nodeId)
    if (!node) continue
    if (node.type === "action" && node.config.actionType === "CALL_AGENT" && contexts.get(node.id) !== "CONSOLIDATED_RESULT") {
      sources.push({ nodeId: node.id, label: `${node.label || "Chamar agente"} — Agente: ${agentsById.get(node.config.agentId)?.name ?? "não configurado"}` })
    } else if (node.type === "orchestrator") {
      sources.push({ nodeId: node.id, label: `${node.label || "Orquestrador"} — Orquestrador: ${orchestratorsById.get(node.config.orchestratorId)?.name ?? "não configurado"}` })
    }
  }
  return sources
}

/**
 * Nodes Human Review ANTERIORES a `fromNodeId` (por edges, mesmo critério de ancestralidade) —
 * alimenta o picker de "Gerente do revisor anterior" (Parte 4 do pedido): só pode se relacionar
 * com uma revisão que já aconteceu antes dela no fluxo, nunca uma solta ou posterior.
 */
export function resolveHumanReviewAncestors(graph: FlowGraph, fromNodeId: string): ContentSource[] {
  const ancestorIds = findAncestorNodeIds(graph, fromNodeId)
  const sources: ContentSource[] = []
  for (const nodeId of ancestorIds) {
    const node = findNode(graph, nodeId)
    if (node?.type === "human_review") sources.push({ nodeId: node.id, label: node.label || "Revisão humana" })
  }
  return sources
}

/**
 * Mesmas fontes de `resolveContentSources`, com uma entrada sintética a mais no topo pro valor
 * bruto do gatilho ("nodeOutputs.trigger" — reaproveita o node "trigger", que sempre existe e é
 * ancestral de tudo, sem precisar de nenhuma convenção de path nova). Usada só pelo seletor de
 * origem dinâmica da Action "Definir variável" (evolução de Variáveis do Workflow) — não altera
 * `resolveContentSources`, pra não arriscar nada nos 3 consumidores que já dependem dela hoje
 * (Condition/Output/Human Review).
 */
export function resolveDynamicValueSources(
  graph: FlowGraph,
  fromNodeId: string,
  agentsById: Map<string, Agent>,
  orchestratorsById: Map<string, Orchestrator>,
): ContentSource[] {
  return [{ nodeId: "trigger", label: "Valor do gatilho" }, ...resolveContentSources(graph, fromNodeId, agentsById, orchestratorsById)]
}

/** Tipo de campo de Structured Output → tipo de Workflow Variable compatível — `ARRAY` nunca tem
 * variável compatível (não existe WorkflowVariableType pra lista). Usado pra filtrar/validar a
 * origem dinâmica de uma variável (Parte 10 do pedido: impedir escolha incompatível, não só
 * alertar). O mapa inverso (variável → tipo de campo) já existe informalmente em 3 lugares do
 * código — este é só o sentido novo que faltava, não duplica os existentes. */
export function mapOutputFieldTypeToVariableType(type: OutputSchemaFieldType): WorkflowVariableType | undefined {
  if (type === "STRING") return "TEXT"
  if (type === "NUMBER") return "NUMERIC"
  if (type === "BOOLEAN") return "BOOLEAN"
  return undefined
}

/**
 * Campos tipados declarados (Structured Output) do orchestrator de origem, achatados e prontos
 * pra virar um Select "Diagnóstico › Severidade" — undefined quando o node não é um orchestrator
 * ou o orchestrador não tem `outputSchema` configurado (nesse caso o chamador cai de volta no
 * campo de texto livre legado, nunca bloqueia).
 */
export function resolveStructuredFields(
  graph: FlowGraph,
  nodeId: string,
  orchestratorsById: Map<string, Orchestrator>,
  policies?: PolicyResultCatalog,
): FlatOutputSchemaField[] | undefined {
  const node = findNode(graph, nodeId)
  if (node?.type === "intervention_policy") return interventionPolicyResultFields(policies?.get(node.config.policyId))
  if (node?.type !== "orchestrator") return undefined
  const orchestrator = orchestratorsById.get(node.config.orchestratorId)
  // Fonte única (071): o catálogo já vem achatado do backend (definição nova OU legado
  // convertido pelo mesmo dual-read do runtime). O achatamento local do formato legado fica só
  // como fallback de compatibilidade.
  if (orchestrator?.structuredOutputFields && orchestrator.structuredOutputFields.length > 0) return orchestrator.structuredOutputFields
  const schema = orchestrator?.outputSchema
  if (!schema) return undefined
  return flattenOutputSchema(schema)
}

/** Convenção de caminho compartilhada por `output.source` e `condition.sourcePath`:
 * "nodeOutputs.<nodeId>" ou, com um campo específico, "nodeOutputs.<nodeId>.<campo>". */
export function encodeSourcePath(nodeId: string, field: string): string {
  const trimmedField = field.trim()
  return trimmedField ? `nodeOutputs.${nodeId}.${trimmedField}` : `nodeOutputs.${nodeId}`
}

/** "variables.<variableId>" — mesma raiz do Execution Context (ver resolveContextValue no
 * backend), só que apontando pro objeto `variables` em vez de `nodeOutputs`. */
export function encodeVariableSourcePath(variableId: string): string {
  return `variables.${variableId}`
}

export type DecodedSourcePath = { kind: "node"; nodeId: string; field: string } | { kind: "variable"; variableId: string }

export function decodeSourcePath(path: string): DecodedSourcePath | null {
  // variableId vazio (ainda não escolheu) é um estado válido e intencional — é o que distingue
  // "modo Variável do Workflow, nada selecionado ainda" de "modo Resultado de um nó anterior,
  // nada selecionado ainda" (ver ConditionForm) sem precisar de um campo extra no config.
  if (path.startsWith("variables.")) return { kind: "variable", variableId: path.slice("variables.".length) }
  if (!path.startsWith("nodeOutputs.")) return null
  const rest = path.slice("nodeOutputs.".length)
  if (!rest) return null
  const dotIndex = rest.indexOf(".")
  if (dotIndex === -1) return { kind: "node", nodeId: rest, field: "" }
  return { kind: "node", nodeId: rest.slice(0, dotIndex), field: rest.slice(dotIndex + 1) }
}

const STRUCTURED_RESULT_PREFIX = "structuredResult."

export function encodeStructuredFieldPath(nodeId: string, fieldPath: string): string {
  return encodeSourcePath(nodeId, `${STRUCTURED_RESULT_PREFIX}${fieldPath}`)
}

/** Extrai o path relativo ("diagnosis.severity") de um `field` decodificado, só quando ele
 * aponta pra dentro de `structuredResult` — o que toda Condition sobre Structured Output usa. */
export function decodeStructuredFieldPath(field: string): string | null {
  return field.startsWith(STRUCTURED_RESULT_PREFIX) ? field.slice(STRUCTURED_RESULT_PREFIX.length) : null
}
