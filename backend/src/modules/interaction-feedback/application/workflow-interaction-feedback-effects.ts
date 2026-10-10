import type { Database } from "../../../infrastructure/database/pool.js"
import { createPostgresFeedbackGenerationRegistry } from "../infrastructure/postgres-feedback-generation-registry.js"
import { generateInteractionFeedback, newGenerationOf, type GenerationOutcome, type GenerationRequest } from "./generate-interaction-feedback.js"
import { createInteractionFeedbackGenerationDeps } from "./pipeline-wiring.js"

/**
 * V1.5.10 — a fronteira de efeitos da ação de Workflow "Gerar feedback de atendimento" (plugada em
 * `WorkflowEffectSink.interactionFeedback`). Produção grava seleção/gerações/runs de verdade; o QA Lab implementa a MESMA
 * porta sem gravar nada (qa-lab/application/simulation-effect-sink.ts). Leituras de seleção passam pela porta porque
 * reservar é um efeito.
 */
export type SelectionScope = { organizationId: string; workflowId: string; nodeId: string }
export type InteractionFeedbackEffects = {
  /** Seleção já persistida por ESTA execução (retry) — vazio quando ainda não houve seleção. */
  persistedSelection(db: Database, scope: SelectionScope & { enrollmentId: string }): Promise<string[]>
  /** Interações que este nó já atendeu/reservou — ficam fora de novas amostras. */
  selectedInteractionIds(db: Database, scope: SelectionScope): Promise<string[]>
  /** Reserva a amostra e devolve a seleção EFETIVA desta execução (o que outra execução já possui não entra). */
  reserveSelection(db: Database, requests: GenerationRequest[]): Promise<string[]>
  generate(db: Database, request: GenerationRequest): Promise<GenerationOutcome>
}

export const productionInteractionFeedbackEffects: InteractionFeedbackEffects = {
  persistedSelection: (db, scope) => createPostgresFeedbackGenerationRegistry(db).listSelection(scope),
  selectedInteractionIds: (db, scope) => createPostgresFeedbackGenerationRegistry(db).selectedInteractionIds(scope),
  async reserveSelection(db, requests) {
    const first = requests[0]
    if (!first || !first.intent.enrollmentId) return []
    const registry = createPostgresFeedbackGenerationRegistry(db)
    await registry.reserveSelection(requests.map(newGenerationOf), new Date())
    return registry.listSelection({ organizationId: first.organizationId, workflowId: first.intent.workflowId, nodeId: first.intent.nodeId, enrollmentId: first.intent.enrollmentId })
  },
  generate: (db, request) => generateInteractionFeedback(createInteractionFeedbackGenerationDeps({ db }), request),
}
