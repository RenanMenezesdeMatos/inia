import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowGraph, FlowNode } from "../domain/graph-schema.js"
import { actionExecutors } from "./action-executors.js"
import { comparatorMatches, processNode, type EnrollmentRow } from "./node-handlers.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"

vi.mock("./action-executors.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./action-executors.js")>()
  return {
    // resolvePeriodWindow é reaproveitado de verdade por resolveHistoricalWindow (Parte 2) —
    // só actionExecutors é mockado aqui, pra não precisar montar um DB fake pros vários
    // caminhos internos de CALL_AGENT/ESCALATE que a Condition/Action não estão testando.
    resolvePeriodWindow: actual.resolvePeriodWindow,
    resolvePreviousPeriodWindow: actual.resolvePreviousPeriodWindow,
    actionExecutors: {
      CALL_AGENT: vi.fn(async () => ({ agentRunId: "run-1", nodeOutput: { severity: "HIGH" } })),
      SET_CONFIG_VALUE: vi.fn(async () => ({})),
      SET_VARIABLE: vi.fn(async () => ({ variableUpdate: { variableId: "var-1", value: true } })),
      ESCALATE: vi.fn(async () => ({ nodeOutput: { target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, recipientCount: 1, surfaces: ["NOTIFICATION"], reason: undefined, operatorName: "Ana", caseId: null } })),
    },
  }
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- assinatura variádica só pra tipar o spread do mock
const notifyHumanReviewPending = vi.fn(async (..._args: unknown[]) => {})
vi.mock("./human-review-executor.js", () => ({
  notifyHumanReviewPending: (...args: unknown[]) => notifyHumanReviewPending(...args),
}))

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const executeOrchestrator = vi.fn(async (..._args: unknown[]) => ({ nodeOutput: { text: "resposta individual", agentId: null, calls: [], results: [], structuredResult: null, orchestratorId: "orch-1", orchestratorName: "Monitoria" } }))
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const executeOrchestratorConsolidated = vi.fn(async (..._args: unknown[]) => ({ nodeOutput: { text: "resposta consolidada", agentId: null, calls: [], results: [], structuredResult: null, orchestratorId: "orch-1", orchestratorName: "Monitoria" } }))
vi.mock("./orchestrator-executor.js", () => ({
  executeOrchestrator: (...args: unknown[]) => executeOrchestrator(...args),
  executeOrchestratorConsolidated: (...args: unknown[]) => executeOrchestratorConsolidated(...args),
}))

const fakeDb = {} as Database
// Sink de efeitos fake (effect-sink.ts) — executores estão mockados acima, então nada aqui é
// chamado de verdade; só precisa existir no ProcessContext.
const effects = createFakeEffects()

function baseEnrollment(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: "enrollment-1",
    organization_id: "org-1",
    workflow_id: "workflow-1",
    version_id: "version-1",
    interaction_id: "interaction-1",
    indicator_measurement_id: null,
    scheduled_subject_id: null,
    scheduled_for: null,
    current_node_id: "node-1",
    matched_flag_name: "nota_ura",
    matched_value_boolean: null,
    matched_value_numeric: "2",
    status: "active",
    attempts: 0,
    revision: 0,
    node_outputs: {},
    variables: {},
    ...overrides,
  }
}

const workflowScope = { scopeType: "ALL_TEAMS", teamId: null, subteamId: null }

describe("comparatorMatches", () => {
  it("compares numeric thresholds", () => {
    expect(comparatorMatches("LTE", false, 2, null, 3)).toBe(true)
    expect(comparatorMatches("GT", false, 2, null, 3)).toBe(false)
  })

  it("compares boolean thresholds only via EQUALS", () => {
    expect(comparatorMatches("EQUALS", true, true, true, null)).toBe(true)
    expect(comparatorMatches("EQUALS", true, false, true, null)).toBe(false)
  })

  it("NOT_EQUALS funciona pra número (bug encontrado ao construir a UI de Histórico/Performance — antes caía no default e sempre retornava false)", () => {
    expect(comparatorMatches("NOT_EQUALS", false, 2, null, 3)).toBe(true)
    expect(comparatorMatches("NOT_EQUALS", false, 3, null, 3)).toBe(false)
  })
})

