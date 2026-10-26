import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ActionConfig, FlowGraph } from "../domain/graph-schema.js"
import { actionExecutors, type ActionExecutionContext } from "./action-executors.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"

/**
 * "Chamar agente" pelo MOTOR DE FEEDBACK (Avaliação de processo, Diagnóstico do indicador) respeita o estado do Agent como o
 * `runAgent`: Agent inativo ou de outra organização não analisa, não chama IA e não publica — a publicação já recusava, mas
 * desativar DEPOIS de publicar não desligava o nó (validação funcional de 20/10/2026). Zero banco: o fake responde por SQL.
 */
type AgentRow = { active: boolean; updated_at: Date | null } | null

function fakeDb(agent: AgentRow) {
  const queries: string[] = []
  const db = {
    query: async (sql: string) => {
      queries.push(sql)
      if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
      if (sql.includes("from agents")) return { rows: agent ? [agent] : [], rowCount: agent ? 1 : 0 }
      if (sql.includes("from indicator_measurements")) return { rows: [{ subject_id: "operator-1" }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as Database
  return { db, queries }
}

function context(db: Database, effects: ReturnType<typeof createFakeEffects>, origin: { interactionId?: string; indicatorMeasurementId?: string }): ActionExecutionContext {
  return {
    db, organizationId: "org-1", workflowId: "wf-1", workflowVersionId: null, nodeId: "agent", graph: { nodes: [], edges: [] } as FlowGraph,
    enrollment: { id: "enrollment-1", interactionId: origin.interactionId ?? null, indicatorMeasurementId: origin.indicatorMeasurementId ?? null, scheduledSubjectId: null, matchedFlagName: "cancelamento", matchedValueBoolean: true, matchedValueNumeric: null, nodeOutputs: {}, variables: {} },
    scopeType: "ALL_TEAMS", teamId: null, subteamId: null, inputContext: "", now: new Date("2026-10-20T12:00:00Z"), effects,
  }
}

const processAssessment = { actionType: "CALL_AGENT", agentId: "agent-1", outputContract: "PROCESS_ASSESSMENT" } as ActionConfig
const indicatorDiagnosis = { actionType: "CALL_AGENT", agentId: "agent-1", outputContract: "INDICATOR_DIAGNOSIS" } as ActionConfig

describe("\"Chamar agente\" pelo motor de feedback — estado do Agent", () => {
  it("Avaliação de processo com Agent inativo: AGENT_INACTIVE e o motor não analisa", async () => {
    const effects = createFakeEffects()
    const { db } = fakeDb({ active: false, updated_at: null })
    await expect(actionExecutors.CALL_AGENT(processAssessment, context(db, effects, { interactionId: "interaction-1" }))).rejects.toMatchObject({ code: "AGENT_INACTIVE" })
    expect(effects.feedbackEngine.analyzeCall).not.toHaveBeenCalled()
  })

  it("Avaliação de processo com Agent inexistente na organização: AGENT_NOT_FOUND e o motor não analisa", async () => {
    const effects = createFakeEffects()
    const { db, queries } = fakeDb(null)
    await expect(actionExecutors.CALL_AGENT(processAssessment, context(db, effects, { interactionId: "interaction-1" }))).rejects.toMatchObject({ code: "AGENT_NOT_FOUND" })
    expect(effects.feedbackEngine.analyzeCall).not.toHaveBeenCalled()
    expect(queries.some((sql) => sql.includes("from agents") && sql.includes("organization_id = $2"))).toBe(true)
  })

  it("Avaliação de processo com Agent ativo: analisa com o Agent do nó", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.analyzeCall.mockResolvedValue({ kind: "FEEDBACK_ENGINE_CALL_ANALYSIS", text: "análise" } as never)
    const { db } = fakeDb({ active: true, updated_at: null })
    const result = await actionExecutors.CALL_AGENT(processAssessment, context(db, effects, { interactionId: "interaction-1" }))
    expect(effects.feedbackEngine.analyzeCall).toHaveBeenCalledWith(db, expect.objectContaining({ agentId: "agent-1", interactionId: "interaction-1", collaboratorId: "operator-1" }))
    expect(result.nodeOutput).toMatchObject({ kind: "FEEDBACK_ENGINE_CALL_ANALYSIS" })
  })

  it("chamada já monitorada: nada roda (nem a checagem do Agent muda isso) — o nó segue com o motivo", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.deliveredMonitoring.mockResolvedValue({ source: "PUBLISHED_FEEDBACK", id: "feedback-earlier", deliveredAt: new Date("2026-10-19T14:00:00Z") })
    const { db } = fakeDb({ active: false, updated_at: null })
    const result = await actionExecutors.CALL_AGENT(processAssessment, context(db, effects, { interactionId: "interaction-1" }))
    expect(effects.feedbackEngine.analyzeCall).not.toHaveBeenCalled()
    expect(result.nodeOutput).toMatchObject({ skippedReason: "CALL_ALREADY_MONITORED" })
  })

  it("Diagnóstico do indicador com Agent inativo: AGENT_INACTIVE e o motor não investiga", async () => {
    const effects = createFakeEffects()
    const { db } = fakeDb({ active: false, updated_at: new Date("2026-10-01T00:00:00Z") })
    await expect(actionExecutors.CALL_AGENT(indicatorDiagnosis, context(db, effects, { indicatorMeasurementId: "measurement-1" }))).rejects.toMatchObject({ code: "AGENT_INACTIVE" })
    expect(effects.feedbackEngine.investigateIndicator).not.toHaveBeenCalled()
  })

  it("Diagnóstico do indicador com Agent ativo: investiga levando a data de configuração do Agent", async () => {
    const effects = createFakeEffects()
    effects.feedbackEngine.investigateIndicator.mockResolvedValue({ investigations: [], skippedReason: "NOTHING_TO_INVESTIGATE" } as never)
    const { db } = fakeDb({ active: true, updated_at: new Date("2026-10-01T00:00:00Z") })
    await actionExecutors.CALL_AGENT(indicatorDiagnosis, context(db, effects, { indicatorMeasurementId: "measurement-1" }))
    expect(effects.feedbackEngine.investigateIndicator).toHaveBeenCalledWith(db, expect.objectContaining({ agentId: "agent-1", personId: "operator-1", agentConfiguredAt: "2026-10-01T00:00:00.000Z" }))
  })
})
