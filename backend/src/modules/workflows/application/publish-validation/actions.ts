import { resolveAgentSpecialty } from "../../../agents/domain/agent-specialty.js"
import { scopesAreCompatible } from "../../../auth/application/manageable-scopes.js"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import type { FlatOutputSchemaField } from "../../../assistant/domain/output-schema-fields.js"
import { findStructuredOutputField } from "../../../assistant/domain/structured-output-definition.js"
import { VARIABLE_TYPE_CHECKERS } from "../action-executors.js"
import { findAncestorNodeIds, resolveNodeContexts, type FlowGraph } from "../../domain/graph-schema.js"
import type { PublishCatalogContext, PublishGraphContext } from "./context.js"
import { parseSourcePath } from "./source-paths.js"

// Família AÇÕES E AGENTES: "Chamar agente" sem destino e referências de Agent; "Definir variável" (valor fixo/dinâmico,
// ciclos). Espelho no editor: workflow-validation/actions.ts.

// Tipo de campo de Structured Output → tipo de Workflow Variable compatível — ARRAY nunca tem
// variável compatível (não existe WorkflowVariableType pra lista). Mapa próprio (não o mesmo de
// validateTypedCondition, que mapeia o sentido inverso pra fins de comparador).
const OUTPUT_FIELD_TYPE_TO_VARIABLE_TYPE: Record<"STRING" | "NUMBER" | "BOOLEAN" | "ARRAY", string | undefined> = {
  STRING: "TEXT",
  NUMBER: "NUMERIC",
  BOOLEAN: "BOOLEAN",
  ARRAY: undefined,
}

/**
 * Valida a origem dinâmica de uma Action "Definir variável" (evolução de Variáveis do Workflow) —
 * mesmo espírito de `validateSourcePathRule`, mas validando contra o TIPO DA VARIÁVEL de destino
 * (atribuição), não contra um comparador. "trigger" é sempre uma origem válida (raiz do grafo).
 */
function validateDynamicVariableSource(
  label: string,
  variableType: string,
  sourcePath: string,
  actionNodeId: string,
  graph: FlowGraph,
  variablesById: Map<string, string>,
  orchestratorSchemasById: Map<string, FlatOutputSchemaField[] | null>,
): void {
  const parsed = parseSourcePath(sourcePath)
  if (!parsed) {
    throw new DomainError(`A ação "${label}" tem uma origem dinâmica inválida.`, "WORKFLOW_INVALID_ACTION", 422)
  }

  if (parsed.kind === "variable") {
    const originType = variablesById.get(parsed.variableId)
    if (!originType) {
      throw new DomainError(`A ação "${label}" referencia uma variável de origem que não existe mais neste workflow.`, "WORKFLOW_INVALID_ACTION", 422)
    }
    if (originType !== variableType) {
      throw new DomainError(`A ação "${label}" tenta atribuir o valor de uma variável de outro tipo — os tipos precisam ser exatamente iguais.`, "WORKFLOW_INVALID_ACTION", 422)
    }
    return
  }

  if (parsed.nodeId === "trigger") return // raiz do grafo — sempre um ancestral válido

  const sourceNode = graph.nodes.find((candidate) => candidate.id === parsed.nodeId)
  if (!sourceNode) {
    throw new DomainError(`A ação "${label}" referencia um resultado que não existe mais neste workflow.`, "WORKFLOW_INVALID_ACTION", 422)
  }
  if (!findAncestorNodeIds(graph, actionNodeId).has(parsed.nodeId)) {
    throw new DomainError(`A ação "${label}" só pode usar o resultado de um nó que vem ANTES dela no fluxo.`, "WORKFLOW_INVALID_ACTION", 422)
  }
  if (parsed.field.startsWith("structuredResult.")) {
    const schema = sourceNode.type === "orchestrator" ? orchestratorSchemasById.get(sourceNode.config.orchestratorId) : undefined
    const fieldPath = parsed.field.slice("structuredResult.".length)
    const field = findStructuredOutputField(schema, fieldPath)
    // Schema desconhecido: não dá pra checar estaticamente — libera (mesmo princípio já usado no
    // resto do arquivo), o checker de runtime (VARIABLE_TYPE_CHECKERS) continua como rede final.
    if (schema && !field) {
      throw new DomainError(`A ação "${label}" usa o campo "${fieldPath}", que não existe mais no resultado estruturado do Orquestrador.`, "WORKFLOW_STRUCTURED_FIELD_NOT_FOUND", 422)
    }
    if (field && OUTPUT_FIELD_TYPE_TO_VARIABLE_TYPE[field.type] !== variableType) {
      throw new DomainError(`A ação "${label}" tenta atribuir um valor de tipo incompatível com a variável.`, "WORKFLOW_INVALID_ACTION", 422)
    }
  }
}

