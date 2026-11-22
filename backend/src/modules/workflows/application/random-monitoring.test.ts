import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { answerAgentVersionQuery } from "../../agents/testing/agent-version-fakes.js"
import { isQualityCallDuration, qualityCallSqlPredicate } from "../../interactions/domain/quality-call-rule.js"
import type { ActionConfig, FlowGraph } from "../domain/graph-schema.js"
import { actionExecutors, type ActionExecutionContext } from "./action-executors.js"
import { executeGenerateFeedback } from "./generate-feedback-action.js"
import { pickRandomMonitoringCall, RANDOM_MONITORING_SAMPLE_VERSION, RANDOM_MONITORING_SELECTION_REASON, TRANSCRIPT_INLINE_BYTES } from "./random-monitoring.js"
import { notMonitoredSql } from "../../feedback-engine/infrastructure/delivery-guards-sql.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"
import type { CallAnalysisNodeOutput, EngineMessageNodeOutput } from "../../feedback-engine/domain/node-output.js"

/**
 * MONITORIA ALEATÓRIA (`RANDOM_MONITORING_SAMPLE_V1`) e REGRA DE CHAMADA CURTA (`QUALITY_CALL_MIN_DURATION_V1`) — zero banco, zero IA:
 * o fake responde por SQL e o motor é um espião.
 */

describe("regra geral de chamada curta", () => {
  it("abaixo do mínimo ou sem duração conhecida fica fora; 0 desliga a regra", () => {
    expect(isQualityCallDuration(59, 60)).toBe(false)
    expect(isQualityCallDuration(60, 60)).toBe(true)
    expect(isQualityCallDuration(null, 60)).toBe(false)
    expect(isQualityCallDuration(null, 0)).toBe(true)
    expect(isQualityCallDuration(5, 0)).toBe(true)
  })

  it("o SQL usa o mesmo critério (fim − início, mínimo como parâmetro)", () => {
    const sql = qualityCallSqlPredicate("i", 5)
    expect(sql).toContain("$5::int <= 0")
    expect(sql).toContain("i.ended_at is not null")
    expect(sql).toContain("extract(epoch from (i.ended_at - i.started_at)) >= $5::int")
  })
})

type PickRow = { eligible: string; unmonitored: string; picked: string | null }
function samplingDb(row: PickRow | null) {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
    }),
  } as unknown as Database
  return { db, calls }
}

const window = { start: new Date("2026-11-20T03:00:00Z"), end: new Date("2026-11-21T03:00:00Z") }
const input = { organizationId: "org-1", operatorId: "op-1", enrollmentId: "enr-1", window, minimumSeconds: 60 }

describe("sorteio da chamada (RANDOM_MONITORING_SAMPLE_V2)", () => {
  it("uma consulta só: chamadas do colaborador no período, com transcrição e a duração mínima, sem monitoria; ordem pela semente", async () => {
    const { db, calls } = samplingDb({ eligible: "3", unmonitored: "2", picked: "call-a" })
    const pick = await pickRandomMonitoringCall(db, input)
    expect(pick).toMatchObject({ interactionId: "call-a", eligible: 3, unmonitored: 2 })
    expect(calls).toHaveLength(1)
    const { sql, params } = calls[0]!
    expect(sql).toContain("i.operator_id = $2")
    expect(sql).toContain("from transcripts t")
    expect(sql).toContain(qualityCallSqlPredicate("i", 5))
    expect(sql).toContain("order by md5($6 || ':' || e.id::text)")
    // A exclusão das já monitoradas é a MESMA da entrega única, dentro do SQL do sorteio (sobre todas as elegíveis, nunca 25).
    expect(sql).toContain(notMonitoredSql("$1", "i.id"))
    expect(sql).not.toMatch(/limit 25/u)
    expect(params.slice(0, 5)).toEqual(["org-1", "op-1", window.start.toISOString(), window.end.toISOString(), 60])
    expect(String(params[5])).toContain("enr-1:op-1:")
    expect(pick.seed).toBe(params[5])
  })

  it("B-07: transcrição conferida pelo tamanho guardado; só a curta (sem compressão) é conferida contra só espaços", async () => {
    const { db, calls } = samplingDb({ eligible: "1", unmonitored: "1", picked: "call-a" })
    await pickRandomMonitoringCall(db, input)
    expect(calls[0]!.sql).toContain(`octet_length(t.content) > ${TRANSCRIPT_INLINE_BYTES} or btrim(t.content) <> ''`)
    expect(calls[0]!.sql).not.toContain("length(btrim(t.content))")
  })

  it("sem chamada elegível: NO_ELIGIBLE_CALL; elegíveis todas já monitoradas: o total conferido de verdade", async () => {
    expect(await pickRandomMonitoringCall(samplingDb({ eligible: "0", unmonitored: "0", picked: null }).db, input)).toMatchObject({ interactionId: null, eligible: 0, reason: "NO_ELIGIBLE_CALL" })
    expect(await pickRandomMonitoringCall(samplingDb(null).db, input)).toMatchObject({ interactionId: null, eligible: 0, reason: "NO_ELIGIBLE_CALL" })
    expect(await pickRandomMonitoringCall(samplingDb({ eligible: "60", unmonitored: "0", picked: null }).db, input)).toMatchObject({ interactionId: null, eligible: 60, unmonitored: 0, reason: "ALL_ELIGIBLE_ALREADY_MONITORED" })
  })

  it("QA-05: 60 elegíveis, as primeiras do sorteio já monitoradas — ainda há sorteio (a V1 parava nas 25 e dizia que todas tinham monitoria)", async () => {
    const pick = await pickRandomMonitoringCall(samplingDb({ eligible: "60", unmonitored: "30", picked: "call-31" }).db, input)
    expect(pick).toMatchObject({ interactionId: "call-31", eligible: 60, unmonitored: 30 })
  })
})

