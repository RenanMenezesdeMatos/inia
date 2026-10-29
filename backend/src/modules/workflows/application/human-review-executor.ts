import type { Database } from "../../../infrastructure/database/pool.js"
import type { HierarchicalTarget, HumanReviewNodeConfig } from "../domain/graph-schema.js"
import type { WorkflowEffectSink } from "./effect-sink.js"
import { resolveByRoleChain, resolveEnrollmentOperatorId, type EnrollmentSubjectContext } from "./enrollment-subject.js"
import { resolveSource } from "./output-executor.js"
import { isReliableFeedbackNodeOutput } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import { isCallAnalysisNodeOutput, isEngineMessageNodeOutput, isIndicatorAnalysisNodeOutput } from "../../feedback-engine/domain/node-output.js"

export type HumanReviewExecutionContext = EnrollmentSubjectContext & {
  organizationId: string
  enrollmentId: string
  nodeId: string
  /** Execution Context acumulado até agora — de onde `config.contentSource` lê o que mostrar ao
   * revisor, e de onde `reviewTarget: ROLE_OF_PREVIOUS_REVIEWER` lê quem decidiu um Human
   * Review anterior nesta mesma execução. */
  nodeOutputs: Record<string, unknown>
  effects: WorkflowEffectSink
}

/**
 * Quem recebe — resolução hierárquica extensível por `target.type`, nunca hardcoded por
 * combinação. `ROLE_OF_PREVIOUS_REVIEWER` reaproveita o mesmo `resolveByRoleChain` de sempre, só
 * trocando o ponto de partida (operador → quem decidiu o Human Review anterior). Compartilhada
 * entre o próprio Human Review (`notifyHumanReviewPending`) e a Action Escalonar
 * (`escalate-executor.ts`) — mesmo `HierarchicalTarget`, mesma resolução, nunca duas versões.
 * `context` aceita qualquer objeto com `db`/`nodeOutputs` (não exige o contexto inteiro do Human
 * Review) — assim quem mais reaproveitar não precisa montar um `HumanReviewExecutionContext`
 * completo só pra isso.
 */
export async function resolveHierarchicalTargetIds(
  context: { db: Database; nodeOutputs: Record<string, unknown> },
  operatorId: string,
  target: HierarchicalTarget,
): Promise<string[]> {
  if (target.type === "SPECIFIC_USER") return [target.userId]
  if (target.type === "ROLE_OF_OPERATOR") {
    return (await resolveByRoleChain(context.db, operatorId, [target.role], { ancestorsOnly: true })).map((recipient) => recipient.id)
  }
  // ROLE_OF_PREVIOUS_REVIEWER — o revisor anterior grava `reviewerId` em
  // node_outputs[previousReviewNodeId] na rota de decisão (workflow-router.ts). Sem esse
  // registro ainda (não deveria acontecer — validado no publish que o node é ancestral), não há
  // pra quem notificar; best-effort, não trava o node por isso.
  const previous = context.nodeOutputs[target.previousReviewNodeId] as { reviewerId?: string } | undefined
  if (!previous?.reviewerId) return []
  return (await resolveByRoleChain(context.db, previous.reviewerId, [target.role])).map((recipient) => recipient.id)
}

/**
 * Primeira visita a um node Human Review: notifica quem o `reviewTarget` resolver de que uma
 * decisão está pendente, incluindo o conteúdo a revisar (`contentSource`, resolvido do Execution
 * Context) e a instrução, quando configurados. Não decide nada sozinho — quem aprova/reprova/
 * escala é sempre uma pessoa, via a rota de decisão do workflow-router
 * (`POST .../enrollments/:id/decision`); o motor só marca o enrollment como `waiting` sem timer
 * até essa rota gravar a decisão (ver node-handlers.ts).
 */
export async function notifyHumanReviewPending(config: HumanReviewNodeConfig, context: HumanReviewExecutionContext): Promise<void> {
  const operatorId = await resolveEnrollmentOperatorId(context)
  if (!operatorId) throw new Error("Não foi possível identificar o operador para a revisão humana.")

  const [resolvedIds, caseId, operatorRow] = await Promise.all([
    resolveHierarchicalTargetIds(context, operatorId, config.reviewTarget),
    context.effects.findRecentCaseId(context.db, context.enrollmentId),
    context.db.query<{ name: string }>(`select name from people where id = $1`, [operatorId]),
  ])
  const operatorName = operatorRow.rows[0]?.name ?? "um operador"
  // O próprio colaborador nunca revisa o resultado sobre ele (nem como "Pessoa específica"): sem outro revisor, o nó falha com o
  // motivo registrado em vez de esperar uma decisão que só ele poderia tomar (achado C16 da 4ª auditoria).
  const reviewerIds = resolvedIds.filter((id) => id !== operatorId)
  if (resolvedIds.length > 0 && reviewerIds.length === 0) throw new Error("A revisão humana não tem revisor além do próprio colaborador desta execução — ajuste o revisor do nó.")

  const contentValue = config.contentSource ? resolveSource(context.nodeOutputs, config.contentSource) : undefined
  // V1.5.12: feedback confiável = o texto legível do que seria emitido (nunca o JSON do artefato).
  const contentText = typeof contentValue === "string" ? contentValue : isReliableFeedbackNodeOutput(contentValue) || isEngineMessageNodeOutput(contentValue) || isCallAnalysisNodeOutput(contentValue) || isIndicatorAnalysisNodeOutput(contentValue) ? contentValue.text : contentValue !== undefined ? JSON.stringify(contentValue) : undefined

  const descriptionParts = [`Um workflow está aguardando sua decisão (aprovar/reprovar/escalar) sobre uma ocorrência de ${operatorName}.`]
  if (config.instruction) descriptionParts.push(`Instrução: ${config.instruction}`)
  if (contentText) descriptionParts.push(`Conteúdo: ${contentText}`)

  for (const reviewerId of reviewerIds) {
    await context.effects.dispatchAlert(context.db, {
      organizationId: context.organizationId,
      caseId,
      recipientId: reviewerId,
      title: `Revisão pendente: ${operatorName}`,
      description: descriptionParts.join(" "),
      severity: "HIGH",
      alertType: "WORKFLOW_HUMAN_REVIEW",
      dedupeKey: `workflow_human_review:${context.enrollmentId}:${context.nodeId}`,
    })
  }
}
