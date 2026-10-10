import { CONVERSATIONAL_OUTPUT_SURFACES, RELIABLE_FEEDBACK_SURFACES, feedbackSourceTypeOf, findAncestorNodeIds, resolveFeedbackDomain, sourceOutputContractOf, isClosingDiagnosisSource, resolveNodeContexts, type FlowGraph, type FlowNode } from "../workflow-graph.schema"
import { triggerDataOrigin, type WorkflowTrigger } from "../workflow.schema"
import type { ValidationIssue } from "./types"

// Feedback confiável ("Gerar feedback" e o Output que o publica). Espelho do backend: workflows/application/publish-validation/reliable-feedback.ts.

// ---------------------------------------------------------------------------------------------
// V1.5.12 — WORKFLOW-CENTRIC RELIABLE FEEDBACK (espelho de validateReliableFeedbackFlow no backend)
// ---------------------------------------------------------------------------------------------

const NODE_OUTPUT_PATH = /^nodeOutputs\.([^.]+)(\..+)?$/

function sourceNodeOfPath(graph: FlowGraph, path: string | undefined): { node: FlowNode; root: boolean } | null {
  const match = path ? NODE_OUTPUT_PATH.exec(path) : null
  const node = match ? graph.nodes.find((candidate) => candidate.id === match[1]) : undefined
  return node ? { node, root: !match![2] } : null
}

const hasBranchEdge = (graph: FlowGraph, nodeId: string, handle: string) => graph.edges.some((edge) => edge.source === nodeId && edge.sourceHandle === handle)

/**
 * Feedback oficial (V1.5.12): "Gerar feedback" com origem explícita e ancestral ("Chamar agente" no caminho individual ou
 * "Orquestrador"), domínio resolvível e compatível com o gatilho, saída ligada e um Output que o consuma; Output do artefato
 * só por Acompanhamento/Notificação; Agent/Orquestrador nunca direto para o Acompanhamento do operador com gatilho por
 * Flag/Indicador. Módulo desligado é checado pelo dry-run do backend.
 */
