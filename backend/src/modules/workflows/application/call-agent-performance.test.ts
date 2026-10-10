import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ActionConfig, FlowGraph } from "../domain/graph-schema.js"

const runAgent = vi.fn(async () => ({ id: "run-1", outputText: "{}", status: "COMPLETED", errorMessage: null, workflowResult: { kind: "indicator", input: {} } }))
vi.mock("../../agents/application/run-agent.js", () => ({ runAgent: (...args: unknown[]) => runAgent(...(args as [])) }))

const { actionExecutors } = await import("./action-executors.js")
const { createFakeEffects } = await import("../testing/fake-effect-sink.js")

const PRV_ROWS = [
  { id: "prv-09", reference_period: "2026-09", achievement_percent: "78.5", quartile: "Q4" },
  { id: "prv-08", reference_period: "2026-08", achievement_percent: "81.0", quartile: "Q3" },
]
const INDICATOR_ROWS = [
  { id: "ind-09-tma", reference_period: "2026-09", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", desired_direction: "LOWER", value: "420", target_value: "360", achievement_percent: "85.7", weight_percent: "40", quartile: "Q4" },
  { id: "ind-08-tma", reference_period: "2026-08", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", desired_direction: "LOWER", value: "400", target_value: "360", achievement_percent: "90", weight_percent: "40", quartile: "Q3" },
]

function contextWith(query: Database["query"]) {
  return {
    db: { query } as unknown as Database,
    organizationId: "org-1",
    workflowId: "workflow-1",
    workflowVersionId: null,
    nodeId: "agent",
    graph: { nodes: [], edges: [] } as FlowGraph,
    enrollment: { id: "e-1", interactionId: null, indicatorMeasurementId: null, scheduledSubjectId: "person-1", matchedFlagName: null, matchedValueBoolean: null, matchedValueNumeric: null, nodeOutputs: {}, variables: {} },
    scopeType: "ALL_TEAMS",
    teamId: null,
    subteamId: null,
    inputContext: "",
    now: new Date("2026-09-16T12:00:00Z"),
    effects: createFakeEffects(),
  }
}

describe("CALL_AGENT · fonte PERFORMANCE (fechamentos oficiais)", () => {
  it("monta o contexto com PRV oficial e indicadores por competência, sem recalcular nada", async () => {
    runAgent.mockClear()
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from people")) return { rows: [{ team_id: "team-1" }], rowCount: 1 }
      if (sql.includes("from employee_prv_performance")) return { rows: PRV_ROWS, rowCount: 2 }
      if (sql.includes("from employee_indicator_performance e")) return { rows: INDICATOR_ROWS, rowCount: 2 }
      return { rows: [], rowCount: 0 }
    })
    const config: ActionConfig = { actionType: "CALL_AGENT", agentId: "agent-1", scheduledDataSource: { kind: "PERFORMANCE", closures: 2 } }
    await actionExecutors.CALL_AGENT(config, contextWith(query as unknown as Database["query"]))

    expect(runAgent).toHaveBeenCalledTimes(1)
    const call = runAgent.mock.calls[0] as unknown as [Database, { inputContext: string; workflow: Record<string, unknown> }]
    const { inputContext, workflow } = call[1]
    expect(inputContext).toContain("Fechamento 2026-09 (mais recente)")
    expect(inputContext).toContain("PRV oficial: atingimento 78.5%, quartil Q4")
    expect(inputContext).toContain("Tempo Médio de Atendimento (TMA): 420 SECONDS, meta 360, atingimento 85.7%, peso 40%, quartil Q4")
    expect(inputContext).toContain("Fechamento 2026-08")
    expect(inputContext).toContain("nunca recalcule")
    expect(workflow.kind).toBe("indicator_summary")
    expect(workflow.evidenceSourceType).toBe("employee_performance")
    // A competência mais recente vira a lista oficial de indicadores; o PRV entra como o primeiro, com o id da linha oficial.
    expect((workflow.indicators as { code: string; measurementIds: string[] }[]).map((indicator) => indicator.code)).toEqual(["PRV", "TMA"])
    expect((workflow.indicators as { measurementIds: string[] }[])[0]!.measurementIds).toEqual(["prv-09"])
  })

  it("falha de forma controlada quando não há fechamento oficial (SEM DADOS nunca vira zero)", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from people")) return { rows: [{ team_id: "team-1" }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
    const config: ActionConfig = { actionType: "CALL_AGENT", agentId: "agent-1", scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } }
    await expect(actionExecutors.CALL_AGENT(config, contextWith(query as unknown as Database["query"]))).rejects.toThrow(/Sem fechamento oficial/)
  })
})