describe("processNode", () => {
  it("trigger advances via the 'always' edge", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "condition" }],
    }
    const node = graph.nodes[0]!
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "trigger" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "condition" })
  })

  it("trigger de uma matrícula da Agenda com colaborador com jornada grava o contexto de expediente em nodeOutputs.trigger (Parte 14 da evolução relativa ao expediente)", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "action" }],
    }
    const node = graph.nodes[0]!
    const shiftDb = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
        if (sql.includes("from employee_work_shifts")) return { rows: [{ start_time: "08:00:00", work_minutes: 480 }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const enrollment = baseEnrollment({
      current_node_id: "trigger",
      scheduled_subject_id: "joao",
      scheduled_for: "2026-09-14T11:15:00.000Z", // 08:15 em America/Fortaleza — 15 min após o início
    })
    const outcome = await processNode({ db: shiftDb, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({
      kind: "advance",
      nextNodeId: "action",
      nodeOutput: {
        employeeId: "joao",
        scheduledShiftStart: "2026-09-14T11:00:00.000Z",
        scheduledShiftEnd: "2026-09-14T19:00:00.000Z",
        scheduledWorkMinutes: 480,
        triggeredAt: "2026-09-14T11:15:00.000Z",
        elapsedScheduledPercent: 3.13,
      },
    })
  })

  it("trigger de uma matrícula da Agenda com colaborador SEM jornada cadastrada não grava contexto nenhum (nunca inventa — Parte 29)", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "action" }],
    }
    const node = graph.nodes[0]!
    const noShiftDb = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
        return { rows: [], rowCount: 0 } // sem jornada cadastrada
      }),
    } as unknown as Database
    const enrollment = baseEnrollment({
      current_node_id: "trigger",
      scheduled_subject_id: "sem-jornada",
      scheduled_for: "2026-09-14T11:15:00.000Z",
      matched_value_numeric: null,
    })
    const outcome = await processNode({ db: noShiftDb, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "action" })
    expect(outcome).not.toHaveProperty("nodeOutput")
  })

  it("wait starts waiting on the first visit, then advances once elapsed", async () => {
    const node: FlowNode = { id: "wait", type: "wait", label: "Aguardar", position: { x: 0, y: 0 }, config: { durationMs: 60_000 } }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e1", source: "wait", sourceHandle: "always", target: "end" }] }
    const now = new Date("2026-01-01T00:00:00Z")

    const firstVisit = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "wait", status: "active" }), workflow: workflowScope, inputContext: "", now, effects },
      node,
    )
    expect(firstVisit).toMatchObject({ kind: "wait", nextEvalAt: new Date(now.getTime() + 60_000) })

    const secondVisit = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "wait", status: "waiting" }), workflow: workflowScope, inputContext: "", now, effects },
      node,
    )
    expect(secondVisit).toMatchObject({ kind: "advance", nextNodeId: "end" })
  })

  it("condition branches true/false by comparator", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Condição",
      position: { x: 0, y: 0 },
      config: { comparator: "LTE", thresholdNumeric: 3 },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "action" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "end" },
      ],
    }
    const matched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", matched_value_numeric: "2" }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(matched).toMatchObject({ kind: "advance", nextNodeId: "action" })

    const unmatched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", matched_value_numeric: "9" }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(unmatched).toMatchObject({ kind: "advance", nextNodeId: "end" })
  })

  it("condition with sourcePath reads from the Execution Context instead of the trigger value", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Condição",
      position: { x: 0, y: 0 },
      config: { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "nodeOutputs.diagnostico.critico" },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "action" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "end" },
      ],
    }
    const matched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({
          current_node_id: "condition",
          matched_value_numeric: null,
          node_outputs: { diagnostico: { critico: true } },
        }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(matched).toMatchObject({ kind: "advance", nextNodeId: "action" })
  })

  it("condition with historicalQuery counts qualifying measurements in the window and compares the count", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Reincidência",
      position: { x: 0, y: 0 },
      config: {
        comparator: "GTE",
        thresholdNumeric: 3,
        historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", comparator: "LT", indicatorThreshold: 3, windowDays: 7 },
      },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "escalate" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "end" },
      ],
    }
    const queryingDb = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("from indicator_measurements")) return { rows: [{ value: "1" }, { value: "2" }, { value: "2.5" }, { value: "4" }], rowCount: 4 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database

    const outcome = await processNode(
      { db: queryingDb, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    // 3 medições (1, 2, 2.5) são < 3 -> contagem 3 -> 3 >= 3 -> true
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "escalate" })
  })

  it("condition with sourcePath compares non-numeric strings via EQUALS against thresholdText", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Severidade crítica?",
      position: { x: 0, y: 0 },
      config: { comparator: "EQUALS", thresholdText: "CRITICAL", sourcePath: "nodeOutputs.orchestrator.structuredResult.diagnosis.severity" },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "escalate" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "end" },
      ],
    }
    const matched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({
          current_node_id: "condition",
          node_outputs: { orchestrator: { structuredResult: { diagnosis: { severity: "CRITICAL" } } } },
        }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(matched).toMatchObject({ kind: "advance", nextNodeId: "escalate" })

    const unmatched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({
          current_node_id: "condition",
          node_outputs: { orchestrator: { structuredResult: { diagnosis: { severity: "LOW" } } } },
        }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(unmatched).toMatchObject({ kind: "advance", nextNodeId: "end" })
  })

  it("condition with sourcePath fails the node when the path can't be resolved", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Condição",
      position: { x: 0, y: 0 },
      config: { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "nodeOutputs.diagnostico.critico" },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "action" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "end" },
      ],
    }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: {} }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome.kind).toBe("fail")
  })

  it("human_review notifies reviewers and waits indefinitely on the first visit", async () => {
    notifyHumanReviewPending.mockClear()
    const node: FlowNode = {
      id: "review",
      type: "human_review",
      label: "Revisão",
      position: { x: 0, y: 0 },
      config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-approved", source: "review", sourceHandle: "approved", target: "end-ok" },
        { id: "e-rejected", source: "review", sourceHandle: "rejected", target: "end-no" },
        { id: "e-escalated", source: "review", sourceHandle: "escalated", target: "end-esc" },
      ],
    }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "review", status: "active" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome.kind).toBe("wait")
    expect(notifyHumanReviewPending).toHaveBeenCalledTimes(1)
  })

  it("human_review does not re-notify while already waiting without a decision yet", async () => {
    notifyHumanReviewPending.mockClear()
    const node: FlowNode = {
      id: "review",
      type: "human_review",
      label: "Revisão",
      position: { x: 0, y: 0 },
      config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } },
    }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e-approved", source: "review", sourceHandle: "approved", target: "end" }] }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "review", status: "waiting" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome.kind).toBe("wait")
    expect(notifyHumanReviewPending).not.toHaveBeenCalled()
  })

  it("human_review advances via the branch matching the recorded decision", async () => {
    const node: FlowNode = {
      id: "review",
      type: "human_review",
      label: "Revisão",
      position: { x: 0, y: 0 },
      config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-approved", source: "review", sourceHandle: "approved", target: "end-ok" },
        { id: "e-rejected", source: "review", sourceHandle: "rejected", target: "end-no" },
        { id: "e-escalated", source: "review", sourceHandle: "escalated", target: "end-esc" },
      ],
    }
    const outcome = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "review", status: "active", node_outputs: { review: { decision: "rejected" } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "end-no", eventType: "human_review_decided" })
  })

  it("end completes the flow", async () => {
    const node: FlowNode = { id: "end", type: "end", label: "Fim", position: { x: 0, y: 0 }, config: {} }
    const graph: FlowGraph = { nodes: [node], edges: [] }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "end" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toEqual({ kind: "complete" })
  })

  it("action calls the matching executor and advances via 'always'", async () => {
    const node: FlowNode = {
      id: "action",
      type: "action",
      label: "Ação",
      position: { x: 0, y: 0 },
      config: { actionType: "SET_CONFIG_VALUE", configKey: "acompanhamento.x", valueType: "NUMERIC", value: 3 },
    }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e1", source: "action", sourceHandle: "always", target: "end" }] }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "action" }), workflow: workflowScope, inputContext: "transcrição", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "end", eventType: "action_executed" })
  })

  it("action propagates the executor's variableUpdate onto the outcome (SET_VARIABLE)", async () => {
    const node: FlowNode = {
      id: "action",
      type: "action",
      label: "Ação",
      position: { x: 0, y: 0 },
      config: { actionType: "SET_VARIABLE", variableId: "var-1", value: true },
    }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e1", source: "action", sourceHandle: "always", target: "end" }] }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "action" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "end" })
    if (outcome.kind !== "advance") throw new Error("expected advance")
    expect(outcome.variableUpdate).toEqual({ variableId: "var-1", value: true })
  })

  it("action carries the executor's nodeOutput into the event payload too (auditoria — Parte 28/29 de variáveis dinâmicas)", async () => {
    vi.mocked(actionExecutors.SET_VARIABLE).mockResolvedValueOnce({
      variableUpdate: { variableId: "var-1", value: 87 },
      nodeOutput: { variableId: "var-1", value: 87, source: "DYNAMIC", sourcePath: "nodeOutputs.orch.structuredResult.risk.score" },
    })
    const node: FlowNode = {
      id: "action",
      type: "action",
      label: "Ação",
      position: { x: 0, y: 0 },
      config: { actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.orch.structuredResult.risk.score" },
    }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e1", source: "action", sourceHandle: "always", target: "end" }] }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "action" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    if (outcome.kind !== "advance") throw new Error("expected advance")
    // O eventPayload (workflow_enrollment_events) precisa carregar o nodeOutput também, não só o
    // node_outputs "atual" — é o que vira histórico auditável quando a mesma variável é definida
    // mais de uma vez na mesma execução (Parte 29 do pedido).
    expect(outcome.eventPayload).toEqual({
      actionType: "SET_VARIABLE",
      nodeOutput: { variableId: "var-1", value: 87, source: "DYNAMIC", sourcePath: "nodeOutputs.orch.structuredResult.risk.score" },
    })
  })

  it("Escalonar com continuation CONTINUE (ou ausente) avança pela edge 'always', igual qualquer outra Action (evolução do Escalonamento)", async () => {
    const node: FlowNode = {
      id: "action",
      type: "action",
      label: "Escalonar",
      position: { x: 0, y: 0 },
      config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"] },
    }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e1", source: "action", sourceHandle: "always", target: "end" }] }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "action" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "end" })
  })

  it("Escalonar com continuation END_BRANCH conclui a execução direto (kind: complete), SEM exigir nenhuma edge de saída (Parte 12/13 do pedido)", async () => {
    const node: FlowNode = {
      id: "action",
      type: "action",
      label: "Escalonar",
      position: { x: 0, y: 0 },
      config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, surfaces: ["NOTIFICATION"], continuation: "END_BRANCH" },
    }
    // Grafo SEM NENHUMA edge saindo de "action" — se o motor exigisse "always" aqui, falharia.
    const graph: FlowGraph = { nodes: [node], edges: [] }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "action" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome.kind).toBe("complete")
  })

  it("trigger grava o valor bruto (numérico) em node_outputs.trigger — vira uma origem resolvível igual a qualquer outro node (Parte 7 da evolução de variáveis dinâmicas)", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "condition" }],
    }
    const node = graph.nodes[0]!
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "trigger", matched_value_numeric: "4.2" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "condition", nodeOutput: 4.2 })
  })

  it("trigger grava o valor bruto (booleano) em node_outputs.trigger quando a flag é booleana", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "condition" }],
    }
    const node = graph.nodes[0]!
    const outcome = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "trigger", matched_value_boolean: true, matched_value_numeric: null }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "condition", nodeOutput: true })
  })

  it("trigger não grava nodeOutput quando não há valor bruto (ex.: gatilho por agenda) — nunca inventa um 0/false", async () => {
    const graph: FlowGraph = {
      nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }],
      edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "condition" }],
    }
    const node = graph.nodes[0]!
    const outcome = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "trigger", matched_value_boolean: null, matched_value_numeric: null }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(outcome).not.toHaveProperty("nodeOutput")
  })

  it("condition reads a Workflow Variable via sourcePath 'variables.<id>' just like nodeOutputs", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "URA baixa?",
      position: { x: 0, y: 0 },
      config: { comparator: "EQUALS", thresholdBoolean: true, sourcePath: "variables.var-1" },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "action" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "end" },
      ],
    }
    const matched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", variables: { "var-1": true } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(matched).toMatchObject({ kind: "advance", nextNodeId: "action" })

    const unmatched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", variables: { "var-1": false } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(unmatched).toMatchObject({ kind: "advance", nextNodeId: "end" })
  })

  it("condition supports the new string comparators (CONTAINS/STARTS_WITH/NOT_EQUALS/IS_EMPTY)", async () => {
    const graphFor = (comparator: string, thresholdText: string | undefined): { node: FlowNode; graph: FlowGraph } => {
      const node: FlowNode = {
        id: "condition",
        type: "condition",
        label: "Condição",
        position: { x: 0, y: 0 },
        config: { comparator: comparator as never, thresholdText, sourcePath: "nodeOutputs.orch.structuredResult.text" },
      }
      const graph: FlowGraph = {
        nodes: [node],
        edges: [
          { id: "e-true", source: "condition", sourceHandle: "true", target: "action" },
          { id: "e-false", source: "condition", sourceHandle: "false", target: "end" },
        ],
      }
      return { node, graph }
    }

    const contains = graphFor("CONTAINS", "cliente")
    const containsOutcome = await processNode(
      {
        db: fakeDb,
        graph: contains.graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { orch: { structuredResult: { text: "Ligação com o cliente" } } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      contains.node,
    )
    expect(containsOutcome).toMatchObject({ kind: "advance", nextNodeId: "action" })

    const startsWith = graphFor("STARTS_WITH", "Ligação")
    const startsWithOutcome = await processNode(
      {
        db: fakeDb,
        graph: startsWith.graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { orch: { structuredResult: { text: "Ligação com o cliente" } } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      startsWith.node,
    )
    expect(startsWithOutcome).toMatchObject({ kind: "advance", nextNodeId: "action" })

    const notEquals = graphFor("NOT_EQUALS", "LOW")
    const notEqualsOutcome = await processNode(
      {
        db: fakeDb,
        graph: notEquals.graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { orch: { structuredResult: { text: "HIGH" } } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      notEquals.node,
    )
    expect(notEqualsOutcome).toMatchObject({ kind: "advance", nextNodeId: "action" })

    const isEmpty = graphFor("IS_EMPTY", undefined)
    const isEmptyOutcome = await processNode(
      {
        db: fakeDb,
        graph: isEmpty.graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { orch: { structuredResult: { text: "" } } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      isEmpty.node,
    )
    expect(isEmptyOutcome).toMatchObject({ kind: "advance", nextNodeId: "action" })
  })

  it("condition supports array values via CONTAINS/IS_EMPTY", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Condição",
      position: { x: 0, y: 0 },
      config: { comparator: "CONTAINS", thresholdText: "urgente", sourcePath: "nodeOutputs.orch.structuredResult.tags" },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "action" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "end" },
      ],
    }
    const matched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { orch: { structuredResult: { tags: ["urgente", "financeiro"] } } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(matched).toMatchObject({ kind: "advance", nextNodeId: "action" })

    const unmatched = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { orch: { structuredResult: { tags: [] } } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(unmatched).toMatchObject({ kind: "advance", nextNodeId: "end" })
  })

  it("action propagates the executor's nodeOutput onto the outcome", async () => {
    const node: FlowNode = {
      id: "action",
      type: "action",
      label: "Ação",
      position: { x: 0, y: 0 },
      config: { actionType: "CALL_AGENT", agentId: "agent-1" },
    }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e1", source: "action", sourceHandle: "always", target: "end" }] }
    const outcome = await processNode(
      { db: fakeDb, graph, enrollment: baseEnrollment({ current_node_id: "action" }), workflow: workflowScope, inputContext: "transcrição", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "end" })
    if (outcome.kind !== "advance") throw new Error("expected advance")
    expect(outcome.nodeOutput).toEqual({ severity: "HIGH" })
  })
})

describe("processNode — condition: histórico generalizado (Parte 2)", () => {
  function historicalGraph(historicalQuery: object, comparator = "LT", thresholdNumeric = 3.3) {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Histórico",
      position: { x: 0, y: 0 },
      config: { comparator: comparator as never, thresholdNumeric, historicalQuery: historicalQuery as never },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
        { id: "e-no-data", source: "condition", sourceHandle: "no_data", target: "no-data-node" },
      ],
    }
    return { node, graph }
  }

  it("AVERAGE abaixo do limiar avança pro branch true", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "3.1", min_value: "2", max_value: "4", sample_count: "5" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("AVERAGE acima do limiar avança pro branch false", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "4.5", min_value: "4", max_value: "5", sample_count: "5" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "false-node" })
  })

  it("sem nenhuma medição no período avança pro branch no_data, nunca false", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("minimumSampleSize configurado: histórico insuficiente vira no_data mesmo com alguma medição", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
      minimumSampleSize: 3,
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "3.1", min_value: "3", max_value: "3.2", sample_count: "2" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("MINIMUM e MAXIMUM leem a coluna certa da agregação", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "3", min_value: "1", max_value: "950", sample_count: "4" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database

    const min = historicalGraph({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "MINIMUM", period: { kind: "ROLLING_DAYS", days: 30 } }, "LT", 2)
    const minOutcome = await processNode(
      { db, graph: min.graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      min.node,
    )
    expect(minOutcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" }) // 1 < 2

    const max = historicalGraph({ kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "MAXIMUM", period: { kind: "ROLLING_DAYS", days: 30 } }, "GT", 900)
    const maxOutcome = await processNode(
      { db, graph: max.graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      max.node,
    )
    expect(maxOutcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" }) // 950 > 900
  })

  it("period CALENDAR delega pro resolvedor de calendário compartilhado (mês anterior)", async () => {
    let capturedWindow: [string, string] | null = null
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "CALENDAR", unit: "MONTH" },
    })
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) {
          capturedWindow = [String(params?.[2]), String(params?.[3])]
          return { rows: [{ avg_value: "3.1", min_value: "3", max_value: "3.2", sample_count: "2" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const now = new Date("2026-03-15T12:00:00Z")
    await processNode({ db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now, effects }, node)
    expect(capturedWindow).not.toBeNull()
    // mês anterior completo a partir de 2026-03-15 -03:00 é fevereiro/2026 inteiro.
    expect(capturedWindow![0]!.slice(0, 7)).toBe("2026-02")
    expect(capturedWindow![1]!.slice(0, 7)).toBe("2026-03")
  })

  it("aggregation COUNT continua com 2 saídas (nunca no_data) — reincidência de sempre", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Reincidência",
      position: { x: 0, y: 0 },
      config: {
        comparator: "GTE",
        thresholdNumeric: 3,
        historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", comparator: "LT", indicatorThreshold: 3, windowDays: 7 },
      },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
      ],
    }
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("from indicator_measurements")) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    // 0 medições, 0 < 3 -> branch false, sem precisar de nenhuma aresta "no_data" no grafo.
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "false-node" })
  })

  it("source INDICATOR_ACHIEVEMENT agrega o atingimento% já normalizado, não indicator_measurements", async () => {
    const { node, graph } = historicalGraph(
      { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 90 } },
      "LT",
      80,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(achievement_percent)")) return { rows: [{ avg_value: "71.1", min_value: "60", max_value: "80", sample_count: "3" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) throw new Error("não deveria consultar indicator_measurements pra source=INDICATOR_ACHIEVEMENT")
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" }) // 71.1 < 80
  })
})