type ExecutorWorld = { pick: PickRow | null; prior?: { interaction_id: string; sample: unknown } | null; timeZone?: string }
function executorDb(world: ExecutorWorld) {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params })
      const versioned = answerAgentVersionQuery(sql, params, (agentId) => (agentId === "agent-1" ? { id: agentId, active: true } : undefined))
      if (versioned) return versioned
      if (sql.includes("minimum_quality_call_seconds")) return { rows: [{ seconds: 60 }], rowCount: 1 }
      if (sql.includes("from operations")) return { rows: [{ timezone: world.timeZone ?? "America/Sao_Paulo" }], rowCount: 1 }
      if (sql.includes("with eligible as")) return { rows: world.pick ? [world.pick] : [], rowCount: world.pick ? 1 : 0 }
      if (sql.includes("r.trigger -> 'randomSample' sample")) return { rows: world.prior ? [world.prior] : [], rowCount: world.prior ? 1 : 0 }
      if (sql.includes("from agents")) return { rows: [{ name: "Qualidade", active: true, updated_at: null }], rowCount: 1 }
      if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
  return Object.assign(db, { calls })
}

function scheduleContext(db: Database, effects: ReturnType<typeof createFakeEffects>, graph: FlowGraph = { nodes: [], edges: [] } as FlowGraph, nodeOutputs: Record<string, unknown> = {}, nodeId = "agent"): ActionExecutionContext {
  return {
    db, organizationId: "org-1", workflowId: "wf-1", workflowVersionId: "ver-1", nodeId, graph,
    enrollment: { id: "enrollment-1", interactionId: null, indicatorMeasurementId: null, scheduledSubjectId: "operator-1", matchedFlagName: null, matchedValueBoolean: null, matchedValueNumeric: null, nodeOutputs, variables: {} },
    scopeType: "ALL_TEAMS", teamId: null, subteamId: null, inputContext: "", now: new Date("2026-11-21T12:00:00Z"), effects,
  }
}

const randomMonitoring = { actionType: "CALL_AGENT", agentId: "agent-1", outputContract: "PROCESS_ASSESSMENT", scheduledDataSource: { kind: "MONITORING", sampleSize: 1, period: "D1" } } as ActionConfig
const callAnalysis: CallAnalysisNodeOutput = { kind: "FEEDBACK_ENGINE_CALL_ANALYSIS", analysisRunId: "run-1", callAssessmentId: "ca-1", interactionId: "call-b", personId: "operator-1", agentId: "agent-1", outcome: "USABLE", reused: false, summary: { procedure: null, pathAssessment: "CORRECT", met: 4, notMet: 0, partial: 0, notObservable: 0, coverage: "COMPLETE" }, text: "ok" }

