import { describe, expect, it, vi } from "vitest"
import { composeInteractionFeedback } from "../../investigation/domain/interaction-feedback.js"
import { FEEDBACK_AUTONOMOUS_DELIVERY_POLICY } from "../domain/feedback-delivery-policy.js"
import { createInMemoryFeedbackGenerationRegistry } from "../testing/in-memory-feedback-generation-registry.js"
import { createInMemoryInteractionFeedbackStore } from "../testing/in-memory-interaction-feedback-store.js"
import { fakeWriter } from "../testing/fake-semantic-model.js"
import { generateInteractionFeedback, GenerationInProgressError, InteractionFeedbackModuleDisabledError, type GenerationDeps, type GenerationRequest } from "./generate-interaction-feedback.js"
import type { PreparedInteraction } from "./prepare-interaction-for-feedback.js"

const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I1", interactionId: "x", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
function strengthFeedback() {
  const action = { id: "A1", kind: "AGENT_ACTION", summary: "s", evidence: [unit("T3", "OPERADOR", "O prazo de entrega é de até cinco dias úteis a partir de hoje.")] }
  const frame = { interactionRef: "I1", interactionId: "x", source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: [action], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], interactionEvents: [], empty: false, findings: [{ id: "F1", interactionRef: "I1", kind: "STRENGTH", summary: "s", observationRefs: ["A1"], evidence: action.evidence, quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_A", attribution: "OPERATOR", declaredKind: null, handle: "SF1", ownership: "AGENT" }] }
  return composeInteractionFeedback({ subject: { collaboratorRef: "c" }, frame: frame as never, interactionLabel: "Atendimento de 14/03/2026", sourceRun: "t" })
}

function harness(options: { prepare?: () => Promise<PreparedInteraction>; enabled?: boolean; writerFails?: () => boolean } = {}) {
  const memory = createInMemoryInteractionFeedbackStore()
  const completedRuns = () => [...memory.runs.values()].map((run) => ({ generationId: run.generationId ?? null, runId: run.id, status: run.status, writerInvoked: run.writerInvoked, completed: run.completedAt !== null }))
  const { registry, rows } = createInMemoryFeedbackGenerationRegistry({ completedRuns })
  const prepare = vi.fn(options.prepare ?? (async (): Promise<PreparedInteraction> => ({ kind: "PREPARED", feedback: strengthFeedback(), runContext: { organizationId: "org", collaboratorId: "op", teamId: null, interactionId: "int-1", occurredAt: null }, requests: [] })))
  const writer = fakeWriter({ fail: options.writerFails })
  const deps: GenerationDeps = { registry, prepare, now: () => new Date("2026-03-15T12:00:00Z"), pipeline: { enabled: options.enabled ?? true, writer, store: memory.store, now: () => new Date("2026-03-15T12:00:00Z"), deliveryPolicy: FEEDBACK_AUTONOMOUS_DELIVERY_POLICY } }
  return { deps, memory, rows, prepare, writer }
}
const request = (overrides: Partial<GenerationRequest["intent"]> = {}): GenerationRequest => ({ organizationId: "org", collaboratorId: "op", interactionId: "int-1", intent: { kind: "WORKFLOW_ACTION", workflowId: "wf-1", workflowVersionId: "v1", nodeId: "gerar", enrollmentId: "enr-1", ...overrides }, selection: { source: "TRIGGER_INTERACTION", strategy: null, rank: null } })

describe("V1.5.10 — geração idempotente do feedback de atendimento", () => {
  it("gera uma vez: AUTO_DELIVER gravado, resultado funcional seguro (sem texto)", async () => {
    const { deps, memory } = harness()
    const outcome = await generateInteractionFeedback(deps, request())
    expect(outcome).toMatchObject({ status: "GENERATED", reused: false, feedbackStatus: "HAS_POINTS", writerInvoked: true, dispositions: { AUTO_DELIVER: 1, HOLD_FOR_QA: 0, BLOCKED: 0 }, reasons: [], policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1" })
    expect(memory.runs.size).toBe(1)
    expect([...memory.runs.values()][0]).toMatchObject({ generationId: outcome.generationId, completedAt: expect.any(Date) })
    expect(JSON.stringify(outcome)).not.toMatch(/prazo|Nesta conversa/)
  })

  it("C) retry da MESMA execução e novas matrículas do mesmo disparo → mesmo resultado, nenhum segundo feedback, zero chamada extra", async () => {
    const { deps, memory, prepare, writer } = harness()
    const first = await generateInteractionFeedback(deps, request())
    const retry = await generateInteractionFeedback(deps, request())
    const otherEnrollment = await generateInteractionFeedback(deps, request({ enrollmentId: "enr-2", workflowVersionId: "v2" }))
    expect(retry).toMatchObject({ reused: true, generationId: first.generationId, runId: first.runId })
    expect(otherEnrollment).toMatchObject({ reused: true, runId: first.runId })
    expect(memory.runs.size).toBe(1)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(writer.calls).toHaveLength(1)
    // Outro nó (configuração explícita) = outra intenção → outro feedback.
    const otherNode = await generateInteractionFeedback(deps, request({ nodeId: "gerar-2" }))
    expect(otherNode.reused).toBe(false)
    expect(memory.runs.size).toBe(2)
  })

  it("D) duas execuções CONCORRENTES da mesma intenção → exatamente um feedback; a outra recebe IN_PROGRESS (retry do motor) e depois reaproveita", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { deps, memory } = harness({ prepare: async () => { await gate; return { kind: "PREPARED", feedback: strengthFeedback(), runContext: { organizationId: "org", collaboratorId: "op", teamId: null, interactionId: "int-1", occurredAt: null }, requests: [] } } })
    const a = generateInteractionFeedback(deps, request({ enrollmentId: "enr-a" }))
    const b = generateInteractionFeedback(deps, request({ enrollmentId: "enr-b" }))
    await expect(b).rejects.toBeInstanceOf(GenerationInProgressError)
    release()
    await a
    expect(memory.runs.size).toBe(1)
    expect(await generateInteractionFeedback(deps, request({ enrollmentId: "enr-b" }))).toMatchObject({ reused: true })
    expect(memory.runs.size).toBe(1)
  })

  it("H) falha técnica → geração FAILED e erro propagado (sem retry próprio); a próxima tentativa do motor retoma e conclui", async () => {
    let fail = true
    const { deps, rows, memory } = harness({ prepare: async () => { if (fail) { const error = new Error("provider indisponível"); error.name = "PROVIDER_UNAVAILABLE"; throw error } return { kind: "PREPARED", feedback: strengthFeedback(), runContext: { organizationId: "org", collaboratorId: "op", teamId: null, interactionId: "int-1", occurredAt: null }, requests: [] } } })
    await expect(generateInteractionFeedback(deps, request())).rejects.toThrow("provider indisponível")
    expect([...rows.values()][0]).toMatchObject({ status: "FAILED", lastError: "PROVIDER_UNAVAILABLE" })
    expect(memory.runs.size).toBe(0)
    fail = false
    expect(await generateInteractionFeedback(deps, request())).toMatchObject({ status: "GENERATED", reused: false })
    expect([...rows.values()][0]).toMatchObject({ status: "COMPLETED", attempts: 2 })
  })

  it("pipeline COMPLETO mas o registro caiu antes de gravar → a retomada ADOTA o run (nunca gera o segundo feedback)", async () => {
    const { deps, memory, prepare } = harness()
    const complete = deps.registry.complete
    deps.registry.complete = vi.fn(async () => { throw new Error("conexão perdida") })
    await expect(generateInteractionFeedback(deps, request())).rejects.toThrow("conexão perdida")
    deps.registry.complete = complete
    const adopted = await generateInteractionFeedback(deps, request())
    expect(adopted).toMatchObject({ status: "GENERATED", dispositions: { AUTO_DELIVER: 1 }, reused: false })
    expect(memory.runs.size).toBe(1)
    expect(prepare).toHaveBeenCalledTimes(1)
  })

  it("redator falhou → fallback nunca é autônomo: HOLD_FOR_QA com motivo estruturado (a ação conclui mesmo assim)", async () => {
    const { deps } = harness({ writerFails: () => true })
    expect(await generateInteractionFeedback(deps, request())).toMatchObject({ status: "GENERATED", dispositions: { AUTO_DELIVER: 0, HOLD_FOR_QA: 1, BLOCKED: 0 }, reasons: expect.arrayContaining(["WRITER_FALLBACK_USED"]) })
  })

  it("sem transcrição = NOT_ANALYZABLE gravado (resultado funcional, reaproveitado no retry); módulo desligado = erro explícito", async () => {
    const { deps, memory } = harness({ prepare: async () => ({ kind: "NOT_ANALYZABLE", reason: "NO_TRANSCRIPT", requests: [] }) })
    expect(await generateInteractionFeedback(deps, request())).toMatchObject({ status: "NOT_ANALYZABLE", notAnalyzableReason: "NO_TRANSCRIPT", runId: null })
    expect(await generateInteractionFeedback(deps, request())).toMatchObject({ status: "NOT_ANALYZABLE", reused: true })
    expect(memory.runs.size).toBe(0)
    await expect(generateInteractionFeedback(harness({ enabled: false }).deps, request())).rejects.toBeInstanceOf(InteractionFeedbackModuleDisabledError)
  })
})
