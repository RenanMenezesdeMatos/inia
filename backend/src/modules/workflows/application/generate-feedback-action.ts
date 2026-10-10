import type { ActionConfig } from "../domain/graph-schema.js"
import { feedbackSourceTypeOf, findAncestorNodeIds, findNode, resolveFeedbackDomain, sourceOutputContractOf } from "../domain/graph-schema.js"
import type { ActionExecutionContext, ActionResult } from "./action-executors.js"
import { resolveEnrollmentOperatorId } from "./enrollment-subject.js"

/**
 * EXECUTOR de "Gerar feedback" — MOTOR DE FEEDBACK (feedback-engine).
 *
 * Lê EXPLICITAMENTE a saída do nó de origem (`sourceNodeId`, nunca "o nó anterior"), confere de novo em runtime o que o publish
 * validou (origem existe, é ancestral, é "Chamar agente"/"Orquestrador"; domínio resolvível) e pede a mensagem ao motor. A
 * análise é a da origem quando ela já rodou no motor; senão o motor analisa agora, com o especialista da origem. A memória é
 * gravada na análise — antes e independentemente de haver mensagem ou Output.
 *
 * Resultado → o que o Workflow faz (nenhum caminho espera decisão humana):
 *   PUBLICÁVEL  → segue pela aresta "Sempre" com a mensagem em `nodeOutputs[nó]` (Revisão humana/Output leem dela);
 *   ABSTENÇÃO   → encerra a execução sem Output, com o motivo no evento (nada material, evidência insuficiente, já entregue);
 *   falha técnica → erro classificado; o motor aplica a política de nova tentativa (a análise gravada é reutilizada).
 */
function selectionReasonOf(context: ActionExecutionContext): string {
  const enrollment = context.enrollment
  if (enrollment.matchedFlagName) {
    const value = enrollment.matchedValueBoolean !== null ? (enrollment.matchedValueBoolean ? "sim" : "não") : enrollment.matchedValueNumeric ?? ""
    return `Sinal da chamada no gatilho do Workflow: ${enrollment.matchedFlagName}${value ? ` = ${value}` : ""}.`
  }
  if (enrollment.interactionId) return "Chamada selecionada pela execução do Workflow."
  if (enrollment.indicatorMeasurementId) return "Medição de indicador que disparou o Workflow."
  return "Execução agendada do Workflow."
}

export async function executeGenerateFeedback(config: Extract<ActionConfig, { actionType: "GENERATE_FEEDBACK" }>, context: ActionExecutionContext): Promise<ActionResult> {
  const source = findNode(context.graph, config.sourceNodeId)
  const sourceType = feedbackSourceTypeOf(source)
  if (!source || !sourceType) throw new Error(`"Gerar feedback": a origem "${config.sourceNodeId}" não é um nó "Chamar agente" ou "Orquestrador" deste Workflow.`)
  if (!findAncestorNodeIds(context.graph, context.nodeId).has(source.id)) throw new Error(`"Gerar feedback": a origem "${source.label}" não vem antes deste nó.`)
  const triggerKind = context.enrollment.interactionId ? "channel_flag" : context.enrollment.indicatorMeasurementId ? "indicator" : "schedule"
  const domain = resolveFeedbackDomain(config.feedbackDomain, triggerKind, sourceType, sourceOutputContractOf(source))
  if (!domain) throw new Error(`"Gerar feedback": não foi possível determinar se o feedback é de monitoria ou de indicador para esta origem.`)
  const collaboratorId = await resolveEnrollmentOperatorId({ db: context.db, enrollment: { interactionId: context.enrollment.interactionId, indicatorMeasurementId: context.enrollment.indicatorMeasurementId, scheduledSubjectId: context.enrollment.scheduledSubjectId } })
  if (!collaboratorId) throw new Error(`"Gerar feedback": não foi possível identificar o colaborador desta execução.`)

  const result = await context.effects.feedbackEngine.generate(context.db, {
    organizationId: context.organizationId,
    enrollmentId: context.enrollment.id,
    workflowId: context.workflowId,
    workflowVersionId: context.workflowVersionId,
    nodeId: context.nodeId,
    sourceNodeId: source.id,
    domain,
    sourceNodeOutput: context.enrollment.nodeOutputs[source.id],
    collaboratorId,
    interactionId: context.enrollment.interactionId,
    indicatorMeasurementId: context.enrollment.indicatorMeasurementId,
    configuredAgentId: source.type === "action" && source.config.actionType === "CALL_AGENT" ? source.config.agentId : null,
    selectionReason: selectionReasonOf(context),
    now: context.now,
  })
  if (result.kind === "ABSTAINED") return { control: { kind: "COMPLETE", eventPayload: { actionType: "GENERATE_FEEDBACK", engine: "FEEDBACK_ENGINE_V1", outcome: "ABSTAINED", messageId: result.messageId, reason: result.reason, analysisRunIds: result.analysisRunIds, reused: result.reused } } }
  return { nodeOutput: result.nodeOutput }
}