describe("\"Chamar agente\" na Agenda com monitoria aleatória", () => {
  it("sorteia uma chamada do colaborador e a analisa pelo motor, como na Flag — com o registro do sorteio (ARQ-04)", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.analyzeCall.mockResolvedValue(callAnalysis)
    const db = executorDb({ pick: { eligible: "2", unmonitored: "1", picked: "call-b" }, timeZone: "America/Manaus" })
    const result = await actionExecutors.CALL_AGENT(randomMonitoring, scheduleContext(db, effects))
    expect(effects.feedbackEngine.analyzeCall).toHaveBeenCalledOnce()
    const request = effects.feedbackEngine.analyzeCall.mock.calls[0]![1]
    expect(request).toMatchObject({ interactionId: "call-b", collaboratorId: "operator-1", agentId: "agent-1", trigger: { kind: "WORKFLOW_SOURCE_NODE", enrollmentId: "enrollment-1", nodeId: "agent", selectionReason: RANDOM_MONITORING_SELECTION_REASON } })
    // A janela é a do dia anterior no fuso da ORGANIZAÇÃO (Manaus, UTC−4), não no fuso padrão.
    const sample = { version: RANDOM_MONITORING_SAMPLE_VERSION, minimumSeconds: 60, period: "D1", window: { start: "2026-11-20T04:00:00.000Z", end: "2026-11-21T04:00:00.000Z" }, timeZone: "America/Manaus", eligible: 2, unmonitored: 1 }
    expect(request.trigger.randomSample).toMatchObject(sample)
    expect(result.nodeOutput).toEqual({ ...callAnalysis, randomSample: expect.objectContaining(sample) })
    // Sem conferência chamada a chamada (a exclusão está no SQL do sorteio).
    expect(effects.feedbackEngine.deliveredMonitoring).not.toHaveBeenCalled()
  })

  it("SFW-05: nova tentativa da mesma execução reaproveita a chamada já sorteada — nunca sorteia outra", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.analyzeCall.mockResolvedValue(callAnalysis)
    const recorded = { version: RANDOM_MONITORING_SAMPLE_VERSION, minimumSeconds: 60, period: "TODAY", window: { start: "2026-11-21T03:00:00.000Z", end: "2026-11-21T11:00:00.000Z" }, timeZone: "America/Sao_Paulo", seed: "s", eligible: 4, unmonitored: 4 }
    const db = executorDb({ pick: { eligible: "5", unmonitored: "5", picked: "outra-chamada" }, prior: { interaction_id: "call-b", sample: recorded } })
    const result = await actionExecutors.CALL_AGENT(randomMonitoring, scheduleContext(db, effects))
    expect(effects.feedbackEngine.analyzeCall.mock.calls[0]![1]).toMatchObject({ interactionId: "call-b", trigger: { randomSample: { ...recorded, reusedPick: true } } })
    expect(result.nodeOutput).toMatchObject({ interactionId: "call-b", randomSample: { reusedPick: true, window: recorded.window } })
    expect(db.calls.some((call) => call.sql.includes("with eligible as"))).toBe(false)
    const lookup = db.calls.find((call) => call.sql.includes("r.trigger -> 'randomSample' sample"))!
    expect(lookup.params).toEqual(["org-1", "operator-1", "enrollment-1", "agent", RANDOM_MONITORING_SELECTION_REASON])
  })

  it("sem chamada para sortear: nenhuma IA, e a saída diz por quê (com o registro do sorteio)", async () => {
    const effects = createFakeEffects()
    const result = await actionExecutors.CALL_AGENT(randomMonitoring, scheduleContext(executorDb({ pick: { eligible: "0", unmonitored: "0", picked: null } }), effects))
    expect(effects.feedbackEngine.analyzeCall).not.toHaveBeenCalled()
    expect(result.nodeOutput).toMatchObject({ kind: "FEEDBACK_ENGINE_NO_ELIGIBLE_CALL", personId: "operator-1", skippedReason: "NO_ELIGIBLE_CALL", detail: "NO_ELIGIBLE_CALL", minimumSeconds: 60, randomSample: { version: RANDOM_MONITORING_SAMPLE_VERSION, eligible: 0 } })
  })

  it("todas as elegíveis já monitoradas: o texto usa o total conferido na mesma consulta", async () => {
    const effects = createFakeEffects()
    const result = await actionExecutors.CALL_AGENT(randomMonitoring, scheduleContext(executorDb({ pick: { eligible: "7", unmonitored: "0", picked: null } }), effects))
    expect(effects.feedbackEngine.analyzeCall).not.toHaveBeenCalled()
    expect(result.nodeOutput).toMatchObject({ detail: "ALL_ELIGIBLE_ALREADY_MONITORED", eligible: 7, text: "Nenhuma chamada sorteada: as 7 chamada(s) elegível(is) do período já tinham monitoria." })
  })
})

describe("\"Gerar feedback\" depois da monitoria aleatória", () => {
  const graph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "agent", type: "action", label: "Sortear", position: { x: 0, y: 0 }, config: randomMonitoring },
      { id: "fb", type: "action", label: "Gerar feedback", position: { x: 0, y: 0 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
    ],
    edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "agent" }, { id: "e2", source: "agent", sourceHandle: "always", target: "fb" }],
  } as unknown as FlowGraph

  it("usa a chamada sorteada e o domínio de monitoria", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.generate.mockResolvedValue({ kind: "PUBLISHABLE", messageId: "m-1", reused: false, nodeOutput: { kind: "FEEDBACK_ENGINE_MESSAGE" } as EngineMessageNodeOutput })
    await executeGenerateFeedback({ actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" }, scheduleContext(executorDb({ pick: null }), effects, graph, { agent: callAnalysis }, "fb"))
    expect(effects.feedbackEngine.generate.mock.calls[0]![1]).toMatchObject({ domain: "MONITORING", interactionId: "call-b", collaboratorId: "operator-1", selectionReason: RANDOM_MONITORING_SELECTION_REASON })
  })
})
