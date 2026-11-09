import type { Database } from "../../../infrastructure/database/pool.js"
import type { HierarchicalTarget, HumanReviewNodeConfig } from "../domain/graph-schema.js"
import type { WorkflowEffectSink } from "./effect-sink.js"
import { resolveByRoleChain, resolveEnrollmentOperatorId, type EnrollmentSubjectContext } from "./enrollment-subject.js"
import { HumanReviewBlockedError, MISSING_CONTENT_MESSAGES, NO_REVIEWER_MESSAGES, missingContentCauseOf, type NoReviewerCause } from "../domain/execution-block.js"
import { notifyPublisherOfBlockedExecution } from "./blocked-execution-notice.js"
import { describeScalarValue, isAbsentContent } from "./execution-context.js"
import { resolveSource } from "./output-executor.js"
import { isReliableFeedbackNodeOutput } from "../../reliable-feedback/domain/reliable-feedback-artifact.js"
import { isCallAnalysisNodeOutput, isEngineMessageNodeOutput, isIndicatorAnalysisNodeOutput } from "../../feedback-engine/domain/node-output.js"

export type HumanReviewExecutionContext = EnrollmentSubjectContext & {
  organizationId: string
  /** Para avisar quem publicou a versão vigente quando a execução bloqueia (D1). */
  workflowId: string
  enrollmentId: string
  nodeId: string
  /** Execution Context acumulado até agora — de onde `config.contentSource` lê o que mostrar ao
   * revisor, e de onde `reviewTarget: ROLE_OF_PREVIOUS_REVIEWER` lê quem decidiu um Human
   * Review anterior nesta mesma execução. */
  nodeOutputs: Record<string, unknown>
  /** Workflow Variables: a tela oferece variável como origem do conteúdo (WF-41). */
  variables?: Record<string, unknown>
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
export async function resolveHierarchicalTargetIds(context: TargetContext, operatorId: string, target: HierarchicalTarget): Promise<string[]> {
  return keepActive(context.db, await candidateIds(context, operatorId, target))
}

type TargetContext = { db: Database; nodeOutputs: Record<string, unknown> }

/** Quem o alvo aponta, sem olhar se está ativo. O cargo vem do primeiro da cadeia: inativo não passa a vez para quem está acima (D3). */
async function candidateIds(context: TargetContext, operatorId: string, target: HierarchicalTarget): Promise<string[]> {
  if (target.type === "SPECIFIC_USER") return [target.userId]
  if (target.type === "ROLE_OF_OPERATOR") {
    return (await resolveByRoleChain(context.db, operatorId, [target.role], { ancestorsOnly: true })).map((recipient) => recipient.id)
  }
  // ROLE_OF_PREVIOUS_REVIEWER — o revisor anterior grava `reviewerId` em node_outputs[previousReviewNodeId] na decisão.
  const previous = context.nodeOutputs[target.previousReviewNodeId] as { reviewerId?: string } | undefined
  if (!previous?.reviewerId) return []
  return (await resolveByRoleChain(context.db, previous.reviewerId, [target.role])).map((recipient) => recipient.id)
}

async function keepActive(db: Database, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const active = new Set((await db.query<{ id: string }>(`select id from people where id = any($1::uuid[]) and active`, [ids])).rows.map((row) => row.id))
  return ids.filter((id) => active.has(id))
}

/** Quem pode revisar agora, ou por que ninguém pode. Usada pela etapa e pela prévia da nova tentativa. */
export async function resolveReviewers(context: TargetContext, operatorId: string, target: HierarchicalTarget): Promise<{ reviewerIds: string[]; cause: NoReviewerCause | null }> {
  const candidates = await candidateIds(context, operatorId, target)
  if (candidates.length === 0) {
    const previousMissing = target.type === "ROLE_OF_PREVIOUS_REVIEWER" && !(context.nodeOutputs[target.previousReviewNodeId] as { reviewerId?: string } | undefined)?.reviewerId
    return { reviewerIds: [], cause: previousMissing ? "PREVIOUS_REVIEW_NOT_DECIDED" : "NO_ONE_IN_CHAIN" }
  }
  const active = await keepActive(context.db, candidates)
  if (active.length === 0) return { reviewerIds: [], cause: "REVIEWER_INACTIVE" }
  // O próprio colaborador nunca revisa o resultado sobre ele, nem como "Pessoa específica" (achado C16 da 4ª auditoria).
  const reviewerIds = active.filter((id) => id !== operatorId)
  return reviewerIds.length > 0 ? { reviewerIds, cause: null } : { reviewerIds: [], cause: "ONLY_THE_COLLABORATOR" }
}

/** Avisa quem publicou e interrompe a etapa: o motor marca a execução como bloqueada (engine.ts). */
async function blockReview(context: HumanReviewExecutionContext, error: HumanReviewBlockedError): Promise<never> {
  await notifyPublisherOfBlockedExecution(context, error.reason)
  throw error
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

  // Sem revisor, a etapa bloqueia com o motivo, em vez de esperar uma decisão que ninguém foi avisado para tomar (P5c).
  const { reviewerIds, cause } = await resolveReviewers(context, operatorId, config.reviewTarget)
  if (cause) await blockReview(context, new HumanReviewBlockedError("HUMAN_REVIEW_NO_REVIEWER", cause, `Revisão sem revisor: ${NO_REVIEWER_MESSAGES[cause]}`))

  // Ninguém decide sem ver o conteúdo configurado (D2).
  const contentValue = config.contentSource ? resolveSource(context.nodeOutputs, config.contentSource, context.variables) : undefined
  if (config.contentSource && isAbsentContent(contentValue)) {
    const contentCause = missingContentCauseOf(config.contentSource)
    await blockReview(context, new HumanReviewBlockedError("HUMAN_REVIEW_CONTENT_MISSING", contentCause, `O conteúdo a revisar não está disponível: ${MISSING_CONTENT_MESSAGES[contentCause]}.`))
  }

  const [caseId, operatorRow] = await Promise.all([
    context.effects.findRecentCaseId(context.db, context.enrollmentId),
    context.db.query<{ name: string }>(`select name from people where id = $1`, [operatorId]),
  ])
  const operatorName = operatorRow.rows[0]?.name ?? "um operador"

  // V1.5.12: feedback confiável = o texto legível do que seria emitido (nunca o JSON do artefato).
  const contentText = typeof contentValue === "string" ? contentValue : isReliableFeedbackNodeOutput(contentValue) || isEngineMessageNodeOutput(contentValue) || isCallAnalysisNodeOutput(contentValue) || isIndicatorAnalysisNodeOutput(contentValue) ? contentValue.text : contentValue !== undefined ? (describeScalarValue(contentValue) ?? JSON.stringify(contentValue)) : undefined

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
