import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { interactionFeedbackModuleEnabled } from "../../interaction-feedback/application/pipeline-wiring.js"
import { RELIABLE_FEEDBACK_POLICIES } from "../domain/reliable-feedback-item.js"
import { createGeminiReliableFeedbackWriter } from "../infrastructure/gemini-reliable-feedback-writer.js"
import { createPostgresIndicatorContextLoader, createPostgresMonitoringContextLoader, createPostgresPublishedKnowledgeLoader, createPostgresRecipientLoader } from "../infrastructure/postgres-feedback-context-loaders.js"
import { createPostgresReliableFeedbackStore } from "../infrastructure/postgres-reliable-feedback-store.js"
import { publishReliableFeedbackToFollowUp, type PublishReliableInput } from "../infrastructure/publish-reliable-feedback.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest, type ReliableGenerationResult } from "./generate-reliable-feedback.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"
import { loadIndicatorDiagnosisPlan } from "../../indicator-diagnosis/application/load-diagnosis-plan.js"
import { loadPeerPracticeData } from "../../indicator-diagnosis/application/load-peer-practice-data.js"
import { resolveExecutionStrategy } from "../../indicator-diagnosis/application/diagnostic-strategy-service.js"
import { prepareDirectIndicatorPlan, preparePrvClosingPlan } from "../../indicator-diagnosis/application/prepare-prv-closing.js"
import { loadTeamObservations } from "../../indicator-diagnosis/application/load-prv-closing-data.js"

/**
 * Montagem de runtime do feedback confiável (V1.5.12). Mesma chave de módulo do QA de feedback
 * (`INIA_INTERACTION_FEEDBACK_PIPELINE`): sem o QA não há como resolver um HOLD_FOR_QA, então com OFF a ação não publica nem
 * roda. A política vem de `INIA_FEEDBACK_DELIVERY_POLICY` (PILOT_V1 | AUTONOMOUS_V1), traduzida para a política PRÓPRIA do
 * feedback confiável (`RELIABLE_FEEDBACK_POLICIES`): PILOT_V1 põe todo item emitível em QA; AUTONOMOUS_V1 (V1.5.12a) deixa seguir o item claro
 * e seguro e manda a QA só a exceção.
 */
export function createReliableGenerationDeps(input: { db: Database; writer?: ReliableFeedbackWriterPort; clock?: Clock }): ReliableGenerationDeps {
  const clock = input.clock ?? systemClock
  return {
    enabled: interactionFeedbackModuleEnabled(),
    store: createPostgresReliableFeedbackStore(input.db),
    writer: input.writer ?? createGeminiReliableFeedbackWriter(),
    policy: RELIABLE_FEEDBACK_POLICIES[env.INIA_FEEDBACK_DELIVERY_POLICY],
    loadMonitoringContext: createPostgresMonitoringContextLoader(input.db),
    loadIndicatorContext: createPostgresIndicatorContextLoader(input.db, () => clock.now()),
    loadPublishedKnowledge: createPostgresPublishedKnowledgeLoader(input.db),
    loadRecipient: createPostgresRecipientLoader(input.db),
    loadIndicatorDiagnosisPlan: (organizationId, request) => loadIndicatorDiagnosisPlan(input.db, { organizationId, ...request }),
    resolveDiagnosticStrategy: (organizationId, request) => resolveExecutionStrategy(input.db, organizationId, request),
    loadPeerPracticeData: (organizationId, request) => loadPeerPracticeData(input.db, { organizationId, ...request }),
    // INDICATOR DIAGNOSIS V1 — o MESMO plano determinístico do nó "Chamar agente" (recalculado) + o agregado do Subgrupo.
    prv: {
      preparePrvClosingPlan: (organizationId, request) => preparePrvClosingPlan(input.db, organizationId, request),
      // V2 — diagnóstico DIRETO de um indicador (sem PRV): o mesmo plano por indicador.
      prepareDirectIndicatorPlan: (organizationId, request) => prepareDirectIndicatorPlan(input.db, organizationId, request),
      loadTeamObservations: (organizationId, request) => loadTeamObservations(input.db, { organizationId, ...request }),
    },
    now: () => clock.now(),
  }
}

/**
 * Fronteira de efeitos do Workflow para o feedback confiável (`WorkflowEffectSink.reliableFeedback`). Produção grava; o QA
 * Lab implementa a mesma porta sem gravar nada (store em memória, publicação simulada).
 */
export type ReliableFeedbackEffects = {
  generate(db: Database, request: ReliableGenerationRequest): Promise<ReliableGenerationResult>
  /** Output FOLLOW_UP + O próprio operador — idempotente por nó Output. */
  publishFollowUp(db: Database, input: PublishReliableInput): Promise<{ caseId: string; feedbackId: string; reused: boolean }>
}

export const productionReliableFeedbackEffects: ReliableFeedbackEffects = {
  generate: (db, request) => generateReliableFeedback(createReliableGenerationDeps({ db }), request),
  publishFollowUp: (db, input) => publishReliableFeedbackToFollowUp(db, createPostgresReliableFeedbackStore(db), input),
}