export function validateReliableFeedbackFlow(graph: FlowGraph, trigger: WorkflowTrigger, isConsolidatedMode: boolean): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const contexts = resolveNodeContexts(graph)
  for (const node of graph.nodes) {
    if (node.type !== "action" || node.config.actionType !== "GENERATE_FEEDBACK") continue
    const config = node.config
    const source = graph.nodes.find((candidate) => candidate.id === config.sourceNodeId)
    if (!source) {
      issues.push({ nodeId: node.id, code: config.sourceNodeId ? "WORKFLOW_FEEDBACK_SOURCE_NOT_FOUND" : "VALIDATION_ERROR", message: `Escolha a origem de "${node.label}": o "Chamar agente" ou "Orquestrador" cujo resultado vira feedback.` })
      continue
    }
    const sourceType = feedbackSourceTypeOf(source)
    if (!sourceType || (source.type === "action" && contexts.get(source.id) === "CONSOLIDATED_RESULT")) {
      issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_SOURCE_INCOMPATIBLE", message: `A origem de "${node.label}" precisa ser um "Chamar agente" ou "Orquestrador" que analisa um colaborador.` })
      continue
    }
    if (!findAncestorNodeIds(graph, node.id).has(source.id)) issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR", message: `A origem de "${node.label}" precisa vir ANTES dele no fluxo.` })
    const prvClosing = isClosingDiagnosisSource(source)
    const origin = triggerDataOrigin(trigger)
    const domain = resolveFeedbackDomain(config.feedbackDomain, isConsolidatedMode ? "schedule" : origin, sourceType, sourceOutputContractOf(source))
    if (!domain) issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_DOMAIN_AMBIGUOUS", message: `Não dá para saber se "${node.label}" é feedback de monitoria ou de indicador com este gatilho e esta origem — escolha o tipo.` })
    else if (domain === "MONITORING" && (origin !== "channel_flag" || isConsolidatedMode)) issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_MONITORING_REQUIRES_INTERACTION", message: `Feedback de monitoria precisa da interação do gatilho por Flag de canal ou Manual com interação (modo Individual).` })
    else if (domain === "INDICATOR" && sourceType === "ORCHESTRATOR") issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_INDICATOR_ORCHESTRATOR_UNSUPPORTED", message: `Feedback de indicador a partir de um Orquestrador ainda não é suportado — use "Chamar agente" como origem.` })
    else if (domain === "INDICATOR" && prvClosing && (origin !== "schedule" || isConsolidatedMode)) issues.push({ nodeId: node.id, code: "WORKFLOW_PRV_DIAGNOSIS_REQUIRES_SCHEDULE", message: `Feedback do fechamento do PRV precisa do gatilho por Agenda no modo Individual (um colaborador por execução).` })
    else if (domain === "INDICATOR" && !prvClosing && (origin !== "indicator" || isConsolidatedMode)) issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_INDICATOR_REQUIRES_CANONICAL_CONTEXT", message: `Feedback de indicador precisa do dado oficial de uma medição — só existe com gatilho por Indicador ou Manual com medição (modo Individual).` })
    if (!hasBranchEdge(graph, node.id, "always")) issues.push({ nodeId: node.id, code: "WORKFLOW_MISSING_BRANCH_EDGE", message: `Conecte a saída de "${node.label}" ao próximo passo.` })
    if (!graph.nodes.some((candidate) => candidate.type === "output" && sourceNodeOfPath(graph, candidate.config.source)?.node.id === node.id)) {
      issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_WITHOUT_OUTPUT", message: `O feedback de "${node.label}" não é entregue a ninguém — adicione um Output com ele como conteúdo.` })
    }
  }
  const officialTrigger = !isConsolidatedMode && triggerDataOrigin(trigger) !== "schedule"
  for (const node of graph.nodes) {
    if (node.type !== "output") continue
    const source = sourceNodeOfPath(graph, node.config.source)
    if (!source) continue
    if (source.node.type === "action" && source.node.config.actionType === "GENERATE_FEEDBACK") {
      if (!source.root) issues.push({ nodeId: node.id, code: "WORKFLOW_OUTPUT_FEEDBACK_SOURCE_INVALID", message: `O Output "${node.label}" precisa publicar o feedback inteiro, não um campo dele.` })
      if (!findAncestorNodeIds(graph, node.id).has(source.node.id)) issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_SOURCE_NOT_ANCESTOR", message: `O Output "${node.label}" precisa vir depois de "${source.node.label}".` })
      const unsupported = node.config.surfaces.filter((surface) => !RELIABLE_FEEDBACK_SURFACES.includes(surface))
      if (unsupported.length > 0) issues.push({ nodeId: node.id, code: "WORKFLOW_OUTPUT_SURFACE_UNSUPPORTED", message: `Feedback confiável só sai por Acompanhamento, Notificação, Chat ou Avatar — Pendências ainda não tem consumidor real.` })
      // Workflow Outputs V1 — espelho de WORKFLOW_OUTPUT_CONVERSATIONAL_TARGET_INVALID: o feedback é do colaborador analisado.
      if (node.config.surfaces.some((surface) => CONVERSATIONAL_OUTPUT_SURFACES.includes(surface)) && node.config.target.type !== "CURRENT_OPERATOR") {
        issues.push({ nodeId: node.id, code: "WORKFLOW_OUTPUT_CONVERSATIONAL_TARGET_INVALID", message: `O feedback é do colaborador analisado: no Chat/Avatar ele só pode ir para "O próprio operador" (para a gestão, use Acompanhamento ou Notificação).` })
      }
      if (!hasBranchEdge(graph, node.id, "always")) issues.push({ nodeId: node.id, code: "WORKFLOW_MISSING_BRANCH_EDGE", message: `Conecte a saída de "${node.label}" ao próximo passo.` })
      continue
    }
    if (source.node.type === "action" && source.node.config.actionType === "GENERATE_INTERACTION_FEEDBACK") {
      issues.push({ nodeId: node.id, code: "WORKFLOW_OUTPUT_FEEDBACK_SOURCE_INVALID", message: `O Output "${node.label}" não publica o feedback direto de atendimento (legado) — use "Gerar feedback" a partir de um Agent/Orquestrador.` })
      continue
    }
    const investigative = feedbackSourceTypeOf(source.node) !== null && contexts.get(source.node.id) !== "CONSOLIDATED_RESULT"
    if (officialTrigger && investigative && node.config.target.type === "CURRENT_OPERATOR" && node.config.surfaces.some((surface) => surface === "FOLLOW_UP" || CONVERSATIONAL_OUTPUT_SURFACES.includes(surface))) {
      issues.push({ nodeId: node.id, code: "WORKFLOW_FEEDBACK_REQUIRES_RELIABILITY", message: `Feedback oficial não vai do "${source.node.label}" direto para ${node.config.surfaces.includes("FOLLOW_UP") ? "o Acompanhamento" : "o Chat/Avatar"}: adicione "Gerar feedback" depois dele e use-o como conteúdo deste Output.` })
    }
  }
  return issues
}
