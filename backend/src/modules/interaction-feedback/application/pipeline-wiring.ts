import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { createGeminiFeedbackWriter } from "../infrastructure/gemini-feedback-writer.js"
import { createPostgresInteractionFeedbackStore } from "../infrastructure/postgres-interaction-feedback-store.js"
import type { FeedbackWriterPort } from "./ports.js"
import type { PipelineDeps } from "./interaction-feedback-pipeline.js"
import { FEEDBACK_DELIVERY_POLICIES } from "../domain/feedback-delivery-policy.js"
import { createPostgresFeedbackGenerationRegistry } from "../infrastructure/postgres-feedback-generation-registry.js"
import type { GenerationDeps } from "./generate-interaction-feedback.js"
import { prepareInteractionForFeedback } from "./prepare-interaction-for-feedback.js"

/**
 * Montagem do pipeline para o runtime: flag `INIA_INTERACTION_FEEDBACK_PIPELINE` (OFF por padrão = nada roda) + store
 * Postgres + o redator (padrão: adapter Gemini do piloto, V1.5.1; injetável) + a política de entrega escolhida por
 * `INIA_FEEDBACK_DELIVERY_POLICY` (V1.5.9: PILOT_V1 = 100% HOLD_FOR_QA, o padrão; AUTONOMOUS_V1 = QA só por exceção). Com a flag OFF o pipeline retorna antes de
 * qualquer leitura/escrita/chamada. Nenhum fluxo existente chama esta função ainda — a fiação no caminho de monitoria e a
 * entrega ao colaborador são etapas seguintes.
 */
export function createInteractionFeedbackPipelineDeps(input: { db: Pick<Database, "query">; writer?: FeedbackWriterPort; clock?: Clock }): PipelineDeps {
  const clock = input.clock ?? systemClock
  return { enabled: env.INIA_INTERACTION_FEEDBACK_PIPELINE === "ON", writer: input.writer ?? createGeminiFeedbackWriter(), store: createPostgresInteractionFeedbackStore(input.db), now: () => clock.now(), deliveryPolicy: FEEDBACK_DELIVERY_POLICIES[env.INIA_FEEDBACK_DELIVERY_POLICY] }
}

/** A MESMA decisão que monta as rotas em app.ts e a que o publish/executor do Workflow consultam (V1.5.10). */
export function interactionFeedbackModuleEnabled(): boolean {
  return env.INIA_INTERACTION_FEEDBACK_PIPELINE === "ON"
}

/**
 * V1.5.10 — geração pedida pelo Workflow: pipeline de produção (acima) + registro de gerações Postgres + preparação
 * semântica DIRETA (sem Planner). Precisa do `Database` inteiro porque a preparação usa o mesmo núcleo das Tools.
 */
export function createInteractionFeedbackGenerationDeps(input: { db: Database; writer?: FeedbackWriterPort; clock?: Clock }): GenerationDeps {
  const pipeline = createInteractionFeedbackPipelineDeps(input)
  return { pipeline, registry: createPostgresFeedbackGenerationRegistry(input.db), prepare: (request) => prepareInteractionForFeedback(input.db, request), now: pipeline.now }
}
