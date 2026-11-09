import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { DeliverySkip } from "../../feedback-engine/domain/delivery-guards.js"
import { answerAgentVersionQuery } from "../../agents/testing/agent-version-fakes.js"
import type { ActionConfig, FlowGraph } from "../domain/graph-schema.js"
import { actionExecutors, type ActionExecutionContext } from "./action-executors.js"
import type { WorkflowEffectSink } from "./effect-sink.js"
import { executeOrchestrator } from "./orchestrator-executor.js"
import { executeOutput } from "./output-executor.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"

const resolveOrchestratorById = vi.fn()
const runOrchestratedReply = vi.fn()
vi.mock("../../assistant/application/resolve-orchestrator.js", () => ({ resolveOrchestratorById: (...args: unknown[]) => resolveOrchestratorById(...args) }))
vi.mock("../../assistant/application/run-orchestrated-reply.js", async (importOriginal) => ({ ...(await importOriginal<object>()), runOrchestratedReply: (...args: unknown[]) => runOrchestratedReply(...args) }))

/**
 * REGRAS DE ENTREGA ÚNICA no Workflow (`ONE_MONITORING_PER_CALL_V1`, `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1`) — zero IA, zero banco.
 * Chamada já monitorada: "Chamar agente"/Orquestrador com avaliação de processo não analisam nada; mensagem que não pode sair: o
 * Output não publica por NENHUMA superfície e a execução segue com o motivo na saída do nó (não é falha).
 */
// PEN-002: "Chamar agente" resolve a versão vigente do agente (ativo) antes de qualquer coisa — o agente do nó existe e está ativo.
const db = {
  query: vi.fn(async (sql: string, params?: unknown[]) =>
    answerAgentVersionQuery(sql, params, (agentId) => (agentId === "agent-1" ? { id: agentId, active: true } : undefined)) ??
    (sql.includes("from interactions") ? { rows: [{ operator_id: "operator-1" }], rowCount: 1 } : { rows: [], rowCount: 0 })),
} as unknown as Database
const monitored = { source: "PUBLISHED_FEEDBACK" as const, id: "feedback-earlier", deliveredAt: new Date("2026-10-03T14:00:00Z") }
const engineMessage = { kind: "FEEDBACK_ENGINE_MESSAGE", messageId: "message-2", domain: "MONITORING", disposition: "READY", label: "Contestação", card: "c", text: "t", analysisRunIds: ["run-2"], findings: { developments: 1, strengths: 1, suppressed: 0 }, limitations: [], reused: false }

function outputContext(effects: ReturnType<typeof createFakeEffects>) {
  return { db, organizationId: "org-1", enrollmentId: "enrollment-1", nodeId: "output-1", nodeOutputs: { gen: engineMessage }, enrollment: { interactionId: "interaction-1", indicatorMeasurementId: null, scheduledSubjectId: null }, effects: effects as unknown as WorkflowEffectSink }
}

