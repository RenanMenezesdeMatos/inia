import type { Database } from "../../../infrastructure/database/pool.js"
import type { DeliveredMonitoring, DeliverySkip } from "../domain/delivery-guards.js"
import type { PublishEngineResult } from "../infrastructure/publish-engine-feedback.js"
import { deliverySkipFromMemory } from "./delivery-skip.js"
import { systemClock, type Clock } from "../../../shared/domain/clock.js"
import { resolveExecutionStrategy } from "../../indicator-diagnosis/application/diagnostic-strategy-service.js"
import { runtimeParametersOf } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import type { ProjectionSource } from "../../conversational-delivery/domain/surface-projection.js"
import { describeCallAnalysis, analyzeCall, type AnalyzeCallDeps, type AnalyzeCallRequest } from "./analyze-call.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest, type GenerateFeedbackResult } from "./generate-feedback.js"
import { investigateIndicator, type InvestigateIndicatorDeps, type InvestigateIndicatorRequest, type InvestigateIndicatorResult } from "./investigate-indicator.js"
import type { EngineModelPort, FeedbackMemoryStore, FeedbackMessageStore } from "./ports.js"
import { DEFAULT_ENGINE_BUDGET, EngineMeter, meteredModel, type EngineBudgetLimits, type EnginePrice } from "./engine-meter.js"
import { createCatalogToolRunner, type CatalogToolRunner } from "../infrastructure/catalog-tool-runner.js"
import { CALL_ANALYSIS_NODE_OUTPUT_KIND, type CallAnalysisNodeOutput } from "../domain/node-output.js"
import { createGatewayEngineModel } from "../infrastructure/gateway-engine-model.js"
import { createPostgresFeedbackMemoryStore } from "../infrastructure/postgres-feedback-memory-store.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../infrastructure/overlay-feedback-memory-store.js"
import { createPostgresIndicatorData } from "../infrastructure/postgres-indicator-data.js"
import { loadAgentDocumentsAt, loadAgentProfile, loadDocumentTitles, loadInteractionForAnalysis, loadPreviousPublishedVersion } from "../infrastructure/postgres-engine-loaders.js"
import { deliveredViewOf, engineProjectionSource, publishEngineFeedbackToFollowUp, type PublishEngineInput } from "../infrastructure/publish-engine-feedback.js"
import { loadArgumentScriptsInForce } from "../../argument-scripts/infrastructure/argument-script-loaders.js"

/**
 * MONTAGEM do motor de feedback e a FRONTEIRA DE EFEITOS do Workflow (`WorkflowEffectSink.feedbackEngine`). Produção grava na
 * memória real; o QA Lab usa a mesma lógica com memória em RAM (nada gravado). Sem chave de módulo: o motor é o caminho único
 * de "Gerar feedback" e não depende de QA nem de aprovação.
 */
export type EngineStores = FeedbackMemoryStore & FeedbackMessageStore & { markDelivered(organizationId: string, messageId: string, at: Date): Promise<void> }

/**
 * Uma montagem = UMA execução (nó do Workflow, simulação, avaliação): o modelo é sempre o MEDIDO (`engine-meter.ts`), com um
 * medidor por montagem — análise, revisão, planejamento, análises disparadas por ferramentas, redação e verificação gastam do
 * mesmo orçamento. `tools: null` = sem ferramentas do catálogo (só as do motor).
 */
