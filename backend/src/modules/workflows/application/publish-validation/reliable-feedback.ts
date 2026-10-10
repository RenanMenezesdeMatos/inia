import { DomainError } from "../../../../shared/domain/domain-error.js"
import { feedbackSourceTypeOf, findAncestorNodeIds, resolveFeedbackDomain, sourceOutputContractOf, isClosingDiagnosisSource, resolveNodeContexts, type FlowGraph, type FlowNode } from "../../domain/graph-schema.js"
import { triggerDataOriginOf } from "../../domain/trigger-config-schema.js"
import { CONVERSATIONAL_SURFACES, RELIABLE_FEEDBACK_SURFACES } from "../output-executor.js"
import type { PublishValidationRow } from "./context.js"

// Feedback confiável ("Gerar feedback" e o Output que o publica). Espelho no editor: workflow-validation/reliable-feedback.ts.

// ---------------------------------------------------------------------------------------------
// V1.5.12 — WORKFLOW-CENTRIC RELIABLE FEEDBACK
// ---------------------------------------------------------------------------------------------

const NODE_OUTPUT_PATH = /^nodeOutputs\.([^.]+)(\..+)?$/

/** Nó cujo resultado um caminho `nodeOutputs.<id>[.campo]` referencia (+ se aponta para a RAIZ do resultado). */
function sourceNodeOfPath(graph: FlowGraph, path: string | undefined): { node: FlowNode; root: boolean } | null {
  const match = path ? NODE_OUTPUT_PATH.exec(path) : null
  const node = match ? graph.nodes.find((candidate) => candidate.id === match[1]) : undefined
  return node ? { node, root: !match![2] } : null
}

function requireBranchEdge(graph: FlowGraph, node: FlowNode, handle: string) {
  if (!graph.edges.some((edge) => edge.source === node.id && edge.sourceHandle === handle)) {
    throw new DomainError(`O nó "${node.label}" não está ligado ao próximo passo. Conecte a saída dele antes de publicar.`, "WORKFLOW_MISSING_BRANCH_EDGE", 422, { nodeId: node.id })
  }
}

/**
 * Regras de PUBLICAÇÃO do feedback oficial (V1.5.12) — nunca deixadas para o runtime:
 *   - "Gerar feedback" exige uma origem EXPLÍCITA que é "Chamar agente" (caminho individual)
 *     ou "Orquestrador", ANCESTRAL do nó, um domínio resolvível e compatível com o gatilho (monitoria = interação do gatilho
 *     por Flag; indicador = medição do gatilho por Indicador + Chamar agente — Indicador + Orquestrador não é suportado na
 *     V1: o nó não recebe o contexto canônico do indicador), a saída ligada e ao menos um Output que o consuma;
 *   - o Output que publica o artefato lê a RAIZ do resultado, vem depois dele e só usa superfícies com consumidor real
 *     (Acompanhamento, Notificação);
 *   - feedback OFICIAL (gatilho por Flag ou por Indicador) nunca vai do Agent/Orquestrador direto para o Acompanhamento do
 *     próprio operador — precisa passar por "Gerar feedback". Versões já publicadas não mudam (só nova publicação).
 */
