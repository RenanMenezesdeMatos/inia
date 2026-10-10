import type { InteractionFeedbackStatus } from "../../investigation/domain/interaction-feedback.js"
import { INTERACTION_FEEDBACK_CONTRACT } from "../../investigation/domain/interaction-feedback.js"
import { FEEDBACK_DISPOSITIONS, type FeedbackDisposition } from "../domain/feedback-delivery-policy.js"
import { workflowGenerationKeyOf, type InteractionSampleStrategy, type InteractionSelectionSource } from "../domain/interaction-selection.js"
import { runInteractionFeedbackPipeline, type PipelineDeps } from "./interaction-feedback-pipeline.js"
import type { PrepareInput, PreparedInteraction } from "./prepare-interaction-for-feedback.js"
import type { DeliveryDecisionRecord } from "./ports.js"

/**
 * V1.5.10 — geração IDEMPOTENTE do feedback de uma interação pedida por uma ação de Workflow:
 *
 *   claim da intenção lógica (registro de gerações) → [adota run já completo] → PrepareInteractionForFeedback
 *     → runInteractionFeedbackPipeline (redator + política de entrega + persistência — tudo como já está)
 *     → resultado FUNCIONAL gravado (AUTO_DELIVER / HOLD_FOR_QA / BLOCKED por item; NOT_ANALYZABLE sem transcrição).
 *
 * A entrega NÃO acontece aqui: AUTO_DELIVER é entregue pelo varredor existente (exatamente uma vez); HOLD_FOR_QA entra
 * na fila de QA e ninguém espera por ela. Falha técnica (provider, banco, contrato do modelo) marca a geração FAILED e
 * PROPAGA o erro — quem decide o retry é o mecanismo do chamador (no Workflow, o do motor). Sem retry próprio aqui nem no
 * redator.
 */
// Posse de uma geração: cobre a preparação + redator (dezenas de segundos) e vence ANTES do próximo retry do motor
// (backoff de 5 min) — uma tentativa que morreu sem conseguir marcar FAILED não segura a interação além disso.
export const GENERATION_LEASE_SECONDS = 240

export type GenerationIntent = { kind: "WORKFLOW_ACTION"; workflowId: string; workflowVersionId: string | null; nodeId: string; enrollmentId: string | null }
export type GenerationSelection = { source: InteractionSelectionSource; strategy: InteractionSampleStrategy | null; rank: number | null }
export type GenerationRequest = { organizationId: string; collaboratorId: string; interactionId: string; intent: GenerationIntent; selection: GenerationSelection }

/** Resumo funcional SEGURO (nunca texto do feedback, trecho, prompt ou handle). */
export type GenerationOutcomeSummary = {
  status: "GENERATED" | "NOT_ANALYZABLE"
  notAnalyzableReason: "NO_TRANSCRIPT" | null
  feedbackStatus: InteractionFeedbackStatus | null
  runId: string | null
  writerInvoked: boolean
  dispositions: Record<FeedbackDisposition, number>
  /** Motivos estruturados das decisões HOLD_FOR_QA/BLOCKED (códigos da política), sem repetição. */
  reasons: string[]
  policyVersion: string | null
}
export type GenerationOutcome = GenerationOutcomeSummary & { interactionId: string; generationId: string | null; reused: boolean }

export type GenerationStatus = "RESERVED" | "PENDING" | "COMPLETED" | "FAILED"
export type GenerationRecord = { id: string; organizationId: string; generationKey: string; interactionId: string; status: GenerationStatus; runId: string | null; outcome: GenerationOutcomeSummary | null; attempts: number }
export type NewGeneration = { organizationId: string; generationKey: string; contractVersion: string; interactionId: string; collaboratorId: string; intent: GenerationIntent; selection: GenerationSelection }
export type ClaimResult = { kind: "OWNED"; generation: GenerationRecord } | { kind: "COMPLETED"; generation: GenerationRecord } | { kind: "IN_PROGRESS"; generation: GenerationRecord }

/** PORT do registro de gerações (Postgres em infrastructure/, memória em testing/). Toda operação escopada à organização. */
export type GenerationRegistry = {
  /** Posse atômica: insere PENDING ou retoma RESERVED/FAILED/PENDING com lease vencida; senão devolve o estado atual. */
  claim(input: NewGeneration, now: Date, leaseSeconds: number): Promise<ClaimResult>
  /** Run COMPLETO (todas as decisões gravadas) desta geração, deixado por uma tentativa que falhou depois do pipeline. */
  findCompletedRun(organizationId: string, generationId: string): Promise<{ runId: string; status: InteractionFeedbackStatus; writerInvoked: boolean } | null>
  complete(organizationId: string, generationId: string, runId: string | null, outcome: GenerationOutcomeSummary, now: Date): Promise<void>
  fail(organizationId: string, generationId: string, error: string, now: Date): Promise<void>
  /** Seleção PERSISTIDA de uma execução (retry relê a mesma), na ordem da amostra. */
  listSelection(input: { organizationId: string; workflowId: string; nodeId: string; enrollmentId: string }): Promise<string[]>
  /** Interações que este nó já atendeu ou reservou — fora de novas amostras (FAILED pode ser escolhida de novo). */
  selectedInteractionIds(input: { organizationId: string; workflowId: string; nodeId: string }): Promise<string[]>
  /** Reserva a amostra (RESERVED) — sem sobrescrever o que outra execução já possui. */
  reserveSelection(rows: NewGeneration[], now: Date): Promise<void>
}