describe("Output — a mensagem do motor não sai quando a regra de entrega única impede", () => {
  it("chamada já monitorada: nada sai por Acompanhamento, Notificação, Chat nem Avatar; o motivo fica na saída do nó", async () => {
    const skip: DeliverySkip = { reason: "CALL_ALREADY_MONITORED", interactionId: "interaction-1", existing: monitored }
    const effects = createFakeEffects()
    effects.feedbackEngine.deliverySkip.mockResolvedValue(skip)
    const result = await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["NOTIFICATION", "FOLLOW_UP", "CHAT", "AVATAR"], source: "nodeOutputs.gen" }, outputContext(effects))
    expect(effects.feedbackEngine.publishFollowUp).not.toHaveBeenCalled()
    expect(effects.dispatchAlert).not.toHaveBeenCalled()
    expect(effects.conversational.deliverChat).not.toHaveBeenCalled()
    expect(effects.conversational.offerAvatar).not.toHaveBeenCalled()
    expect(effects.feedbackEngine.markDelivered).not.toHaveBeenCalled()
    expect(result.nodeOutput).toMatchObject({ caseId: null, feedbackId: null, notPublished: { reason: "CALL_ALREADY_MONITORED" } })
    expect((result.nodeOutput as { notPublished: { text: string } }).notPublished.text).toContain("2026-10-03")
  })

  it("corrida: a checagem prévia passou, mas a publicação (com trava) encontrou o período entregue — as superfícies seguintes também não saem", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.publishFollowUp.mockResolvedValue({ caseId: null, feedbackId: null, reused: false, skipped: { reason: "PERIOD_ALREADY_DELIVERED", periods: ["TMA|2026-09-01|2026-09-30"] } })
    const result = await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP", "NOTIFICATION", "CHAT"], source: "nodeOutputs.gen" }, outputContext(effects))
    expect(effects.feedbackEngine.publishFollowUp).toHaveBeenCalledOnce()
    expect(effects.dispatchAlert).not.toHaveBeenCalled()
    expect(effects.conversational.deliverChat).not.toHaveBeenCalled()
    expect(result.nodeOutput).toMatchObject({ caseId: null, notPublished: { reason: "PERIOD_ALREADY_DELIVERED" } })
  })

  it("sem impedimento: publica normalmente e a saída do nó não traz motivo", async () => {
    const effects = createFakeEffects()
    const result = await executeOutput({ target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.gen" }, outputContext(effects))
    expect(result.nodeOutput).toEqual({ caseId: "case-fake", feedbackId: "feedback-fake" })
  })
})

describe("Origem da monitoria — chamada já monitorada não é analisada de novo (zero IA)", () => {
  it("Orquestrador com avaliação de processo: não roteia nem chama especialista", async () => {
    resolveOrchestratorById.mockReset().mockResolvedValue({ orchestratorId: "orch-1", orchestratorName: "Monitoria", orchestratorAgentId: "a", systemPrompt: "", specialists: [], tools: [], outputInstructions: null })
    runOrchestratedReply.mockReset()
    const effects = createFakeEffects()
    effects.feedbackEngine.deliveredMonitoring.mockResolvedValue(monitored)
    const engine = { effects: effects as unknown as WorkflowEffectSink, organizationId: "org-1", workflowId: "wf-2", enrollmentId: "enrollment-2", nodeId: "orch", matchedFlagName: "contestacao" }
    const result = await executeOrchestrator({ orchestratorId: "orch-1", instruction: "Avalie", specialistOutputContract: "PROCESS_ASSESSMENT" }, { db, organizationId: "org-1", inputContext: "", workflowScope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }, enrollment: { interactionId: "interaction-1", indicatorMeasurementId: null, scheduledSubjectId: null }, engine })
    expect(runOrchestratedReply).not.toHaveBeenCalled()
    expect(result.nodeOutput).toMatchObject({ skippedReason: "CALL_ALREADY_MONITORED", calls: [], results: [] })
  })

  it("\"Chamar agente\" com avaliação de processo: não analisa a chamada", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.deliveredMonitoring.mockResolvedValue(monitored)
    const context: ActionExecutionContext = {
      db, organizationId: "org-1", workflowId: "wf-2", workflowVersionId: null, nodeId: "agent", graph: { nodes: [], edges: [] } as FlowGraph,
      enrollment: { id: "enrollment-2", interactionId: "interaction-1", indicatorMeasurementId: null, scheduledSubjectId: null, matchedFlagName: "contestacao", matchedValueBoolean: true, matchedValueNumeric: null, nodeOutputs: {}, variables: {} },
      scopeType: "ALL_TEAMS", teamId: null, subteamId: null, inputContext: "", now: new Date("2026-10-05T12:00:00Z"), effects,
    }
    const config = { actionType: "CALL_AGENT", agentId: "agent-1", outputContract: "PROCESS_ASSESSMENT" } as ActionConfig
    const result = await actionExecutors.CALL_AGENT(config, context)
    expect(effects.feedbackEngine.analyzeCall).not.toHaveBeenCalled()
    expect(result.nodeOutput).toMatchObject({ kind: "FEEDBACK_ENGINE_CALL_ALREADY_MONITORED", skippedReason: "CALL_ALREADY_MONITORED", personId: "operator-1", existing: { id: "feedback-earlier" } })
  })
})