export function validateReliableFeedbackFlow(graph: FlowGraph, trigger: PublishValidationRow["triggerConfig"], consolidated: boolean): void {
  const contexts = resolveNodeContexts(graph)
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "GENERATE_FEEDBACK") continue
    const config = node.config
    const detail = { nodeId: node.id }
    // Motor de feedback: sempre disponível (não depende do módulo de QA de feedback nem de aprovação humana).
    const source = graph.nodes.find((candidate) => candidate.id === config.sourceNodeId)
    if (!source) throw new DomainError(`O nó "${node.label}" precisa de uma origem: escolha o "Chamar agente" ou "Orquestrador" cujo resultado vira feedback.`, "WORKFLOW_FEEDBACK_SOURCE_NOT_FOUND", 422, detail)
    const sourceType = feedbackSourceTypeOf(source)
    if (!sourceType || (source.type === "action" && contexts.get(source.id) === "CONSOLIDATED_RESULT")) {
      throw new DomainError(`A origem de "${node.label}" ("${source.label}") não é um "Chamar agente" ou "Orquestrador" que analisa um colaborador.`, "WORKFLOW_FEEDBACK_SOURCE_INCOMPATIBLE", 422, detail)
    }
    if (!findAncestorNodeIds(graph, node.id).has(source.id)) {
      throw new DomainError(`A origem de "${node.label}" ("${source.label}") precisa vir ANTES dele no fluxo.`, "WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR", 422, detail)
    }
    const triggerKind = triggerDataOriginOf(trigger)
    const sourceContract = sourceOutputContractOf(source)
    // Diagnóstico a partir do FECHAMENTO OFICIAL: o do PRV (V1) ou o direto de um indicador (V2) — nenhum exige a medição do gatilho.
    const prvClosing = isClosingDiagnosisSource(source)
    const domain = resolveFeedbackDomain(config.feedbackDomain, consolidated ? "schedule" : triggerKind, sourceType, sourceContract)
    if (!domain) {
      throw new DomainError(`Não dá para saber se "${node.label}" é feedback de monitoria ou de indicador com este gatilho e esta origem. Escolha o tipo explicitamente (monitoria exige gatilho por Flag ou Manual com interação; indicador, gatilho por Indicador ou Manual com medição).`, "WORKFLOW_FEEDBACK_DOMAIN_AMBIGUOUS", 422, detail)
    }
    if (domain === "MONITORING" && (triggerKind !== "channel_flag" || consolidated)) {
      throw new DomainError(`"${node.label}" é feedback de monitoria, que precisa da interação do gatilho por Flag de canal ou Manual com interação (modo Individual).`, "WORKFLOW_FEEDBACK_MONITORING_REQUIRES_INTERACTION", 422, detail)
    }
    if (domain === "INDICATOR" && sourceType === "ORCHESTRATOR") {
      throw new DomainError(`"${node.label}" é feedback de indicador a partir de um Orquestrador — ainda não suportado: o Orquestrador não recebe o contexto canônico do indicador. Use "Chamar agente" como origem.`, "WORKFLOW_FEEDBACK_INDICATOR_ORCHESTRATOR_UNSUPPORTED", 422, detail)
    }
    if (domain === "INDICATOR" && prvClosing && (triggerKind !== "schedule" || consolidated)) {
      throw new DomainError(`"${node.label}" é feedback do fechamento do PRV, que precisa do gatilho por Agenda no modo Individual (um colaborador por execução).`, "WORKFLOW_PRV_DIAGNOSIS_REQUIRES_SCHEDULE", 422, detail)
    }
    if (domain === "INDICATOR" && !prvClosing && (triggerKind !== "indicator" || consolidated)) {
      throw new DomainError(`"${node.label}" é feedback de indicador, que precisa do dado canônico de uma medição — só existe com gatilho por Indicador ou Manual com medição (modo Individual).`, "WORKFLOW_FEEDBACK_INDICATOR_REQUIRES_CANONICAL_CONTEXT", 422, detail)
    }
    requireBranchEdge(graph, node, "always")
    const consumed = graph.nodes.some((candidate) => candidate.type === "output" && sourceNodeOfPath(graph, candidate.config.source)?.node.id === node.id)
    if (!consumed) throw new DomainError(`O feedback de "${node.label}" não é entregue a ninguém. Adicione um Output com ele como conteúdo.`, "WORKFLOW_FEEDBACK_WITHOUT_OUTPUT", 422, detail)
  }

  const officialTrigger = !consolidated && triggerDataOriginOf(trigger) !== "schedule"
  for (const node of graph.nodes) {
    if (node.type !== "output") continue
    const detail = { nodeId: node.id }
    const source = sourceNodeOfPath(graph, node.config.source)
    if (!source) continue
    const sourceAction = source.node.type === "action" ? source.node.config.actionType : null
    if (sourceAction === "GENERATE_FEEDBACK") {
      if (!source.root) throw new DomainError(`O Output "${node.label}" precisa publicar o feedback inteiro de "${source.node.label}", não um campo dele.`, "WORKFLOW_OUTPUT_FEEDBACK_SOURCE_INVALID", 422, detail)
      if (!findAncestorNodeIds(graph, node.id).has(source.node.id)) throw new DomainError(`O Output "${node.label}" precisa vir depois de "${source.node.label}".`, "WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR", 422, detail)
      const unsupported = node.config.surfaces.filter((surface) => !RELIABLE_FEEDBACK_SURFACES.includes(surface))
      if (unsupported.length > 0) throw new DomainError(`O Output "${node.label}" usa superfície(s) que ainda não têm consumidor real (${unsupported.join(", ")}). Para feedback, use Acompanhamento, Notificação, Chat ou Avatar.`, "WORKFLOW_OUTPUT_SURFACE_UNSUPPORTED", 422, detail)
      // Workflow Outputs V1 — o feedback confiável pertence ao colaborador analisado: Chat/Avatar só para "O próprio operador".
      if (node.config.surfaces.some((surface) => CONVERSATIONAL_SURFACES.includes(surface)) && node.config.target.type !== "CURRENT_OPERATOR") {
        throw new DomainError(`O Output "${node.label}" entrega o feedback de "${source.node.label}" no Chat/Avatar de outra pessoa. O feedback é do colaborador analisado: use "O próprio operador" (para a gestão, use Acompanhamento ou Notificação).`, "WORKFLOW_OUTPUT_CONVERSATIONAL_TARGET_INVALID", 422, detail)
      }
      requireBranchEdge(graph, node, "always")
      continue
    }
    if (sourceAction === "GENERATE_INTERACTION_FEEDBACK") {
      throw new DomainError(`O Output "${node.label}" não publica o resultado do feedback direto de atendimento (legado): ele é entregue pelo próprio módulo. Use "Gerar feedback" a partir de um Agent/Orquestrador.`, "WORKFLOW_OUTPUT_FEEDBACK_SOURCE_INVALID", 422, detail)
    }
    const investigative = feedbackSourceTypeOf(source.node) !== null && contexts.get(source.node.id) !== "CONSOLIDATED_RESULT"
    if (officialTrigger && investigative && node.config.target.type === "CURRENT_OPERATOR" && node.config.surfaces.some((surface) => surface === "FOLLOW_UP" || CONVERSATIONAL_SURFACES.includes(surface))) {
      throw new DomainError(
        `O Output "${node.label}" publicaria o resultado de "${source.node.label}" direto ${node.config.surfaces.includes("FOLLOW_UP") ? "no Acompanhamento" : "no Chat/Avatar"} do operador. Feedback oficial de monitoria/indicador passa obrigatoriamente pela camada de confiabilidade: adicione "Gerar feedback" depois de "${source.node.label}" e use-o como conteúdo do Output.`,
        "WORKFLOW_FEEDBACK_REQUIRES_RELIABILITY",
        422,
        detail,
      )
    }
  }
}