export type GenerationDeps = {
  registry: GenerationRegistry
  pipeline: PipelineDeps
  prepare: (input: PrepareInput) => Promise<PreparedInteraction>
  now: () => Date
}

export class InteractionFeedbackModuleDisabledError extends Error {
  constructor() {
    super("O feedback de atendimento está desligado neste ambiente (INIA_INTERACTION_FEEDBACK_PIPELINE).")
    this.name = "INTERACTION_FEEDBACK_MODULE_DISABLED"
  }
}
export class GenerationInProgressError extends Error {
  constructor() {
    super("Outra execução está gerando o feedback desta interação agora; será conferido na próxima tentativa.")
    this.name = "INTERACTION_FEEDBACK_GENERATION_IN_PROGRESS"
  }
}

export function newGenerationOf(request: GenerationRequest): NewGeneration {
  return {
    organizationId: request.organizationId,
    generationKey: workflowGenerationKeyOf({ workflowId: request.intent.workflowId, nodeId: request.intent.nodeId, interactionId: request.interactionId }),
    contractVersion: INTERACTION_FEEDBACK_CONTRACT,
    interactionId: request.interactionId,
    collaboratorId: request.collaboratorId,
    intent: request.intent,
    selection: request.selection,
  }
}

const emptyDispositions = (): Record<FeedbackDisposition, number> => Object.fromEntries(FEEDBACK_DISPOSITIONS.map((disposition) => [disposition, 0])) as Record<FeedbackDisposition, number>

export function summarizeGeneration(input: { feedbackStatus: InteractionFeedbackStatus; runId: string; writerInvoked: boolean; decisions: DeliveryDecisionRecord[] }): GenerationOutcomeSummary {
  const dispositions = emptyDispositions()
  for (const entry of input.decisions) dispositions[entry.decision.disposition] += 1
  const reasons = [...new Set(input.decisions.filter((entry) => entry.decision.disposition !== "AUTO_DELIVER").flatMap((entry) => entry.decision.reasons as string[]))].sort()
  return { status: "GENERATED", notAnalyzableReason: null, feedbackStatus: input.feedbackStatus, runId: input.runId, writerInvoked: input.writerInvoked, dispositions, reasons, policyVersion: input.decisions[0]?.decision.policyVersion ?? null }
}

export async function generateInteractionFeedback(deps: GenerationDeps, request: GenerationRequest): Promise<GenerationOutcome> {
  if (!deps.pipeline.enabled) throw new InteractionFeedbackModuleDisabledError()
  const claim = await deps.registry.claim(newGenerationOf(request), deps.now(), GENERATION_LEASE_SECONDS)
  if (claim.kind === "COMPLETED") return { ...claim.generation.outcome!, interactionId: request.interactionId, generationId: claim.generation.id, reused: true }
  if (claim.kind === "IN_PROGRESS") throw new GenerationInProgressError()
  const generation = claim.generation
  const finish = async (runId: string | null, outcome: GenerationOutcomeSummary): Promise<GenerationOutcome> => {
    await deps.registry.complete(request.organizationId, generation.id, runId, outcome, deps.now())
    return { ...outcome, interactionId: request.interactionId, generationId: generation.id, reused: false }
  }
  try {
    // Uma tentativa anterior completou o pipeline e caiu antes de gravar o resultado: ADOTA (nunca gera um segundo feedback).
    const completed = await deps.registry.findCompletedRun(request.organizationId, generation.id)
    if (completed) {
      const decisions = await deps.pipeline.store.listDeliveryDecisions(request.organizationId, completed.runId)
      return await finish(completed.runId, summarizeGeneration({ feedbackStatus: completed.status, runId: completed.runId, writerInvoked: completed.writerInvoked, decisions }))
    }
    const prepared = await deps.prepare({ organizationId: request.organizationId, collaboratorId: request.collaboratorId, interactionId: request.interactionId, now: deps.now() })
    if (prepared.kind === "NOT_ANALYZABLE") {
      return await finish(null, { status: "NOT_ANALYZABLE", notAnalyzableReason: prepared.reason, feedbackStatus: null, runId: null, writerInvoked: false, dispositions: emptyDispositions(), reasons: [], policyVersion: null })
    }
    const result = await runInteractionFeedbackPipeline(deps.pipeline, prepared.feedback, { ...prepared.runContext, generationId: generation.id })
    if (result.status === "SKIPPED_FLAG_OFF") throw new InteractionFeedbackModuleDisabledError()
    return await finish(result.runId, summarizeGeneration({ feedbackStatus: prepared.feedback.status, runId: result.runId, writerInvoked: result.status === "RECORDED", decisions: result.decisions }))
  } catch (error) {
    await deps.registry.fail(request.organizationId, generation.id, error instanceof Error ? error.name : "GENERATION_ERROR", deps.now()).catch(() => undefined)
    throw error
  }
}