/**
 * Nunca permite uma variável depender (direta ou indiretamente) de si mesma através de Actions
 * "Definir variável" com origem dinâmica de outra variável (Parte 12 do pedido) — monta um grafo
 * pequeno de dependências (variável de origem → variável de destino) e roda DFS com detecção de
 * ciclo; auto-referência já é pega como o caso trivial de ciclo de tamanho 1.
 */
function validateNoVariableCycles(graph: FlowGraph, variableNamesById: Map<string, string>): void {
  const dependsOn = new Map<string, Set<string>>()
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "SET_VARIABLE" || !node.config.sourcePath) continue
    const parsed = parseSourcePath(node.config.sourcePath)
    if (parsed?.kind !== "variable") continue
    const dependents = dependsOn.get(parsed.variableId) ?? new Set<string>()
    dependents.add(node.config.variableId)
    dependsOn.set(parsed.variableId, dependents)
  }

  const state = new Map<string, "visiting" | "done">()
  const path: string[] = []

  function visit(variableId: string): void {
    const current = state.get(variableId)
    if (current === "done") return
    if (current === "visiting") {
      const cycleNames = [...path.slice(path.indexOf(variableId)), variableId].map((id) => variableNamesById.get(id) ?? id)
      throw new DomainError(`Ciclo entre variáveis: ${cycleNames.join(" → ")}. Uma variável nunca pode depender dela mesma, mesmo indiretamente.`, "WORKFLOW_VARIABLE_CYCLE", 422)
    }
    state.set(variableId, "visiting")
    path.push(variableId)
    for (const dependent of dependsOn.get(variableId) ?? []) visit(dependent)
    path.pop()
    state.set(variableId, "done")
  }

  for (const variableId of dependsOn.keys()) visit(variableId)
}

/** "Chamar agente" exige um Output (ou um Escalonar com conteúdo) para o resultado chegar a alguém. */
export function validateAgentHasOutput(context: PublishGraphContext): void {
  const { graph } = context
  // Validação completa da Action Escalonar (Target/Conteúdo/Surface) mais abaixo, junto das
  // validações de Human Review/Output que ela reaproveita.
  // O Workflow nunca publica sozinho — CALL_AGENT só devolve dados pro Execution Context (ver
  // run-agent.ts/action-executors.ts). Se o grafo chama um agente, precisa de pelo menos um
  // node Output OU um Escalonar com conteúdo selecionado (contentSource) em algum lugar, senão
  // o resultado do agente nunca chegaria a lugar nenhum — Escalonar reaproveita exatamente o
  // mesmo mecanismo de entrega do Output, então também conta como publicação válida.
  const hasCallAgent = graph.nodes.some((node) => node.type === "action" && node.config.actionType === "CALL_AGENT")
  const hasOutput = graph.nodes.some((node) => node.type === "output")
  const hasEscalateWithContent = graph.nodes.some(
    (node) => node.type === "action" && node.config.actionType === "ESCALATE" && Boolean(node.config.contentSource),
  )
  if (hasCallAgent && !hasOutput && !hasEscalateWithContent) {
    throw new DomainError(
      "O workflow chama um agente mas não tem nenhum nó Output — o resultado do agente nunca seria publicado. Adicione um nó Output.",
      "WORKFLOW_MISSING_OUTPUT",
      422,
    )
  }
}

/** "Definir variável": variável existente, valor fixo ou origem dinâmica compatível e nenhum ciclo entre variáveis. */
export function validateVariables(context: PublishCatalogContext): void {
  const { graph, variablesById, variableNamesById, orchestratorSchemasById } = context
  // Action "Definir variável" — valor fixo ou dinâmico (evolução de Variáveis do Workflow).
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "SET_VARIABLE") continue
    const variableType = variablesById.get(node.config.variableId)
    if (!variableType) {
      throw new DomainError(`A ação "${node.label}" referencia uma variável que não existe mais neste workflow.`, "WORKFLOW_INVALID_ACTION", 422)
    }
    if (node.config.sourcePath) {
      validateDynamicVariableSource(node.label, variableType, node.config.sourcePath, node.id, graph, variablesById, orchestratorSchemasById)
      continue
    }
    if (node.config.value === undefined) {
      throw new DomainError(`A ação "${node.label}" precisa de um valor fixo ou de uma origem dinâmica.`, "WORKFLOW_INVALID_ACTION", 422)
    }
    if (!VARIABLE_TYPE_CHECKERS[variableType]?.(node.config.value)) {
      throw new DomainError(`A ação "${node.label}" define um valor incompatível com o tipo da variável.`, "WORKFLOW_INVALID_ACTION", 422)
    }
  }
  validateNoVariableCycles(graph, variableNamesById)
}

