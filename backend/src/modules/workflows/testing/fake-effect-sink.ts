import { vi, type Mock } from "vitest"
import type { WorkflowEffectSink } from "../application/effect-sink.js"

type Spied<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K] }
export type FakeEffects = Omit<Spied<WorkflowEffectSink>, "agentRuns" | "interactionFeedback" | "reliableFeedback" | "conversational" | "feedbackEngine" | "interventions"> & { agentRuns: Spied<WorkflowEffectSink["agentRuns"]>; interactionFeedback: Spied<WorkflowEffectSink["interactionFeedback"]>; reliableFeedback: Spied<WorkflowEffectSink["reliableFeedback"]>; conversational: Spied<WorkflowEffectSink["conversational"]>; feedbackEngine: Spied<WorkflowEffectSink["feedbackEngine"]>; interventions: Spied<WorkflowEffectSink["interventions"]> }

/**
 * Sink de efeitos com espiões — só pra testes (nunca importado por código de produção). Cada
 * primitivo é um `vi.fn` que não grava nada; os testes inspecionam as chamadas em vez de
 * mockar módulos inteiros (`vi.mock("./dispatch-alert.js")`), que deixou de funcionar quando os
 * executores passaram a chamar `context.effects.*` (ver effect-sink.ts).
 */
export function createFakeEffects(overrides: Partial<FakeEffects> = {}): FakeEffects {
  return {
    dispatchAlert: vi.fn(async () => {}),
    recordWorkflowKnowledgeUsage: vi.fn(async () => {}),
    dispatchWorkflowOutputRows: vi.fn(async () => {}),
    publishFeedback: vi.fn(async () => ({ caseId: "case-fake", feedbackId: "feedback-fake" })),
    setConfigValue: vi.fn(async () => {}),
    findRecentCaseId: vi.fn(async () => null),
    agentRuns: {
      start: vi.fn(async () => "agent-run-fake"),
      complete: vi.fn(async () => {}),
      fail: vi.fn(async () => {}),
    },
    interactionFeedback: {
      persistedSelection: vi.fn(async () => []),
      selectedInteractionIds: vi.fn(async () => []),
      reserveSelection: vi.fn(async (_db, requests) => requests.map((request) => request.interactionId)),
      generate: vi.fn(async () => { throw new Error("generate não configurado neste teste") }),
    },
    reliableFeedback: {
      generate: vi.fn(async () => { throw new Error("reliableFeedback.generate não configurado neste teste") }),
      publishFollowUp: vi.fn(async () => ({ caseId: "case-fake", feedbackId: "feedback-fake", reused: false })),
    },
    conversational: {
      reliableProjectionSource: vi.fn(async (_db, input) => ({ kind: "FEEDBACK_TEXT" as const, domain: input.nodeOutput.domain, label: input.nodeOutput.label, card: input.nodeOutput.presentation?.card ?? null, fullText: input.nodeOutput.text })),
      deliverChat: vi.fn(async () => ({ outputId: "output-fake", conversationId: "conversation-fake", reused: false })),
      offerAvatar: vi.fn(async () => ({ outputId: "avatar-output-fake", reused: false })),
    },
    feedbackEngine: {
      analyzeCall: vi.fn(async () => { throw new Error("feedbackEngine.analyzeCall não configurado neste teste") }),
      investigateIndicator: vi.fn(async () => { throw new Error("feedbackEngine.investigateIndicator não configurado neste teste") }),
      generate: vi.fn(async () => { throw new Error("feedbackEngine.generate não configurado neste teste") }),
      publishFollowUp: vi.fn(async () => ({ caseId: "case-fake", feedbackId: "feedback-fake", reused: false })),
      projectionSource: vi.fn(async () => ({ kind: "TEXT" as const, title: null, text: "texto" })),
      markDelivered: vi.fn(async () => {}),
      deliveredMonitoring: vi.fn(async () => null),
      deliverySkip: vi.fn(async () => null),
    },
    interventions: {
      recorded: vi.fn(async () => null),
      apply: vi.fn(async () => { throw new Error("interventions.apply não configurado neste teste") }),
      generateNarrative: vi.fn(async () => ({ status: "READY" as const, attempt: 1, error: null })),
    },
    ...overrides,
  }
}
