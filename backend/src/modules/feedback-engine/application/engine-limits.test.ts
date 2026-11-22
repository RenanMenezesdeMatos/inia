import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ANALYSIS_LEASE_SECONDS, TRANSCRIPT_MAX_CHARS } from "./analyze-call.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { transcriptStatusOf } from "../domain/procedure.js"
import { PRACTICE_LINES_PER_REQUEST } from "../domain/practice-identity.js"
import { PRACTICES_PER_THEME_REQUEST } from "../domain/practice-themes.js"
import { ENGINE_LEASE_SECONDS, EngineLeaseLostError, holdEngineLease } from "./engine-lease.js"
import { DEFAULT_ENGINE_BUDGET, ENGINE_MAX_RUN_SECONDS } from "./engine-meter.js"
import { MESSAGE_LEASE_SECONDS } from "./generate-feedback.js"
import { INVESTIGATION_LEASE_SECONDS } from "./investigate-indicator.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import type { EngineModelResponse } from "./ports.js"

describe("tempo máximo do motor de feedback", () => {
  it("uma execução vai até 30 min; a posse é curta (2 min) e renovada enquanto ela está viva", () => {
    expect(ENGINE_MAX_RUN_SECONDS).toBe(30 * 60)
    expect(DEFAULT_ENGINE_BUDGET.maxDurationMs).toBe(ENGINE_MAX_RUN_SECONDS * 1000)
    expect(ENGINE_LEASE_SECONDS).toBe(120)
    for (const lease of [ANALYSIS_LEASE_SECONDS, MESSAGE_LEASE_SECONDS, INVESTIGATION_LEASE_SECONDS]) expect(lease).toBe(ENGINE_LEASE_SECONDS)
  })
})

describe("ENGINE_LEASE_V1 — posse curta e renovada", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"))
  })
  afterEach(() => vi.useRealTimers())

  it("execução viva e demorada: renova a cada 40 s e a posse nunca vence; parada, não renova mais", async () => {
    const tokens: Date[] = []
    let current = new Date(Date.now() + 120_000)
    // O prazo é do armazenamento (relógio do banco); a posse só passa o token atual.
    const hold = holdEngineLease({ label: "t", recordId: "r", initial: current, renew: async (token) => {
      expect(token).toEqual(current)
      const until = new Date(Date.now() + 120_000)
      tokens.push(until)
      current = until
      return until
    } })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(tokens).toHaveLength(15)
    expect(current.getTime() - Date.now()).toBeGreaterThan(80_000)
    hold.stop()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(tokens).toHaveLength(15)
  })

  it("outra execução pegou a posse: a renovação é recusada, para e fica registrada", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    let calls = 0
    const hold = holdEngineLease({ label: "perdida", recordId: "r", initial: new Date(), renew: async () => (++calls === 1 ? new Date() : null) })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(calls).toBe(2)
    expect(hold.lost()).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("feedback_engine_lease_lost"))
    warn.mockRestore()
  })

  it("posse perdida: o modelo guardado recusa a chamada sem pagar, e a perda é reconhecida só pela dona", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const generate = vi.fn<(request: unknown) => Promise<EngineModelResponse>>(async () => ({ text: "{}", model: "m", usage: null, durationMs: 1, costUsd: null }) as unknown as EngineModelResponse)
    const model = { generate, meter: { tag: "medidor" } }
    const hold = holdEngineLease({ label: "perdida", recordId: "run-1", initial: new Date(), renew: async () => null })
    const guarded = hold.guard(model)
    // O medidor do orçamento (e o resto da porta) continua acessível.
    expect(guarded.meter).toBe(model.meter)
    await guarded.generate({ stage: "CALL_ANALYSIS", systemPrompt: "s", contents: [] } as never)
    expect(generate).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(hold.lost()).toBe(true)
    let refused: unknown = null
    try {
      await guarded.generate({ stage: "CALL_ANALYSIS", systemPrompt: "s", contents: [] } as never)
    } catch (error) {
      refused = error
    }
    expect(refused).toBeInstanceOf(EngineLeaseLostError)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(() => hold.assertHeld()).toThrow(EngineLeaseLostError)
    expect(hold.isLossOf(refused)).toBe(true)
    expect(hold.isLossOf(new EngineLeaseLostError("outra", "MODEL_CALL"))).toBe(false)
    expect(hold.isLossOf(new Error("x"))).toBe(false)
    warn.mockRestore()
  })

  it("banco fora do ar num tique: tenta de novo no seguinte (a posse ainda vale)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    let calls = 0
    const hold = holdEngineLease({ label: "instavel", recordId: "r", initial: new Date(), renew: async () => {
      calls += 1
      if (calls === 1) throw new Error("conexão recusada")
      return new Date(Date.now() + 120_000)
    } })
    await vi.advanceTimersByTimeAsync(2 * 40_000)
    expect(calls).toBe(2)
    expect(hold.lost()).toBe(false)
    hold.stop()
    warn.mockRestore()
  })

  it("travada além do tempo máximo: para de renovar e deixa a posse vencer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    let calls = 0
    holdEngineLease({ label: "travada", recordId: "r", initial: new Date(), renew: async () => ((calls += 1), new Date(Date.now() + 120_000)) })
    await vi.advanceTimersByTimeAsync(40 * 60_000)
    expect(calls).toBe(44)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("feedback_engine_lease_max_hold"))
    warn.mockRestore()
  })
})