/** Agent de cada "Chamar agente": existe, ativo, compatível com o ponto do fluxo (síntese só pós-JOIN) e não é coordenador. */
export async function validateAgentReferences(context: PublishGraphContext): Promise<void> {
  const { db, organizationId, graph, row } = context
  // Referências (Agent/Orquestrador) por último: só depois de tudo o que é estrutural/de contexto
  // passar — um rascunho com dois problemas recebe primeiro o problema de topologia/contexto (o
  // que a UI já sinaliza), nunca "agente inativo" mascarando um grafo mal formado.
  // Referência de Agent (Chamar agente): agente excluído/inativo/de outra organização só falhava
  // em runtime (run-agent.ts, AGENT_NOT_FOUND/AGENT_INACTIVE) — mesmo hardening feito acima pro
  // Orquestrador. Um tipo ORCHESTRATOR (agente-coordenador de um Orquestrador) nunca é chamado
  // direto por um Workflow: ele não analisa nada sozinho, só coordena especialistas.
  const agentIds = [...new Set(graph.nodes.flatMap((node) => (node.type === "action" && node.config.actionType === "CALL_AGENT" ? [node.config.agentId] : [])))]
  if (agentIds.length > 0) {
    const agentRows = await db.query<{ id: string; name: string; active: boolean; agent_type: string; specialty: string | null; specialty_kind: string | null; domain: string | null; consolidated_input: boolean | null; scope_type?: string | null; team_id?: string | null; subteam_id?: string | null }>(
      `select id, name, active, agent_type, specialty, specialty_kind, domain, consolidated_input, scope_type, team_id, subteam_id from agents where id = any($1::uuid[]) and organization_id = $2`,
      [agentIds, organizationId],
    )
    const agentContexts = resolveNodeContexts(graph)
    for (const node of graph.nodes) {
      if (node.type !== "action") continue
      const config = node.config
      if (config.actionType !== "CALL_AGENT") continue
      const found = agentRows.rows.find((candidate) => candidate.id === config.agentId)
      if (!found) throw new DomainError(`O nó "${node.label}" referencia um agente que não existe mais.`, "WORKFLOW_AGENT_NOT_FOUND", 422, { nodeId: node.id })
      if (found.active === false) throw new DomainError(`O nó "${node.label}" usa o agente "${found.name}", que está inativo.`, "WORKFLOW_AGENT_INACTIVE", 422, { nodeId: node.id })
      // Mesma regra do Orquestrador (achado A-F08): um Agent exclusivo de outro Grupo — com o prompt, as bases e as Tools de
      // investigação dele — nunca roda para gente de fora do Grupo dele. Revalidado a cada publicação.
      if (found.scope_type && !(await scopesAreCompatible(db, row, { scopeType: found.scope_type, teamId: found.team_id ?? null, subteamId: found.subteam_id ?? null }))) {
        throw new DomainError(`O agente "${found.name}" não está disponível para o grupo deste workflow.`, "WORKFLOW_AGENT_SCOPE_FORBIDDEN", 422, { nodeId: node.id })
      }
      // Pós-JOIN só com Agent que aceita o resultado consolidado (síntese); um Agent de síntese
      // fora do pós-JOIN não tem o que sintetizar (evolução 2026-09-16, synthesis-agent-executor.ts).
      const specialty = resolveAgentSpecialty(found)
      const afterJoin = agentContexts.get(node.id) === "CONSOLIDATED_RESULT"
      if (afterJoin && !specialty.acceptsConsolidated) {
        throw new DomainError(
          `O nó "${node.label}" chama "${found.name}" depois de "Consolidar resultados", mas esse agente analisa um colaborador por vez — escolha um Agent de síntese (ou marque o agente como "aceita resultado consolidado").`,
          "WORKFLOW_AGENT_NOT_CONSOLIDATED",
          422,
          { nodeId: node.id },
        )
      }
      if (!afterJoin && specialty.kind === "SYNTHESIS") {
        throw new DomainError(
          `O nó "${node.label}" chama "${found.name}", que é um Agent de síntese — ele só roda depois de "Consolidar resultados".`,
          "WORKFLOW_AGENT_SYNTHESIS_REQUIRES_JOIN",
          422,
          { nodeId: node.id },
        )
      }
      if (found.agent_type === "ORCHESTRATOR") {
        throw new DomainError(
          `O nó "${node.label}" chama "${found.name}", que é o agente-coordenador de um Orquestrador — use o nó Orquestrador, ou escolha um agente especialista.`,
          "WORKFLOW_AGENT_INVALID_TYPE",
          422,
          { nodeId: node.id },
        )
      }
    }
  }
}