describe("processNode — condition: performanceQuery (Parte 8)", () => {
  function performanceGraph(performanceQuery: object, comparator: string, thresholdNumeric?: number, thresholdText?: string) {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Performance",
      position: { x: 0, y: 0 },
      config: { comparator: comparator as never, thresholdNumeric, thresholdText, performanceQuery: performanceQuery as never },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
        { id: "e-no-data", source: "condition", sourceHandle: "no_data", target: "no-data-node" },
      ],
    }
    return { node, graph }
  }

  it("quartil do indicador == Q4 compara como string, nunca infere do valor bruto", async () => {
    const { node, graph } = performanceGraph({ kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "NOTA_URA" }, "EQUALS", undefined, "Q4")
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("from employee_indicator_performance")) {
          return {
            rows: [
              {
                id: "perf-1",
                personId: "operator-1",
                indicatorDefinitionId: "indicator-def-1",
                indicatorCode: "NOTA_URA",
                subteamId: null,
                referencePeriod: "2026-08",
                value: "2",
                targetValue: "4.5",
                achievementPercent: "60",
                weightPercent: "20",
                quartile: "Q4",
                source: "MANUAL_SEED",
              },
            ],
            rowCount: 1,
          }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("atingimento consolidado do PRV usa a tabela de PRV, comparação numérica", async () => {
    const { node, graph } = performanceGraph({ kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" }, "LT", 85)
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("from employee_prv_performance")) {
          return {
            rows: [{ id: "prv-1", personId: "operator-1", subteamId: null, referencePeriod: "2026-08", achievementPercent: "72", quartile: "Q4", source: "MANUAL_SEED" }],
            rowCount: 1,
          }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" }) // 72 < 85
  })

  it("sem nenhum registro de performance ainda -> no_data, nunca false", async () => {
    const { node, graph } = performanceGraph({ kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" }, "EQUALS", undefined, "Q4")
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("from employee_prv_performance")) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })
})

describe("processNode — condition: AND/OR (Parte 3)", () => {
  it("ALL (E) só bate quando TODAS as regras batem", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "URA baixa e PRV baixo",
      position: { x: 0, y: 0 },
      config: {
        comparator: "EQUALS",
        group: {
          operator: "ALL",
          rules: [
            { comparator: "LT", thresholdNumeric: 3, sourcePath: "nodeOutputs.a.value" },
            { comparator: "LT", thresholdNumeric: 80, sourcePath: "nodeOutputs.b.value" },
          ],
        },
      },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
      ],
    }
    const bothMatch = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { a: { value: 2 }, b: { value: 70 } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(bothMatch).toMatchObject({ kind: "advance", nextNodeId: "true-node" })

    const onlyOneMatches = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { a: { value: 2 }, b: { value: 90 } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(onlyOneMatches).toMatchObject({ kind: "advance", nextNodeId: "false-node" })
  })

  it("ANY (OU) basta UMA regra bater", async () => {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Q4 indicador ou Q4 PRV",
      position: { x: 0, y: 0 },
      config: {
        comparator: "EQUALS",
        group: {
          operator: "ANY",
          rules: [
            { comparator: "EQUALS", thresholdText: "Q4", sourcePath: "nodeOutputs.a.quartile" },
            { comparator: "EQUALS", thresholdText: "Q4", sourcePath: "nodeOutputs.b.quartile" },
          ],
        },
      },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
      ],
    }
    const oneMatches = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { a: { quartile: "Q1" }, b: { quartile: "Q4" } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(oneMatches).toMatchObject({ kind: "advance", nextNodeId: "true-node" })

    const neitherMatches = await processNode(
      {
        db: fakeDb,
        graph,
        enrollment: baseEnrollment({ current_node_id: "condition", node_outputs: { a: { quartile: "Q1" }, b: { quartile: "Q2" } } }),
        workflow: workflowScope,
        inputContext: "",
        now: new Date(),
        effects,
      },
      node,
    )
    expect(neitherMatches).toMatchObject({ kind: "advance", nextNodeId: "false-node" })
  })
})

describe("processNode — condition: histórico com Unidade de Análise agregada, Período e Comparação (evolução de Abrangência/Unidade de Análise)", () => {
  function historicalGraph(historicalQuery: object, comparator = "LT", thresholdNumeric: number | undefined = 3.3) {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Histórico agregado",
      position: { x: 0, y: 0 },
      config: { comparator: comparator as never, thresholdNumeric: thresholdNumeric as never, historicalQuery: historicalQuery as never },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
        { id: "e-no-data", source: "condition", sourceHandle: "no_data", target: "no-data-node" },
      ],
    }
    return { node, graph }
  }

  const supervisorEnrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "supervisor-1", matched_value_numeric: null })
  const aggregateWorkflow = { ...workflowScope, consolidatedStructure: { kind: "SUPERVISOR_TEAM" as const, supervisorId: "supervisor-1" } }

  it("agrega a Condition sobre TODA a equipe do supervisor (Unidade de Análise = Equipe de Supervisor), nunca sobre o supervisor sozinho", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
    })
    const seenSubjectIds: unknown[] = []
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: "op-1" }, { id: "op-2" }], rowCount: 2 }
        if (sql.includes("avg(m.value)")) {
          seenSubjectIds.push(params?.[1])
          return { rows: [{ avg_value: "2.9", min_value: "2", max_value: "3.5", sample_count: "10" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment: supervisorEnrollment, workflow: aggregateWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
    expect(seenSubjectIds[0]).toEqual(["op-1", "op-2"]) // nunca ["supervisor-1"]
  })

  it("equipe sem nenhum operador vira Sem Dados, nunca Não (nunca inventa um resultado)", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [], rowCount: 0 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    // Sem nenhum operador na equipe, o próprio supervisor vira o "sujeito" (fallback de
    // resolveSubjectIds) — ainda assim sem medição nenhuma pra ele, o resultado é Sem Dados.
    const outcome = await processNode({ db, graph, enrollment: supervisorEnrollment, workflow: aggregateWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("Período CURRENT ('Este mês'): usa a janela corrente parcial, nunca o mês anterior completo", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "CALENDAR", unit: "MONTH", phase: "CURRENT" },
    })
    const seenWindow: { start?: string; end?: string } = {}
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) {
          seenWindow.start = params?.[2] as string
          seenWindow.end = params?.[3] as string
          return { rows: [{ avg_value: "3.0", min_value: "3", max_value: "3", sample_count: "1" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const now = new Date("2026-09-14T12:00:00.000Z")
    await processNode({ db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now, effects }, node)
    // A janela corrente termina em "agora" (parcial) — nunca antes do início deste mês.
    expect(new Date(seenWindow.end!).getTime()).toBe(now.getTime())
    expect(new Date(seenWindow.start!).getTime()).toBeLessThan(now.getTime())
  })

  it("compareTo GOAL: compara contra a meta vigente do time, nunca um valor fixo digitado", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "QUALIDADE",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
      compareTo: { kind: "GOAL" },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "80", min_value: "80", max_value: "80", sample_count: "1" }], rowCount: 1 }
        if (sql.includes("from goals g")) return { rows: [{ personId: "operator-1", effectiveGoal: "85" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    // comparator LT (config): 80 < 85 (meta) -> true, mesmo com thresholdNumeric ausente/irrelevante.
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      { ...node, config: { ...node.config, thresholdNumeric: undefined } },
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("compareTo GOAL sem meta cadastrada vira Sem Dados, nunca compara contra um valor inventado", async () => {
    const { node, graph } = historicalGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "QUALIDADE",
      aggregation: "AVERAGE",
      period: { kind: "ROLLING_DAYS", days: 30 },
      compareTo: { kind: "GOAL" },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "80", min_value: "80", max_value: "80", sample_count: "1" }], rowCount: 1 }
        if (sql.includes("from goals g")) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("compareTo PREVIOUS_PERIOD: compara contra o mesmo cálculo do período anterior, real (nunca período atual duplicado)", async () => {
    const { node, graph } = historicalGraph(
      {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "TMA",
        aggregation: "AVERAGE",
        period: { kind: "ROLLING_DAYS", days: 7 },
        compareTo: { kind: "PREVIOUS_PERIOD" },
      },
      "GT",
      undefined,
    )
    let call = 0
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) {
          call += 1
          // 1ª chamada = período corrente (pior, TMA maior); 2ª = período anterior (melhor).
          const avg = call === 1 ? "620" : "540"
          return { rows: [{ avg_value: avg, min_value: avg, max_value: avg, sample_count: "5" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    // comparator GT: TMA corrente (620) > TMA anterior (540) -> true ("piorou").
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("compareTo PREVIOUS_PERIOD + changeMode PERCENT: aumentou pelo menos 10% -> true", async () => {
    const { node, graph } = historicalGraph(
      {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "TMA",
        aggregation: "AVERAGE",
        period: { kind: "ROLLING_DAYS", days: 7 },
        compareTo: { kind: "PREVIOUS_PERIOD", changeMode: "PERCENT" },
      },
      "GTE",
      10,
    )
    let call = 0
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) {
          call += 1
          // 1ª chamada = período corrente (468s); 2ª = período anterior (420s) -> +11,43%.
          const avg = call === 1 ? "468" : "420"
          return { rows: [{ avg_value: avg, min_value: avg, max_value: avg, sample_count: "5" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("compareTo PREVIOUS_PERIOD + changeMode PERCENT: variação abaixo do mínimo pedido -> false, nunca dispara à toa", async () => {
    const { node, graph } = historicalGraph(
      {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "TMA",
        aggregation: "AVERAGE",
        period: { kind: "ROLLING_DAYS", days: 7 },
        compareTo: { kind: "PREVIOUS_PERIOD", changeMode: "PERCENT" },
      },
      "GTE",
      10,
    )
    let call = 0
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) {
          call += 1
          // 420 -> 421: variação de ~0,24%, bem abaixo dos 10% pedidos — nunca dispara por um
          // ruído mínimo (Parte 18 do pedido).
          const avg = call === 1 ? "421" : "420"
          return { rows: [{ avg_value: avg, min_value: avg, max_value: avg, sample_count: "5" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "false-node" })
  })

  it("compareTo PREVIOUS_PERIOD + changeMode PERCENT: valor anterior zero vira Sem Dados, nunca divide por zero", async () => {
    const { node, graph } = historicalGraph(
      {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "TMA",
        aggregation: "AVERAGE",
        period: { kind: "ROLLING_DAYS", days: 7 },
        compareTo: { kind: "PREVIOUS_PERIOD", changeMode: "PERCENT" },
      },
      "GTE",
      10,
    )
    let call = 0
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("avg(m.value)")) {
          call += 1
          const avg = call === 1 ? "100" : "0"
          return { rows: [{ avg_value: avg, min_value: avg, max_value: avg, sample_count: "5" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })
})

describe("processNode — condition: Recorrência de Quartil (Parte 7/8/10/24)", () => {
  function recurrenceGraph(performanceQuery: object, comparator: string, thresholdNumeric: number) {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Recorrência",
      position: { x: 0, y: 0 },
      config: { comparator: comparator as never, thresholdNumeric, performanceQuery: performanceQuery as never },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
        { id: "e-no-data", source: "condition", sourceHandle: "no_data", target: "no-data-node" },
      ],
    }
    return { node, graph }
  }

  function indicatorPerformanceRows(quartiles: string[]) {
    return quartiles.map((quartile, index) => ({
      id: `perf-${index}`,
      personId: "operator-1",
      indicatorDefinitionId: "indicator-def-1",
      indicatorCode: "MONITORIA",
      subteamId: null,
      referencePeriod: `2026-0${8 - index}`,
      value: "2",
      targetValue: "4.5",
      achievementPercent: "60",
      weightPercent: "20",
      quartile,
      source: "MANUAL_SEED",
    }))
  }

  function prvPerformanceRows(quartiles: string[]) {
    return quartiles.map((quartile, index) => ({
      id: `prv-${index}`,
      personId: "operator-1",
      subteamId: null,
      referencePeriod: `2026-0${8 - index}`,
      achievementPercent: "72",
      quartile,
      source: "MANUAL_SEED",
    }))
  }

  it("Q4 em 3 dos últimos 3 fechamentos (indicador) -> true", async () => {
    const { node, graph } = recurrenceGraph(
      { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "MONITORIA", recurrence: { periods: 3, matchQuartile: "Q4" } },
      "GTE",
      3,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("from employee_indicator_performance")) return { rows: indicatorPerformanceRows(["Q4", "Q4", "Q4"]), rowCount: 3 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("Q4 em só 2 dos últimos 3 fechamentos (PRV) -> false, nunca Sem Dados quando o histórico É suficiente", async () => {
    const { node, graph } = recurrenceGraph({ kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE", recurrence: { periods: 3, matchQuartile: "Q4" } }, "GTE", 3)
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("from employee_prv_performance")) return { rows: prvPerformanceRows(["Q4", "Q4", "Q2"]), rowCount: 3 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "false-node" })
  })

  it("colaborador com menos fechamentos do que os N pedidos -> Sem Dados, nunca compara uma contagem parcial", async () => {
    const { node, graph } = recurrenceGraph(
      { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "MONITORIA", recurrence: { periods: 3, matchQuartile: "Q4" } },
      "GTE",
      3,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        // Colaborador só tem 1 fechamento no histórico, mas a regra pede 3.
        if (sql.includes("from employee_indicator_performance")) return { rows: indicatorPerformanceRows(["Q4"]), rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("colaborador sem nenhum fechamento ainda -> Sem Dados", async () => {
    const { node, graph } = recurrenceGraph(
      { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_QUARTILE", indicatorCode: "MONITORIA", recurrence: { periods: 3, matchQuartile: "Q4" } },
      "GTE",
      3,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("from employee_indicator_performance")) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode(
      { db, graph, enrollment: baseEnrollment({ current_node_id: "condition" }), workflow: workflowScope, inputContext: "", now: new Date(), effects },
      node,
    )
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })
})

describe("processNode — condition: Meta por Subgrupo (Parte 1/2 do pedido de Meta/Fechamentos)", () => {
  function goalGraph() {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Qualidade abaixo da meta",
      position: { x: 0, y: 0 },
      config: {
        comparator: "LT",
        thresholdNumeric: undefined,
        historicalQuery: {
          kind: "INDICATOR_THRESHOLD_COUNT",
          indicatorCode: "QUALIDADE",
          aggregation: "AVERAGE",
          period: { kind: "ROLLING_DAYS", days: 30 },
          compareTo: { kind: "GOAL" },
        } as never,
      },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
        { id: "e-no-data", source: "condition", sourceHandle: "no_data", target: "no-data-node" },
      ],
    }
    return { node, graph }
  }

  function fakeDbWithGoals(measurementValue: string, goalsByPerson: Record<string, string | null>) {
    return {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: measurementValue, min_value: measurementValue, max_value: measurementValue, sample_count: "5" }], rowCount: 1 }
        if (sql.includes("from goals g")) {
          const subjectIds = params?.[2] as string[]
          const rows = subjectIds.filter((id) => goalsByPerson[id] !== undefined).map((id) => ({ personId: id, effectiveGoal: goalsByPerson[id] }))
          return { rows, rowCount: rows.length }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
  }

  it("João (Subgrupo A, meta 85): 80 < 85 -> true", async () => {
    const { node, graph } = goalGraph()
    const db = fakeDbWithGoals("80", { "joao-1": "85" })
    const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "joao-1" })
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("Maria (Subgrupo B, meta 90): MESMA Condition, meta diferente — 80 < 90 continua true, mas contra um número diferente (nunca uma meta global fixa)", async () => {
    const { node, graph } = goalGraph()
    const db = fakeDbWithGoals("80", { "maria-1": "90" })
    const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "maria-1" })
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
    // Confirma que a query de metas foi de fato consultada com o subject certo (não hardcoded).
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("from goals g"), expect.arrayContaining([["maria-1"]]))
  })

  it("colaborador sem meta de Subgrupo cadastrada cai pro fallback da meta de Time (retrocompatibilidade)", async () => {
    const { node, graph } = goalGraph()
    // fakeDbWithGoals simula o resultado já resolvido (coalesce Subgrupo->Time) — o teste real da
    // prioridade SQL entre os dois níveis é coberto pela própria query (coalesce), aqui confirma
    // que UM valor de meta qualquer (seja de onde vier) já é suficiente pra resolver a Condition.
    const db = fakeDbWithGoals("80", { "pedro-1": "88" })
    const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "pedro-1" })
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("estrutura Consolidada com membros de Subgrupos com METAS DIFERENTES -> Sem Dados, nunca escolhe uma arbitrariamente", async () => {
    const { node, graph } = goalGraph()
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: "joao-1" }, { id: "maria-1" }], rowCount: 2 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "80", min_value: "80", max_value: "80", sample_count: "10" }], rowCount: 1 }
        if (sql.includes("from goals g")) {
          const subjectIds = params?.[2] as string[]
          const goalsByPerson: Record<string, string> = { "joao-1": "85", "maria-1": "90" }
          return { rows: subjectIds.map((id) => ({ personId: id, effectiveGoal: goalsByPerson[id] })), rowCount: subjectIds.length }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "supervisor-1" })
    const aggregateWorkflow = { ...workflowScope, consolidatedStructure: { kind: "SUPERVISOR_TEAM" as const, supervisorId: "supervisor-1" } }
    const outcome = await processNode({ db, graph, enrollment, workflow: aggregateWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("estrutura Consolidada onde todos os membros resolvem a MESMA meta -> compara normalmente", async () => {
    const { node, graph } = goalGraph()
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: "joao-1" }, { id: "carlos-1" }], rowCount: 2 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "80", min_value: "80", max_value: "80", sample_count: "10" }], rowCount: 1 }
        if (sql.includes("from goals g")) {
          const subjectIds = params?.[2] as string[]
          return { rows: subjectIds.map((id) => ({ personId: id, effectiveGoal: "85" })), rowCount: subjectIds.length }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "supervisor-1" })
    const aggregateWorkflow = { ...workflowScope, consolidatedStructure: { kind: "SUPERVISOR_TEAM" as const, supervisorId: "supervisor-1" } }
    const outcome = await processNode({ db, graph, enrollment, workflow: aggregateWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("algum membro sem nenhuma meta aplicável -> Sem Dados", async () => {
    const { node, graph } = goalGraph()
    // Estrutura com 2 membros — a query real sempre devolve UMA linha por pessoa (coalesce),
    // mesmo sem meta nenhuma: joao-1 tem meta cadastrada, maria-1 devolve effectiveGoal null.
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: "joao-1" }, { id: "maria-1" }], rowCount: 2 }
        if (sql.includes("avg(m.value)")) return { rows: [{ avg_value: "80", min_value: "80", max_value: "80", sample_count: "10" }], rowCount: 1 }
        if (sql.includes("from goals g")) {
          const subjectIds = params?.[2] as string[]
          const goalsByPerson: Record<string, string | null> = { "joao-1": "85", "maria-1": null }
          const rows = subjectIds.map((id) => ({ personId: id, effectiveGoal: goalsByPerson[id] ?? null }))
          return { rows, rowCount: rows.length }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const aggregateWorkflow = { ...workflowScope, consolidatedStructure: { kind: "SUPERVISOR_TEAM" as const, supervisorId: "supervisor-1" } }
    const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "supervisor-1" })
    const outcome = await processNode({ db, graph, enrollment, workflow: aggregateWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })
})

describe("processNode — condition: Últimos N fechamentos para Valor/Atingimento/PRV (Parte 3/4/5 do pedido de Meta/Fechamentos)", () => {
  function closuresGraph(historicalQuery: object, comparator = "LT", thresholdNumeric = 3.3) {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Fechamentos",
      position: { x: 0, y: 0 },
      config: { comparator: comparator as never, thresholdNumeric: thresholdNumeric as never, historicalQuery: historicalQuery as never },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
        { id: "e-no-data", source: "condition", sourceHandle: "no_data", target: "no-data-node" },
      ],
    }
    return { node, graph }
  }

  const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "operator-1" })

  it("Valor do indicador — últimos 3 meses fechados completos: Média 2,9 < 3,3 -> true", async () => {
    const { node, graph } = closuresGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("missing_months")) return { rows: [{ missing_months: "0", avg_value: "2.9", min_value: "2.5", max_value: "3.2", sample_count: "12" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("Valor do indicador — mês corrente NUNCA entra nos meses fechados esperados", async () => {
    const { node, graph } = closuresGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
    })
    const now = new Date("2026-09-15T12:00:00Z")
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("missing_months")) {
          // Hoje 15/09/2026 -> os 3 meses fechados esperados são Agosto/Julho/Junho (calendário
          // local -03); Setembro (mês corrente, ainda em andamento) nunca pode aparecer.
          const [, , starts, ends] = params as [string, string[], string[], string[]]
          expect(starts).toEqual(["2026-08-01T03:00:00.000Z", "2026-07-01T03:00:00.000Z", "2026-06-01T03:00:00.000Z"])
          expect(ends).toEqual(["2026-09-01T03:00:00.000Z", "2026-08-01T03:00:00.000Z", "2026-07-01T03:00:00.000Z"])
          return { rows: [{ missing_months: "0", avg_value: "2.9", min_value: "2.5", max_value: "3.2", sample_count: "9" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now, effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("Valor do indicador — um mês esperado (Julho) sem dados -> Sem Dados, nunca busca um mês mais antigo pra completar", async () => {
    const { node, graph } = closuresGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        // A engine consulta EXATAMENTE os 3 meses esperados (Junho/Julho/Agosto) — mesmo que
        // Maio tenha dado, ele nunca entra na consulta (não há "busca mais pra trás" nenhuma).
        if (sql.includes("missing_months")) return { rows: [{ missing_months: "1", avg_value: "3.0", min_value: "2.8", max_value: "3.2", sample_count: "6" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("Valor do indicador — só 2 dos 3 meses fechados pedidos têm dado -> Sem Dados, nunca uma média parcial", async () => {
    const { node, graph } = closuresGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "NOTA_URA",
      aggregation: "AVERAGE",
      period: { kind: "CLOSURES", unit: "MONTH", count: 3 },
    })
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("missing_months")) return { rows: [{ missing_months: "1", avg_value: "2.9", min_value: "2.5", max_value: "3.2", sample_count: "8" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("Atingimento do indicador — últimos 3 fechamentos completos: Média 92% < 90%? -> false", async () => {
    const { node, graph } = closuresGraph(
      { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
      "LT",
      90,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("recent_periods") && sql.includes("employee_indicator_performance")) {
          return { rows: [{ avg_value: "92", min_value: "88", max_value: "95", sample_count: "3", total_closures: "3" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "false-node" })
  })

  it("Atingimento do indicador — histórico insuficiente (1 de 3 fechamentos) -> Sem Dados", async () => {
    const { node, graph } = closuresGraph(
      { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
      "LT",
      90,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("recent_periods") && sql.includes("employee_indicator_performance")) {
          return { rows: [{ avg_value: "92", min_value: "92", max_value: "92", sample_count: "1", total_closures: "1" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })

  it("Atingimento do PRV — últimos 3 fechamentos completos: Média 72% < 80% -> true", async () => {
    const { node, graph } = closuresGraph(
      { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
      "LT",
      80,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("recent_periods") && sql.includes("employee_prv_performance")) {
          return { rows: [{ avg_value: "72", min_value: "68", max_value: "76", sample_count: "3", total_closures: "3" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("Atingimento do PRV — histórico insuficiente -> Sem Dados", async () => {
    const { node, graph } = closuresGraph(
      { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
      "LT",
      80,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("recent_periods") && sql.includes("employee_prv_performance")) {
          return { rows: [{ avg_value: "72", min_value: "72", max_value: "72", sample_count: "1", total_closures: "1" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "no-data-node" })
  })
})

describe("processNode — condition: PRV sem indicador e COUNT proibido pra Atingimento/PRV (dois bugs de domínio pós-revalidação)", () => {
  function closuresGraph(historicalQuery: object, comparator = "LT", thresholdNumeric = 3.3) {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Condição",
      position: { x: 0, y: 0 },
      config: { comparator: comparator as never, thresholdNumeric: thresholdNumeric as never, historicalQuery: historicalQuery as never },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
        { id: "e-no-data", source: "condition", sourceHandle: "no_data", target: "no-data-node" },
      ],
    }
    return { node, graph }
  }

  const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "operator-1" })

  it("Atingimento do PRV SEM indicatorCode (campo ausente, nunca string vazia) + Média, período comum -> usa employee_prv_performance normalmente", async () => {
    const { node, graph } = closuresGraph({ kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "AVERAGE", source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 } }, "LT", 80)
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("employee_prv_performance")) return { rows: [{ avg_value: "72", min_value: "68", max_value: "76", sample_count: "3" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("Atingimento do PRV com Mínimo -> continua usando employee_prv_performance (matriz de agregação)", async () => {
    const { node, graph } = closuresGraph({ kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "MINIMUM", source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 } }, "LT", 80)
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("employee_prv_performance")) return { rows: [{ avg_value: "72", min_value: "68", max_value: "76", sample_count: "3" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    // Mínimo (68) < 80 -> true; prova que a agregação MINIMUM foi mesmo usada, não a Média.
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })

  it("Atingimento do PRV com Máximo -> continua usando employee_prv_performance (matriz de agregação)", async () => {
    const { node, graph } = closuresGraph({ kind: "INDICATOR_THRESHOLD_COUNT", aggregation: "MAXIMUM", source: "PRV_ACHIEVEMENT", period: { kind: "ROLLING_DAYS", days: 30 } }, "LT", 80)
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("employee_prv_performance")) return { rows: [{ avg_value: "72", min_value: "68", max_value: "90", sample_count: "3" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    // Máximo (90) < 80 é falso -> prova que MAXIMUM foi mesmo usado, não a Média (72, que bateria).
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "false-node" })
  })

  it("Quantidade de ocorrências (COUNT) + source Atingimento do indicador -> falha controlada em runtime, nunca reinterpreta como Valor bruto", async () => {
    const { node, graph } = closuresGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "QUALIDADE",
      aggregation: "COUNT",
      source: "INDICATOR_ACHIEVEMENT",
      comparator: "LT",
      indicatorThreshold: 3,
      period: { kind: "ROLLING_DAYS", days: 7 },
    })
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database
    await expect(processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /Quantidade de ocorrências.*só está disponível para Valor do indicador/,
    )
    // Nunca chegou a consultar indicator_measurements como se a origem fosse MEASUREMENT.
    // Só o contexto organizacional (timezone) é lido antes da falha — nunca uma medição.
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) => String(sql).includes("indicator_measurements") || String(sql).includes("employee_"))).toBe(false)
  })

  it("Quantidade de ocorrências (COUNT) + source Atingimento do PRV -> falha controlada em runtime", async () => {
    const { node, graph } = closuresGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      aggregation: "COUNT",
      source: "PRV_ACHIEVEMENT",
      comparator: "LT",
      indicatorThreshold: 3,
      period: { kind: "ROLLING_DAYS", days: 7 },
    })
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database
    await expect(processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /Quantidade de ocorrências.*só está disponível para Valor do indicador/,
    )
    // Só o contexto organizacional (timezone) é lido antes da falha — nunca uma medição.
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) => String(sql).includes("indicator_measurements") || String(sql).includes("employee_"))).toBe(false)
  })

  it("Valor do indicador (MEASUREMENT/ausente) + COUNT continua funcionando normalmente (regressão)", async () => {
    const { node, graph } = closuresGraph(
      { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "COUNT", comparator: "LT", indicatorThreshold: 3, period: { kind: "ROLLING_DAYS", days: 7 } },
      "GTE",
      1,
    )
    const db = {
      query: vi.fn(async () => ({ rows: [{ value: "2.5" }, { value: "2.9" }], rowCount: 2 })),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })
})

describe("processNode — condition: Meta vigente só é referência válida pra Valor do indicador (Atingimento já representa a relação com a meta)", () => {
  function closuresGraph(historicalQuery: object, comparator = "LT", thresholdNumeric = 3.3) {
    const node: FlowNode = {
      id: "condition",
      type: "condition",
      label: "Condição",
      position: { x: 0, y: 0 },
      config: { comparator: comparator as never, thresholdNumeric: thresholdNumeric as never, historicalQuery: historicalQuery as never },
    }
    const graph: FlowGraph = {
      nodes: [node],
      edges: [
        { id: "e-true", source: "condition", sourceHandle: "true", target: "true-node" },
        { id: "e-false", source: "condition", sourceHandle: "false", target: "false-node" },
        { id: "e-no-data", source: "condition", sourceHandle: "no_data", target: "no-data-node" },
      ],
    }
    return { node, graph }
  }

  const enrollment = baseEnrollment({ current_node_id: "condition", interaction_id: null, scheduled_subject_id: "operator-1" })

  it("Atingimento do indicador + Meta vigente -> falha controlada em runtime, nunca vira Sem Dados como se fosse uma condição legítima", async () => {
    const { node, graph } = closuresGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      indicatorCode: "QUALIDADE",
      aggregation: "AVERAGE",
      source: "INDICATOR_ACHIEVEMENT",
      period: { kind: "ROLLING_DAYS", days: 30 },
      compareTo: { kind: "GOAL" },
    })
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database
    await expect(processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /Meta vigente.*só está disponível para Valor do indicador/,
    )
    // Só o contexto organizacional (timezone) é lido antes da falha — nunca uma medição.
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) => String(sql).includes("indicator_measurements") || String(sql).includes("employee_"))).toBe(false)
  })

  it("Atingimento do PRV + Meta vigente -> falha controlada em runtime", async () => {
    const { node, graph } = closuresGraph({
      kind: "INDICATOR_THRESHOLD_COUNT",
      aggregation: "AVERAGE",
      source: "PRV_ACHIEVEMENT",
      period: { kind: "ROLLING_DAYS", days: 30 },
      compareTo: { kind: "GOAL" },
    })
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Database
    await expect(processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /Meta vigente.*só está disponível para Valor do indicador/,
    )
    // Só o contexto organizacional (timezone) é lido antes da falha — nunca uma medição.
    expect((db.query as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) => String(sql).includes("indicator_measurements") || String(sql).includes("employee_"))).toBe(false)
  })

  it("Atingimento do indicador + Período anterior continua funcionando normalmente (regressão — só Meta vigente é proibida)", async () => {
    const { node, graph } = closuresGraph(
      {
        kind: "INDICATOR_THRESHOLD_COUNT",
        indicatorCode: "QUALIDADE",
        aggregation: "AVERAGE",
        source: "INDICATOR_ACHIEVEMENT",
        period: { kind: "ROLLING_DAYS", days: 30 },
        compareTo: { kind: "PREVIOUS_PERIOD" },
      },
      "GTE",
      0,
    )
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("employee_indicator_performance")) return { rows: [{ avg_value: "80", min_value: "80", max_value: "80", sample_count: "3" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "true-node" })
  })
})

describe("processNode — select_employees / apply_individually (EMPLOYEE_COLLECTION)", () => {
  const consolidatedWorkflow = { ...workflowScope, consolidatedStructure: { kind: "SUPERVISOR_TEAM" as const, supervisorId: "supervisor-1" } }
  const consolidatedEnrollment = baseEnrollment({ current_node_id: "select", interaction_id: null, scheduled_subject_id: "supervisor-1" })

  function selectNode(criterion?: object): FlowNode {
    return {
      id: "select",
      type: "select_employees",
      label: "Selecionar colaboradores",
      position: { x: 0, y: 0 },
      config: criterion ? { criterion: criterion as never } : {},
    }
  }
  const QUARTILE_CRITERION = {
    comparator: "GTE",
    thresholdNumeric: 80,
    historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } },
  }

  it("rejeita rodar fora de um Workflow Consolidado — defesa em runtime (payload manual)", async () => {
    const node = selectNode(QUARTILE_CRITERION)
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "select", sourceHandle: "always", target: "end" }] }
    const db = {} as Database
    await expect(processNode({ db, graph, enrollment: consolidatedEnrollment, workflow: workflowScope, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /só é válido num Workflow em modo Consolidado/,
    )
  })

  it("rejeita rodar sem critério configurado", async () => {
    const node = selectNode()
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "select", sourceHandle: "always", target: "end" }] }
    const db = {} as Database
    await expect(processNode({ db, graph, enrollment: consolidatedEnrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /precisa de um critério de seleção configurado/,
    )
  })

  it("primeira seleção (STRUCTURE): resolve Estrutura ∩ Abrangência/Filtro populacional e grava a coleção em node_outputs", async () => {
    const node = selectNode(QUARTILE_CRITERION)
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "select", sourceHandle: "always", target: "apply" }] }
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: "op-1" }, { id: "op-2" }], rowCount: 2 }
        if (sql.includes("role = 'OPERATOR' and active")) return { rows: [{ id: "op-1" }, { id: "op-2" }], rowCount: 2 }
        if (sql.includes("from indicator_measurements")) {
          const valueOf = (operatorId: string) => (operatorId === "op-1" ? 90 : 50) // op-1 TRUE, op-2 FALSE
          if (sql.includes("group by m.subject_id")) {
            return { rows: (params?.[1] as string[]).map((id) => ({ subject_id: id, avg_value: String(valueOf(id)), min_value: String(valueOf(id)), max_value: String(valueOf(id)), sample_count: "1" })), rowCount: 0 }
          }
          const value = valueOf((params?.[1] as string[])[0]!)
          return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment: consolidatedEnrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({
      kind: "advance",
      nextNodeId: "apply",
      eventType: "employees_selected",
      eventPayload: { evaluatedCount: 2, selectedCount: 1, notMatchedCount: 1, noDataCount: 0 },
    })
    expect(outcome).toMatchObject({ nodeOutput: { kind: "EMPLOYEE_COLLECTION", memberIds: ["op-1"], sourceKind: "STRUCTURE", sourceNodeId: null } })
  })

  it("refinamento (COLLECTION -> COLLECTION): lê só node_outputs da coleção anterior, nunca reconsulta estrutura/elegibilidade", async () => {
    const previousCollection = {
      kind: "EMPLOYEE_COLLECTION",
      memberIds: ["op-1", "op-2"],
      evaluatedCount: 10,
      selectedCount: 2,
      notMatchedCount: 5,
      noDataCount: 3,
      sourceKind: "STRUCTURE",
      sourceNodeId: null,
      criterion: QUARTILE_CRITERION,
      selectedAt: new Date().toISOString(),
    }
    const node: FlowNode = { id: "select-2", type: "select_employees", label: "PRV < 80%", position: { x: 0, y: 0 }, config: { criterion: QUARTILE_CRITERION as never } }
    const graph: FlowGraph = {
      nodes: [{ id: "select-1", type: "select_employees", label: "Q4 3/3", position: { x: 0, y: 0 }, config: {} }, node],
      edges: [
        { id: "e0", source: "select-1", sourceHandle: "always", target: "select-2" },
        { id: "e1", source: "select-2", sourceHandle: "always", target: "end" },
      ],
    }
    const structureQueries: string[] = []
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("reports_to_id") || sql.includes("role = 'OPERATOR' and active")) structureQueries.push(sql)
        if (sql.includes("from indicator_measurements")) {
          const valueOf = (operatorId: string) => (operatorId === "op-1" ? "90" : "50")
          if (sql.includes("group by m.subject_id")) {
            return { rows: (params?.[1] as string[]).map((id) => ({ subject_id: id, avg_value: valueOf(id), min_value: "0", max_value: "0", sample_count: "1" })), rowCount: 0 }
          }
          return { rows: [{ avg_value: valueOf((params?.[1] as string[])[0]!), min_value: "0", max_value: "0", sample_count: "1" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const enrollment = baseEnrollment({ current_node_id: "select-2", interaction_id: null, scheduled_subject_id: "supervisor-1", node_outputs: { "select-1": previousCollection } })
    const outcome = await processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ nodeOutput: { sourceKind: "EMPLOYEE_COLLECTION", sourceNodeId: "select-1", memberIds: ["op-1"] } })
    expect(structureQueries).toEqual([]) // nunca reconsulta estrutura/elegibilidade num refinamento
  })

  it("0 selecionados é resultado legítimo — nunca um erro", async () => {
    const node = selectNode(QUARTILE_CRITERION)
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "select", sourceHandle: "always", target: "apply" }] }
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("reports_to_id")) return { rows: [{ id: "op-1" }], rowCount: 1 }
        if (sql.includes("role = 'OPERATOR' and active")) return { rows: [{ id: "op-1" }], rowCount: 1 }
        if (sql.includes("from indicator_measurements")) return { rows: [{ avg_value: "10", min_value: "10", max_value: "10", sample_count: "1" }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment: consolidatedEnrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({ kind: "advance", nodeOutput: { memberIds: [], selectedCount: 0 } })
  })

  function rankingSelectNode(ranking?: object): FlowNode {
    return {
      id: "select",
      type: "select_employees",
      label: "Selecionar colaboradores",
      position: { x: 0, y: 0 },
      config: { selectionMode: "RANKING", ranking: ranking as never },
    }
  }
  const QUALIDADE_RANKING = {
    source: "MEASUREMENT",
    indicatorCode: "QUALIDADE",
    aggregation: "AVERAGE",
    period: { kind: "ROLLING_DAYS", days: 90 },
    selection: "LOWEST",
    count: 2,
  }

  it("selectionMode RANKING: rejeita rodar sem configuração de ranking, ANTES de resolver candidatos (nunca gasta query à toa)", async () => {
    const node = rankingSelectNode()
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "select", sourceHandle: "always", target: "end" }] }
    const db = {} as Database // nenhuma query esperada
    await expect(processNode({ db, graph, enrollment: consolidatedEnrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /precisa de uma configuração de ranking/,
    )
  })

  it("selectionMode RANKING: resolve candidatos (Estrutura ∩ Abrangência) e grava EmployeeCollectionOutput em modo RANKING com evidência de posição/valor", async () => {
    const node = rankingSelectNode(QUALIDADE_RANKING)
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "select", sourceHandle: "always", target: "apply" }] }
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: "op-1" }, { id: "op-2" }, { id: "op-3" }], rowCount: 3 }
        if (sql.includes("role = 'OPERATOR' and active")) return { rows: [{ id: "op-1" }, { id: "op-2" }, { id: "op-3" }], rowCount: 3 }
        if (sql.includes("from indicator_measurements")) {
          const values: Record<string, number> = { "op-1": 90, "op-2": 60, "op-3": 70 }
          if (sql.includes("group by m.subject_id")) {
            return { rows: (params?.[1] as string[]).map((id) => ({ subject_id: id, avg_value: String(values[id]), min_value: String(values[id]), max_value: String(values[id]), sample_count: "1" })), rowCount: 0 }
          }
          const value = values[(params?.[1] as string[])[0]!]!
          return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const outcome = await processNode({ db, graph, enrollment: consolidatedEnrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toMatchObject({
      kind: "advance",
      nextNodeId: "apply",
      eventType: "employees_selected",
      eventPayload: { evaluatedCount: 3, selectedCount: 2, rankedCount: 3, noDataCount: 0, partitionBy: "NONE", requestedCountPerPartition: 2, partitionCount: 1 },
    })
    expect(outcome).toMatchObject({
      nodeOutput: {
        kind: "EMPLOYEE_COLLECTION",
        mode: "RANKING",
        memberIds: ["op-2", "op-3"],
        partitionBy: "NONE",
        partitions: [
          {
            id: null,
            name: null,
            members: [
              { employeeId: "op-2", value: 60, position: 1 },
              { employeeId: "op-3", value: 70, position: 2 },
            ],
          },
        ],
        sourceKind: "STRUCTURE",
        sourceNodeId: null,
      },
    })
  })

  it("apply_individually: devolve outcome 'fan_out' com os membros da coleção mais próxima", async () => {
    const collection = {
      kind: "EMPLOYEE_COLLECTION",
      memberIds: ["op-1", "op-2", "op-3"],
      evaluatedCount: 10,
      selectedCount: 3,
      notMatchedCount: 5,
      noDataCount: 2,
      sourceKind: "STRUCTURE",
      sourceNodeId: null,
      criterion: QUARTILE_CRITERION,
      selectedAt: new Date().toISOString(),
    }
    const node: FlowNode = { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 0 }, config: {} }
    const graph: FlowGraph = {
      nodes: [{ id: "select", type: "select_employees", label: "Selecionar", position: { x: 0, y: 0 }, config: {} }, node],
      edges: [
        { id: "e1", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e2", source: "apply", sourceHandle: "always", target: "review" },
      ],
    }
    const enrollment = baseEnrollment({ current_node_id: "apply", interaction_id: null, scheduled_subject_id: "supervisor-1", node_outputs: { select: collection } })
    const db = {} as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(outcome).toEqual({ kind: "fan_out", fanOutNodeId: "apply", nextNodeId: "review", memberIds: ["op-1", "op-2", "op-3"] })
  })

  it("apply_individually rejeita quando não há 'Selecionar colaboradores' antes dele", async () => {
    const node: FlowNode = { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 0 }, config: {} }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "apply", sourceHandle: "always", target: "end" }] }
    const enrollment = baseEnrollment({ current_node_id: "apply", interaction_id: null, scheduled_subject_id: "supervisor-1" })
    const db = {} as Database
    await expect(processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /precisa de uma coleção de colaboradores/,
    )
  })

  it("apply_individually rejeita quando a coleção anterior ainda não foi executada nesta matrícula (node_outputs vazio)", async () => {
    const node: FlowNode = { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 0 }, config: {} }
    const graph: FlowGraph = {
      nodes: [{ id: "select", type: "select_employees", label: "Selecionar", position: { x: 0, y: 0 }, config: {} }, node],
      edges: [
        { id: "e1", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e2", source: "apply", sourceHandle: "always", target: "end" },
      ],
    }
    const enrollment = baseEnrollment({ current_node_id: "apply", interaction_id: null, scheduled_subject_id: "supervisor-1" })
    const db = {} as Database
    await expect(processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /ainda não foi executado nesta matrícula/,
    )
  })
})

describe("processNode — consolidate_results (Consolidar resultados, fan-in/JOIN)", () => {
  const consolidatedWorkflow = { ...workflowScope, consolidatedStructure: { kind: "SUPERVISOR_TEAM" as const, supervisorId: "supervisor-1" } }

  function joinGraph(): FlowGraph {
    return {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "select", type: "select_employees", label: "Selecionar", position: { x: 0, y: 0 }, config: {} },
        { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 0 }, config: {} },
        { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 0 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, instruction: null } as never },
        { id: "join", type: "consolidate_results", label: "Consolidar resultados", position: { x: 0, y: 0 }, config: {} },
        { id: "orchestrator", type: "orchestrator", label: "Resumo executivo", position: { x: 0, y: 0 }, config: { orchestratorId: "orch-1", instruction: "Resuma." } },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e0", source: "trigger", sourceHandle: "always", target: "select" },
        { id: "e1", source: "select", sourceHandle: "always", target: "apply" },
        { id: "e2", source: "apply", sourceHandle: "always", target: "review" },
        { id: "e3", source: "review", sourceHandle: "approved", target: "join" },
        { id: "e4", source: "join", sourceHandle: "always", target: "orchestrator" },
        { id: "e5", source: "orchestrator", sourceHandle: "always", target: "end" },
      ],
    }
  }

  it("apply_individually inclui joinNodeId no outcome quando há um 'Consolidar resultados' pareado adiante", async () => {
    const graph = joinGraph()
    const applyNode = graph.nodes.find((n) => n.id === "apply")!
    const collection = { kind: "EMPLOYEE_COLLECTION", memberIds: ["op-1"], evaluatedCount: 1, selectedCount: 1, notMatchedCount: 0, noDataCount: 0, sourceKind: "STRUCTURE", sourceNodeId: null, criterion: {}, selectedAt: new Date().toISOString() }
    const enrollment = baseEnrollment({ current_node_id: "apply", interaction_id: null, scheduled_subject_id: "supervisor-1", node_outputs: { select: collection } })
    const db = {} as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, applyNode)
    expect(outcome).toEqual({ kind: "fan_out", fanOutNodeId: "apply", nextNodeId: "review", memberIds: ["op-1"], joinNodeId: "join" })
  })

  it("FILHO (parent_enrollment_id presente) chegando no Join: devolve 'complete', nunca continua além dele", async () => {
    const graph = joinGraph()
    const joinNode = graph.nodes.find((n) => n.id === "join")!
    const enrollment = baseEnrollment({ current_node_id: "join", interaction_id: null, scheduled_subject_id: "op-1", parent_enrollment_id: "parent-1" })
    const db = {} as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, joinNode)
    expect(outcome).toMatchObject({ kind: "complete", nodeOutput: { kind: "EMPLOYEE_REACHED_JOIN", joinNodeId: "join" } })
  })

  it("PAI (sem parent_enrollment_id) checando o Join: devolve 'join_check' com fanOutNodeId/nextNodeId corretos, nunca consulta o banco", async () => {
    const graph = joinGraph()
    const joinNode = graph.nodes.find((n) => n.id === "join")!
    const enrollment = baseEnrollment({ current_node_id: "join", interaction_id: null, scheduled_subject_id: "supervisor-1", parent_enrollment_id: null })
    const db = {} as Database // nenhuma query esperada — processNode só DECIDE, quem consulta é engine.ts
    const outcome = await processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, joinNode)
    expect(outcome).toEqual({ kind: "join_check", joinNodeId: "join", fanOutNodeId: "apply", nextNodeId: "orchestrator" })
  })

  it("PAI checando um Join sem 'Aplicar individualmente' de origem: rejeita (defesa em runtime)", async () => {
    const node: FlowNode = { id: "join", type: "consolidate_results", label: "Consolidar resultados", position: { x: 0, y: 0 }, config: {} }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "join", sourceHandle: "always", target: "end" }] }
    const enrollment = baseEnrollment({ current_node_id: "join", interaction_id: null, scheduled_subject_id: "supervisor-1", parent_enrollment_id: null })
    const db = {} as Database
    await expect(processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "", now: new Date(), effects }, node)).rejects.toThrow(
      /precisa de um "Aplicar individualmente" antes dele/,
    )
  })

  it("Orchestrator pós-JOIN (contexto CONSOLIDATED_RESULT) despacha pra executeOrchestratorConsolidated, nunca pra executeOrchestrator — com o EmployeeFanInOutput/coleção corretos", async () => {
    executeOrchestrator.mockClear()
    executeOrchestratorConsolidated.mockClear()
    const graph = joinGraph()
    const orchestratorNode = graph.nodes.find((n) => n.id === "orchestrator")!
    const collection = { kind: "EMPLOYEE_COLLECTION", memberIds: ["op-1"], evaluatedCount: 1, selectedCount: 1, notMatchedCount: 0, noDataCount: 0, sourceKind: "STRUCTURE", sourceNodeId: null, criterion: {}, selectedAt: new Date().toISOString() }
    const fanIn = { kind: "EMPLOYEE_FAN_IN", sourceFanOutNodeId: "apply", expectedCount: 1, completedCount: 1, failedCount: 0, joinedAt: new Date().toISOString(), children: [] }
    const enrollment = baseEnrollment({
      current_node_id: "orchestrator",
      interaction_id: null,
      scheduled_subject_id: "supervisor-1",
      parent_enrollment_id: null,
      node_outputs: { select: collection, join: fanIn },
    })
    const db = {} as Database
    const outcome = await processNode({ db, graph, enrollment, workflow: consolidatedWorkflow, inputContext: "contexto", now: new Date(), effects }, orchestratorNode)
    expect(executeOrchestratorConsolidated).toHaveBeenCalledTimes(1)
    expect(executeOrchestrator).not.toHaveBeenCalled()
    // PEN-076: matrícula de uma versão publicada (version_id) — sem versão fixada no nó, o Orquestrador roda a versão da migração.
    // O alcance do Workflow vai junto: a versão fixada do Orquestrador só roda se servir a ele (resolve-orchestrator.ts).
    expect(executeOrchestratorConsolidated).toHaveBeenCalledWith(orchestratorNode.config, { db, organizationId: enrollment.organization_id, inputContext: "contexto", fanIn, collection, publishedRun: true, workflowScope: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null } })
    expect(outcome).toMatchObject({ kind: "advance", nextNodeId: "end" })
  })

  it("Orchestrator EMPLOYEE (contexto normal) continua despachando pra executeOrchestrator, nunca pra executeOrchestratorConsolidated", async () => {
    executeOrchestrator.mockClear()
    executeOrchestratorConsolidated.mockClear()
    const node: FlowNode = { id: "orchestrator", type: "orchestrator", label: "Diagnóstico", position: { x: 0, y: 0 }, config: { orchestratorId: "orch-1", instruction: "Diagnostique." } }
    const graph: FlowGraph = { nodes: [node], edges: [{ id: "e", source: "orchestrator", sourceHandle: "always", target: "end" }] }
    const enrollment = baseEnrollment({ current_node_id: "orchestrator" })
    const db = {} as Database
    const teamWorkflow = { scopeType: "SUBTEAM", teamId: "team-9", subteamId: "subteam-9", populationFilter: { kind: "ALL" } }
    await processNode({ db, graph, enrollment, workflow: teamWorkflow, inputContext: "", now: new Date(), effects }, node)
    expect(executeOrchestrator).toHaveBeenCalledTimes(1)
    expect(executeOrchestratorConsolidated).not.toHaveBeenCalled()
    // Só o alcance do Workflow, contra o qual a versão fixada do Orquestrador é conferida.
    expect(executeOrchestrator).toHaveBeenCalledWith(node.config, expect.objectContaining({ workflowScope: { scopeType: "SUBTEAM", teamId: "team-9", subteamId: "subteam-9" } }))
  })
})