describe("ENGINE_LEASE_V1 — só renova e só conclui quem ainda detém a posse (memória em RAM, mesma regra do Postgres)", () => {
  const identity = { organizationId: "org", kind: "CALL_ANALYSIS" as const, analysisKey: "k", personId: "p", interactionId: "i", indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: "a", trigger: { kind: "EVALUATION" as const, selectionReason: "teste" }, logicVersion: "v", asOf: new Date("2026-11-21T12:00:00Z") }
  const t0 = new Date("2026-11-21T12:00:00Z")

  it("análise: posse vencida é retomada por outra execução, e a primeira não consegue mais renovar", async () => {
    let clock = t0
    const store = createInMemoryFeedbackMemoryStore({ now: () => clock })
    const first = await store.claimAnalysis(identity, t0, 120)
    if (first.kind !== "CLAIMED") throw new Error("esperava a posse")
    expect(first.attempt).toBe(1)
    expect(await store.claimAnalysis(identity, new Date(t0.getTime() + 60_000), 120)).toEqual({ kind: "IN_PROGRESS" })
    clock = new Date(t0.getTime() + 40_000)
    const renewed = await store.renewAnalysisLease("org", first.runId, first.leaseUntil, 120)
    // O prazo novo sai do relógio do armazenamento, nunca de quem pede a renovação.
    expect(renewed).toEqual(new Date(t0.getTime() + 160_000))
    // A primeira caiu: ninguém renova, a posse vence e outra execução pega.
    const second = await store.claimAnalysis(identity, new Date(t0.getTime() + 170_000), 120)
    expect(second.kind).toBe("CLAIMED")
    if (second.kind !== "CLAIMED") return
    expect(second.attempt).toBe(2)
    expect(await store.renewAnalysisLease("org", first.runId, renewed!, 120)).toBeNull()
  })

  it("análise: a primeira, que perdeu a posse, não grava a conclusão nem marca a falha da outra", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const store = createInMemoryFeedbackMemoryStore({ now: () => t0 })
    const first = await store.claimAnalysis(identity, t0, 120)
    const second = await store.claimAnalysis(identity, new Date(t0.getTime() + 170_000), 120)
    if (first.kind !== "CLAIMED" || second.kind !== "CLAIMED") throw new Error("esperava as duas posses")
    const outcome = { outcomeReasons: ["X"], result: { by: "first" }, provenance: {}, metrics: {} }
    await expect(store.completeInsufficient("org", first.runId, outcome, t0, { attempt: first.attempt })).rejects.toBeInstanceOf(EngineLeaseLostError)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("feedback_engine_lease_lost_on_complete"))
    await store.failAnalysis("org", first.runId, "erro da primeira", t0, { attempt: first.attempt })
    expect(store.runs.get(second.runId)?.status).toBe("RUNNING")
    await store.completeInsufficient("org", second.runId, { ...outcome, result: { by: "second" } }, t0, { attempt: second.attempt })
    expect(store.runs.get(second.runId)?.status).toBe("COMPLETED")
    expect(store.runs.get(second.runId)?.result).toEqual({ by: "second" })
    warn.mockRestore()
  })

  it("mensagem: a mesma regra (renovação e conclusão)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const store = createInMemoryFeedbackMemoryStore({ now: () => new Date(t0.getTime() + 40_000) })
    const message = { organizationId: "org", messageKey: "m", enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "n", sourceNodeId: "s", personId: "p", domain: "MONITORING" as const }
    const first = await store.claimMessage(message, t0, 120)
    if (first.kind !== "CLAIMED") throw new Error("esperava a posse")
    expect(await store.renewMessageLease("org", first.messageId, new Date(0), 120)).toBeNull()
    expect(await store.renewMessageLease("org", first.messageId, first.leaseUntil, 120)).toEqual(new Date(t0.getTime() + 160_000))
    const second = await store.claimMessage(message, new Date(t0.getTime() + 400_000), 120)
    if (second.kind !== "CLAIMED") throw new Error("esperava a retomada")
    const completion = { status: "ABSTAINED" as const, analysisRunIds: [], abstainReason: "NOTHING_MATERIAL", findingKeys: [], brief: null, message: null, composition: null, suppressed: [], metrics: {}, materials: [] }
    await expect(store.completeMessage("org", first.messageId, completion, t0, { attempt: first.attempt })).rejects.toBeInstanceOf(EngineLeaseLostError)
    expect(store.messages.get(first.messageId)?.status).toBe("RUNNING")
    expect((await store.completeMessage("org", second.messageId, completion, t0, { attempt: second.attempt })).status).toBe("ABSTAINED")
    warn.mockRestore()
  })
})