export function createEngineDeps(input: { db: Database; model?: EngineModelPort; stores?: EngineStores; clock?: Clock; maxCallAnalyses?: number; peerCallAnalyses?: boolean; organizePractices?: boolean; allowCollaborator?: (collaboratorId: string) => boolean; budget?: EngineBudgetLimits; price?: EnginePrice | null; tools?: CatalogToolRunner | null; maxToolCalls?: number }): GenerateFeedbackDeps & { stores: EngineStores; meter: EngineMeter } {
  const clock = input.clock ?? systemClock
  const stores = input.stores ?? createPostgresFeedbackMemoryStore(input.db)
  const meter = new EngineMeter(input.budget ?? DEFAULT_ENGINE_BUDGET, () => Date.now(), input.price ?? null)
  const model = meteredModel(input.model ?? createGatewayEngineModel(), meter)
  const tools = input.tools === null ? undefined : input.tools ?? createCatalogToolRunner(input.db)
  const analyze: AnalyzeCallDeps = {
    memory: stores,
    model,
    loadInteraction: (organizationId, interactionId) => loadInteractionForAnalysis(input.db, organizationId, interactionId),
    loadAgent: (organizationId, agentId) => loadAgentProfile(input.db, organizationId, agentId),
    loadDocuments: (organizationId, agentId, at) => loadAgentDocumentsAt(input.db, organizationId, agentId, at),
    loadPreviousVersion: (organizationId, documentId, version) => loadPreviousPublishedVersion(input.db, organizationId, documentId, version),
    loadArgumentScripts: (organizationId, person, at) => loadArgumentScriptsInForce(input.db, organizationId, person, at),
    now: () => clock.now(),
    ...(input.allowCollaborator ? { allowCollaborator: input.allowCollaborator } : {}),
    organizePractices: input.organizePractices ?? true,
  }
  const investigate: InvestigateIndicatorDeps = {
    memory: stores,
    data: createPostgresIndicatorData(input.db),
    analyze,
    strategy: async (organizationId, enrollmentId, indicatorId) => runtimeParametersOf(await resolveExecutionStrategy(input.db, organizationId, { enrollmentId, indicatorId })),
    now: () => clock.now(),
    ...(input.maxCallAnalyses !== undefined ? { maxCallAnalyses: input.maxCallAnalyses } : {}),
    ...(input.peerCallAnalyses !== undefined ? { peerCallAnalyses: input.peerCallAnalyses } : {}),
    ...(tools ? { tools } : {}),
    ...(input.maxToolCalls !== undefined ? { maxToolCalls: input.maxToolCalls } : {}),
  }
  return {
    stores,
    meter,
    memory: stores,
    messages: stores,
    model,
    analyze,
    investigate,
    loadDocumentTitles: (organizationId, documentIds) => loadDocumentTitles(input.db, organizationId, documentIds),
    loadAgentConfiguredAt: async (organizationId, agentId) => (await loadAgentProfile(input.db, organizationId, agentId))?.updatedAt.toISOString() ?? null,
    now: () => clock.now(),
  }
}

/** Resultado da análise de chamada como saída de nó (referência + resumo legível). */
export async function callAnalysisNodeOutput(deps: GenerateFeedbackDeps, request: AnalyzeCallRequest): Promise<CallAnalysisNodeOutput> {
  const result = await analyzeCall(deps.analyze, request)
  const analysis = result.assessment?.analysis ?? null
  const count = (status: string) => analysis?.criteria.filter((criterion) => criterion.status === status && !criterion.ruleConflict).length ?? 0
  return {
    kind: CALL_ANALYSIS_NODE_OUTPUT_KIND,
    analysisRunId: result.runId,
    callAssessmentId: result.assessment?.id ?? null,
    interactionId: request.interactionId,
    personId: request.collaboratorId,
    agentId: request.agentId,
    outcome: result.outcome,
    reused: result.reused,
    summary: { procedure: analysis?.scenario.procedureTitle ?? null, pathAssessment: analysis?.scenario.pathAssessment ?? "NO_PROCEDURE", met: count("MET"), notMet: count("NOT_MET"), partial: count("PARTIAL"), notObservable: count("NOT_OBSERVABLE"), coverage: analysis?.coverage.status ?? "PARTIAL" },
    text: analysis ? describeCallAnalysis(analysis) : `Análise da chamada sem conclusão (${result.outcomeReasons.join(", ")}).`,
  }
}

export type FeedbackEngineEffects = {
  analyzeCall(db: Database, request: AnalyzeCallRequest): Promise<CallAnalysisNodeOutput>
  investigateIndicator(db: Database, request: InvestigateIndicatorRequest): Promise<InvestigateIndicatorResult>
  generate(db: Database, request: GenerateFeedbackRequest): Promise<GenerateFeedbackResult>
  publishFollowUp(db: Database, input: PublishEngineInput): Promise<PublishEngineResult>
  /** `ONE_MONITORING_PER_CALL_V1` — monitoria já entregue desta chamada, ou null. Só leitura (checagem antes de pagar a análise). */
  deliveredMonitoring(db: Database, input: { organizationId: string; interactionId: string }): Promise<DeliveredMonitoring | null>
  /** Regras de entrega única para ESTA mensagem (sem trava) — antes de entregar por Chat/Avatar. null = pode entregar. */
  deliverySkip(db: Database, input: { organizationId: string; messageId: string }): Promise<DeliverySkip | null>
  projectionSource(db: Database, input: { organizationId: string; recipientId: string; messageId: string }): Promise<ProjectionSource>
  markDelivered(db: Database, input: { organizationId: string; messageId: string; at: Date }): Promise<void>
}

