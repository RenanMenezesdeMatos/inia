import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import type { WorkflowEnrollmentEvent } from "@/schemas/admin/workflow.schema"

import { nodeDisplayName } from "../node-visuals"

/** Referência curta e estável a uma execução — a mesma que aparece no detalhe de cada uma, para ligar original ↔ tentativas. */
export function shortExecutionId(id: string): string {
  return `#${id.slice(0, 8)}`
}

/** Rótulo do nó na versão publicada; o id fica de reserva quando o nó não existe mais nela. */
export function nodeLabelOf(graph: FlowGraph | null, nodeId: string | null | undefined): string | null {
  if (!nodeId) return null
  return graph?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId
}

/** O que aconteceu em cada evento da execução, em linguagem de tela — o mesmo texto no "Executar agora" e na aba Execuções. */
const ENROLLMENT_EVENT_LABELS: Record<string, string> = {
  manual_run_requested: "Execução manual solicitada",
  node_advanced: "Etapa concluída",
  action_executed: "Ação executada",
  condition_evaluated: "Condição avaliada",
  intervention_policy_evaluated: "Política de acompanhamento avaliada",
  orchestrator_executed: "Orquestrador executado",
  output_dispatched: "Saída entregue",
  human_review_requested: "Revisão humana solicitada",
  human_review_decided: "Revisão humana decidida",
  reliable_feedback_held_for_qa: "Feedback retido para o QA",
  wait_started: "Espera iniciada",
  wait_elapsed: "Espera encerrada",
  node_failed: "Falha nesta tentativa",
  flow_dead: "Execução encerrada com falha",
  flow_completed: "Execução concluída",
  node_blocked: "Bloqueada",
  retry_requested: "Nova tentativa solicitada",
  retry_started: "Nova tentativa iniciada",
  output_already_delivered: "Entrega já feita — não repetida",
}

export function enrollmentEventLabel(eventType: string): string {
  return ENROLLMENT_EVENT_LABELS[eventType] ?? "Evento registrado"
}

/** Nome da etapa na lista de execuções: nunca o id técnico. A etapa pode ter saído do fluxo numa versão posterior. */
export function stepNameOf(graph: FlowGraph | null, nodeId: string | null | undefined): string {
  const node = nodeId ? graph?.nodes.find((candidate) => candidate.id === nodeId) : undefined
  return node ? nodeDisplayName(node) : "Etapa de outra versão do fluxo"
}

export function agentVersionText(versionNumber: number | null | undefined): string {
  return typeof versionNumber === "number" ? `versão ${versionNumber}` : "versão não identificada"
}

/** Versão VIGENTE de um agente na prévia da nova tentativa — sem versão = o agente nunca foi publicado. */
export function vigenteVersionText(versionNumber: number | null | undefined): string {
  return typeof versionNumber === "number" ? `versão ${versionNumber} (vigente)` : "sem versão publicada"
}

/** Motivo do bloqueio (`blockedReason` / `payload.reason`). Ausente = execução antiga, de quando só havia agente inativo. */
export type BlockReason = "AGENT_INACTIVE" | "AGENT_ACCESS_NOT_AUTHORIZED" | "HUMAN_REVIEW_NO_REVIEWER" | "HUMAN_REVIEW_CONTENT_MISSING" | "TRIGGERING_RECORD_CANCELLED" | "UNKNOWN"
const KNOWN_BLOCK_REASONS: readonly unknown[] = ["AGENT_INACTIVE", "AGENT_ACCESS_NOT_AUTHORIZED", "HUMAN_REVIEW_NO_REVIEWER", "HUMAN_REVIEW_CONTENT_MISSING", "TRIGGERING_RECORD_CANCELLED"]
export const blockReasonOf = (value: unknown): BlockReason => {
  if (value === null || value === undefined) return "AGENT_INACTIVE"
  return KNOWN_BLOCK_REASONS.includes(value) ? (value as BlockReason) : "UNKNOWN"
}

/** O que fazer em cada motivo — a mesma orientação na linha, no cartão e no evento. */
export const BLOCKED_GUIDANCE: Record<BlockReason, string> = {
  AGENT_INACTIVE: "Reative ou substitua o agente e solicite uma nova tentativa.",
  AGENT_ACCESS_NOT_AUTHORIZED: "Ajuste o agente (alcance ou bases da versão vigente) ou substitua-o e solicite uma nova tentativa.",
  HUMAN_REVIEW_NO_REVIEWER: "Ajuste a hierarquia ou o revisor da etapa e solicite uma nova tentativa.",
  HUMAN_REVIEW_CONTENT_MISSING: "Corrija a origem do conteúdo, publique e solicite uma nova tentativa.",
  TRIGGERING_RECORD_CANCELLED: "Reative o lote na Central de Dados ou envie uma carga nova e solicite uma nova tentativa.",
  UNKNOWN: "Confira os eventos desta execução e solicite uma nova tentativa.",
}

/** Por que a Revisão humana parou (`blockedDetails.cause`), em linguagem de tela e sem citar pessoa. */
const REVIEW_BLOCK_TEXT: Record<string, string> = {
  NO_ONE_IN_CHAIN: "este colaborador não tem o cargo pedido na hierarquia",
  REVIEWER_INACTIVE: "a pessoa indicada para revisar está inativa",
  PREVIOUS_REVIEW_NOT_DECIDED: "a revisão anterior, de onde sai o revisor, não foi decidida neste caminho",
  ONLY_THE_COLLABORATOR: "o único revisor possível é o próprio colaborador",
  SOURCE_NOT_AVAILABLE: "o conteúdo a revisar não está disponível: a etapa de origem não rodou neste caminho",
  VARIABLE_WITHOUT_VALUE: "o conteúdo a revisar não está disponível: a variável ainda não tem valor",
}

