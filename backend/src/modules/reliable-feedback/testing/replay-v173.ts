import fixture from "./contestacao-v173-smoke-fixture.json" with { type: "json" }
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, type ReliableGenerationDeps } from "../application/generate-reliable-feedback.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import type { PublishedKnowledgeDocument } from "../domain/process-assessment.js"
import type { ReliableFeedbackWriterPort } from "../application/ports.js"

/**
 * REPLAY do SMOKE-V173 (Larissa) SEM MODELO, a partir dos insumos REAIS congelados (`contestacao-v173-smoke-fixture.json`):
 * transcrição e contexto da interação, a saída real do Orquestrador (avaliação de processo + trechos apresentados), a resposta
 * real do redator e as versões publicadas da base. Com o código da época, reproduz o artefato gravado item a item; com o código
 * atual, é o diagnóstico CORRETO do mesmo caso (ex.: aplicabilidade dos subitens da recapitulação).
 */
type Fixture = {
  sourceType: "ORCHESTRATOR"
  context: { transcript: string; label: string; otherOperatorNames: string[]; subjectOperatorName: string | null }
  sourceNodeOutput: unknown
  writerRawOutput: unknown
  published: PublishedKnowledgeDocument[]
}
export const V173_FIXTURE = fixture as unknown as Fixture
export const V173_ORG = "00000000-0000-4000-8000-000000000001"
export const V173_COLLABORATOR = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
export const V173_INTERACTION = "b43f6eb2-9973-4457-9396-a274a284cf5e"

export async function replayV173(options: { writer?: Partial<ReliableFeedbackWriterPort> } = {}) {
  const store = createInMemoryReliableFeedbackStore({ onReactivate: () => true })
  const writer: ReliableFeedbackWriterPort = { writeMonitoring: async () => ({ rawOutput: V173_FIXTURE.writerRawOutput }), writeIndicator: async () => { throw new Error("não usado") }, ...options.writer }
  const deps: ReliableGenerationDeps = {
    enabled: true, store, writer, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    loadMonitoringContext: async () => V173_FIXTURE.context,
    loadIndicatorContext: async () => null,
    loadPublishedKnowledge: async (_organizationId, ids) => new Map(V173_FIXTURE.published.filter((document) => ids.includes(document.documentId)).map((document) => [document.documentId, document])),
    loadIndicatorDiagnosisPlan: async () => null, loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null,
    loadRecipient: async () => ({ firstName: "Larissa" }), now: () => new Date("2026-09-28T18:29:48Z"),
  }
  const result = await generateReliableFeedback(deps, { organizationId: V173_ORG, enrollmentId: "79d252cd-61e3-465a-b34b-21d1197a4d5e", workflowId: "wf", workflowVersionId: "v", nodeId: "72201d41-aa27-401c-b1ff-ae663c84e615", sourceNodeId: "922e9da5-2299-4dfe-9840-9af449c4ae84", sourceType: V173_FIXTURE.sourceType, domain: "MONITORING", sourceNodeOutput: V173_FIXTURE.sourceNodeOutput, collaboratorId: V173_COLLABORATOR, interactionId: V173_INTERACTION, indicatorMeasurementId: null, configuredAgentId: null })
  return { result, artifact: result.record.artifact!, store }
}
