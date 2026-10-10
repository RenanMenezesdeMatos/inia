import type { Database } from "../../../infrastructure/database/pool.js"
import { env } from "../../../config/env.js"
import { FEEDBACK_DELIVERY_POLICIES } from "../domain/feedback-delivery-policy.js"
import { createGeminiFeedbackWriter } from "../infrastructure/gemini-feedback-writer.js"
import { createInMemoryInteractionFeedbackStore } from "../infrastructure/ephemeral-interaction-feedback-store.js"
import { InteractionFeedbackModuleDisabledError, summarizeGeneration, type GenerationOutcome, type GenerationRequest } from "./generate-interaction-feedback.js"
import { runInteractionFeedbackPipeline } from "./interaction-feedback-pipeline.js"
import { interactionFeedbackModuleEnabled } from "./pipeline-wiring.js"
import { prepareInteractionForFeedback, type PrepareInput, type PreparedInteraction } from "./prepare-interaction-for-feedback.js"
import type { FeedbackWriterPort } from "./ports.js"

/**
 * V1.5.10 — SIMULAÇÃO (QA Lab) de "Gerar feedback de atendimento": a MESMA preparação semântica, o MESMO pipeline e a
 * MESMA política de entrega, com um store EFÊMERO — nenhum run, revisão, decisão, geração ou entrega é gravado, nenhuma
 * notificação sai, e o varredor nunca vê nada. As requests de IA seguem a política do QA Lab (orçamento / "Parar antes da
 * IA"). Devolve só o resultado conceitual seguro (disposições e motivos estruturados).
 */
export async function simulateInteractionFeedbackGeneration(db: Database, request: GenerationRequest, deps: { writer?: FeedbackWriterPort; prepare?: (input: PrepareInput) => Promise<PreparedInteraction>; now?: () => Date } = {}): Promise<GenerationOutcome> {
  if (!interactionFeedbackModuleEnabled()) throw new InteractionFeedbackModuleDisabledError()
  const now = deps.now ?? (() => new Date())
  const prepared = await (deps.prepare ?? ((input) => prepareInteractionForFeedback(db, input)))({ organizationId: request.organizationId, collaboratorId: request.collaboratorId, interactionId: request.interactionId, now: now() })
  if (prepared.kind === "NOT_ANALYZABLE") {
    return { status: "NOT_ANALYZABLE", notAnalyzableReason: prepared.reason, feedbackStatus: null, runId: null, writerInvoked: false, dispositions: { AUTO_DELIVER: 0, HOLD_FOR_QA: 0, BLOCKED: 0 }, reasons: [], policyVersion: null, interactionId: request.interactionId, generationId: null, reused: false }
  }
  const { store } = createInMemoryInteractionFeedbackStore()
  const result = await runInteractionFeedbackPipeline({ enabled: true, writer: deps.writer ?? createGeminiFeedbackWriter(), store, now, deliveryPolicy: FEEDBACK_DELIVERY_POLICIES[env.INIA_FEEDBACK_DELIVERY_POLICY] }, prepared.feedback, prepared.runContext)
  if (result.status === "SKIPPED_FLAG_OFF") throw new InteractionFeedbackModuleDisabledError()
  // runId de um store efêmero não identifica nada persistido — não sai da simulação.
  return { ...summarizeGeneration({ feedbackStatus: prepared.feedback.status, runId: result.runId, writerInvoked: result.status === "RECORDED", decisions: result.decisions }), runId: null, interactionId: request.interactionId, generationId: null, reused: false }
}