type BlockDetails = { agentName?: string | null | undefined; agentVersionNumber?: number | null | undefined; denial?: string | null | undefined; cause?: string | null | undefined }

/** O trecho da frase do bloqueio que diz o motivo, para qualquer motivo. */
export function blockedReasonText(reason: BlockReason, details: BlockDetails | null | undefined): string {
  if (reason === "HUMAN_REVIEW_NO_REVIEWER") return (details?.cause ? REVIEW_BLOCK_TEXT[details.cause] : undefined) ?? "a revisão não tem revisor disponível"
  if (reason === "HUMAN_REVIEW_CONTENT_MISSING") return (details?.cause ? REVIEW_BLOCK_TEXT[details.cause] : undefined) ?? "o conteúdo a revisar não está disponível"
  if (reason === "TRIGGERING_RECORD_CANCELLED") return "a medição que iniciou esta execução foi cancelada na Central de Dados"
  if (reason === "UNKNOWN") return "motivo não identificado"
  return blockedAgentText(reason, details?.agentName ?? null, details?.agentVersionNumber, details?.denial)
}

/** Detalhe do acesso não autorizado (`blockedDetails.denial`) — sem nada do que é restrito. */
const DENIAL_TEXT: Record<string, string> = {
  SCOPE: "o alcance da versão vigente do agente não cobre este Workflow",
  KNOWLEDGE: "a versão vigente do agente usa uma base de conhecimento não autorizada para o alcance dele",
}

/** "agente “X” (versão N) inativo" / "agente “X” (versão N) sem acesso autorizado: <detalhe>" — trecho da frase do bloqueio. */
export function blockedAgentText(reason: Extract<BlockReason, "AGENT_INACTIVE" | "AGENT_ACCESS_NOT_AUTHORIZED">, agentName: string | null, versionNumber: number | null | undefined, denial?: string | null): string {
  const agent = agentName ? `agente “${agentName}”${typeof versionNumber === "number" ? ` (versão ${versionNumber})` : ""}` : "agente"
  if (reason === "AGENT_INACTIVE") return `${agent} inativo`
  const detail = denial ? DENIAL_TEXT[denial] : null
  return `${agent} sem acesso autorizado neste contexto${detail ? `: ${detail}` : ""}`
}

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null)
const versionOf = (value: unknown): string => (typeof value === "number" ? ` (versão ${value})` : "")

/**
 * Eventos do bloqueio e da nova tentativa (PEN-073/074) em linguagem de tela — null para qualquer outro evento.
 * Mesmo padrão das outras descrições da aba Execuções: sem id técnico como informação principal.
 */
export function describeRetryEvent(event: WorkflowEnrollmentEvent): string | null {
  const payload = event.payload
  if (event.eventType === "node_blocked") {
    const agent = text(payload.agentName)
    const reason = blockReasonOf(payload.reason)
    if (reason === "HUMAN_REVIEW_NO_REVIEWER" || reason === "HUMAN_REVIEW_CONTENT_MISSING" || reason === "TRIGGERING_RECORD_CANCELLED" || reason === "UNKNOWN") {
      const why = blockedReasonText(reason, { cause: text(payload.cause) })
      return `${why.charAt(0).toUpperCase()}${why.slice(1)}. ${BLOCKED_GUIDANCE[reason]}`
    }
    if (reason === "AGENT_ACCESS_NOT_AUTHORIZED") {
      return `${agent ? `Agente "${agent}"${versionOf(payload.agentVersionNumber)}` : "Agente"} sem acesso autorizado neste contexto. ${BLOCKED_GUIDANCE[reason]}`
    }
    return `${agent ? `Agente "${agent}"${versionOf(payload.agentVersionNumber)} inativo` : "Agente inativo"}. ${BLOCKED_GUIDANCE[reason]}`
  }
  if (event.eventType === "retry_requested") {
    const retryId = text(payload.retryEnrollmentId)
    const start = payload.startsAt === "TRIGGER" ? "recomeça do início" : payload.startsAt === "AFTER_FAN_OUT" ? "recomeça depois do envio para vários colaboradores" : "continua da etapa bloqueada"
    return `Nova tentativa${retryId ? ` ${shortExecutionId(retryId)}` : ""} pedida por ${text(payload.requestedBy) ?? "alguém"} — versão ${String(payload.workflowVersionNumber ?? "?")} do Workflow, ${start}.`
  }
  if (event.eventType === "retry_started") {
    const originalId = text(payload.originalEnrollmentId)
    return `Nova tentativa${originalId ? ` da execução ${shortExecutionId(originalId)}` : ""}, pedida por ${text(payload.requestedBy) ?? "alguém"} — versão ${String(payload.workflowVersionNumber ?? "?")} do Workflow.`
  }
  if (event.eventType === "output_already_delivered") {
    const deliveredBy = text(payload.deliveredByEnrollmentId)
    return `Entrega já feita${deliveredBy ? ` pela execução ${shortExecutionId(deliveredBy)}` : ""} — não foi repetida.`
  }
  return null
}
