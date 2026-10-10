import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"

const flags = vi.hoisted(() => ({ pipeline: "ON" as "ON" | "OFF" }))
vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: new Proxy(original.env, { get: (target, key) => (key === "INIA_INTERACTION_FEEDBACK_PIPELINE" ? flags.pipeline : key === "INIA_FEEDBACK_DELIVERY_POLICY" ? "AUTONOMOUS_V1" : Reflect.get(target, key)) }) }
})

const { SimulationEffectSink } = await import("./simulation-effect-sink.js")
const { simulateInteractionFeedbackGeneration } = await import("../../interaction-feedback/application/simulate-interaction-feedback.js")
const { composeInteractionFeedback } = await import("../../investigation/domain/interaction-feedback.js")
const { fakeWriter } = await import("../../interaction-feedback/testing/fake-semantic-model.js")

const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I1", interactionId: "x", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
function strengthFeedback() {
  const action = { id: "A1", kind: "AGENT_ACTION", summary: "s", evidence: [unit("T3", "OPERADOR", "O prazo de entrega é de até cinco dias úteis a partir de hoje.")] }
  const frame = { interactionRef: "I1", interactionId: "x", source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: [action], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], interactionEvents: [], empty: false, findings: [{ id: "F1", interactionRef: "I1", kind: "STRENGTH", summary: "s", observationRefs: ["A1"], evidence: action.evidence, quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_A", attribution: "OPERATOR", declaredKind: null, handle: "SF1", ownership: "AGENT" }] }
  return composeInteractionFeedback({ subject: { collaboratorRef: "c" }, frame: frame as never, interactionLabel: "Atendimento de 14/03/2026", sourceRun: "t" })
}
const request = { organizationId: "org", collaboratorId: "op", interactionId: "int-1", intent: { kind: "WORKFLOW_ACTION" as const, workflowId: "wf", workflowVersionId: null, nodeId: "gerar", enrollmentId: "enr" }, selection: { source: "TRIGGER_INTERACTION" as const, strategy: null, rank: null } }

describe("V1.5.10 — QA Lab simula \"Gerar feedback de atendimento\" sem efeito real", () => {
  it("I) mesma preparação + pipeline + política, store EFÊMERO: resultado conceitual (AUTO_DELIVER) e ZERO escrita no banco", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
    const db = { query } as unknown as Database
    const writer = fakeWriter()
    const outcome = await simulateInteractionFeedbackGeneration(db, request, { writer, prepare: async () => ({ kind: "PREPARED", feedback: strengthFeedback(), runContext: { organizationId: "org", collaboratorId: "op", teamId: null, interactionId: "int-1", occurredAt: null }, requests: [] }) })
    expect(outcome).toMatchObject({ status: "GENERATED", dispositions: { AUTO_DELIVER: 1, HOLD_FOR_QA: 0, BLOCKED: 0 }, runId: null, generationId: null, policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1" })
    // Nenhum run/revisão/decisão/geração/entrega gravado: o banco não foi tocado.
    expect(query).not.toHaveBeenCalled()
    expect(writer.calls).toHaveLength(1)
  })

  it("o sink registra o efeito INTERACTION_FEEDBACK (só códigos seguros), não reserva nada e não cria entrega/notificação", async () => {
    const sink = new SimulationEffectSink([], { simulateInteractionFeedback: async () => ({ status: "GENERATED", notAnalyzableReason: null, feedbackStatus: "HAS_POINTS", runId: null, writerInvoked: true, dispositions: { AUTO_DELIVER: 0, HOLD_FOR_QA: 1, BLOCKED: 0 }, reasons: ["FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY"], policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1", interactionId: "int-1", generationId: null, reused: false }) })
    sink.beginNode("gerar")
    const db = { query: vi.fn() } as unknown as Database
    expect(await sink.interactionFeedback.reserveSelection(db, [request])).toEqual(["int-1"])
    expect(await sink.interactionFeedback.persistedSelection(db, { organizationId: "org", workflowId: "wf", nodeId: "gerar", enrollmentId: "enr" })).toEqual([])
    await sink.interactionFeedback.generate(db, request)
    expect(sink.effects).toEqual([{ kind: "INTERACTION_FEEDBACK", id: 1, nodeId: "gerar", interactionId: "int-1", status: "GENERATED", notAnalyzableReason: null, feedbackStatus: "HAS_POINTS", writerInvoked: true, dispositions: { AUTO_DELIVER: 0, HOLD_FOR_QA: 1, BLOCKED: 0 }, reasons: ["FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY"], policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1" }])
    expect(db.query).not.toHaveBeenCalled()
  })

  it("módulo desligado: a simulação também não roda", async () => {
    flags.pipeline = "OFF"
    await expect(simulateInteractionFeedbackGeneration({ query: vi.fn() } as unknown as Database, request, { writer: fakeWriter() })).rejects.toThrow(/desligado/)
    flags.pipeline = "ON"
  })
})