export const productionFeedbackEngineEffects: FeedbackEngineEffects = {
  analyzeCall: (db, request) => callAnalysisNodeOutput(createEngineDeps({ db }), request),
  investigateIndicator: (db, request) => investigateIndicator(createEngineDeps({ db }).investigate, request),
  generate: (db, request) => generateFeedback(createEngineDeps({ db }), request),
  publishFollowUp: (db, input) => publishEngineFeedbackToFollowUp(db, input),
  deliveredMonitoring: (db, input) => createPostgresFeedbackMemoryStore(db).deliveredMonitoringOf(input.organizationId, input.interactionId),
  async deliverySkip(db, input) {
    const store = createPostgresFeedbackMemoryStore(db)
    const message = await store.getMessage(input.organizationId, input.messageId)
    return message ? deliverySkipFromMemory(store, message) : null
  },
  projectionSource: (db, input) => engineProjectionSource(db, input),
  markDelivered: (db, input) => createPostgresFeedbackMemoryStore(db).markDelivered(input.organizationId, input.messageId, input.at),
}

/**
 * QA Lab: a MESMA lógica (análise, investigação, composição) com memória em RAM — nada é gravado, nada é publicado. Leituras do
 * banco (interação, base, indicadores) continuam reais e somente leitura.
 */
export function createSimulationFeedbackEngineEffects(options: { model?: EngineModelPort } = {}): FeedbackEngineEffects & { stores: ReturnType<typeof createInMemoryFeedbackMemoryStore> } {
  const stores = createInMemoryFeedbackMemoryStore()
  // Memória SOBREPOSTA: a memória real (somente leitura, pelo `db` da simulação) + a RAM da simulação — o que a simulação analisa
  // fica visível para a própria investigação; nada é gravado.
  const deps = (db: Database) => createEngineDeps({ db, stores: createOverlayFeedbackMemoryStore(createPostgresFeedbackMemoryStore(db), stores), ...(options.model ? { model: options.model } : {}) })
  return {
    stores,
    analyzeCall: (db, request) => callAnalysisNodeOutput(deps(db), request),
    investigateIndicator: (db, request) => investigateIndicator(deps(db).investigate, request),
    generate: (db, request) => generateFeedback(deps(db), request),
    async publishFollowUp(db, input) {
      const message = await stores.getMessage(input.organizationId, input.messageId)
      if (!message || message.status !== "PUBLISHABLE" || message.personId !== input.recipientId) throw new Error("Mensagem do motor não publicável (simulação).")
      const skipped = await deliverySkipFromMemory(deps(db).memory, message)
      if (skipped) return { caseId: null, feedbackId: null, reused: false, skipped }
      await stores.markDelivered(input.organizationId, input.messageId, new Date())
      return { caseId: `sim-case-${input.messageId}`, feedbackId: `sim-feedback-${input.messageId}`, reused: false }
    },
    async projectionSource(db, input) {
      const message = await stores.getMessage(input.organizationId, input.messageId)
      if (!message || !message.message || !message.brief) throw new Error("Mensagem do motor não publicável (simulação).")
      return { kind: "FEEDBACK_VIEW", domain: message.domain, label: message.brief.label, view: await deliveredViewOf(db, input.organizationId, input.recipientId, message.message.view), fullText: message.message.text }
    },
    markDelivered: (_db, input) => stores.markDelivered(input.organizationId, input.messageId, input.at),
    deliveredMonitoring: (db, input) => deps(db).memory.deliveredMonitoringOf(input.organizationId, input.interactionId),
    async deliverySkip(db, input) {
      const message = await stores.getMessage(input.organizationId, input.messageId)
      return message ? deliverySkipFromMemory(deps(db).memory, message) : null
    },
  }
}