describe("chamada longa e lotes da organização das práticas", () => {
  // ~70 caracteres por fala, alternando operador e cliente.
  const transcriptOf = (turns: number) => Array.from({ length: turns }, (_, index) => `${index % 2 === 0 ? "Operador" : "Cliente"}: fala número ${index} com um texto de tamanho comum numa ligação.`).join("\n")

  it("uma ligação de ~50 min bem falada (~50 mil caracteres) entra inteira — o encerramento não é cortado", () => {
    const projection = projectTranscript(transcriptOf(700), { maxChars: TRANSCRIPT_MAX_CHARS })
    expect(TRANSCRIPT_MAX_CHARS).toBe(80_000)
    expect(projection.truncatedTurns).toBe(0)
    expect(transcriptStatusOf(projection)).toBe("COMPLETE")
  })

  it("acima do limite, o que sobra é cortado e a transcrição fica marcada como incompleta (nenhuma omissão é acusada)", () => {
    const projection = projectTranscript(transcriptOf(1_400), { maxChars: TRANSCRIPT_MAX_CHARS })
    expect(projection.truncatedTurns).toBeGreaterThan(0)
    expect(transcriptStatusOf(projection)).toBe("INCOMPLETE")
  })

  it("lotes da organização das práticas longe do teto de saída que o lote de 40 regras atingiu em 21/11", () => {
    expect(PRACTICE_LINES_PER_REQUEST).toBe(20)
    expect(PRACTICES_PER_THEME_REQUEST).toBe(30)
  })
})
